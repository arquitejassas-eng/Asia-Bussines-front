from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.fechas import ModeloConFechasUtc

from app.models.movimiento import TipoMovimiento


class ProductoBase(BaseModel):
    codigo_importacion: str = ""
    codigo: str
    referencia: str = ""
    descripcion: str
    familia: str = ""
    calibre: str = ""
    entrada: float = 0
    stock: float = 0
    # Sin configurar (None) = no genera alerta de stock bajo para este producto.
    stock_minimo: float | None = None
    # Cuántas unidades "de medida" contiene una unidad de stock — para
    # Caballetes/Flanches es la longitud (m); para productos vendidos por
    # caja con área fija (ej. Porcelanato) son los m² por caja. Mismo campo
    # reutilizado en los dos casos, nunca obligatorio: sin configurar, el
    # producto se sigue vendiendo por la cantidad de stock tal cual (como
    # cualquier producto normal).
    metros_por_unidad: float | None = None


class ProductoCrear(ProductoBase):
    # Sin negativos al crear o editar. (No se pone en ProductoBase porque la
    # respuesta también hereda de ahí y hay stock histórico en negativo.)
    entrada: float = Field(default=0, ge=0)
    stock: float = Field(default=0, ge=0)


class ProductoActualizar(ProductoCrear):
    # Valores de stock/entrada que el formulario vio al abrirse: permiten no
    # pisar una venta o carga hecha mientras se editaba (ver
    # services/movimientos.py::aplicar_stock_editado).
    stock_anterior: float | None = None
    entrada_anterior: float | None = None


class ProductoResponse(ProductoBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    bodega_id: int | None
    rollo_id: int | None = None
    identificador_rollo: str = ""
    peso_neto: float | None = None
    # Solo poblados para el stock adicional que genera Producción (ver
    # Producto.color/ral/calidad/... en app/models/producto.py) — vacíos/None
    # para cualquier producto que no venga de ese flujo.
    color: str = ""
    ral: str = ""
    calidad: str | None = None
    motivo_segunda: str = ""
    produccion_id: int | None = None
    fecha_produccion: datetime | None = None
    codigo_rollo_origen: str = ""
    ancho_rollo: float | None = None
    tipo_producto: str = ""


class MovimientoResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    tipo: TipoMovimiento
    motivo: str
    producto_codigo: str
    producto_descripcion: str
    rollo_id: int | None = None
    identificador_rollo: str = ""
    bodega_origen_id: int | None
    bodega_destino_id: int | None
    cantidad: float
    usuario: str
    observaciones: str
    cotizacion: str = ""
    empresa_externa: str = ""


class PaginaProductos(BaseModel):
    items: list[ProductoResponse]
    total: int
    pagina: int
    tamano: int
    total_paginas: int


class PaginaMovimientos(BaseModel):
    items: list[MovimientoResponse]
    total: int
    pagina: int
    tamano: int
    total_paginas: int


class FiltrosHistorial(BaseModel):
    codigo_producto: str | None = None
    fecha_desde: datetime | None = None
    fecha_hasta: datetime | None = None

class PrevisualizacionCargaProductosResponse(BaseModel):
    nombre_archivo: str
    hoja_actual: str
    hojas_disponibles: list[str]
    encabezados: list[str]
    mapeo_sugerido: dict[str, str]
    filas_totales: int


class SeleccionarHojaCargaProductosRequest(BaseModel):
    hoja: str


class ConfirmarCargaProductosRequest(BaseModel):
    mapeo: dict[str, str]


class FilaCargaOmitida(BaseModel):
    fila: int
    codigo: str
    motivo: str


class ResultadoCargaProductosResponse(BaseModel):
    filas_totales: int
    creados: int
    actualizados: int
    omitidas: int
    detalle_omitidas: list[FilaCargaOmitida]


class MovimientoCrear(BaseModel):
    tipo: TipoMovimiento
    motivo: str = ""
    # En una entrada manual se puede crear el producto sin registrarlo antes.
    producto_id: int | None = None
    codigo_importacion: str = ""
    codigo: str = ""
    descripcion: str = ""
    familia: str = ""
    calibre: str = ""
    bodega_destino_id: int | None = None
    cantidad: float
    observaciones: str = ""
