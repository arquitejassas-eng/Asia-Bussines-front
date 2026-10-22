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
    # Solo productos: lo que necesita el frontend para agruparlos en tarjetas
    # igual que el inventario de cada bodega (modelo de la teja, tipo y medida).
    referencia: str = ""
    tipo_producto: str = ""
    metros_por_unidad: float | None = None
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
    # Solo rollos y sin filtro de empresa: metros de cada empresa ("AR",
    # "ABG", "" = sin empresa) en toda la compañía -> {"fisico", "reservado", "libre"}.
    # Lo apartado cuenta para la empresa de la que sale el material de cada línea.
    # En productos: el stock de cada empresa (fisico/reservado/libre de sus
    # productos), y abajo, el físico de cada empresa en cada sede.
    por_empresa: dict[str, dict[str, float]] = {}
    por_bodega_empresa: dict[int, dict[str, float]] = {}
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
    # Totales de rollos por empresa (todos los códigos): {"AR": {"fisico", "reservado", "libre"}, ...}
    totales_por_empresa: dict[str, dict[str, float]] = {}
    # Calibres de esos rollos que faltan en la tabla de equivalencias de
    # espesor: para decirle al usuario exactamente cuáles registrar.
    calibres_sin_equivalencia: list[float] = []
