"""Productos que Planta mandó al stock sin que existieran en el inventario.

Cuando una producción deja stock de algo que no está creado (una teja de una
medida nueva, un caballete, lámina lisa...), el producto nace con un código
provisional sacado del código de la producción ("PROD-20261110...-1"). Ese
código no sirve para vender ni para Siigo: Admin Inventario recibe el aviso y
le pone el código real desde Inventario total.

Un mismo código provisional puede estar en varias bodegas (si ya se trasladó):
se cambia en todas a la vez, y también en el historial (movimientos,
traslados, envíos y préstamos) para que el producto no quede con dos nombres.
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.bodega import Bodega
from app.models.envio import EnvioItem
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.prestamo import PrestamoEmpresa
from app.models.producto import Producto
from app.models.solicitud import Solicitud
from app.models.usuario import Usuario
from app.services.empresas import EMPRESAS_CONOCIDAS

PREFIJO_PROVISIONAL = "PROD-"
MAX_SUGERENCIAS = 5


def es_provisional(codigo: str | None) -> bool:
    return (codigo or "").upper().startswith(PREFIJO_PROVISIONAL)


def _parecidos(db: Session, producto: Producto) -> list[dict]:
    """Productos ya codificados que parecen el mismo: misma familia, medida,
    calidad y empresa (y mismo color y calibre si los tiene). Son la
    sugerencia de un clic; Admin Inventario decide."""
    consulta = db.query(Producto).filter(
        Producto.familia == producto.familia, ~Producto.codigo.ilike(f"{PREFIJO_PROVISIONAL}%"),
        Producto.empresa == (producto.empresa or ""), Producto.calidad == producto.calidad,
    )
    if producto.metros_por_unidad:
        consulta = consulta.filter(Producto.metros_por_unidad.between(
            float(producto.metros_por_unidad) - 0.005, float(producto.metros_por_unidad) + 0.005))
    if producto.color:
        consulta = consulta.filter(Producto.color == producto.color)
    if producto.calibre:
        consulta = consulta.filter(Producto.calibre == producto.calibre)
    vistos: dict[str, dict] = {}
    for otro in consulta.order_by(Producto.stock.desc()).limit(40):
        if otro.codigo not in vistos:
            vistos[otro.codigo] = {"codigo": otro.codigo, "descripcion": otro.descripcion}
        if len(vistos) == MAX_SUGERENCIAS:
            break
    return list(vistos.values())


def productos_sin_codigo(db: Session) -> list[dict]:
    """Uno por código provisional con existencias, con las bodegas donde está."""
    productos = (
        db.query(Producto)
        .filter(Producto.codigo.ilike(f"{PREFIJO_PROVISIONAL}%"), Producto.stock > 0)
        .order_by(Producto.fecha_produccion.desc().nullslast(), Producto.id.desc())
        .all()
    )
    bodegas = {b.id: b.nombre for b in db.query(Bodega).all()}
    grupos: dict[str, dict] = {}
    for p in productos:
        grupo = grupos.get(p.codigo)
        if grupo is None:
            grupo = grupos[p.codigo] = {
                "codigo": p.codigo, "descripcion": p.descripcion, "familia": p.familia or "",
                "empresa": p.empresa or "", "calidad": p.calidad or "", "fecha": p.fecha_produccion,
                "stock": 0.0, "bodegas": [], "sugerencias": _parecidos(db, p),
            }
        grupo["stock"] = round(grupo["stock"] + float(p.stock), 2)
        grupo["bodegas"].append({"nombre": bodegas.get(p.bodega_id, "Admin Inventario"), "stock": float(p.stock)})
    return list(grupos.values())


def poner_codigo(db: Session, codigo_provisional: str, codigo_nuevo: str, usuario: Usuario) -> int:
    """Cambia el código provisional por el real en todas las bodegas. Devuelve
    cuántas filas de producto cambiaron. No junta productos: si en una bodega
    ya hay otro producto con ese código, avisa para que se escoja otro."""
    nuevo = " ".join((codigo_nuevo or "").split()).upper()
    if not nuevo:
        raise HTTPException(status_code=400, detail="Escribe el código del producto.")
    if es_provisional(nuevo):
        raise HTTPException(status_code=400, detail="Ese es un código de producción: escribe el código real del producto.")
    if len(nuevo) > 50:
        raise HTTPException(status_code=400, detail="El código no puede tener más de 50 caracteres.")
    productos = db.query(Producto).filter(Producto.codigo == codigo_provisional).with_for_update().all()
    if not productos:
        raise HTTPException(status_code=404, detail="Ese producto ya tiene código o ya no existe. Recarga la lista.")

    bodegas = {b.id: b.nombre for b in db.query(Bodega).all()}
    for p in productos:
        choca = db.query(Producto).filter(
            Producto.bodega_id == p.bodega_id, Producto.codigo == nuevo,
            Producto.empresa == (p.empresa or ""), Producto.id != p.id,
        ).first()
        if choca is not None:
            empresa = EMPRESAS_CONOCIDAS.get(p.empresa or "", p.empresa or "")
            raise HTTPException(
                status_code=400,
                detail=f"En {bodegas.get(p.bodega_id, 'esa bodega')} ya hay un producto de {empresa} con el código "
                f"{nuevo} ({choca.descripcion}). Usa otro código, o pásale estas unidades a ese producto con un ajuste.",
            )

    for p in productos:
        p.codigo = nuevo
    for modelo, columna in ((Movimiento, Movimiento.producto_codigo), (Solicitud, Solicitud.producto_codigo),
                            (EnvioItem, EnvioItem.producto_codigo), (PrestamoEmpresa, PrestamoEmpresa.codigo)):
        db.query(modelo).filter(columna == codigo_provisional).update({columna: nuevo}, synchronize_session=False)
    # Queda en el historial quién le puso el código (cantidad 0: no mueve stock).
    db.add(Movimiento(
        fecha=datetime.now(timezone.utc), tipo=TipoMovimiento.ENTRADA, motivo="codigo_asignado",
        producto_codigo=nuevo, producto_descripcion=productos[0].descripcion[:255],
        bodega_origen_id=None, bodega_destino_id=productos[0].bodega_id, cantidad=0, usuario=usuario.correo,
        observaciones=f"Código asignado por Admin Inventario: antes {codigo_provisional} (código provisional de la producción).",
    ))
    return len(productos)
