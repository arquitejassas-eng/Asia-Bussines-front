"""Importaciones con costo diferente (solo se venden completas) y sus alertas
para Admin Inventario."""

import sqlalchemy as sa
from alembic import op


revision = "20261123_01"
down_revision = "20261118_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "importaciones_controladas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("clave", sa.String(20), nullable=False),
        sa.Column("empresa", sa.String(10), nullable=False),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("activa", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("nota", sa.String(255), nullable=False, server_default=""),
        sa.Column("creada_por", sa.String(150), nullable=False, server_default=""),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("clave", name="uq_importaciones_controladas_clave"),
    )
    op.create_table(
        "alertas_importacion",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("apartado_id", sa.Integer(), sa.ForeignKey("apartados.id", ondelete="SET NULL"), nullable=True),
        sa.Column("apartado_item_id", sa.Integer(), sa.ForeignKey("apartado_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("numero_cotizacion", sa.String(32), nullable=False, server_default=""),
        sa.Column("bodega_id", sa.Integer(), sa.ForeignKey("bodegas.id"), nullable=True),
        sa.Column("codigo", sa.String(60), nullable=False, server_default=""),
        sa.Column("descripcion", sa.String(255), nullable=False, server_default=""),
        sa.Column("empresa_linea", sa.String(10), nullable=False, server_default=""),
        sa.Column("metros_requeridos", sa.Float(), nullable=False, server_default="0"),
        sa.Column("metros_en_bodega", sa.Float(), nullable=False, server_default="0"),
        sa.Column("metros_faltantes", sa.Float(), nullable=False, server_default="0"),
        sa.Column("importaciones", sa.String(120), nullable=False, server_default=""),
        sa.Column("opciones", sa.Text(), nullable=False, server_default=""),
        sa.Column("estado", sa.String(20), nullable=False, server_default="pendiente"),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fecha_actualizacion", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decidida_por", sa.String(150), nullable=False, server_default=""),
        sa.Column("fecha_decision", sa.DateTime(timezone=True), nullable=True),
        sa.Column("nota", sa.String(500), nullable=False, server_default=""),
    )
    op.create_index("ix_alertas_importacion_apartado_id", "alertas_importacion", ["apartado_id"])
    op.create_index("ix_alertas_importacion_apartado_item_id", "alertas_importacion", ["apartado_item_id"])
    op.create_index("ix_alertas_importacion_estado", "alertas_importacion", ["estado"])


def downgrade() -> None:
    op.drop_table("alertas_importacion")
    op.drop_table("importaciones_controladas")
