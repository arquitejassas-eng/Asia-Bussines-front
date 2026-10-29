from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.fechas import ModeloConFechasUtc


class PrestamoResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fecha: datetime
    empresa_presta: str
    empresa_recibe: str
    prestador: str = ""
    bodega_id: int | None = None
    apartado_id: int | None = None
    numero_cotizacion: str
    tipo: str
    codigo: str
    descripcion: str
    cantidad: float
    unidad: str
    referencia_rollo: str
    origen: str
    usuario: str
    saldado: bool
    saldado_por: str
    fecha_saldado: datetime | None = None

    @field_serializer("fecha_saldado", when_used="json")
    def _serializar_fecha_saldado(self, valor: datetime | None) -> str | None:
        if valor is None:
            return None
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.isoformat().replace("+00:00", "Z")


class DeudaEmpresaResponse(BaseModel):
    """Lo que `debe` le debe a `presta` de un material, neto (sin saldar)."""
    tipo: str
    codigo: str
    descripcion: str
    unidad: str
    presta: str
    debe: str
    cantidad: float


class SacadoSinExistenciaResponse(ModeloConFechasUtc):
    """Lo que Planta sacó de la bodega aunque el sistema no lo tenía."""
    fecha: datetime
    bodega_id: int | None = None
    producto_codigo: str
    producto_descripcion: str
    cantidad: float
    cotizacion: str
    usuario: str
    observaciones: str


class ReportePrestamosResponse(BaseModel):
    resumen: list[DeudaEmpresaResponse]
    prestamos: list[PrestamoResponse]
    sacado_sin_existencia: list[SacadoSinExistenciaResponse]


class SaldarPrestamosRequest(BaseModel):
    ids: list[int] = Field(min_length=1)
