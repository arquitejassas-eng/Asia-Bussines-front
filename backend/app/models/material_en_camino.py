from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Cargamento(Base):
    """Material comprado que todavía no llega: el mismo Excel del proveedor
    (checklist / packing list) que después se sube en Recepción, guardado
    ANTES de que llegue. Es de la EMPRESA, no de una bodega: llega a Admin
    Inventario, que después lo reparte. No es inventario -- nunca crea rollos
    ni movimientos --, solo dice cuánto viene de cada código para poder
    apartarlo desde cualquier bodega (ver apartados.disponibilidad_por_codigo).
    Llega por partes (varias mulas): cada rollo se marca a mano al llegar."""

    __tablename__ = "cargamentos_en_camino"

    id: Mapped[int] = mapped_column(primary_key=True)
    proveedor: Mapped[str] = mapped_column(String(150), default="")
    archivo_origen: Mapped[str] = mapped_column(String(255), default="")
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_creacion: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    # "en_camino": sus rollos que no han llegado cuentan para apartar.
    # "cerrado": ya no cuenta nada (llegó todo, o lo que faltaba no vendrá).
    estado: Mapped[str] = mapped_column(String(20), default="en_camino", index=True)
    cerrado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_cierre: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rollos = relationship("CargamentoRollo", back_populates="cargamento", cascade="all, delete-orphan",
                          order_by="CargamentoRollo.id")


class CargamentoRollo(Base):
    """Un rollo del checklist, ya clasificado igual que en Recepción."""

    __tablename__ = "cargamento_rollos"

    id: Mapped[int] = mapped_column(primary_key=True)
    cargamento_id: Mapped[int] = mapped_column(ForeignKey("cargamentos_en_camino.id", ondelete="CASCADE"), nullable=False, index=True)
    identificador_rollo: Mapped[str] = mapped_column(String(120), default="")
    codigo_interno: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    empresa: Mapped[str] = mapped_column(String(10), default="")
    descripcion: Mapped[str] = mapped_column(String(255), default="")
    calibre: Mapped[float] = mapped_column(Float, default=0)
    peso_neto: Mapped[float | None] = mapped_column(Float, nullable=True)
    metros: Mapped[float] = mapped_column(Float, default=0)
    # Se marca a mano cuando llega en una mula; desde ahí deja de contar como
    # "en camino" (su material pasa a Admin Inventario por repartir).
    llego: Mapped[bool] = mapped_column(Boolean, default=False)
    llego_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_llegada: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cargamento = relationship("Cargamento", back_populates="rollos")
