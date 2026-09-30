"""Empresa de la que sale el material de cada apartado ("AR" o "ABG").

Columna nueva con valor por defecto vacío: los apartados que ya existen
quedan sin empresa; no toca ningún otro dato.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261003_01"
down_revision = "20261002_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartados", sa.Column("empresa", sa.String(10), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("apartados", "empresa")
