import enum

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.services.empresas import sigla_empresa_desde_referencia


class EstadoRollo(str, enum.Enum):
    CERRADO = "cerrado"   # recién ingresado, nunca usado
    ABIERTO = "abierto"   # ya usado y con metros disponibles
    AGOTADO = "agotado"   # sin metros disponibles


class Rollo(Base):
    """
    Materia prima "Rollos de acero" — se controla POR ROLLO INDIVIDUAL.
    Aunque varios rollos compartan `codigo_interno`, cada uno es un registro
    aparte con sus propios metros y estado; nunca se suman entre sí.
    """

    __tablename__ = "rollos"
    __table_args__ = (
        Index("ix_rollos_bodega_fecha", "bodega_id", "fecha_ingreso"),
        Index("ix_rollos_bodega_estado", "bodega_id", "estado"),
        # Un rollo físico (su referencia) no puede estar dos veces en la misma
        # bodega. Igual que en productos, NULL en bodega_id (material de Admin
        # Inventario) no queda cubierto: SQL no considera iguales dos NULL.
        UniqueConstraint("bodega_id", "identificador_rollo", name="uq_rollos_bodega_identificador"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # NULL = material de Admin Inventario, aún sin repartir a ninguna sede.
    bodega_id: Mapped[int | None] = mapped_column(ForeignKey("bodegas.id"), nullable=True, index=True)
    recepcion_id: Mapped[int | None] = mapped_column(ForeignKey("recepciones.id"), nullable=True)

    codigo_interno: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    identificador_rollo: Mapped[str] = mapped_column(String(60), nullable=False)
    codigo_proveedor: Mapped[str] = mapped_column(String(60), default="")
    # Sigla de la empresa dueña del rollo ("AR" = Arquitejas, "ABG" = Asia
    # Business). Se deduce sola de `identificador_rollo` al crear el rollo
    # (ver `_completar_empresa` abajo) y se puede corregir a mano. "" = la
    # referencia no la traía.
    empresa: Mapped[str] = mapped_column(String(10), default="", index=True)
    descripcion: Mapped[str] = mapped_column(String(255), default="")
    familia: Mapped[str] = mapped_column(String(50), default="Rollos de acero")
    color_material: Mapped[str] = mapped_column(String(60), default="")
    calibre: Mapped[float] = mapped_column(Float, default=0)
    peso_neto: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Ancho físico del rollo (perpendicular a los metros que se consumen).
    # Solo lo usa Producción de Caballetes: el ancho se divide siempre en 3
    # para saber cuánto mide cada sección. La mayoría de rollos miden 122 m
    # de ancho (el valor por defecto); si un rollo específico es distinto,
    # se corrige aquí mismo, fila por fila — igual que `familia` — en vez de
    # que el sistema intente adivinarlo por el código.
    ancho_material: Mapped[float] = mapped_column(Float, default=122)

    metros_proveedor: Mapped[float] = mapped_column(Float, default=0)
    metros_calculados: Mapped[float] = mapped_column(Float, default=0)
    metros_disponibles: Mapped[float] = mapped_column(Float, default=0)
    metros_consumidos: Mapped[float] = mapped_column(Float, default=0)

    fecha_ingreso: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    estado: Mapped[EstadoRollo] = mapped_column(Enum(EstadoRollo), default=EstadoRollo.CERRADO)
    observaciones: Mapped[str] = mapped_column(Text, default="")
    proveedor: Mapped[str] = mapped_column(String(120), default="")
    lote: Mapped[str] = mapped_column(String(60), default="")

    bodega = relationship("Bodega", back_populates="rollos")
    historial_consumos = relationship(
        "HistorialConsumoRollo", back_populates="rollo", cascade="all, delete-orphan"
    )

    def recalcular_estado(self) -> None:
        """Deriva el estado a partir de los metros — nunca se asigna a mano.
        Sin metros disponibles es AGOTADO aunque nunca se haya consumido nada
        (antes, un rollo con 0 m y 0 consumidos quedaba "cerrado", como nuevo)."""
        if self.metros_disponibles <= 0:
            self.estado = EstadoRollo.AGOTADO
        elif self.metros_consumidos <= 0:
            self.estado = EstadoRollo.CERRADO
        else:
            self.estado = EstadoRollo.ABIERTO


@event.listens_for(Rollo, "before_insert")
def _completar_empresa(_mapper, _conexion, rollo: Rollo) -> None:
    """Un solo punto para los tres caminos que crean rollos (recepción, carga
    por Excel e ingreso manual): si nadie indicó la empresa, se deduce de la
    referencia."""
    if not rollo.empresa:
        rollo.empresa = sigla_empresa_desde_referencia(rollo.identificador_rollo, rollo.codigo_interno)


class HistorialConsumoRollo(Base):
    __tablename__ = "historial_consumos_rollo"

    id: Mapped[int] = mapped_column(primary_key=True)
    rollo_id: Mapped[int] = mapped_column(ForeignKey("rollos.id"), nullable=False, index=True)
    fecha: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    cantidad: Mapped[float] = mapped_column(Float, nullable=False)
    usuario: Mapped[str] = mapped_column(String(150), default="")
    observaciones: Mapped[str] = mapped_column(Text, default="")

    rollo = relationship("Rollo", back_populates="historial_consumos")
