"""Línea de una cotización producida en otra bodega y pasada a la parte que la
entrega (en camino hasta que llegue)."""

import sqlalchemy as sa
from alembic import op


revision = "20261127_01"
down_revision = "20261126_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartado_items", sa.Column("producida_en_id", sa.Integer(), sa.ForeignKey("bodegas.id"), nullable=True))
    op.add_column("apartado_items", sa.Column("en_camino", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("apartado_items", "en_camino")
    op.drop_column("apartado_items", "producida_en_id")
