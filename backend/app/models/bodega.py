from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Desde estas sedes no se trasladan materiales a otras bodegas (quedan muy
# lejos): lo que solo hay allá no se puede pedir para despachar en otra.
BODEGAS_SIN_TRASLADO = {"SAN GIL"}


class Bodega(Base):
    __tablename__ = "bodegas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)

    @property
    def sin_traslado(self) -> bool:
        return " ".join((self.nombre or "").upper().split()) in BODEGAS_SIN_TRASLADO

    usuarios = relationship("Usuario", back_populates="bodega")
    productos = relationship("Producto", back_populates="bodega")
    rollos = relationship("Rollo", back_populates="bodega")
