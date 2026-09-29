"""Material en camino: checklist del proveedor (de la empresa, no de una
bodega) y sus rollos, que se marcan a mano a medida que llegan.

Solo tablas nuevas; no toca datos existentes.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261001_01"
down_revision = "20260930_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cargamentos_en_camino",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("proveedor", sa.String(150), nullable=False, server_default=""),
        sa.Column("archivo_origen", sa.String(255), nullable=False, server_default=""),
        sa.Column("creado_por", sa.String(150), nullable=False, server_default=""),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True)),
        sa.Column("estado", sa.String(20), nullable=False, server_default="en_camino"),
        sa.Column("cerrado_por", sa.String(150), nullable=False, server_default=""),
        sa.Column("fecha_cierre", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_cargamentos_en_camino_estado", "cargamentos_en_camino", ["estado"])
    op.create_table(
        "cargamento_rollos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cargamento_id", sa.Integer(), sa.ForeignKey("cargamentos_en_camino.id", ondelete="CASCADE"), nullable=False),
        sa.Column("identificador_rollo", sa.String(120), nullable=False, server_default=""),
        sa.Column("codigo_interno", sa.String(60), nullable=False),
        sa.Column("empresa", sa.String(10), nullable=False, server_default=""),
        sa.Column("descripcion", sa.String(255), nullable=False, server_default=""),
        sa.Column("calibre", sa.Float(), nullable=False, server_default="0"),
        sa.Column("peso_neto", sa.Float(), nullable=True),
        sa.Column("metros", sa.Float(), nullable=False, server_default="0"),
        sa.Column("llego", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("llego_por", sa.String(150), nullable=False, server_default=""),
        sa.Column("fecha_llegada", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_cargamento_rollos_cargamento_id", "cargamento_rollos", ["cargamento_id"])
    op.create_index("ix_cargamento_rollos_codigo_interno", "cargamento_rollos", ["codigo_interno"])


def downgrade() -> None:
    op.drop_table("cargamento_rollos")
    op.drop_table("cargamentos_en_camino")
