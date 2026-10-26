from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator

from app.services.seccionados import LAMINA_LISA, SECCIONES_POR_TIPO_PRODUCTO, TIPOS_LINEA_ROLLO
from app.models.apartado import EstadoApartado, ModalidadApartado
from app.services.empresas import AMBAS_EMPRESAS, EMPRESAS_CONOCIDAS
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
    # Solo POR_ROLLO: "" / "teja", "caballete" o "flanche" (ver seccionados).
    # "lamina_lisa" solo en una orden de producción interna.
    tipo_producto: str = ""
    # Orden interna, lámina lisa: en qué se convierte y qué bodega la convierte
    # (None = la misma de la línea).
    convertir_en: str = ""
    bodega_conversion_id: int | None = None

    # Solo para POR_STOCK.
    producto_id: int | None = None

    # Solo al crear: bodega de donde sale ESTA línea, si es distinta a la de la
    # cotización. Una cotización con material de varias bodegas se guarda como
    # una cotización por bodega, con el mismo número (ver crear_apartado).
    bodega_id: int | None = None
    # Empresa de la que sale el material de ESTA línea ("" = la de la
    # cotización). Una cotización de Asia puede llevar material de
    # Arquitejas: sigue siendo una sola cotización y lo que salga de esa
    # línea queda como préstamo (ver services/prestamos.py).
    empresa: str = ""

    # "Rollo completo" (POR_ROLLO): el rollo entero que se vende. El código,
    # la cantidad (1) y la medida (sus metros) los pone el backend.
    rollo_id: int | None = None

    # Solo POR_STOCK: el sistema no tiene ese producto (0 o negativo) pero
    # sí está en la bodega; se aparta igual (ver ApartadoItem.hay_fisico).
    hay_fisico: bool = False

    @model_validator(mode="after")
    def _exigir_campos_segun_modalidad(self) -> "ApartadoItemCrear":
        self.empresa = (self.empresa or "").strip().upper()
        if self.modalidad != ModalidadApartado.POR_STOCK:
            self.hay_fisico = False
        if self.empresa == AMBAS_EMPRESAS:
            # "Material de las dos empresas": solo lámina por producir (un
            # producto o un rollo completo es de una sola empresa).
            if self.modalidad != ModalidadApartado.POR_ROLLO or self.rollo_id:
                raise ValueError("\"Material de las dos empresas\" solo se puede en una línea de lámina por producir.")
        elif self.empresa and self.empresa not in EMPRESAS_CONOCIDAS:
            raise ValueError("La empresa del material de cada línea debe ser Arquitejas o Asia Business.")
        self.tipo_producto = (self.tipo_producto or "").strip().lower()
        if self.tipo_producto == "teja" or self.modalidad != ModalidadApartado.POR_ROLLO:
            self.tipo_producto = ""
        if self.tipo_producto not in (*TIPOS_LINEA_ROLLO, LAMINA_LISA):
            raise ValueError("El tipo de la línea debe ser teja, caballete, flanche o lámina lisa.")
        self.convertir_en = (self.convertir_en or "").strip().lower()
        if self.tipo_producto == LAMINA_LISA:
            if self.convertir_en not in SECCIONES_POR_TIPO_PRODUCTO:
                raise ValueError("Di en qué se convierte la lámina lisa: caballetes o flanches.")
        else:
            self.convertir_en, self.bodega_conversion_id = "", None
        if self.modalidad == ModalidadApartado.POR_ROLLO and self.rollo_id:
            return self
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
    # Orden de producción interna (Admin Inventario): solo líneas de lámina
    # por producir; lo producido entra al stock.
    orden_interna: bool = False
    items: list[ApartadoItemCrear]

    @model_validator(mode="after")
    def _empresa_valida(self) -> "ApartadoCrear":
        self.empresa = (self.empresa or "").strip().upper()
        if self.empresa not in EMPRESAS_CONOCIDAS:
            raise ValueError("Elige de qué empresa sale el material: Arquitejas o Asia Business.")
        if self.orden_interna:
            if any(i.modalidad != ModalidadApartado.POR_ROLLO or i.rollo_id for i in self.items):
                raise ValueError("Una orden de producción interna solo lleva lámina por producir (material por rollo).")
        elif any(i.tipo_producto == LAMINA_LISA for i in self.items):
            raise ValueError("La lámina lisa solo se pide en una orden de producción interna.")
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


