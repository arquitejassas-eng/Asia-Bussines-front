"""Tipo de la línea por rollo de una cotización.

`apartado_items.tipo_producto`: "" (teja / lámina por metro), "caballete" o
"flanche". Un caballete o un flanche se corta a lo ancho del rollo (3 o 5
por corte), así que la lámina que se aparta es cortes × medida y no
cantidad × medida (5 caballetes de 3 m = 6 m, no 15). Las líneas que ya
existen quedan "" (como estaban).
"""

import sqlalchemy as sa
from alembic import op


revision = "20261021_01"
down_revision = "20261020_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartado_items", sa.Column("tipo_producto", sa.String(20), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("apartado_items", "tipo_producto")
