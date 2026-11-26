"""Lo producido en una bodega que se entrega en otra: datos del envío en la
parte de la cotización (en camino / recibido, quién lo lleva y quién lo recibe)."""

import sqlalchemy as sa
from alembic import op


revision = "20261126_01"
down_revision = "20261125_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartados", sa.Column("envio_estado", sa.String(20), nullable=False, server_default=""))
    op.add_column("apartados", sa.Column("envio_destino_bodega_id", sa.Integer(), sa.ForeignKey("bodegas.id"), nullable=True))
    op.add_column("apartados", sa.Column("envio_origen_bodega_id", sa.Integer(), sa.ForeignKey("bodegas.id"), nullable=True))
    op.add_column("apartados", sa.Column("envio_transporta", sa.String(150), nullable=False, server_default=""))
    op.add_column("apartados", sa.Column("envio_enviado_por", sa.String(150), nullable=False, server_default=""))
    op.add_column("apartados", sa.Column("envio_fecha_envio", sa.DateTime(timezone=True), nullable=True))
    op.add_column("apartados", sa.Column("envio_recibido_por", sa.String(150), nullable=False, server_default=""))
    op.add_column("apartados", sa.Column("envio_fecha_recibido", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for columna in ("envio_fecha_recibido", "envio_recibido_por", "envio_fecha_envio", "envio_enviado_por",
                    "envio_transporta", "envio_origen_bodega_id", "envio_destino_bodega_id", "envio_estado"):
        op.drop_column("apartados", columna)
