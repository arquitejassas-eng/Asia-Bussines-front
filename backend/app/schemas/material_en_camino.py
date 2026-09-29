from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_serializer


def _utc(valor: datetime | None) -> str | None:
    if valor is None:
        return None
    if valor.tzinfo is None:
        valor = valor.replace(tzinfo=timezone.utc)
    return valor.isoformat().replace("+00:00", "Z")


class GuardarEnCaminoRequest(BaseModel):
    proveedor_principal: str = ""


class MarcarLlegadaRequest(BaseModel):
    # Los rollos que trajo esta mula.
    rollo_ids: list[int] = Field(min_length=1)


class RolloEnCamino(BaseModel):
    id: int
    identificador_rollo: str
    codigo_interno: str
    descripcion: str
    metros: float
    llego: bool
    llego_por: str
    fecha_llegada: datetime | None
    ya_tiene_ingreso: bool

    @field_serializer("fecha_llegada", when_used="json")
    def _fecha(self, valor: datetime | None) -> str | None:
        return _utc(valor)


class CargamentoResponse(BaseModel):
    id: int
    proveedor: str
    archivo_origen: str
    creado_por: str
    fecha_creacion: datetime
    estado: str
    cerrado_por: str
    fecha_cierre: datetime | None
    total_rollos: int
    rollos_llegados: int
    total_metros: float
    metros_pendientes: float
    rollos_ya_con_ingreso: int
    rollos: list[RolloEnCamino]

    @field_serializer("fecha_creacion", "fecha_cierre", when_used="json")
    def _fechas(self, valor: datetime | None) -> str | None:
        return _utc(valor)
