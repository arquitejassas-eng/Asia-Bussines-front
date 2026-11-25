import enum

from sqlalchemy import Boolean, Column, Enum, ForeignKey, Integer, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RolUsuario(str, enum.Enum):
    JEFE_PLANTA = "jefe_planta"
    ADMINISTRATIVO = "administrativo"
    ADMIN_INVENTARIO = "admin_inventario"
    # Administración global de cuentas (crear/editar/activar usuarios de
    # cualquier bodega y rol) — no participa de los flujos operativos
    # (inventario, apartados, producción, etc.), solo de app/services/usuarios.py.
    SUPERADMIN = "superadmin"
    # Solo lectura: consulta el inventario de productos y rollos de TODAS las
    # sedes (resumen de app/api/routes/admin_inventario.py). No tiene ningún
    # endpoint de escritura, ni bodega fija.
    VENDEDOR = "vendedor"


# Bodegas ADICIONALES que maneja una cuenta de bodega o de Planta (ej. las
# mismas personas llevan Santander y Maxitejas): cambia de bodega desde el
# menú sin cerrar sesión (ver deps.usuario_actual, encabezado X-Bodega-Id).
# Solo el superadmin las asigna.
usuario_bodegas = Table(
    "usuario_bodegas", Base.metadata,
    Column("usuario_id", Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), primary_key=True),
    Column("bodega_id", Integer, ForeignKey("bodegas.id", ondelete="CASCADE"), primary_key=True),
)


class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    correo: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    contrasena_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    rol: Mapped[RolUsuario] = mapped_column(Enum(RolUsuario), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # NULL únicamente para ADMIN_INVENTARIO, SUPERADMIN y VENDEDOR: son las únicas
    # cuentas sin bodega fija (ven/administran entre todas las sedes — ver
    # app/api/deps.py::coincide_bodega).
    bodega_id: Mapped[int | None] = mapped_column(ForeignKey("bodegas.id"), nullable=True)
    bodega = relationship("Bodega", back_populates="usuarios")
    bodegas_extra = relationship("Bodega", secondary=usuario_bodegas, lazy="selectin", order_by="Bodega.nombre")

    @property
    def bodegas_extra_ids(self) -> list[int]:
        return [b.id for b in self.bodegas_extra]
