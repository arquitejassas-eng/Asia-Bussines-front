from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Produccion(Base):
    """Registro de producción — consume uno o varios rollos de un mismo
    código de clasificación, descontando metros de cada rollo por separado."""

    __tablename__ = "producciones"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo_unico: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)  # PROD-0001
    # Autogenerada para producción libre; para producción ligada a un apartado
    # es el `numero_cotizacion` que escribió la encargada de inventario (String(32) allí).
    # NO es única: una misma cotización puede tener varias producciones (varios
    # ítems del apartado, o varias entregas parciales del mismo ítem).
    cotizacion: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    fecha: Mapped[DateTime] = mapped_column(DateTime(timezone=True))

    usuario: Mapped[str] = mapped_column(String(150), default="")
    responsable: Mapped[str] = mapped_column(String(150), default="")

    bodega_id: Mapped[int] = mapped_column(ForeignKey("bodegas.id"), nullable=False, index=True)

    # "teja" (default) o "caballete" — cada uno tiene su propia regla de
    # cortes/consumo en app/services/produccion.py::registrar_produccion.
    # Se guarda aquí (y no solo en la request) para que la pantalla de
    # confirmación y la Hoja de Vida sepan qué regla aplicó esta producción.
    tipo_producto: Mapped[str] = mapped_column(String(20), default="teja")

    # Si viene de un apartado enviado a producción (módulo "Apartados"); nulo
    # para producción libre, que sigue funcionando igual que antes.
    apartado_item_id: Mapped[int | None] = mapped_column(ForeignKey("apartado_items.id"), nullable=True, index=True)

    producto_fabricado: Mapped[str] = mapped_column(String(150), default="")
    modelo: Mapped[str] = mapped_column(String(80), default="")
    medida_producto: Mapped[str] = mapped_column(String(80), default="")
    cantidad_productos: Mapped[int] = mapped_column(Integer, default=0)

    codigo_clasificacion: Mapped[str] = mapped_column(String(60), default="")
    total_metros_consumidos: Mapped[float] = mapped_column(Float, default=0)
    saldo_codigo: Mapped[float] = mapped_column(Float, default=0)
    # Cuánto de `total_metros_consumidos` superó lo que el apartado todavía
    # necesitaba (0 si no hay apartado, o si no se consumió de más). El
    # apartado nunca se carga más allá de lo que pedía — este es el resto.
    metros_excedente: Mapped[float] = mapped_column(Float, default=0)
    observaciones: Mapped[str] = mapped_column(Text, default="")

    rollos_utilizados = relationship(
        "RolloUtilizadoProduccion", back_populates="produccion", cascade="all, delete-orphan"
    )
    apartado_item = relationship("ApartadoItem", back_populates="producciones")
    # Unidades de stock (Producto) que esta producción dejó disponibles más
    # allá de lo que el apartado necesitaba — ver `Producto.produccion_id`.
    productos_stock = relationship("Producto", viewonly=True)

    @property
    def cliente_apartado(self) -> str:
        """Cliente del apartado de origen, para que Producción y Hoja de Vida
        lo muestren sin que planta tenga que volver a escribirlo (sección 14)."""
        if self.apartado_item is None:
            return ""
        return self.apartado_item.apartado.cliente


class RolloUtilizadoProduccion(Base):
    """Detalle de trazabilidad: qué rollo(s) y cuántos metros de cada uno
    se consumieron en una producción específica."""

    __tablename__ = "rollos_utilizados_produccion"

    id: Mapped[int] = mapped_column(primary_key=True)
    produccion_id: Mapped[int] = mapped_column(ForeignKey("producciones.id"), nullable=False, index=True)
    rollo_id: Mapped[int] = mapped_column(ForeignKey("rollos.id"), nullable=False, index=True)
    identificador_rollo: Mapped[str] = mapped_column(String(60), default="")
    metros_consumidos: Mapped[float] = mapped_column(Float, nullable=False)

    produccion = relationship("Produccion", back_populates="rollos_utilizados")