class LineaSeparar(BaseModel):
    """Una línea que pasa a la cotización nueva: completa o solo una parte."""
    item_id: int
    cantidad: float = Field(gt=0)


class CompletarConStockRequest(BaseModel):
    """Planta no produjo todas las unidades de una línea de rollo porque una
    (o varias) salieron de una que ya estaba en stock."""
    producto_id: int
    cantidad: int = Field(gt=0)
    # El sistema dice que no hay (0 o negativo) pero en la bodega sí están:
    # Planta las saca igual (ver apartados.completar_con_stock).
    hay_fisico: bool = False


class ProductoParaCompletar(BaseModel):
    id: int
    codigo: str
    descripcion: str
    disponible: float


class StockParaCompletarResponse(BaseModel):
    # Cuántas unidades de la línea se pueden completar con stock (las que
    # todavía no se han producido).
    max_unidades: int
    productos: list[ProductoParaCompletar]
    # Empresa del material de la línea: solo salen productos de esa empresa.
    empresa: str = ""


class SepararApartadoRequest(BaseModel):
    """Lo que pasa a una cotización nueva y el número de esa cotización."""
    lineas: list[LineaSeparar] = Field(min_length=1)
    numero_cotizacion: str = Field(min_length=1, max_length=32)
    cliente: str | None = Field(default=None, max_length=150)


class ApartadoItemEditar(ApartadoItemCrear):
    # Línea que ya existe (se modifica); sin id es una línea nueva.
    id: int | None = None


class ApartadoEditar(ApartadoCrear):
    items: list[ApartadoItemEditar]
    # Edición de la cotización COMPLETA (Admin Inventario): las otras partes
    # (otras bodegas, mismo número) que se editan junto con esta. Cada línea
    # trae su bodega_id y al guardar se reparte entre las partes.
    otras_partes_ids: list[int] = []


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
    rollo_id: int | None = None
    rollo_referencia: str | None = None
    tipo_producto: str = ""
    # "" = material de la empresa de la cotización.
    empresa_material: str = ""
    hay_fisico: bool = False
    convertir_en: str = ""
    bodega_conversion_id: int | None = None
    laminas_convertidas: float = 0


class RolloParaApartarResponse(BaseModel):
    """Un rollo que se puede vender completo en una cotización."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    identificador_rollo: str
    codigo_interno: str
    descripcion: str = ""
    color_material: str = ""
    calibre: float = 0
    empresa: str = ""
    peso_neto: float | None = None
    metros_disponibles: float


class OtraBodegaConMaterial(BaseModel):
    """Bodega (que traslada) donde hay libre de lo que se está apartando."""
    bodega_id: int
    bodega: str
    cantidad: float


class OtraEmpresaConMaterial(BaseModel):
    """En la MISMA bodega hay libre de la otra empresa (ej. Asia no tiene,
    Arquitejas sí): la pantalla ofrece cambiar el material de la línea."""
    empresa: str
    cantidad: float
    # Lo que esa empresa tiene sin prometer en todas las bodegas.
    total: float = 0


class SiguienteNumeroResponse(BaseModel):
    numero: str


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
    # Sin prometer de la empresa elegida en todas las bodegas (con lo en camino).
    disponible_empresa: float | None = None
    # Dónde más hay libre de este código (de la misma empresa), de más a menos.
    otras_bodegas: list[OtraBodegaConMaterial] = []
    otras_empresas: list[OtraEmpresaConMaterial] = []


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
    # Lo que se puede prometer en toda la empresa y dónde hay fuera de esta bodega.
    disponible_empresa: float | None = None
    en_otras_bodegas: str = ""
    otras_bodegas: list[OtraBodegaConMaterial] = []
    otras_empresas: list[OtraEmpresaConMaterial] = []


class ApartadoResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    salida_pendiente: bool = False
    orden_interna: bool = False
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
    # Otras partes activas de la misma cotización: "SANTANDER", "3811-AR (RICAURTE)".
    otras_partes: list[str] = []

    @field_serializer("fecha_creacion", "fecha_enviado_a_produccion", "fecha_cancelado", "fecha_entregado", "stock_separado_en", when_used="json")
    def _serializar_fechas_opcionales(self, valor: datetime | None) -> str | None:
        if valor is None:
            return None
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.isoformat().replace("+00:00", "Z")
