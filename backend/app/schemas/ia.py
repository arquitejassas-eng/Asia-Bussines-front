from typing import Any, Optional
from pydantic import BaseModel, Field


class ChatEntrada(BaseModel):
    mensaje: str
    historial: list[dict[str, Any]] = Field(default_factory=list)
    bodega_id: Optional[int] = None


class ChatRespuesta(BaseModel):
    respuesta: str


class AlertaIaResponse(BaseModel):
    id: int
    nivel: str  # "critico" | "advertencia" | "info"
    tipo: str
    titulo: str
    mensaje: str
    producto_id: Optional[int] = None
    producto_codigo: str = ""
    producto_descripcion: str = ""
    fecha: str


class MetricasReporte(BaseModel):
    entradas: int = 0
    salidas: int = 0
    traslados: int = 0
    transferencias: int = 0
    productos_criticos: int = 0


class ReporteIaResponse(BaseModel):
    id: int
    fecha: str
    fecha_desde: str = ""
    fecha_hasta: str = ""
    resumen: str = ""
    hallazgos: list[str] = Field(default_factory=list)
    recomendaciones: list[str] = Field(default_factory=list)
    metricas: MetricasReporte = Field(default_factory=MetricasReporte)


class GenerarReporteRequest(BaseModel):
    fecha_desde: Optional[str] = None
    fecha_hasta: Optional[str] = None


class PrediccionStockResponse(BaseModel):
    producto_id: int
    producto_codigo: str
    producto_descripcion: str
    stock_actual: float
    dias_estimados_agotamiento: Optional[float] = None
    cantidad_sugerida_reabastecer: Optional[float] = None
    confianza: Optional[float] = None
    nota: str = ""


class PrediccionNegocioResponse(BaseModel):
    periodo: str = ""
    tendencia: str = "estable"  # "creciente" | "estable" | "decreciente"
    resumen: str = ""
    factores_clave: list[str] = Field(default_factory=list)
    recomendaciones: list[str] = Field(default_factory=list)
