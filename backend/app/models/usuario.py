import enum

from sqlalchemy import Boolean, Enum, ForeignKey, String
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
