"""Línea de cotización incluida en otra línea de Siigo.

En Siigo el tornillo y su capuchón son un solo producto ("TORNILLO 2" CON
CAPUCHON AZUL"); en Inventario son dos, cada uno con su stock. La línea del
capuchón se marca como incluida: descuenta su inventario pero no sube a Siigo.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261109_01"
down_revision = "20261106_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartado_items", sa.Column("siigo_incluido", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("apartado_items", "siigo_incluido")
