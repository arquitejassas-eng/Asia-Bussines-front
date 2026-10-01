from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator

from app.models.apartado import EstadoApartado, ModalidadApartado
from app.services.empresas import EMPRESAS_CONOCIDAS
from app.schemas.fechas import ModeloConFechasUtc


class ApartadoItemCrear(BaseModel):
    # La modalidad decide qué campos de abajo son obligatorios (ver
    # `_exigir_campos_segun_modalidad`) -- por defecto POR_ROLLO para no
    # romper a ningún llamador existente que todavía no la envíe.
    modalidad: ModalidadApartado = ModalidadApartado.POR_ROLLO
    descripcion: str = ""
    cantidad: float = Field(gt=0)

    # Solo para POR_ROLLO.
    codigo_interno: str | None = None
    medida: float | None = Field(default=None, gt=0)

    # Solo para POR_STOCK.
    producto_id: int | None = None

    @model_validator(mode="after")
    def _exigir_campos_segun_modalidad(self) -> "ApartadoItemCrear":
        if self.modalidad == ModalidadApartado.POR_ROLLO:
            if not self.codigo_interno or not self.codigo_interno.strip():
                raise ValueError("Indica el código de clasificación (codigo_interno) para un ítem POR_ROLLO.")
            if not self.medida:
                raise ValueError("Indica la medida (metros por unidad) para un ítem POR_ROLLO.")
        else:
            if not self.producto_id:
                raise ValueError("Indica el producto (producto_id) para un ítem POR_STOCK.")
        return self


class ApartadoCrear(BaseModel):
    # Bodega de donde sale el material. La elige Admin Inventario (quien crea
    # los apartados); para cualquier otro rol se ignora y se usa la suya.
    bodega_id: int | None = None
    # Permite apartar más de lo que hay: material ya comprado que todavía no
    # llega. El apartado queda "esperando material" y no se puede enviar a
    # producción hasta que se le dé ingreso (ver faltantes_apartado).
    material_en_camino: bool = False
    numero_cotizacion: str = Field(min_length=1, max_length=32)
    # De qué empresa sale el material (obligatorio): "AR" o "ABG".
    empresa: str
    cliente: str = ""
    observaciones: str = ""
    items: list[ApartadoItemCrear]

    @model_validator(mode="after")
    def _empresa_valida(self) -> "ApartadoCrear":
        self.empresa = (self.empresa or "").strip().upper()
        if self.empresa not in EMPRESAS_CONOCIDAS:
            raise ValueError("Elige de qué empresa sale el material: Arquitejas o Asia Business.")
        return self


class RolloUsadoEnSalida(BaseModel):
    """Un rollo de la hoja de vida física: de qué línea, cuál rollo y cuánto."""
    item_id: int
    referencia: str = Field(min_length=1)
    metros: float = Field(gt=0)


class RegistrarSalidaRequest(BaseModel):
    rollos: list[RolloUsadoEnSalida] = []
    # Líneas de producto de stock a descontar (caballetes, tornillos...).
    items_stock: list[int] = []


class ApartadoItemEditar(ApartadoItemCrear):
    # Línea que ya existe (se modifica); sin id es una línea nueva.
    id: int | None = None


class ApartadoEditar(ApartadoCrear):
    items: list[ApartadoItemEditar]


class ApartadoItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    modalidad: ModalidadApartado
    codigo_interno: str | None = None
    descripcion: str
    cantidad: float
    medida: float | None = None
    metros_requeridos: float | None = None
    metros_consumidos: float
    producto_id: int | None = None
    stock_descontado: bool
    metros_pendientes: float | None = None
    tiene_produccion_registrada: bool = False


class DisponibilidadCodigoResponse(BaseModel):
    """Material que hay de un código de clasificación (color + calibre), para
    que la encargada de inventario vea cuánto puede apartar antes de crearlo."""
    codigo_interno: str
    familia: str
    color_material: str
    calibre: float
    cantidad_rollos: int
    metros_disponibles: float
    metros_reservados: float
    metros_consumidos: float
    metros_en_camino: float = 0
    metros_por_repartir: float = 0
    metros_esperando: float = 0
    metros_para_apartar: float = 0


class ReservaCodigoResponse(BaseModel):
    """Metros reservados (apartados activos) de un código, agregados para toda
    la bodega — usado en "Rollos almacenados" para mostrar el stock físico ya
    descontado por reservas, sin tener que consultarlo código por código."""
    codigo_interno: str
    metros_reservados: float


class DisponibilidadProductoResponse(BaseModel):
    """Análogo a `DisponibilidadCodigoResponse`, pero para un `Producto` de
    stock: cuánto hay, cuánto ya está reservado por apartados activos, y
    cuánto queda disponible antes de crear un apartado POR_STOCK."""
    producto_id: int
    codigo: str
    descripcion: str
    stock: float
    cantidad_reservada: float
    cantidad_disponible: float


class ApartadoResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    bodega_id: int
    bodega_nombre: str = ""
    numero_cotizacion: str
    empresa: str = ""
    cliente: str
    creado_por: str
    fecha_creacion: datetime
    estado: EstadoApartado
    enviado_a_produccion_por: str
    fecha_enviado_a_produccion: datetime | None
    cancelado_por: str
    fecha_cancelado: datetime | None
    fecha_entregado: datetime | None
    observaciones: str
    stock_separado_confirmado: bool
    stock_separado_por: str
    stock_separado_en: datetime | None
    items: list[ApartadoItemResponse] = []
    # Lo que todavía no ha llegado a la bodega (ej. "faltan 200 m de LA50170,50").
    faltantes: list[str] = []

    @field_serializer("fecha_creacion", "fecha_enviado_a_produccion", "fecha_cancelado", "fecha_entregado", "stock_separado_en", when_used="json")
    def _serializar_fechas_opcionales(self, valor: datetime | None) -> str | None:
        if valor is None:
            return None
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.isoformat().replace("+00:00", "Z")
