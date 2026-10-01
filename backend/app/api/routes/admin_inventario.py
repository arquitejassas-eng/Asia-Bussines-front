from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, literal, or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, requiere_rol
from app.api.routes.rollos import asignar_peso_actual, filtro_empresa
from app.models.apartado import Apartado, ApartadoItem, ModalidadApartado
from app.models.bodega import Bodega
from app.models.equivalencias import TablaEspesorEquivalencia
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario
from app.schemas.admin_inventario import ComparativoInventarioResponse, FilaComparativoResponse
from app.schemas.rollos import RolloResponse
from app.services.apartados import ESTADOS_RESERVA_ACTIVA
from app.services.clasificacion import formatear_calibre

# Todo este router es de solo lectura, por eso VENDEDOR también entra: es su
# única vista del inventario (todas las sedes). Si se agrega aquí un endpoint
# de escritura, debe restringirse solo a ADMIN_INVENTARIO en el endpoint.
router = APIRouter(
    prefix="/admin-inventario", tags=["Admin Inventario"],
    dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO, RolUsuario.VENDEDOR))],
)


def _agregar_apartados(filas: list[FilaComparativoResponse], reservas: dict[tuple[str, int], float]) -> None:
    """Descuenta lo apartado de cada código en cada sede: la tabla muestra
    lo físico, lo apartado y lo que de verdad queda libre para vender. Un
    código apartado sin material en la sede (viene en camino) también
    aparece, con 0 físico y el libre en negativo -- igual que en el Excel."""
    por_codigo = {fila.codigo: fila for fila in filas}
    for (codigo, bodega_id), reservado in reservas.items():
        if not reservado or not codigo:
            continue
        fila = por_codigo.get(codigo)
        if fila is None:
            fila = FilaComparativoResponse(codigo=codigo, descripcion="", por_bodega={}, total=0.0)
            filas.append(fila)
            por_codigo[codigo] = fila
        fila.por_bodega.setdefault(bodega_id, 0.0)
    filas.sort(key=lambda f: f.codigo)
    for fila in filas:
        for bodega_id, fisico in fila.por_bodega.items():
            reservado = round(reservas.get((fila.codigo, bodega_id), 0), 2)
            if reservado:
                fila.reservado_por_bodega[bodega_id] = reservado
            fila.libre_por_bodega[bodega_id] = round(fisico - reservado, 2)
        fila.reservado_total = round(sum(fila.reservado_por_bodega.values()), 2)
        fila.libre_total = round(fila.total - fila.reservado_total, 2)


def _consulta_reservas_rollos(db: Session, *columnas):
    return (
        db.query(*columnas, func.sum(ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos))
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), ApartadoItem.modalidad == ModalidadApartado.POR_ROLLO)
        .group_by(*columnas)
    )


def _reservas_rollos(db: Session, empresa: str = "") -> dict[tuple[str, int], float]:
    """Metros apartados por (código, sede). Con filtro de empresa, solo lo
    que se apartó de esa empresa (la empresa de la que sale el material)."""
    consulta = _consulta_reservas_rollos(db, ApartadoItem.codigo_interno, Apartado.bodega_id)
    if empresa:
        consulta = consulta.filter(Apartado.empresa == filtro_empresa(empresa))
    return {(codigo, bodega_id): max(float(total or 0), 0) for codigo, bodega_id, total in consulta.all()}


def _agregar_por_empresa(db: Session, filas: list[FilaComparativoResponse]) -> dict[str, dict[str, float]]:
    """Metros de cada empresa por código (físico de sus rollos en sedes,
    apartado de las cotizaciones de esa empresa, libre) y el total de la compañía."""
    fisico = (
        db.query(Rollo.codigo_interno, Rollo.empresa, func.sum(Rollo.metros_disponibles))
        .filter(Rollo.bodega_id.isnot(None), Rollo.metros_disponibles > 0)
        .group_by(Rollo.codigo_interno, Rollo.empresa)
        .all()
    )
    reservado = _consulta_reservas_rollos(db, ApartadoItem.codigo_interno, Apartado.empresa).all()
    por_codigo: dict[str, dict[str, dict[str, float]]] = {}
    for codigo, sigla, metros in fisico:
        datos = por_codigo.setdefault(codigo, {}).setdefault(sigla or "", {"fisico": 0.0, "reservado": 0.0})
        datos["fisico"] += float(metros or 0)
    for codigo, sigla, metros in reservado:
        datos = por_codigo.setdefault(codigo, {}).setdefault(sigla or "", {"fisico": 0.0, "reservado": 0.0})
        datos["reservado"] += max(float(metros or 0), 0)
    totales: dict[str, dict[str, float]] = {}
    for fila in filas:
        for sigla, datos in por_codigo.get(fila.codigo, {}).items():
            libre = datos["fisico"] - datos["reservado"]
            fila.por_empresa[sigla] = {"fisico": round(datos["fisico"], 2), "reservado": round(datos["reservado"], 2),
                                       "libre": round(libre, 2)}
            total = totales.setdefault(sigla, {"fisico": 0.0, "reservado": 0.0, "libre": 0.0})
            total["fisico"] += datos["fisico"]; total["reservado"] += datos["reservado"]; total["libre"] += libre
    return {sigla: {k: round(v, 2) for k, v in t.items()} for sigla, t in totales.items()}


def _reservas_productos(db: Session) -> dict[tuple[str, int], float]:
    filas = (
        db.query(Producto.codigo, Apartado.bodega_id, func.sum(ApartadoItem.cantidad))
        .join(ApartadoItem, ApartadoItem.producto_id == Producto.id)
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), ApartadoItem.modalidad == ModalidadApartado.POR_STOCK,
                ApartadoItem.stock_descontado.is_(False))
        .group_by(Producto.codigo, Apartado.bodega_id)
        .all()
    )
    return {(codigo, bodega_id): float(total or 0) for codigo, bodega_id, total in filas}


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
        .filter(Producto.bodega_id.isnot(None), Producto.familia != "Rollos de acero")
        .group_by(Producto.codigo, Producto.bodega_id)
        .all()
    )

    rollos_pivotados = _pivotear(filas_rollos, con_color=True, con_peso=True)
    productos_pivotados = _pivotear(filas_productos, con_color=False, con_familia=True)
    # Con filtro de empresa se descuenta lo apartado de esa empresa; sin
    # filtro, todo lo apartado (y además el desglose por empresa).
    _agregar_apartados(rollos_pivotados, _reservas_rollos(db, empresa))
    totales_por_empresa = {} if empresa else _agregar_por_empresa(db, rollos_pivotados)
    _agregar_apartados(productos_pivotados, _reservas_productos(db))
    peso_actual_total_por_bodega: dict[int, float] = {}
    for fila in rollos_pivotados:
        for bodega_id, peso in fila.peso_actual_por_bodega.items():
            peso_actual_total_por_bodega[bodega_id] = round(peso_actual_total_por_bodega.get(bodega_id, 0) + peso, 2)

    return {
        "bodegas": bodegas,
        "rollos": rollos_pivotados,
        "productos": productos_pivotados,
        "peso_actual_total_por_bodega": peso_actual_total_por_bodega,
        "peso_actual_total_general": round(sum(peso_actual_total_por_bodega.values()), 2),
        "rollos_sin_peso_actual_total": sum(fila.rollos_sin_peso_actual for fila in rollos_pivotados),
        "totales_por_empresa": totales_por_empresa,
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
