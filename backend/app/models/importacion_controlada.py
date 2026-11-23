from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImportacionControlada(Base):
    """Importación con costo diferente (ej. la 17 de Arquitejas): mientras sus
    rollos sean de la empresa que los importó, solo se venden completos (nadie
    les saca metros). `clave` es el inicio de la referencia de sus rollos:
    "17AR" = importación 17 de Arquitejas (no se confunde con "17ABG")."""

    __tablename__ = "importaciones_controladas"
    __table_args__ = (UniqueConstraint("clave", name="uq_importaciones_controladas_clave"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    clave: Mapped[str] = mapped_column(String(20), nullable=False)
    empresa: Mapped[str] = mapped_column(String(10), nullable=False)
    numero: Mapped[int] = mapped_column(nullable=False)
    activa: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    nota: Mapped[str] = mapped_column(String(255), default="", server_default="", nullable=False)
    creada_por: Mapped[str] = mapped_column(String(150), default="", server_default="", nullable=False)
    fecha_creacion: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)


class AlertaImportacion(Base):
    """A una línea de una cotización le falta material en su bodega y existe
    material de una importación controlada que se podría usar: Admin
    Inventario decide (autorizar con otro material, vender el rollo completo
    a la otra empresa, o anular). Mientras está "pendiente" la cotización no
    se puede producir. Lo que se decidió queda escrito (quién y cuándo)."""

    __tablename__ = "alertas_importacion"
    __table_args__ = (Index("ix_alertas_importacion_estado", "estado"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    apartado_id: Mapped[int | None] = mapped_column(ForeignKey("apartados.id", ondelete="SET NULL"), nullable=True, index=True)
    apartado_item_id: Mapped[int | None] = mapped_column(ForeignKey("apartado_items.id", ondelete="SET NULL"), nullable=True, index=True)
    # Escritos aparte: la cotización o la línea se pueden borrar después.
    numero_cotizacion: Mapped[str] = mapped_column(String(32), default="", server_default="", nullable=False)
    bodega_id: Mapped[int | None] = mapped_column(ForeignKey("bodegas.id"), nullable=True)
    codigo: Mapped[str] = mapped_column(String(60), default="", server_default="", nullable=False)
    descripcion: Mapped[str] = mapped_column(String(255), default="", server_default="", nullable=False)
    empresa_linea: Mapped[str] = mapped_column(String(10), default="", server_default="", nullable=False)
    metros_requeridos: Mapped[float] = mapped_column(Float, default=0, server_default="0", nullable=False)
    metros_en_bodega: Mapped[float] = mapped_column(Float, default=0, server_default="0", nullable=False)
    metros_faltantes: Mapped[float] = mapped_column(Float, default=0, server_default="0", nullable=False)
    # Las importaciones controladas involucradas ("17AR") y las opciones (JSON).
    importaciones: Mapped[str] = mapped_column(String(120), default="", server_default="", nullable=False)
    opciones: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    # pendiente · autorizada · anulada · resuelta (ya no hace falta)
    estado: Mapped[str] = mapped_column(String(20), default="pendiente", server_default="pendiente", nullable=False)
    fecha_creacion: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    fecha_actualizacion: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decidida_por: Mapped[str] = mapped_column(String(150), default="", server_default="", nullable=False)
    fecha_decision: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    nota: Mapped[str] = mapped_column(String(500), default="", server_default="", nullable=False)
