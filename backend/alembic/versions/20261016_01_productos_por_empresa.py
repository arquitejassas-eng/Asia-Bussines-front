"""Productos por empresa.

`productos.empresa` (AR / ABG / ""): el mismo código puede estar en las dos
empresas de una bodega, así que la identidad pasa de (bodega, código) a
(bodega, código, empresa). Envíos y solicitudes guardan la empresa del
producto que mueven. Columnas nuevas con valor "" (sin empresa): no cambia
ningún dato existente.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261016_01"
down_revision = "20261010_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("productos", sa.Column("empresa", sa.String(10), nullable=False, server_default=""))
    op.create_index("ix_productos_empresa", "productos", ["empresa"])
    op.drop_constraint("uq_productos_bodega_codigo", "productos", type_="unique")
    op.create_unique_constraint("uq_productos_bodega_codigo_empresa", "productos", ["bodega_id", "codigo", "empresa"])
    op.add_column("envio_items", sa.Column("empresa", sa.String(10), nullable=False, server_default=""))
    op.add_column("solicitudes", sa.Column("empresa", sa.String(10), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("solicitudes", "empresa")
    op.drop_column("envio_items", "empresa")
    op.drop_constraint("uq_productos_bodega_codigo_empresa", "productos", type_="unique")
    op.create_unique_constraint("uq_productos_bodega_codigo", "productos", ["bodega_id", "codigo"])
    op.drop_index("ix_productos_empresa", table_name="productos")
    op.drop_column("productos", "empresa")
