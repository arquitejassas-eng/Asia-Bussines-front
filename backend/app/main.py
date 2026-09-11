import logging
import time

from fastapi import FastAPI, Request
from fastapi import HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

try:
    import sentry_sdk
except ImportError:  # Permite desarrollo hasta instalar las dependencias nuevas.
    sentry_sdk = None

from app.api.router import router_api
from app.core.config import settings
from app.db.session import engine

logger = logging.getLogger("arquitejas.api")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

if settings.SENTRY_DSN and sentry_sdk:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENTORNO,
        traces_sample_rate=0.1,
    )

app = FastAPI(
    title="Arquitejas — API de Inventario",
    version="1.0.0",
    description="API del sistema de inventario multi-bodega de Arquitejas.",
    # Sin esto, Swagger UI adivina la URL base para "Try it out" a partir del
    # origen del navegador -- declararla explícitamente evita que apunte a
    # localhost cuando /docs se abre contra el backend desplegado.
    servers=[{"url": settings.URL_BACKEND, "description": settings.ENTORNO}],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.lista_origenes_permitidos,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router_api)

# Mensajes claros para las constraints de BD que sí esperamos que un usuario
# pueda chocar (ej. dos requests casi simultáneos creando el mismo código en
# la misma bodega) -- el nombre de la constraint es idéntico en MySQL local y
# Postgres/Supabase (se declaró explícito en el modelo), así que este mapeo
# funciona en ambos motores sin parsear el texto del error de cada uno.
_MENSAJES_CONSTRAINT: dict[str, str] = {
    "uq_productos_bodega_codigo": "Ya existe un producto con ese código en tu bodega. Actualiza la página e intenta de nuevo.",
}


@app.exception_handler(IntegrityError)
async def manejar_integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
    """Evita que una violación de constraint (ej. código de producto
    duplicado) llegue al cliente como un 500 crudo con detalle de SQL. No
    intenta extraer el valor exacto que chocó del texto del error -- muchos
    códigos reales de este negocio incluyen "-" y "," (los mismos separadores
    que usan los mensajes de error de MySQL/Postgres), así que un parseo
    ingenuo devolvería valores cortados mal más seguido de lo que ayudaría."""
    texto_error = str(exc.orig or exc)
    mensaje = next(
        (m for clave, m in _MENSAJES_CONSTRAINT.items() if clave in texto_error),
        "La operación no se pudo completar porque choca con datos existentes.",
    )
    logger.warning("integrity_error method=%s path=%s detail=%s", request.method, request.url.path, texto_error)
    return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": mensaje})


@app.middleware("http")
async def registrar_solicitud(request: Request, call_next):
    """Registro compacto para diagnosticar errores y latencias en producción."""
    inicio = time.perf_counter()
    try:
        respuesta = await call_next(request)
    except Exception:
        logger.exception("request_error method=%s path=%s", request.method, request.url.path)
        raise
    logger.info(
        "request method=%s path=%s status=%s duration_ms=%d",
        request.method, request.url.path, respuesta.status_code,
        (time.perf_counter() - inicio) * 1000,
    )
    return respuesta


@app.get("/", tags=["Salud"])
def estado() -> dict:
    return {"servicio": "arquitejas-api", "entorno": settings.ENTORNO, "estado": "ok"}


@app.get("/health", tags=["Salud"])
def health_check() -> dict:
    """Sondeo de disponibilidad para el balanceador; incluye la base de datos."""
    try:
        with engine.connect() as conexion:
            conexion.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Base de datos no disponible.") from exc
    return {"servicio": "arquitejas-api", "estado": "ok", "base_de_datos": "ok"}
