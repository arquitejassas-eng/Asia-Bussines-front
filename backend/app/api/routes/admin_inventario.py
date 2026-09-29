from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, literal, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, requiere_rol
from app.services.rollos import asignar_peso_actual, filtro_empresa
from app.models.bodega import Bodega
from app.models.equivalencias import TablaEspesorEquivalencia
from app.models.producto import Producto
from app.models.rollo import FAMILIA_ROLLOS, Rollo
from app.models.usuario import RolUsuario
from app.schemas.admin_inventario import ComparativoInventarioResponse, FilaComparativoResponse
from app.schemas.rollos import RolloResponse
from app.services.clasificacion import formatear_calibre

# Todo este router es de solo lectura, por eso VENDEDOR también entra: es su
# única vista del inventario (todas las sedes). Si se agrega aquí un endpoint
# de escritura, debe restringirse solo a ADMIN_INVENTARIO en el endpoint.
router = APIRouter(
    prefix="/admin-inventario", tags=["Admin Inventario"],
    dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO, RolUsuario.VENDEDOR))],
)


def _pivotear(filas, *, con_color: bool, con_peso: bool = False, con_familia: bool = False) -> list[FilaComparativoResponse]:
    """`con_color=True` para rollos (pinta la fila por color_material en el
    frontend); productos no tienen ese concepto, solo llevan calibre.
    `con_peso=True` también agrega peso ACTUAL (toneladas, según metros
    disponibles hoy -- no el peso neto de ingreso) y cantidad de rollos por
    bodega -- solo aplica a rollos, un producto no se cuenta por unidad
    física. `con_familia=True` (solo productos) agrega la familia para
    resolver su unidad de medida en el frontend. `con_peso` y `con_familia`
    nunca se usan juntos, así que ambos reutilizan la posición 8 de `fila`."""
    agrupado: dict[str, dict] = {}
    for fila in filas:
        codigo, descripcion, bodega_id, total, extra, calibre, peso, cantidad_rollos = fila[:8]
        familia = fila[8] if con_familia else ""
        sin_peso_actual = fila[8] if con_peso else 0
        entrada = agrupado.setdefault(
            codigo, {"descripcion": "", "color_material": "", "calibre": "", "familia": "", "por_bodega": {}, "total": 0.0,
                     "peso_actual_por_bodega": {}, "peso_actual_total": 0.0, "rollos_sin_peso_actual": 0,
                     "cantidad_por_bodega": {}, "cantidad_total": 0}
        )
        cantidad = round(float(total or 0), 2)
        entrada["por_bodega"][bodega_id] = cantidad
        entrada["total"] = round(entrada["total"] + cantidad, 2)
        if descripcion and not entrada["descripcion"]:
            entrada["descripcion"] = descripcion
        if con_color and extra and not entrada["color_material"]:
            entrada["color_material"] = extra
        if calibre and not entrada["calibre"]:
            # Rollos: número (0.2 -> "0,20"). Productos: ya es texto ("31 - (0,25)").
            entrada["calibre"] = formatear_calibre(calibre) if isinstance(calibre, (int, float)) else str(calibre)
        if familia and not entrada["familia"]:
            entrada["familia"] = familia
        if con_peso:
            peso_valor = round(float(peso or 0), 2)
            entrada["peso_actual_por_bodega"][bodega_id] = peso_valor
            entrada["peso_actual_total"] = round(entrada["peso_actual_total"] + peso_valor, 2)
            entrada["rollos_sin_peso_actual"] += int(sin_peso_actual or 0)
            entrada["cantidad_por_bodega"][bodega_id] = int(cantidad_rollos or 0)
            entrada["cantidad_total"] += int(cantidad_rollos or 0)
    return [
        FilaComparativoResponse(codigo=codigo, descripcion=datos["descripcion"],
                                 color_material=datos["color_material"], calibre=datos["calibre"],
                                 familia=datos["familia"],
                                 por_bodega=datos["por_bodega"], total=datos["total"],
                                 peso_actual_por_bodega=datos["peso_actual_por_bodega"], peso_actual_total=datos["peso_actual_total"],
                                 rollos_sin_peso_actual=datos["rollos_sin_peso_actual"],
                                 cantidad_por_bodega=datos["cantidad_por_bodega"], cantidad_total=datos["cantidad_total"])
        for codigo, datos in sorted(agrupado.items())
    ]


