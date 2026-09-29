"""Filtros de consulta compartidos por rutas y servicios.

Vive en la capa de datos (no en app/api) para que los servicios no dependan
de la capa HTTP.
"""


def coincide_bodega(columna, bodega_id: int | None):
    """Filtra una columna de bodega por el `bodega_id` de un usuario, que es
    None para las cuentas sin bodega fija (Admin Inventario: su material sin
    asignar tiene bodega_id NULL). Deja explícito ese caso con IS NULL; para
    los demás roles equivale a `columna == bodega_id`. Recibe el id directo
    (no el `Usuario`) para usarse también en servicios que solo reciben
    `bodega_id` (ej. app/services/ia_herramientas.py)."""
    return columna.is_(None) if bodega_id is None else columna == bodega_id
