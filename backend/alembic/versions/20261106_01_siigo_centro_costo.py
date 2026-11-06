"""Centro de costo de Siigo en la cotización.

El Siigo de Arquitejas no deja crear una cotización sin centro de costo: lo
escoge el vendedor en el formulario. Solo agrega una columna vacía.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261106_01"
down_revision = "20261030_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartados", sa.Column("siigo_centro_costo", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("apartados", "siigo_centro_costo")
