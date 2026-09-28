"""Referencia de rollo única por bodega: uq_rollos_bodega_identificador.

La recepción de proveedor podía registrar dos veces el mismo rollo físico
(mismo Excel subido dos veces, o doble clic). Si ya hay duplicados, esta
migración falla a propósito: hay que decidir a mano cuál conservar.
"""

from alembic import op


revision = "20260930_01"
down_revision = "20260929_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_rollos_bodega_identificador", "rollos", ["bodega_id", "identificador_rollo"])


def downgrade() -> None:
    op.drop_constraint("uq_rollos_bodega_identificador", "rollos", type_="unique")
