from decimal import Decimal


def a_decimal(valor: float | Decimal) -> Decimal:
    """Convierte a Decimal pasando por texto (Decimal(0.1) daría
    0.1000000000000000055...), para operar contra columnas Numeric como
    Producto.stock sin arrastrar el error del float."""
    return Decimal(str(valor))
