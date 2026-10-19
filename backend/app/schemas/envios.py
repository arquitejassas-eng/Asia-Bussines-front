from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator

from app.models.envio import EstadoEnvio
from app.schemas.fechas import ModeloConFechasUtc


class EnvioItemCrear(BaseModel):
    """Dos formas mutuamente excluyentes: un rollo completo (`rollo_id`, sin
    cantidad — se envía tal cual está, nunca una parte) o una cantidad de un
    producto por unidades (`producto_codigo` + `cantidad`)."""
    rollo_id: int | None = None
    producto_codigo: str | None = None
    # Empresa del producto (el mismo código puede ser de Arquitejas y de Asia).
    empresa: str = ""
    cantidad: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _validar_forma(self) -> "EnvioItemCrear":
        if self.rollo_id is not None and self.producto_codigo is not None:
            raise ValueError("Un ítem de envío es un rollo o un producto, no ambos.")
        if self.rollo_id is None and self.producto_codigo is None:
            raise ValueError("Cada ítem necesita un rollo_id o un producto_codigo.")
        if self.producto_codigo is not None and not self.cantidad:
            raise ValueError("Indica la cantidad a enviar de ese producto.")
        if self.rollo_id is not None and self.cantidad is not None:
            raise ValueError("Un rollo se envía completo, no lleva cantidad.")
        return self


class EnvioCrear(BaseModel):
    bodega_destino_id: int
    items: list[EnvioItemCrear]
    observaciones: str = ""


class EnvioItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    rollo_id: int | None
    producto_codigo: str | None
    empresa: str = ""
    descripcion: str
    cantidad: float | None


class EnvioResponse(ModeloConFechasUtc):
    model_config = ConfigDict(from_attributes=True)
    id: int
    bodega_destino_id: int
    estado: EstadoEnvio
    enviado_por: str
    fecha_envio: datetime
    respondido_por: str
    fecha_respuesta: datetime | None
    observaciones: str
    items: list[EnvioItemResponse] = []

    @field_serializer("fecha_envio", when_used="json")
    def _serializar_fecha_envio(self, valor: datetime) -> str:
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.isoformat().replace("+00:00", "Z")

    @field_serializer("fecha_respuesta", when_used="json")
    def _serializar_fecha_respuesta(self, valor: datetime | None) -> str | None:
        if valor is None:
            return None
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.isoformat().replace("+00:00", "Z")
