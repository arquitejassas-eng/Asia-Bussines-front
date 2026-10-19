from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Producto(Base):
    """
    Productos controlados por CANTIDAD (todas las familias excepto
    "Rollos de acero", que se maneja en el modelo `Rollo` por unidad
    individual — ver documento "Prompt Rollos almacenados").
    """

    __tablename__ = "productos"
    # NULL en bodega_id (pool de Admin Inventario) NO queda cubierto por esta
    # constraint -- NULL nunca es igual a otro NULL en SQL estándar. Cubre
    # bodegas reales, que es el escenario de cargas simultáneas que importaba.
    # Un mismo código puede estar en las dos empresas de una bodega (ej. AM-B
    # de Arquitejas y AM-B de Asia en Ricaurte): la identidad es bodega +
    # código + empresa.
    __table_args__ = (UniqueConstraint("bodega_id", "codigo", "empresa", name="uq_productos_bodega_codigo_empresa"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # NULL = material de Admin Inventario, aún sin repartir a ninguna sede.
    bodega_id: Mapped[int | None] = mapped_column(ForeignKey("bodegas.id"), nullable=True, index=True)

    codigo_importacion: Mapped[str] = mapped_column(String(50), default="")
    codigo: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Otro código de identificación además de `codigo` (ej. referencia interna
    # o del fabricante) — texto libre, no se valida unicidad.
    referencia: Mapped[str] = mapped_column(String(50), default="")
    descripcion: Mapped[str] = mapped_column(String(255), nullable=False)
    familia: Mapped[str] = mapped_column(String(50), default="")
    # Empresa dueña del stock: "AR" (Arquitejas), "ABG" (Asia Business) o ""
    # (sin empresa). Mismas siglas que Rollo.empresa y Apartado.empresa.
    empresa: Mapped[str] = mapped_column(String(10), default="", server_default="", index=True)
    calibre: Mapped[str] = mapped_column(String(30), default="")

    entrada: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    stock: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    # NULL = sin alerta configurada para este producto (no todos la necesitan).
    stock_minimo: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Los siguientes campos solo se usan para el stock adicional que genera
    # Producción al fabricar más unidades de las que un apartado necesitaba
    # (ver `app/services/produccion.py::registrar_produccion`) — quedan NULL/
    # vacíos para cualquier producto que no venga de ese flujo.
    color: Mapped[str] = mapped_column(String(60), default="")
    ral: Mapped[str] = mapped_column(String(20), default="")
    calidad: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "primera" | "segunda"
    motivo_segunda: Mapped[str] = mapped_column(String(255), default="")
    metros_por_unidad: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    produccion_id: Mapped[int | None] = mapped_column(ForeignKey("producciones.id"), nullable=True)
    fecha_produccion: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Código de clasificación del rollo del que salió este stock — separado
    # de `familia` porque productos como Caballetes usan una familia fija
    # ("CABALLETES") para todos, sin importar el rollo: esta columna es la
    # que conserva la trazabilidad hacia el rollo de origen. Vacía para
    # tejas (ahí la familia YA es el código del rollo) y para cualquier
    # producto que no venga de Producción.
    codigo_rollo_origen: Mapped[str] = mapped_column(String(50), default="")
    # Ancho físico del rollo de origen (ver Rollo.ancho_material) — solo para
    # productos seccionados (Caballetes/Flanches): se divide entre el número
    # de secciones de ese tipo para mostrar el ancho de cada sección. No se
    # usa en ningún cálculo de metros, es puramente clasificatorio.
    ancho_rollo: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    # "caballete" | "flanche" | "" — fuente estructural confiable de qué
    # producto seccionado es este stock (en vez de comparar el texto de
    # `familia`), para saber qué divisor de ancho_rollo le corresponde. Vacío
    # para tejas y cualquier producto que no venga de ese flujo.
    tipo_producto: Mapped[str] = mapped_column(String(20), default="")

    bodega = relationship("Bodega", back_populates="productos")
