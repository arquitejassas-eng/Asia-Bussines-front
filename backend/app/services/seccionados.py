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


def metros_de_linea(cantidad: float, medida: float | None, tipo_producto: str | None = "") -> float:
    """Metros de lámina que necesita una línea por rollo. Teja: cantidad ×
    medida. Caballete/flanche: cortes × medida, con cortes = cantidad entre
    las secciones, redondeado hacia arriba (5 caballetes de 3 m = 2 cortes =
    6 m; sale 1 de sobra, que queda como stock)."""
    medida = medida or 0
    secciones = SECCIONES_POR_TIPO_PRODUCTO.get(tipo_producto or "")
    if secciones:
        return round(math.ceil(round(cantidad / secciones, 6)) * medida, 2)
    return round(cantidad * medida, 2)
