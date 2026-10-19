import enum

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EstadoSolicitud(str, enum.Enum):
    PENDIENTE = "pendiente"
    ACEPTADA = "aceptada"
    RECHAZADA = "rechazada"


class TipoOperacionSolicitud(str, enum.Enum):
    SOLICITUD = "solicitud"
    PRESTAMO = "prestamo"
    INTERCAMBIO = "intercambio"


class Solicitud(Base):
    """Solicitud de material entre bodegas (módulo "Bodegas", punto 14)."""

    __tablename__ = "solicitudes"

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    estado: Mapped[EstadoSolicitud] = mapped_column(
        Enum(EstadoSolicitud), default=EstadoSolicitud.PENDIENTE
    )
    tipo_operacion: Mapped[TipoOperacionSolicitud] = mapped_column(Enum(TipoOperacionSolicitud))

    cantidad: Mapped[float] = mapped_column(Float, nullable=False)
    producto_codigo: Mapped[str] = mapped_column(String(60), nullable=False)
    # Empresa del producto pedido (el mismo código puede ser de las dos).
    empresa: Mapped[str] = mapped_column(String(10), default="", server_default="")
    producto_descripcion: Mapped[str] = mapped_column(String(255), default="")
    # Solo se informa para materia prima manejada por unidad (rollos).
    rollo_id: Mapped[int | None] = mapped_column(ForeignKey("rollos.id"), nullable=True, index=True)

    bodega_solicitante_id: Mapped[int] = mapped_column(ForeignKey("bodegas.id"), nullable=False)
    bodega_propietaria_id: Mapped[int] = mapped_column(ForeignKey("bodegas.id"), nullable=False)

    solicitado_por: Mapped[str] = mapped_column(String(150), default="")
    observaciones: Mapped[str] = mapped_column(Text, default="")
