from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SiigoPreferencia(Base):
    """Lo que el programa recuerda para no volver a preguntarlo al subir
    cotizaciones a Siigo, por empresa (cada una tiene su propio Siigo):

    - tipo "producto": clave = código de la línea (código de clasificación o
      código del producto de stock) -> valor = código del producto en Siigo.
    - tipo "vendedor": clave = correo del usuario -> valor = id del vendedor en Siigo.
    - tipo "cliente": clave = cédula/NIT -> valor = impuestos que lleva
      ("iva", "retefuente", "iva,retefuente" o "").
    """

    __tablename__ = "siigo_preferencias"
    __table_args__ = (UniqueConstraint("empresa", "tipo", "clave", name="uq_siigo_preferencias"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa: Mapped[str] = mapped_column(String(10), nullable=False)
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    clave: Mapped[str] = mapped_column(String(150), nullable=False)
    valor: Mapped[str] = mapped_column(String(150), default="")
    # Nombre legible (ej. el nombre del producto o del vendedor en Siigo).
    nombre: Mapped[str] = mapped_column(String(255), default="")
    actualizado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
