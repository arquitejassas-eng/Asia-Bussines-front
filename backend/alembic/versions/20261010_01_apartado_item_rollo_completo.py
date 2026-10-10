"""Líneas de cotización de "rollo completo".

Columna nueva `apartado_items.rollo_id` (opcional): el rollo entero que esa
línea vende. Las líneas existentes quedan en NULL; no toca ningún dato.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261010_01"
down_revision = "20261008_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartado_items", sa.Column("rollo_id", sa.Integer(), sa.ForeignKey("rollos.id"), nullable=True))
    op.create_index("ix_apartado_items_rollo_id", "apartado_items", ["rollo_id"])


def downgrade() -> None:
    op.drop_index("ix_apartado_items_rollo_id", table_name="apartado_items")
    op.drop_column("apartado_items", "rollo_id")
