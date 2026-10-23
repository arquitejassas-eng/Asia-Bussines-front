import enum

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EstadoEnvio(str, enum.Enum):
    PENDIENTE_CONFIRMACION = "pendiente_confirmacion"
    RECIBIDO = "recibido"
    NO_LLEGO = "no_llego"


class Envio(Base):
    """
    Despacho de material desde Admin Inventario (bodega_id NULL, ver
    `Usuario.bodega_id`) hacia una sede. A diferencia de `Solicitud` (una
    bodega le pide material a otra y esta aprueba antes de mover nada), aquí
    el origen (Admin Inventario) decide y envía primero; la sede destino
    confirma después si el material realmente llegó. El origen nunca se
    guarda como columna porque siempre es el mismo: Admin Inventario.
    """

    __tablename__ = "envios"
    __table_args__ = (
        Index("ix_envios_bodega_destino_estado", "bodega_destino_id", "estado"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bodega_destino_id: Mapped[int] = mapped_column(ForeignKey("bodegas.id"), nullable=False, index=True)

    estado: Mapped[EstadoEnvio] = mapped_column(Enum(EstadoEnvio), default=EstadoEnvio.PENDIENTE_CONFIRMACION)

    enviado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_envio: Mapped[DateTime] = mapped_column(DateTime(timezone=True))

    respondido_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_respuesta: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    observaciones: Mapped[str] = mapped_column(Text, default="")

    items = relationship("EnvioItem", back_populates="envio", cascade="all, delete-orphan")


class EnvioItem(Base):
    """Línea de un envío: o bien un rollo completo específico (`rollo_id`,
    se traslada tal cual está — mismo código, metros y estado, nunca una
    cantidad suelta), o bien una cantidad de un producto por unidades
    (`producto_codigo` + `cantidad`, sí es fungible)."""

    __tablename__ = "envio_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    envio_id: Mapped[int] = mapped_column(ForeignKey("envios.id"), nullable=False, index=True)

    rollo_id: Mapped[int | None] = mapped_column(ForeignKey("rollos.id"), nullable=True, index=True)
    producto_codigo: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Empresa del producto enviado (el mismo código puede ser de las dos).
    empresa: Mapped[str] = mapped_column(String(10), default="", server_default="")
    descripcion: Mapped[str] = mapped_column(String(255), default="")
    cantidad: Mapped[float | None] = mapped_column(Float, nullable=True)

    envio = relationship("Envio", back_populates="items")
