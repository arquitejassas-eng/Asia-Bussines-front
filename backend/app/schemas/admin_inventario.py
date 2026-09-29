from pydantic import BaseModel

from app.schemas.bodegas import BodegaResponse


class FilaComparativoResponse(BaseModel):
    codigo: str
    descripcion: str
    color_material: str = ""
    calibre: str = ""
    # Solo para productos (no rollos) — resuelve la unidad de medida junto
    # con TablaUnidadFamilia en el frontend.
    familia: str = ""
    por_bodega: dict[int, float]
    total: float
    # Lo apartado por cotizaciones activas (aún sin producir/entregar) y lo
    # libre = físico - apartado. Puede quedar negativo si se apartó material
    # que viene en camino. Vacío cuando se filtra por empresa: los apartados
    # no son de una empresa.
    reservado_por_bodega: dict[int, float] = {}
    reservado_total: float = 0.0
    libre_por_bodega: dict[int, float] = {}
    libre_total: float = 0.0
    # Solo para rollos (peso ACTUAL en toneladas -- según metros disponibles
    # hoy, no el peso neto de ingreso -- y cantidad de rollos); en productos
    # quedan vacíos, un producto no se cuenta por unidad física.
    peso_actual_por_bodega: dict[int, float] = {}
    peso_actual_total: float = 0.0
    # Rollos de este código que no entraron en la suma de arriba porque su
    # calibre no está en la tabla de equivalencias (mt_por_ton desconocido).
    rollos_sin_peso_actual: int = 0
    cantidad_por_bodega: dict[int, int] = {}
    cantidad_total: int = 0


class ComparativoInventarioResponse(BaseModel):
    """Inventario de todas las sedes lado a lado. Admin Inventario nunca
    aparece aquí — su material sin asignar se ve en /rollos e
    /inventario/productos (bodega_id IS NULL), no en esta vista agregada."""
    bodegas: list[BodegaResponse]
    rollos: list[FilaComparativoResponse]
    productos: list[FilaComparativoResponse]
    peso_actual_total_por_bodega: dict[int, float] = {}
    peso_actual_total_general: float = 0.0
    rollos_sin_peso_actual_total: int = 0
    # Calibres de esos rollos que faltan en la tabla de equivalencias de
    # espesor: para decirle al usuario exactamente cuáles registrar.
    calibres_sin_equivalencia: list[float] = []
