from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Sedes muy lejos de Bogotá y Funza: su material no cuenta al crear
# cotizaciones que salen de otra bodega (sí las de allá mismo). Los traslados
# con ellas funcionan como con cualquier bodega.
BODEGAS_LEJANAS = {"SAN GIL"}


class Bodega(Base):
    __tablename__ = "bodegas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)

    @property
    def lejana(self) -> bool:
        return " ".join((self.nombre or "").upper().split()) in BODEGAS_LEJANAS

    usuarios = relationship("Usuario", back_populates="bodega")
    productos = relationship("Producto", back_populates="bodega")
    rollos = relationship("Rollo", back_populates="bodega")