@router.get("/comparativo", response_model=ComparativoInventarioResponse)
def comparativo_inventario(empresa: str = "", db: Session = Depends(get_db)) -> dict:
    """Compara el inventario de todas las sedes en un solo lugar. Solo
    lectura (SELECT + GROUP BY) — no reasigna la propiedad de ningún rollo
    ni producto. Admin Inventario nunca aparece: su propio material sin
    asignar (bodega_id IS NULL) se consulta en /rollos e
    /inventario/productos, no aquí. `empresa` (sigla o "sin_empresa")
    filtra solo los rollos: los productos no llevan empresa."""
    bodegas = db.query(Bodega).order_by(Bodega.nombre).all()

    # Peso ACTUAL por rollo (no el peso neto de ingreso): metros disponibles
    # hoy / mt_por_ton del espesor real. Si el calibre del rollo no está en
    # la tabla de equivalencias, mt_por_ton sale NULL del LEFT JOIN y ese
    # rollo queda fuera del SUM (SUM ignora NULL) -- se cuenta aparte en
    # sin_peso_actual_expr para poder avisarlo en el frontend, en vez de
    # subestimar el peso total en silencio.
    peso_actual_expr = case(
        (TablaEspesorEquivalencia.mt_por_ton > 0, Rollo.metros_disponibles / TablaEspesorEquivalencia.mt_por_ton),
        else_=None,
    )
    sin_peso_actual_expr = case(
        (or_(TablaEspesorEquivalencia.mt_por_ton.is_(None), TablaEspesorEquivalencia.mt_por_ton <= 0), 1),
        else_=0,
    )

    consulta_rollos = (
        db.query(
            Rollo.codigo_interno, func.max(Rollo.descripcion), Rollo.bodega_id, func.sum(Rollo.metros_disponibles),
            func.max(Rollo.color_material), func.max(Rollo.calibre), func.sum(peso_actual_expr), func.count(Rollo.id),
            func.sum(sin_peso_actual_expr),
        )
        .outerjoin(TablaEspesorEquivalencia, TablaEspesorEquivalencia.espesor == Rollo.calibre)
        # Solo rollos con material: un agotado inflaba la cantidad de rollos por
        # bodega que ven los vendedores y los avisos de calibre sin equivalencia.
        .filter(Rollo.bodega_id.isnot(None), Rollo.metros_disponibles > 0)
    )
    if empresa:
        consulta_rollos = consulta_rollos.filter(Rollo.empresa == filtro_empresa(empresa))
    filas_rollos = consulta_rollos.group_by(Rollo.codigo_interno, Rollo.bodega_id).all()

    consulta_faltantes = (
        db.query(Rollo.calibre).distinct()
        .outerjoin(TablaEspesorEquivalencia, TablaEspesorEquivalencia.espesor == Rollo.calibre)
        .filter(Rollo.bodega_id.isnot(None), Rollo.metros_disponibles > 0,
                or_(TablaEspesorEquivalencia.mt_por_ton.is_(None), TablaEspesorEquivalencia.mt_por_ton <= 0))
    )
    if empresa:
        consulta_faltantes = consulta_faltantes.filter(Rollo.empresa == filtro_empresa(empresa))
    calibres_sin_equivalencia = sorted(float(c or 0) for (c,) in consulta_faltantes.all())
    filas_productos = (
        db.query(
            # _pivotear desempaqueta por posición (codigo, descripcion, bodega_id,
            # total, extra, calibre, peso, cantidad_rollos, familia); productos no
            # usa "extra" (con_color=False) ni "peso"/"cantidad_rollos" (con_peso=False
            # por defecto) — solo el calibre real (posición 5) y familia importan aquí.
            Producto.codigo, func.max(Producto.descripcion), Producto.bodega_id, func.sum(Producto.stock),
            literal(None), func.max(Producto.calibre), literal(None), literal(None),
            func.max(Producto.familia),
        )
        .filter(Producto.bodega_id.isnot(None), Producto.familia != FAMILIA_ROLLOS)
        .group_by(Producto.codigo, Producto.bodega_id)
        .all()
    )

    rollos_pivotados = _pivotear(filas_rollos, con_color=True, con_peso=True)
    peso_actual_total_por_bodega: dict[int, float] = {}
    for fila in rollos_pivotados:
        for bodega_id, peso in fila.peso_actual_por_bodega.items():
            peso_actual_total_por_bodega[bodega_id] = round(peso_actual_total_por_bodega.get(bodega_id, 0) + peso, 2)

    return {
        "bodegas": bodegas,
        "rollos": rollos_pivotados,
        "productos": _pivotear(filas_productos, con_color=False, con_familia=True),
        "peso_actual_total_por_bodega": peso_actual_total_por_bodega,
        "peso_actual_total_general": round(sum(peso_actual_total_por_bodega.values()), 2),
        "rollos_sin_peso_actual_total": sum(fila.rollos_sin_peso_actual for fila in rollos_pivotados),
        "calibres_sin_equivalencia": calibres_sin_equivalencia,
    }


@router.get("/rollos-por-codigo", response_model=list[RolloResponse])
def rollos_por_codigo(
    codigo_interno: str = Query(..., min_length=1), empresa: str = "", db: Session = Depends(get_db),
) -> list[Rollo]:
    """Rollos individuales (uno por uno, con su propio peso, bodega,
    empresa y estado) de un código específico, en todas las sedes — para
    poder ver, desde una fila del resumen comparativo, exactamente cuál rollo
    pesa cuánto, de quién es y en qué sede está. `empresa` aplica el mismo
    filtro que el resumen."""
    consulta = (
        db.query(Rollo)
        .filter(Rollo.codigo_interno == codigo_interno, Rollo.bodega_id.isnot(None), Rollo.metros_disponibles > 0)
    )
    if empresa:
        consulta = consulta.filter(Rollo.empresa == filtro_empresa(empresa))
    rollos = consulta.order_by(Rollo.bodega_id.asc(), Rollo.fecha_ingreso.desc()).all()
    asignar_peso_actual(db, rollos)
    return rollos
