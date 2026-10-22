"""Línea de stock apartada aunque el sistema no tenga el producto.

`apartado_items.hay_fisico`: Admin Inventario confirmó que el producto está
en la bodega aunque el sistema lo tenga en 0 o en negativo (ej. caballetes).
Las líneas que ya existen quedan en false (como estaban).
"""

import sqlalchemy as sa
from alembic import op


revision = "20261022_02"
down_revision = "20261022_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartado_items", sa.Column("hay_fisico", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("apartado_items", "hay_fisico")
