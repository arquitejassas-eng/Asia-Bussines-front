"""Apartados "pendientes por dar salida".

Material que ya salió de la bodega pero no se sabe de qué rollo (en el
Excel, REFERENCIA = "SI"). Sigue apartado hasta que, revisando la hoja de
vida, se registre la salida con la referencia del rollo. Columna nueva con
valor por defecto falso: no toca ningún dato existente.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261008_01"
down_revision = "20261003_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartados", sa.Column("salida_pendiente", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("apartados", "salida_pendiente")
