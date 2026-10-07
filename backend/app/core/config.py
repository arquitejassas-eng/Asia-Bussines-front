"""
Configuración central de la aplicación.

Toda constante que dependa del entorno (credenciales, URLs, secretos) vive
aquí y se lee desde variables de entorno — nunca hardcodeada en el resto  
del código. Esto es lo que permite pasar de MySQL local a Supabase
(Postgres) en producción sin tocar una sola línea del backend: solo cambia
la variable DATABASE_URL.
"""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENTORNO: str = "desarrollo"

    # SQLAlchemy acepta el mismo código sin importar el motor detrás de la
    # URL (mysql+pymysql:// en local, postgresql+psycopg2:// en Supabase).
    DATABASE_URL: str = "mysql+pymysql://root@localhost:3306/inventario"

    SECRET_KEY: str = "solo-desarrollo-no-usar-en-produccion"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    ORIGENES_PERMITIDOS: str = "http://localhost:5173,http://127.0.0.1:4173"
    # URL pública real del backend (sin / al final). Se declara como "servers"
    # en el esquema OpenAPI para que "Try it out" en /docs siempre apunte al
    # host correcto en vez de depender del origen relativo del navegador.
    URL_BACKEND: str = "http://localhost:8000"
    RECEPCIONES_TEMPORALES_DIR: str = "./.recepciones-temporales"
    RECEPCIONES_TEMPORALES_MINUTOS: int = 60
    MAX_ARCHIVO_RECEPCION_BYTES: int = 15 * 1024 * 1024
    # Si se configura, permite compartir recepciones entre varios workers.
    REDIS_URL: str | None = None
    # DSN opcional de Sentry para reportar errores no controlados en producción.
    SENTRY_DSN: str | None = None

    # Asistente de IA — Gemini (Google) como principal y Groq de respaldo,
    # los dos gratis dentro de su límite de uso. Basta con una de las dos
    # API keys; con las dos, si uno llega a su límite el chat sigue con el
    # otro. Si ninguno responde, el chat avisa el error en vez de inventar.
    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-flash-latest"
    GROQ_API_KEY: str | None = None
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    @property
    def lista_origenes_permitidos(self) -> list[str]:
        return [o.strip() for o in self.ORIGENES_PERMITIDOS.split(",") if o.strip()]

    @property
    def es_produccion(self) -> bool:
        return self.ENTORNO.lower() == "produccion"

    @model_validator(mode="after")
    def validar_secret_key(self) -> "Settings":
        claves_inseguras = {"", "changeme", "solo-desarrollo-no-usar-en-produccion"}
        if self.es_produccion and self.SECRET_KEY in claves_inseguras:
            raise ValueError("SECRET_KEY debe configurarse con un secreto real en produccion.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
