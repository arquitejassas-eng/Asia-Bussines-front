"""Traslado a una bodega que no lleva inventario en el sistema (San Gil).

Se crea en Apartados como una cotización sin cliente, sin precios y sin Siigo:
el material queda apartado y, al darle "Salida", se descuenta (los rollos
salen enteros) sin entrar a ninguna otra bodega. `traslado_a` es el nombre de
esa bodega; vacío en las cotizaciones normales.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261110_01"
down_revision = "20261109_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartados", sa.Column("traslado_a", sa.String(length=60), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("apartados", "traslado_a")
