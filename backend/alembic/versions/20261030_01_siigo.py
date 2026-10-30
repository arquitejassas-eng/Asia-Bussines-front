"""Cotizaciones a Siigo Nube.

- `apartados`: cédula/NIT del cliente y cómo quedó la cotización en Siigo
  (id, número "C-1-...", total, IVA, retención, vendedor, fecha) o si quedó
  pendiente de subir/actualizar y por qué.
- `apartado_items`: precio, cantidad en la unidad de Siigo (kilos,
  centímetros o unidades) y producto de Siigo de cada línea.
- `siigo_preferencias` (tabla nueva): lo que se recuerda por empresa
  (producto de Siigo de cada código, vendedor de cada usuario, impuestos de
  cada cliente).

Solo agrega: lo que ya existe queda como estaba (las columnas nuevas
quedan vacías en las cotizaciones viejas).
"""

import sqlalchemy as sa
from alembic import op


revision = "20261030_01"
down_revision = "20261029_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apartados", sa.Column("cliente_identificacion", sa.String(20), nullable=False, server_default=""))
    op.add_column("apartados", sa.Column("siigo_id", sa.String(60), nullable=False, server_default=""))
    op.add_column("apartados", sa.Column("siigo_numero", sa.String(30), nullable=False, server_default=""))
    op.add_column("apartados", sa.Column("siigo_total", sa.Float(), nullable=True))
    op.add_column("apartados", sa.Column("siigo_iva", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("apartados", sa.Column("siigo_retefuente", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("apartados", sa.Column("siigo_vendedor", sa.Integer(), nullable=True))
    op.add_column("apartados", sa.Column("fecha_siigo", sa.DateTime(timezone=True), nullable=True))
    op.add_column("apartados", sa.Column("siigo_pendiente", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("apartados", sa.Column("siigo_error", sa.Text(), nullable=False, server_default=""))

    op.add_column("apartado_items", sa.Column("precio", sa.Float(), nullable=True))
    op.add_column("apartado_items", sa.Column("siigo_cantidad", sa.Float(), nullable=True))
    op.add_column("apartado_items", sa.Column("siigo_producto", sa.String(60), nullable=False, server_default=""))

    op.create_table(
        "siigo_preferencias",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("empresa", sa.String(10), nullable=False),
        sa.Column("tipo", sa.String(20), nullable=False),
        sa.Column("clave", sa.String(150), nullable=False),
        sa.Column("valor", sa.String(150), nullable=False, server_default=""),
        sa.Column("nombre", sa.String(255), nullable=False, server_default=""),
        sa.Column("actualizado_por", sa.String(150), nullable=False, server_default=""),
        sa.Column("fecha", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("empresa", "tipo", "clave", name="uq_siigo_preferencias"),
    )


def downgrade() -> None:
    op.drop_table("siigo_preferencias")
    for columna in ("siigo_producto", "siigo_cantidad", "precio"):
        op.drop_column("apartado_items", columna)
    for columna in ("siigo_error", "siigo_pendiente", "fecha_siigo", "siigo_vendedor", "siigo_retefuente", "siigo_iva", "siigo_total", "siigo_numero",
                    "siigo_id", "cliente_identificacion"):
        op.drop_column("apartados", columna)
