from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.fechas import ModeloConFechasUtc


class ConsumoRolloProduccion(BaseModel):
    rollo_id: int
    metros: float = Field(gt=0)


class StockAdicionalItemCrear(BaseModel):
    """Una línea de unidades adicionales que quedaron disponibles más allá
    de lo que el apartado necesitaba (o, en producción libre, simplemente
    unidades que se quieren dejar en inventario). `calidad` clasifica cada
    línea por separado para poder tener, por ejemplo, 2 de Primera y 1 de
    Segunda con su propio motivo en la misma producción."""
    calidad: Literal["primera", "segunda"]
    cantidad: int = Field(gt=0)
    motivo_segunda: str = ""
    # Tejas: cada línea puede tener su propia medida (ej. 2 de 6 m y 3 de 3 m).
    # Sin ella se usa `metros_por_unidad` de la producción. Caballetes y
    # flanches usan siempre la de la producción (define el corte).
    metros_por_unidad: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _exigir_motivo_si_segunda(self) -> "StockAdicionalItemCrear":
        if self.calidad == "segunda" and not self.motivo_segunda.strip():
            raise ValueError("Indica el motivo/descripción del defecto para una unidad de Segunda.")
        return self


class ProduccionCrear(BaseModel):
    # "teja" (default, todo el comportamiento existente) o un producto
    # "seccionado" (caballete/flanche): se corta distinto — cada corte de N
    # metros de largo del rollo produce SIEMPRE la misma cantidad de
    # unidades (el ancho del rollo se divide siempre en ese número de
    # secciones — 3 para caballete, 5 para flanche), así que
    # `cantidad_productos` + `metros_por_unidad` (la longitud) determinan
    # cuántos cortes hacen falta y cuánto sobra — ver
    # app/services/produccion.py::SECCIONES_POR_TIPO_PRODUCTO y
    # registrar_produccion.
    tipo_producto: Literal["teja", "caballete", "flanche"] = "teja"
    producto_fabricado: str = ""
    modelo: str
    medida_producto: str
    cantidad_productos: int = Field(gt=0)
    responsable: str
    observaciones: str = ""
    rollos: list[ConsumoRolloProduccion]
    # Si viene de una solicitud de producción (apartado enviado a producción);
    # cuando se informa, la cotización se toma del apartado y no se puede editar.
    apartado_item_id: int | None = None
    # Otras líneas de la MISMA cotización y el MISMO código (color + espesor)
    # que salen en esta misma producción (ej. 11 tejas de 5,10 m y 11 de
    # 4,90 m del mismo rojo calibre 0,25). Solo tejas.
    apartado_items_extra: list[int] = []

    # Datos del lote, para las unidades de `stock_adicional` (si las hay) —
    # ninguno es obligatorio si no se registra stock adicional. Para
    # caballetes, `metros_por_unidad` (la longitud) es SIEMPRE obligatorio:
    # sin ella no se puede calcular cuántos cortes hacen falta.
    color: str = ""
    ral: str = ""
    calibre: str = ""
    metros_por_unidad: float | None = None
    stock_adicional: list[StockAdicionalItemCrear] = []

    @model_validator(mode="after")
    def _exigir_metros_por_unidad_si_hace_falta(self) -> "ProduccionCrear":
        if self.tipo_producto == "teja" and not self.calibre.strip():
            raise ValueError("Indica el calibre — es obligatorio para identificar y consolidar correctamente el stock de TEJA.")
        if self.tipo_producto in ("caballete", "flanche") and not self.metros_por_unidad:
            raise ValueError(f"Indica la longitud del {self.tipo_producto} (metros por unidad) para calcular los cortes.")
        if any(not (item.metros_por_unidad or self.metros_por_unidad) for item in self.stock_adicional):
            raise ValueError("Indica los metros por unidad de cada línea de stock adicional.")
        return self


class RolloUtilizadoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    rollo_id: int
    identificador_rollo: str
    metros_consumidos: float


class StockAdicionalGeneradoResponse(BaseModel):
    """Una unidad de stock (Producto) que quedó disponible por esta
    producción — para que la confirmación en pantalla muestre exactamente
    qué código/cantidad/calidad se generó."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    codigo: str
    descripcion: str
    stock: float
    calidad: str | None = None
    motivo_segunda: str = ""
    color: str = ""
    ral: str = ""
    calibre: str = ""
    metros_por_unidad: float | None = None
    codigo_rollo_origen: str = ""
    ancho_rollo: float | None = None
    tipo_producto: str = ""


class ProduccionResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    codigo_unico: str
    cotizacion: str
    fecha: datetime
    usuario: str
    responsable: str
    bodega_id: int
    tipo_producto: str = "teja"
    producto_fabricado: str
    modelo: str
    medida_producto: str
    cantidad_productos: int
    codigo_clasificacion: str
    total_metros_consumidos: float
    saldo_codigo: float
    metros_excedente: float = 0
    observaciones: str
    apartado_item_id: int | None = None
    cliente_apartado: str = ""
    rollos_utilizados: list[RolloUtilizadoResponse] = []
    productos_stock: list[StockAdicionalGeneradoResponse] = []
