"""VENDEDOR: nuevo rol de solo lectura que consulta el inventario de
productos y rollos de todas las sedes.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260928_01"
down_revision = "20260910_01"
branch_labels = None
depends_on = None


rol_usuario_anterior = sa.Enum("JEFE_PLANTA", "ADMINISTRATIVO", "ADMIN_INVENTARIO", "SUPERADMIN", name="rolusuario")
rol_usuario_nuevo = sa.Enum("JEFE_PLANTA", "ADMINISTRATIVO", "ADMIN_INVENTARIO", "SUPERADMIN", "VENDEDOR", name="rolusuario")


def upgrade() -> None:
    # Mismo caso que en 20260828_01: en Postgres hay que agregar el valor al
    # tipo enum con ALTER TYPE, no con un cambio de columna.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TYPE rolusuario ADD VALUE IF NOT EXISTS 'VENDEDOR'")
    else:
        op.alter_column("usuarios", "rol", existing_type=rol_usuario_anterior, type_=rol_usuario_nuevo, existing_nullable=False)


def downgrade() -> None:
    # Ver nota de downgrade en 20260825_01 -- Postgres no soporta quitar un
    # valor de un tipo ENUM, no implementado aquí por la misma razón.
    if op.get_bind().dialect.name != "postgresql":
        op.alter_column("usuarios", "rol", existing_type=rol_usuario_nuevo, type_=rol_usuario_anterior, existing_nullable=False)
