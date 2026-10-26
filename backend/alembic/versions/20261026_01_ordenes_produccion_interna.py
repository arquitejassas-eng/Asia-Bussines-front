"""Órdenes de producción interna (para stock) de Admin Inventario.

`apartados.orden_interna`: la "cotización" es una orden de Admin Inventario
para producir stock (sin cliente): lo que Planta produce para ella entra al
inventario. `apartado_items.convertir_en` / `bodega_conversion_id` /
`laminas_convertidas`: una línea de lámina lisa que después se convierte en
caballetes o flanches, en esa bodega (ej. Ricaurte corta, Santander
convierte). Solo agrega columnas: lo que ya existe queda como estaba.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261026_01"
down_revision = "20261023_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartados", sa.Column("orden_interna", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("apartado_items", sa.Column("convertir_en", sa.String(20), nullable=False, server_default=""))
    op.add_column("apartado_items", sa.Column("bodega_conversion_id", sa.Integer(), sa.ForeignKey("bodegas.id"), nullable=True))
    op.add_column("apartado_items", sa.Column("laminas_convertidas", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("apartado_items", "laminas_convertidas")
    op.drop_column("apartado_items", "bodega_conversion_id")
    op.drop_column("apartado_items", "convertir_en")
    op.drop_column("apartados", "orden_interna")
