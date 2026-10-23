import enum

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EstadoSolicitud(str, enum.Enum):
    """Un traslado entre sedes (ej. Funza -> Ricaurte) tarda días, así que
    el material no se mueve al aceptar:
    PENDIENTE -> ACEPTADA (queda apartado en la bodega dueña, sin moverse)
    -> DESPACHADA (salió de la bodega dueña: va en camino)
    -> RECIBIDA (llegó: entra a la bodega que lo pidió)."""
    PENDIENTE = "pendiente"
    ACEPTADA = "aceptada"
    RECHAZADA = "rechazada"
    DESPACHADA = "despachada"
    RECIBIDA = "recibida"


# Lo que la bodega dueña ya aceptó y todavía no llega: sigue apartado para el traslado.
ESTADOS_TRASLADO_EN_CURSO = (EstadoSolicitud.ACEPTADA, EstadoSolicitud.DESPACHADA)


class TipoOperacionSolicitud(str, enum.Enum):
    SOLICITUD = "solicitud"
    PRESTAMO = "prestamo"
    INTERCAMBIO = "intercambio"


class Solicitud(Base):
    """Solicitud de material entre bodegas (módulo "Bodegas", punto 14)."""

    __tablename__ = "solicitudes"
    # La campanita y Bodegas preguntan seguido "lo de mi bodega en tal estado"
    # (pendientes, por despachar, en camino).
    __table_args__ = (
        Index("ix_solicitudes_propietaria_estado", "bodega_propietaria_id", "estado"),
        Index("ix_solicitudes_solicitante_estado", "bodega_solicitante_id", "estado"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    estado: Mapped[EstadoSolicitud] = mapped_column(
        Enum(EstadoSolicitud), default=EstadoSolicitud.PENDIENTE, index=True
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
    # Cotización para la que se pide (texto libre, como Apartado.numero_cotizacion).
    numero_cotizacion: Mapped[str] = mapped_column(String(32), default="", server_default="")

    aceptada_por: Mapped[str] = mapped_column(String(150), default="", server_default="")
    fecha_aceptada: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    despachada_por: Mapped[str] = mapped_column(String(150), default="", server_default="")
    fecha_despachada: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recibida_por: Mapped[str] = mapped_column(String(150), default="", server_default="")
    fecha_recibida: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
