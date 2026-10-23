"""Índices para las consultas que la app hace más seguido.

Postgres no indexa solo las llaves foráneas: lo apartado por producto y por
código, los traslados por bodega y estado (la campanita y Bodegas se
actualizan solas cada pocos segundos), los rollos de cada producción (Hoja de
Vida) y las referencias de rollo (Recepción revisa en todas las bodegas) se
buscaban recorriendo la tabla entera. Solo agrega índices: no cambia datos.
"""

from alembic import op


revision = "20261023_01"
down_revision = "20261022_02"
branch_labels = None
depends_on = None

INDICES = [
    ("ix_apartado_items_producto_id", "apartado_items", ["producto_id"]),
    ("ix_apartado_items_codigo_interno", "apartado_items", ["codigo_interno"]),
    ("ix_apartados_estado", "apartados", ["estado"]),
    ("ix_solicitudes_estado", "solicitudes", ["estado"]),
    ("ix_solicitudes_propietaria_estado", "solicitudes", ["bodega_propietaria_id", "estado"]),
    ("ix_solicitudes_solicitante_estado", "solicitudes", ["bodega_solicitante_id", "estado"]),
    ("ix_rollos_utilizados_produccion_produccion_id", "rollos_utilizados_produccion", ["produccion_id"]),
    ("ix_rollos_utilizados_produccion_rollo_id", "rollos_utilizados_produccion", ["rollo_id"]),
    ("ix_productos_produccion_id", "productos", ["produccion_id"]),
    ("ix_envio_items_rollo_id", "envio_items", ["rollo_id"]),
    ("ix_rollos_recepcion_id", "rollos", ["recepcion_id"]),
    ("ix_rollos_identificador_rollo", "rollos", ["identificador_rollo"]),
    ("ix_cargamento_rollos_identificador_rollo", "cargamento_rollos", ["identificador_rollo"]),
]


def upgrade() -> None:
    for nombre, tabla, columnas in INDICES:
        op.create_index(nombre, tabla, columnas)


def downgrade() -> None:
    for nombre, tabla, _ in reversed(INDICES):
        op.drop_index(nombre, table_name=tabla)
