from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.fechas import ModeloConFechasUtc

from app.models.solicitud import EstadoSolicitud, TipoOperacionSolicitud


class BodegaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nombre: str


class BodegaCrear(BaseModel):
    nombre: str


class SolicitudCrear(BaseModel):
    producto_id: int | None = None
    rollo_id: int | None = None
    cantidad: float | None = None
    tipo_operacion: TipoOperacionSolicitud = TipoOperacionSolicitud.SOLICITUD
    observaciones: str = ""
    # Cotización para la que se pide el traslado (opcional).
    numero_cotizacion: str = Field(default="", max_length=32)


class SolicitudResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    estado: EstadoSolicitud
    tipo_operacion: TipoOperacionSolicitud
    cantidad: float
    producto_codigo: str
    producto_descripcion: str
    rollo_id: int | None = None
    bodega_solicitante_id: int
    bodega_propietaria_id: int
    solicitado_por: str
    observaciones: str
    empresa: str = ""
    numero_cotizacion: str = ""
    aceptada_por: str = ""
    fecha_aceptada: datetime | None = None
    despachada_por: str = ""
    fecha_despachada: datetime | None = None
    recibida_por: str = ""
    fecha_recibida: datetime | None = None

    @field_serializer("fecha_aceptada", "fecha_despachada", "fecha_recibida", when_used="json")
    def _serializar_fechas_traslado(self, valor: datetime | None) -> str | None:
        if valor is None:
            return None
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.isoformat().replace("+00:00", "Z")
