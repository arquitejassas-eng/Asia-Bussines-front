"""Productos "seccionados" (caballete, flanche): el ancho del rollo se divide
siempre en N partes iguales, así que cada corte a lo largo del rollo produce
SIEMPRE N unidades. Un solo lugar define cuántas secciones tiene cada tipo:
lo usan la cotización (cuánta lámina apartar) y Producción (cuántos cortes
hacer). Debe coincidir con SECCIONES_POR_TIPO_PRODUCTO del frontend
(src/Utils/produccion.ts)."""

import math

SECCIONES_POR_TIPO_PRODUCTO = {"caballete": 3, "flanche": 5}

# Tipo de una línea de cotización por rollo: "" = teja (o lámina por metro).
TIPOS_LINEA_ROLLO = ("", *SECCIONES_POR_TIPO_PRODUCTO)

# Lámina lisa (cantidad x medida, como la teja): solo en una orden de
# producción interna; después se convierte en caballetes o flanches.
LAMINA_LISA = "lamina_lisa"


# La teja COLONIAL gasta un 6 % más de lámina que su medida (60 tejas de 3 m
# = 180 m × 1,06 = 190,8 m del rollo), sin importar calibre ni lámina. Ese 6 %
# es parte de la venta (no merma). En Siigo se cobra la medida (180 m).
FACTOR_COLONIAL = 1.06


def es_colonial(descripcion: str | None) -> bool:
    from app.services.modelos_teja import modelo_en_descripcion
    return modelo_en_descripcion(descripcion) == "COLONIAL"


def metros_de_linea(cantidad: float, medida: float | None, tipo_producto: str | None = "",
                    descripcion: str | None = None) -> float:
    """Metros de lámina que necesita una línea por rollo. Teja: cantidad ×
    medida (× 1,06 si la descripción es de teja COLONIAL; sin descripción,
    como para Siigo, no se suma). Caballete/flanche: cortes × medida, con
    cortes = cantidad entre las secciones, redondeado hacia arriba (5
    caballetes de 3 m = 2 cortes = 6 m; sale 1 de sobra, que queda como stock)."""
    medida = medida or 0
    secciones = SECCIONES_POR_TIPO_PRODUCTO.get(tipo_producto or "")
    if secciones:
        return round(math.ceil(round(cantidad / secciones, 6)) * medida, 2)
    if not tipo_producto and es_colonial(descripcion):
        return round(cantidad * medida * FACTOR_COLONIAL, 2)
    return round(cantidad * medida, 2)
