"""Rollos prestados por terceros.

`prestamos_empresa.prestador`: el nombre de la empresa o persona que prestó
un rollo al ingresarlo a mano (ej. "Aceros XYZ"); "" en los préstamos entre
Arquitejas y Asia Business. Solo agrega una columna: lo que ya existe queda
como estaba.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261029_01"
down_revision = "20261026_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("prestamos_empresa", sa.Column("prestador", sa.String(150), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("prestamos_empresa", "prestador")
