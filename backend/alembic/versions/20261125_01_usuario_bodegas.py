"""Cuentas que manejan varias bodegas (ej. Santander y Maxitejas): bodegas
adicionales por usuario, para cambiar de bodega sin cerrar sesión."""

import sqlalchemy as sa
from alembic import op


revision = "20261125_01"
down_revision = "20261123_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usuario_bodegas",
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuarios.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("bodega_id", sa.Integer(), sa.ForeignKey("bodegas.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("usuario_bodegas")
