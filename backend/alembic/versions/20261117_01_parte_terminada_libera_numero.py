"""La parte terminada o entregada de una cotización ya no ocupa su número en la bodega.

Antes el número era único entre todas las cotizaciones no anuladas de una
bodega: si Ricaurte ya había terminado su parte de la 4049 y luego le pasaban
otra línea de la misma cotización (que salía de Santander), no se podía crear
la parte nueva en Ricaurte. Ahora solo es único entre las activas (apartada,
enviada a producción, en producción).
"""

import sqlalchemy as sa
from alembic import op


revision = "20261117_01"
down_revision = "20261110_01"
branch_labels = None
depends_on = None

ACTIVA = "estado IN ('APARTADO', 'ENVIADO_A_PRODUCCION', 'EN_PRODUCCION')"


def upgrade() -> None:
    op.drop_index("uq_apartados_bodega_cotizacion_activa", table_name="apartados")
    op.create_index(
        "uq_apartados_bodega_cotizacion_activa", "apartados", ["bodega_id", "numero_cotizacion"], unique=True,
        postgresql_where=sa.text(ACTIVA), sqlite_where=sa.text(ACTIVA),
    )


def downgrade() -> None:
    op.drop_index("uq_apartados_bodega_cotizacion_activa", table_name="apartados")
    op.create_index(
        "uq_apartados_bodega_cotizacion_activa", "apartados", ["bodega_id", "numero_cotizacion"], unique=True,
        postgresql_where=sa.text("estado <> 'CANCELADO'"), sqlite_where=sa.text("estado <> 'CANCELADO'"),
    )
