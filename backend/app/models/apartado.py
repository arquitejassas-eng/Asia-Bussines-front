import enum

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, String, Text, text, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EstadoApartado(str, enum.Enum):
    APARTADO = "apartado"  # material reservado; incluye "pendiente de producción"
    ENVIADO_A_PRODUCCION = "enviado_a_produccion"
    EN_PRODUCCION = "en_produccion"
    PRODUCCION_TERMINADA = "produccion_terminada"
    ENTREGADO = "entregado"
    CANCELADO = "cancelado"


class ModalidadApartado(str, enum.Enum):
    """De qué se reserva un `ApartadoItem` — vive por ítem, nunca en el
    `Apartado`: un mismo apartado puede mezclar ítems de ambas modalidades
    (ver `app/services/apartados.py::marcar_produccion_terminada`)."""
    POR_ROLLO = "por_rollo"
    POR_STOCK = "por_stock"


class Apartado(Base):
    """
    Reserva de material de una cotización de cliente (módulo "Apartados").
    Cliente y número de cotización son texto libre, igual que `responsable`
    o `proveedor` en el resto del sistema — no existe una tabla de clientes.
    El material se reserva por FAMILIA (ver `ApartadoItem`), nunca por rollo
    específico; la disponibilidad real se calcula agregando `Rollo` con los
    apartados activos (`app/services/apartados.py::disponibilidad_por_codigo`).
    """

    __tablename__ = "apartados"
    __table_args__ = (
        # Una cotización activa por bodega; si se cancela, su número se puede
        # volver a usar (ej. se canceló porque quedó mal y se crea de nuevo).
        Index("uq_apartados_bodega_cotizacion_activa", "bodega_id", "numero_cotizacion", unique=True,
              postgresql_where=text("estado <> 'CANCELADO'"), sqlite_where=text("estado <> 'CANCELADO'")),
        Index("ix_apartados_bodega_estado", "bodega_id", "estado"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bodega_id: Mapped[int] = mapped_column(ForeignKey("bodegas.id"), nullable=False, index=True)

    numero_cotizacion: Mapped[str] = mapped_column(String(32), nullable=False)
    cliente: Mapped[str] = mapped_column(String(150), default="")
    # Empresa de la que sale el material: "AR" (Arquitejas) o "ABG" (Asia
    # Business), mismas siglas que Rollo.empresa. Informativo: le dice a la
    # bodega y a Planta de qué empresa tomar los rollos.
    empresa: Mapped[str] = mapped_column(String(10), default="")
    # "Pendiente por dar salida": el material ya salió (en el Excel,
    # REFERENCIA = "SI") pero no se sabe de qué rollo. Sigue apartado (así
    # nadie lo vende) hasta que se registre la salida con la hoja de vida;
    # no va a Planta. Al completar la salida queda Entregado.
    salida_pendiente: Mapped[bool] = mapped_column(default=False, server_default=false())

    creado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_creacion: Mapped[DateTime] = mapped_column(DateTime(timezone=True))
    estado: Mapped[EstadoApartado] = mapped_column(Enum(EstadoApartado), default=EstadoApartado.APARTADO)

    enviado_a_produccion_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_enviado_a_produccion: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cancelado_por: Mapped[str] = mapped_column(String(150), default="")
    fecha_cancelado: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    fecha_entregado: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    observaciones: Mapped[str] = mapped_column(Text, default="")

    # Confirmacion de que el stock (items POR_STOCK) de esta cotizacion ya se
    # separo fisicamente -- requisito para registrar produccion de sus items
    # POR_ROLLO (ver services/produccion.py::_apartado_item_para_produccion).
    # A nivel de Apartado, no por item: se crean todos juntos y es una sola
    # confirmacion por cotizacion.
    stock_separado_confirmado: Mapped[bool] = mapped_column(default=False)
    stock_separado_por: Mapped[str] = mapped_column(String(150), default="")
    stock_separado_en: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items = relationship("ApartadoItem", back_populates="apartado", cascade="all, delete-orphan")
    bodega = relationship("Bodega")

    @property
    def bodega_nombre(self) -> str:
        return self.bodega.nombre if self.bodega else ""


class ApartadoItem(Base):
    """Línea de producto solicitado dentro de un apartado (ej. "10 tejas de 6 metros"
    o "100 AM-A"). `modalidad` decide qué campos aplican:

    POR_ROLLO (comportamiento original, sin cambios): se reserva por
    `codigo_interno` — el mismo código de clasificación (color + calibre) por
    el que ya se agrupan los rollos en "Rollos almacenados" y por el que
    `registrar_produccion` exige que todos los rollos consumidos coincidan.
    Usa `medida`/`metros_requeridos`/`metros_consumidos`. No se usa
    `Rollo.familia`: ese campo no se diferencia hoy en ningún flujo de carga
    (siempre queda "Rollos de acero").

    POR_STOCK (nuevo): se reserva un `Producto` concreto por `producto_id` —
    su identidad es `Producto.id`, nunca un código agregado (mismo criterio
    que ya usa `app/services/movimientos.py`). `codigo_interno`/`medida`/
    `metros_requeridos` quedan `NULL` (no tienen sentido para stock).
    `stock_descontado` es la guarda de idempotencia: se marca `true` la única
    vez que `marcar_produccion_terminada` descuenta `Producto.stock` para
    este ítem, para que una segunda llamada no vuelva a descontar.
    """

    __tablename__ = "apartado_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    apartado_id: Mapped[int] = mapped_column(ForeignKey("apartados.id"), nullable=False, index=True)

    modalidad: Mapped[ModalidadApartado] = mapped_column(String(20), default=ModalidadApartado.POR_ROLLO)

    codigo_interno: Mapped[str | None] = mapped_column(String(60), nullable=True)
    descripcion: Mapped[str] = mapped_column(String(255), default="")
    cantidad: Mapped[float] = mapped_column(Float, nullable=False)
    medida: Mapped[float | None] = mapped_column(Float, nullable=True)  # metros por unidad (solo POR_ROLLO)
    metros_requeridos: Mapped[float | None] = mapped_column(Float, nullable=True)  # cantidad * medida (solo POR_ROLLO)
    metros_consumidos: Mapped[float] = mapped_column(Float, default=0)

    producto_id: Mapped[int | None] = mapped_column(ForeignKey("productos.id"), nullable=True)  # solo POR_STOCK
    stock_descontado: Mapped[bool] = mapped_column(default=False)  # solo POR_STOCK

    # "Rollo completo": la línea vende un rollo entero y ESE rollo queda
    # apartado solo para esta cotización (nadie más lo puede consumir,
    # producir ni trasladar). Sigue siendo POR_ROLLO: código, metros
    # requeridos y consumidos funcionan igual que siempre. No va a Planta:
    # se le da salida al rollo entero desde Apartados.
    rollo_id: Mapped[int | None] = mapped_column(ForeignKey("rollos.id"), nullable=True, index=True)

    @property
    def rollo_referencia(self) -> str | None:
        return self.rollo.identificador_rollo if self.rollo is not None else None

    @property
    def metros_pendientes(self) -> float | None:
        """Solo tiene sentido para POR_ROLLO -- None para POR_STOCK."""
        if self.metros_requeridos is None:
            return None
        return round(self.metros_requeridos - self.metros_consumidos, 2)

    @property
    def tiene_produccion_registrada(self) -> bool:
        return bool(self.producciones)

    apartado = relationship("Apartado", back_populates="items")
    producciones = relationship("Produccion", back_populates="apartado_item")
    producto = relationship("Producto")
    rollo = relationship("Rollo")
