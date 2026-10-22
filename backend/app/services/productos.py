"""Consultas de `Producto` compartidas entre módulos que antes las
reimplementaban cada uno con su propio criterio (Inventario ya usaba
`stock_minimo` por producto; Reportes e IA usaban umbrales fijos —0, 5, 10—
sin relación con lo que el usuario configura). Este archivo es el único
punto de verdad para "qué productos están en alerta de stock", evitando que
InventarioPage, la campana de Reportes y el asistente de IA muestren
resultados distintos para la misma pregunta.
"""
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import coincide_bodega
from app.models.producto import Producto
from app.models.unidad_familia import TablaUnidadFamilia

FAMILIA_ROLLOS = "Rollos de acero"

# Todo lo que identifica a un producto (qué es), a diferencia de cuánto hay
# (stock/entrada) o de dónde salió (produccion_id, fecha_produccion: son
# trazabilidad de la producción original y no se copian a otra sede).
CAMPOS_IDENTIDAD_PRODUCTO = (
    "codigo_importacion", "codigo", "referencia", "descripcion", "familia", "calibre", "stock_minimo",
    "color", "ral", "calidad", "motivo_segunda", "metros_por_unidad", "codigo_rollo_origen",
    "ancho_rollo", "tipo_producto", "empresa",
)


def familias_existentes(db: Session) -> list[str]:
    """Una por familia (sin importar mayúsculas): la forma más usada en los
    productos, más las que solo tienen unidad configurada."""
    conteo: dict[str, tuple[int, str]] = {}
    for familia, cantidad in (
        db.query(Producto.familia, func.count(Producto.id))
        .filter(Producto.familia != FAMILIA_ROLLOS)
        .group_by(Producto.familia)
    ):
        texto = (familia or "").strip()
        if texto:
            actual = conteo.get(texto.upper())
            if actual is None or cantidad > actual[0]:
                conteo[texto.upper()] = (cantidad, texto)
    for (familia,) in db.query(TablaUnidadFamilia.familia):
        texto = (familia or "").strip()
        if texto and texto.upper() not in conteo:
            conteo[texto.upper()] = (0, texto)
    return sorted((texto for _, texto in conteo.values()), key=str.upper)


def familia_existente(db: Session, familia: str) -> str:
    """La familia tal como ya está escrita si ya existe, aunque la escriban
    con otras mayúsculas o en singular/plural ("caballete" -> "CABALLETES"):
    una familia escrita distinto partía el mismo producto en dos tarjetas.
    Si no existe, queda la que escribieron (es una familia nueva)."""
    texto = " ".join((familia or "").split())
    if not texto:
        return texto
    clave = texto.upper()
    existentes = {f.upper(): f for f in familias_existentes(db)}
    for candidata in (clave, f"{clave}S", f"{clave}ES", clave[:-1] if clave.endswith("S") else None,
                      clave[:-2] if clave.endswith("ES") else None):
        if candidata and candidata in existentes:
            return existentes[candidata]
    return texto


def nuevo_producto_en_bodega(origen: Producto, *, bodega_id: int | None, cantidad) -> Producto:
    """Crea en otra bodega la fila de un producto que llega por traslado,
    solicitud aceptada o envío, copiando TODA su identidad. Antes cada flujo
    copiaba solo algunos campos: una teja de Segunda llegaba sin calidad (y
    la app la tomaba como Primera), y caballetes/flanches perdían su tipo y
    su longitud."""
    datos = {campo: getattr(origen, campo) for campo in CAMPOS_IDENTIDAD_PRODUCTO}
    return Producto(bodega_id=bodega_id, entrada=cantidad, stock=cantidad, **datos)


def productos_bajo_minimo(db: Session, bodega_id: int | None) -> list[Producto]:
    """Productos con `stock_minimo` configurado y `stock` por debajo de ese
    umbral. Un producto sin `stock_minimo` configurado nunca aparece aquí —
    mismo criterio ya usado por `GET /inventario/productos/alertas`."""
    return (
        db.query(Producto)
        .filter(
            coincide_bodega(Producto.bodega_id, bodega_id),
            Producto.familia != FAMILIA_ROLLOS,
            Producto.stock_minimo.isnot(None),
            Producto.stock < Producto.stock_minimo,
        )
        .order_by(Producto.codigo)
        .all()
    )


def productos_agotados(db: Session, bodega_id: int | None) -> list[Producto]:
    """Productos con stock en cero (o menos) — siempre crítico, sin
    importar si tienen `stock_minimo` configurado."""
    return (
        db.query(Producto)
        .filter(
            coincide_bodega(Producto.bodega_id, bodega_id),
            Producto.familia != FAMILIA_ROLLOS,
            Producto.stock <= 0,
        )
        .order_by(Producto.codigo)
        .all()
    )
