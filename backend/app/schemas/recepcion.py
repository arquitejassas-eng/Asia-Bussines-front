from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.fechas import ModeloConFechasUtc


class PrevisualizacionRollo(BaseModel):
    fila: int
    rollo: str
    codigo_proveedor: str = ""
    espesor: float | None = None
    ancho: float | None = None
    net_weight: float | None = None
    gross_weight: float | None = None
    coil_meters: float | None = None
    color_top: str = ""
    color_back: str = ""
    tipo_material: str = ""
    proveedor: str = ""
    lote: str = ""
    empresa: str = ""  # sigla de la empresa receptora; "" = se deduce de la referencia
    # "" | "sin_referencia" | "repetida_en_archivo" | "ya_existe" (se omitirá al confirmar)
    problema_referencia: str = ""

    clasificado: bool
    codigo_clasificacion: str | None = None
    color_nombre: str | None = None
    tipo_nombre: str | None = None

    metros_calculados: float | None = None
    diferencia_porcentaje: float | None = None
    resultado: str  # "ok" | "diferencia" | "pendiente_datos"


class ResumenVerificacion(BaseModel):
    total_rollos: int
    ok: int
    con_diferencia: int
    pendientes_datos: int


class PrevisualizacionRecepcionResponse(BaseModel):
    nombre_archivo: str
    hoja_actual: str
    hojas_disponibles: list[str]
    encabezados: list[str]
    mapeo_sugerido: dict[str, str]
    filas_totales: int
    nota_importacion_equivalencias: str = ""


class SeleccionarHojaRecepcionRequest(BaseModel):
    hoja: str


class ProcesarRecepcionRequest(BaseModel):
    mapeo: dict[str, str]
    tolerancia_porcentaje: float = 2


class VerificacionRecepcionResponse(BaseModel):
    rollos: list[PrevisualizacionRollo]
    resumen: ResumenVerificacion
    estado_recepcion: str


class ConfirmarRecepcionRequest(BaseModel):
    tolerancia_porcentaje: float = 2
    proveedor_principal: str = ""


class RecepcionResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    bodega_id: int | None
    encargado: str
    proveedor: str
    archivo_origen: str
    tolerancia_porcentaje: float
    estado: str
    # Solo en la respuesta de /confirmar (en el historial quedan en su valor
    # por defecto): rollos registrados y referencias omitidas por existir ya.
    rollos_registrados: int = 0
    rollos_omitidos: list[str] = []


class EquivalenciaColorInput(BaseModel):
    ral: str
    nombre: str
    codigo_interno: str


class EquivalenciaColorResponse(EquivalenciaColorInput):
    model_config = ConfigDict(from_attributes=True)
    id: int


class EquivalenciaTipoInput(BaseModel):
    nombre: str
    codigo_interno: str


class EquivalenciaTipoResponse(EquivalenciaTipoInput):
    model_config = ConfigDict(from_attributes=True)
    id: int


class EquivalenciaEspesorInput(BaseModel):
    espesor: float
    mt_por_ton: float
    peso_por_metro: float


class EquivalenciaEspesorResponse(EquivalenciaEspesorInput):
    model_config = ConfigDict(from_attributes=True)
    id: int


class TablasEquivalenciaResponse(BaseModel):
    colores: list[EquivalenciaColorResponse]
    tipos: list[EquivalenciaTipoResponse]
    espesores: list[EquivalenciaEspesorResponse]
