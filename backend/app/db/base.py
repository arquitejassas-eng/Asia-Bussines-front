"""
Base declarativa de SQLAlchemy.

Todos los modelos heredan de `Base`. Este archivo también reimporta cada
módulo de modelos para que Alembic los "vea" al generar migraciones
automáticas (autogenerate) — sin este import, una tabla nueva no se
detectaría aunque el modelo exista.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Importados solo por su efecto secundario (registrar las tablas en Base.metadata).
from app.models import (  # noqa: E402,F401
    apartado,
    bodega,
    envio,
    equivalencias,
    material_en_camino,
    movimiento,
    produccion,
    producto,
    recepcion,
    rollo,
    solicitud,
    unidad_familia,
    usuario,
)
