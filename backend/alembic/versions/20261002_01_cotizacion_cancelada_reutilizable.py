"""El número de una cotización cancelada se puede volver a usar.

Antes la restricción única (bodega_id, numero_cotizacion) contaba también las
canceladas: si una cotización se cancelaba porque quedó mal, no se podía crear
de nuevo con su número. Ahora solo es única entre las que no están canceladas.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261002_01"
down_revision = "20261001_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_apartados_bodega_cotizacion", "apartados", type_="unique")
    op.create_index(
        "uq_apartados_bodega_cotizacion_activa", "apartados", ["bodega_id", "numero_cotizacion"], unique=True,
        postgresql_where=sa.text("estado <> 'CANCELADO'"), sqlite_where=sa.text("estado <> 'CANCELADO'"),
    )


def downgrade() -> None:
    op.drop_index("uq_apartados_bodega_cotizacion_activa", table_name="apartados")
    op.create_unique_constraint("uq_apartados_bodega_cotizacion", "apartados", ["bodega_id", "numero_cotizacion"])
