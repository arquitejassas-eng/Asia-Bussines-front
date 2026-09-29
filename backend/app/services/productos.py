"""Consultas de `Producto` compartidas entre módulos que antes las
reimplementaban cada uno con su propio criterio (Inventario ya usaba
`stock_minimo` por producto; Reportes e IA usaban umbrales fijos —0, 5, 10—
sin relación con lo que el usuario configura). Este archivo es el único
punto de verdad para "qué productos están en alerta de stock", evitando que
InventarioPage, la campana de Reportes y el asistente de IA muestren
resultados distintos para la misma pregunta.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.filtros import coincide_bodega
from app.models.producto import Producto

from app.models.rollo import FAMILIA_ROLLOS  # noqa: E402 -- se re-exporta aquí

# Todo lo que identifica a un producto (qué es), a diferencia de cuánto hay
# (stock/entrada) o de dónde salió (produccion_id, fecha_produccion: son
# trazabilidad de la producción original y no se copian a otra sede).
CAMPOS_IDENTIDAD_PRODUCTO = (
    "codigo_importacion", "codigo", "referencia", "descripcion", "familia", "calibre", "stock_minimo",
    "color", "ral", "calidad", "motivo_segunda", "metros_por_unidad", "codigo_rollo_origen",
    "ancho_rollo", "tipo_producto",
)


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
