"""Traslados entre bodegas en pasos.

Un traslado de ciudad a ciudad tarda días: aceptar ya no mueve el material.
`solicitudes.estado` suma DESPACHADA (salió de la bodega dueña, va en camino)
y RECIBIDA (llegó). Las solicitudes ya aceptadas antes de esto se movieron
al aceptarlas, así que quedan como RECIBIDA. Columnas nuevas: la cotización
para la que se pide y quién/cuándo aceptó, despachó y recibió.
"""

import sqlalchemy as sa
from alembic import op


revision = "20261020_01"
down_revision = "20261016_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        # ADD VALUE no se puede usar en la misma transacción en que se crea.
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE estadosolicitud ADD VALUE IF NOT EXISTS 'DESPACHADA'")
            op.execute("ALTER TYPE estadosolicitud ADD VALUE IF NOT EXISTS 'RECIBIDA'")
    op.add_column("solicitudes", sa.Column("numero_cotizacion", sa.String(32), nullable=False, server_default=""))
    for quien, cuando in (("aceptada_por", "fecha_aceptada"), ("despachada_por", "fecha_despachada"), ("recibida_por", "fecha_recibida")):
        op.add_column("solicitudes", sa.Column(quien, sa.String(150), nullable=False, server_default=""))
        op.add_column("solicitudes", sa.Column(cuando, sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE solicitudes SET estado = 'RECIBIDA', fecha_recibida = fecha WHERE estado = 'ACEPTADA'")


def downgrade() -> None:
    op.execute("UPDATE solicitudes SET estado = 'ACEPTADA' WHERE estado IN ('DESPACHADA', 'RECIBIDA')")
    for columna in ("fecha_recibida", "recibida_por", "fecha_despachada", "despachada_por", "fecha_aceptada", "aceptada_por", "numero_cotizacion"):
        op.drop_column("solicitudes", columna)
    # Los valores DESPACHADA/RECIBIDA del tipo enum de PostgreSQL no se pueden quitar: quedan sin uso.
