import enum

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TipoMovimiento(str, enum.Enum):
    ENTRADA = "entrada"
    SALIDA = "salida"
    TRASLADO = "traslado"
    TRANSFERENCIA = "transferencia"  # aceptación de una solicitud entre bodegas


class Movimiento(Base):
    """Historial global de inventario — cada bodega ve solo los movimientos
    donde participó como origen o destino."""

    __tablename__ = "movimientos"
    __table_args__ = (
        Index("ix_movimientos_origen_fecha", "bodega_origen_id", "fecha"),
        Index("ix_movimientos_destino_fecha", "bodega_destino_id", "fecha"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    tipo: Mapped[TipoMovimiento] = mapped_column(Enum(TipoMovimiento), nullable=False)
    motivo: Mapped[str] = mapped_column(String(60), default="")

    # Índice creado en la migración 20260903_01 (aquí para que el modelo lo diga también).
    producto_codigo: Mapped[str] = mapped_column(String(60), default="", index=True)
    producto_descripcion: Mapped[str] = mapped_column(String(255), default="")

    rollo_id: Mapped[int | None] = mapped_column(ForeignKey("rollos.id"), nullable=True, index=True)
    identificador_rollo: Mapped[str] = mapped_column(String(60), default="")

    bodega_origen_id: Mapped[int | None] = mapped_column(ForeignKey("bodegas.id"), nullable=True)
    bodega_destino_id: Mapped[int | None] = mapped_column(ForeignKey("bodegas.id"), nullable=True)

    cantidad: Mapped[float] = mapped_column(Float, nullable=False)
    usuario: Mapped[str] = mapped_column(String(150), default="")
    observaciones: Mapped[str] = mapped_column(Text, default="")
    cotizacion: Mapped[str] = mapped_column(String(32), default="")
    # Solo se informa en salidas hacia terceros (intercambio con otra
    # empresa, motivo="intercambio_externo") -- vacío en todo lo demás.
    empresa_externa: Mapped[str] = mapped_column(String(150), default="", index=True)
