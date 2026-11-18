"""Rollos prestados a empresas externas: con qué rollo y cuántos kilos los
devolvieron, y la factura de la diferencia."""

import sqlalchemy as sa
from alembic import op


revision = "20261118_01"
down_revision = "20261117_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("prestamos_empresa", sa.Column("devuelto_con", sa.String(255), nullable=False, server_default=""))
    op.add_column("prestamos_empresa", sa.Column("kilos_devueltos", sa.Float(), nullable=True))
    op.add_column("prestamos_empresa", sa.Column("factura", sa.String(60), nullable=False, server_default=""))
    op.add_column("prestamos_empresa", sa.Column("fecha_factura", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for columna in ("fecha_factura", "factura", "kilos_devueltos", "devuelto_con"):
        op.drop_column("prestamos_empresa", columna)
