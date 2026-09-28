from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.fechas import ModeloConFechasUtc

from app.models.rollo import EstadoRollo


class HistorialConsumoResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    fecha: datetime
    cantidad: float
    usuario: str
    observaciones: str


class RolloResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    bodega_id: int | None
    codigo_interno: str
    identificador_rollo: str
    codigo_proveedor: str
    empresa: str = ""
    descripcion: str
    familia: str
    color_material: str
    calibre: float
    ancho_material: float = 122
    peso_neto: float | None
    metros_proveedor: float
    metros_calculados: float
    metros_disponibles: float
    metros_consumidos: float
    fecha_ingreso: datetime
    estado: EstadoRollo
    observaciones: str
    proveedor: str
    lote: str
    peso_actual_toneladas: float | None = None
    # Sin historial_consumos: ninguna pantalla lo usaba y viajaba completo con
    # cada rollo en cada actualización automática (crece con cada consumo).
    # La hoja de vida del rollo usa GET /rollos/{id}/historial.


class PaginaRollos(BaseModel):
    items: list[RolloResponse]
    total: int
    pagina: int
    tamano: int
    total_paginas: int


class ClasificacionSugeridaResponse(BaseModel):
    """Color y descripción sugeridos a partir de rollos ya registrados con el
    mismo prefijo de código (todo antes de la coma del calibre — ej. "LA5017"
    en "LA50170,20"). No usa una tabla fija: se deriva de lo que esta bodega
    ya cargó, así se ajusta sola a cualquier color o material que usen."""
    encontrado: bool
    descripcion: str = ""
    color_material: str = ""


class SugerenciaReferenciaResponse(BaseModel):
    """Próxima referencia sugerida (ej. "LA50170,20-03"). El número final es
    único para toda la bodega, sin importar la clasificación (color/calibre)
    de otros rollos — usada para autocompletar el ingreso manual."""
    identificador_rollo: str


class RolloCrear(BaseModel):
    """Ingreso manual de UN rollo físico existente en bodega (a diferencia de
    la carga masiva por Excel en `/rollos/carga/*`, pensada para varios a la
    vez). Mismos campos y mismo criterio de "código interno" libre que ese
    flujo — no se deriva de una tabla de clasificación."""
    codigo_interno: str = Field(min_length=1, max_length=60)
    identificador_rollo: str = Field(min_length=1, max_length=60)
    codigo_proveedor: str = ""
    descripcion: str = ""
    color_material: str = ""
    calibre: float = 0
    peso_neto: float | None = None
    metros_proveedor: float = Field(ge=0, default=0)
    metros_disponibles: float = Field(ge=0)
    metros_consumidos: float = Field(ge=0, default=0)
    proveedor: str = ""
    lote: str = ""
    observaciones: str = ""


class ConsumoRolloCrear(BaseModel):
    cantidad: float
    observaciones: str = ""


class SalidaExternaRolloCrear(BaseModel):
    """Salida del rollo completo hacia otra empresa (intercambio externo) --
    nunca una cantidad parcial, igual que "solicitar un rollo" entre bodegas."""
    empresa: str = Field(min_length=1)
    observaciones: str = ""


class ActualizarObservacionesRollo(BaseModel):
    observaciones: str


class ActualizarFamiliaRollo(BaseModel):
    """Recepción registra todo bajo "Rollos de acero"; aquí la encargada de
    inventario reclasifica el rollo a la familia real (ej. "Teja Colonial")
    para que el módulo Inventario lo agrupe correctamente."""
    familia: str = Field(min_length=1, default="Rollos de acero")


class ActualizarEmpresaRollo(BaseModel):
    """Corrige a mano la empresa dueña del rollo cuando la referencia no la
    traía o se dedujo mal. "" = sin empresa."""
    empresa: str = Field(max_length=10, pattern=r"^[A-Za-z]*$")


class ActualizarAnchoRollo(BaseModel):
    """La mayoría de rollos miden 122 m de ancho (el valor por defecto); si
    uno específico es distinto, se corrige aquí — Producción de Caballetes
    lo usa para calcular el ancho de cada sección (ancho ÷ 3)."""
    ancho_material: float = Field(gt=0, default=122)


class PrevisualizacionCargaRollosResponse(BaseModel):
    nombre_archivo: str
    hoja_actual: str
    hojas_disponibles: list[str]
    encabezados: list[str]
    mapeo_sugerido: dict[str, str]
    filas_totales: int


class SeleccionarHojaCargaRollosRequest(BaseModel):
    hoja: str


class ConfirmarCargaRollosRequest(BaseModel):
    mapeo: dict[str, str]


class FilaCargaRolloOmitida(BaseModel):
    fila: int
    identificador_rollo: str
    motivo: str


class DiferenciaCargaRollo(BaseModel):
    fila: int
    identificador_rollo: str
    campo: str
    en_la_app: str
    en_el_excel: str


class ResultadoCargaRollosResponse(BaseModel):
    filas_totales: int
    creados: int
    # Rollos que ya existían: se actualizaron sus datos descriptivos, nunca
    # sus metros ni su código (ver services/carga_rollos.py::procesar_filas).
    actualizados: int
    omitidas: int
    detalle_omitidas: list[FilaCargaRolloOmitida]
    # Lo que el Excel trae distinto en rollos existentes y NO se aplicó.
    diferencias: list[DiferenciaCargaRollo] = []


class FiltrosRollos(BaseModel):
    codigo_interno: str | None = None
    codigo_proveedor: str | None = None
    descripcion: str | None = None
    familia: str | None = None
    color_material: str | None = None
    calibre: str | None = None
    estado: EstadoRollo | None = None
    fecha_desde: datetime | None = None
    fecha_hasta: datetime | None = None
