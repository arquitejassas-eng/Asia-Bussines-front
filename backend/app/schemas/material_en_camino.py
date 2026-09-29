from datetime import datetime

from pydantic import BaseModel

from app.schemas.fechas import ModeloConFechasUtc


class GuardarEnCaminoRequest(BaseModel):
    bodega_id: int
    proveedor_principal: str = ""


class CodigoEnCamino(BaseModel):
    codigo_interno: str
    descripcion: str
    rollos: int
    metros: float


class CargamentoResponse(ModeloConFechasUtc):
    id: int
    bodega_id: int
    bodega_nombre: str
    proveedor: str
    archivo_origen: str
    creado_por: str
    fecha_creacion: datetime
    estado: str
    llego_por: str
    fecha_llegada: datetime | None
    total_rollos: int
    total_metros: float
    rollos_ya_registrados: int
    codigos: list[CodigoEnCamino]
