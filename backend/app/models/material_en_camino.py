from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Cargamento(Base):
    """Material comprado que todavía no llega: el mismo Excel del proveedor
    (checklist / packing list) que después se sube en Recepción, guardado
    ANTES de que llegue. No es inventario -- nunca crea rollos ni
    movimientos --, solo dice cuánto viene de cada código para que Admin
    Inventario pueda apartarlo (ver apartados.metros_para_apartar). Cuando
    llega, se le da ingreso en Recepción como siempre y aquí se marca a mano
    como "llegó" para que deje de contar."""

    __tablename__ = "cargamentos_en_camino"

    id: Mapped[int] = mapped_column(primary_key=True)
    bodega_id: Mapped[int] = mapped_column(ForeignKey("bodegas.id"), nullable=False, index=True)
    proveedor: Mapped[str] = mapped_column(String(150), default="")
    archivo_origen: Mapped[str] = mapped_column(String(255), default="")
    creado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_creacion: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    # "en_camino" cuenta para apartar; "llego" ya no (su material entra por Recepción).
    estado: Mapped[str] = mapped_column(String(20), default="en_camino", index=True)
    llego_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_llegada: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rollos = relationship("CargamentoRollo", back_populates="cargamento", cascade="all, delete-orphan")
    bodega = relationship("Bodega")


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

    cargamento = relationship("Cargamento", back_populates="rollos")
