from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PrestamoEmpresa(Base):
    """Material de una empresa que salió para una cotización de la otra (ej.
    Arquitejas le presta 228 m de LR30020,27 o 2 caballetes a una cotización
    de Asia). Se anota solo, en el momento en que el material sale (al
    producir, al terminar la producción o al dar salida). `saldado` = las
    empresas ya cuadraron ese préstamo: deja de contar en lo que se deben."""

    __tablename__ = "prestamos_empresa"
    __table_args__ = (Index("ix_prestamos_empresa_saldado_fecha", "saldado", "fecha"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=False)
    empresa_presta: Mapped[str] = mapped_column(String(10), nullable=False)
    empresa_recibe: Mapped[str] = mapped_column(String(10), nullable=False)
    # Rollo prestado por un tercero (empresa_presta = "EXT"): su nombre.
    prestador: Mapped[str] = mapped_column(String(150), default="", server_default="", nullable=False)
    bodega_id: Mapped[int | None] = mapped_column(ForeignKey("bodegas.id"), nullable=True, index=True)
    # El número queda escrito aparte: la cotización se puede borrar después.
    apartado_id: Mapped[int | None] = mapped_column(ForeignKey("apartados.id", ondelete="SET NULL"), nullable=True, index=True)
    numero_cotizacion: Mapped[str] = mapped_column(String(32), default="")
    # "lamina" (metros de un rollo) o "producto" (unidades de stock).
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    codigo: Mapped[str] = mapped_column(String(60), nullable=False)
    descripcion: Mapped[str] = mapped_column(String(255), default="")
    cantidad: Mapped[float] = mapped_column(Float, nullable=False)
    unidad: Mapped[str] = mapped_column(String(10), default="")  # "m" o "und"
    referencia_rollo: Mapped[str] = mapped_column(String(60), default="")
    # Dónde se anotó: "produccion", "salida", "fin_produccion", "stock_planta".
    origen: Mapped[str] = mapped_column(String(30), default="")
    usuario: Mapped[str] = mapped_column(String(150), default="")
    saldado: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    saldado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_saldado: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
