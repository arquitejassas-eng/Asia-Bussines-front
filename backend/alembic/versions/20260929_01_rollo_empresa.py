"""Agrega `empresa` a `rollos`: sigla de la empresa dueña del rollo (AR =
Arquitejas, ABG = Asia Business), deducida de la referencia. Rellena los
rollos que ya existan.
"""

import re

from alembic import op
import sqlalchemy as sa


revision = "20260929_01"
down_revision = "20260928_01"
branch_labels = None
depends_on = None


# Copia congelada de app/services/empresas.py: una migración no debe cambiar
# de comportamiento si ese servicio cambia después.
_SIGLAS_CONOCIDAS = ("ABG", "AR")


def _sigla(identificador_rollo: str | None, codigo_interno: str | None) -> str:
    sin_importacion = re.sub(r"\s+", "", identificador_rollo or "").upper().lstrip("0123456789")
    if not sin_importacion:
        return ""
    codigo = re.sub(r"\s+", "", codigo_interno or "").upper()
    if codigo:
        posicion = sin_importacion.find(codigo)
        if posicion == 0:
            return ""
        if posicion > 0 and sin_importacion[:posicion].isalpha():
            return sin_importacion[:posicion]
    for sigla in _SIGLAS_CONOCIDAS:
        if sin_importacion.startswith(sigla):
            return sigla
    return ""


def upgrade() -> None:
    op.add_column("rollos", sa.Column("empresa", sa.String(10), nullable=False, server_default=""))
    op.create_index("ix_rollos_empresa", "rollos", ["empresa"])

    conexion = op.get_bind()
    rollos = conexion.execute(sa.text("SELECT id, identificador_rollo, codigo_interno FROM rollos")).fetchall()
    for rollo_id, identificador_rollo, codigo_interno in rollos:
        sigla = _sigla(identificador_rollo, codigo_interno)
        if sigla:
            conexion.execute(sa.text("UPDATE rollos SET empresa = :sigla WHERE id = :id"), {"sigla": sigla, "id": rollo_id})


def downgrade() -> None:
    op.drop_index("ix_rollos_empresa", table_name="rollos")
    op.drop_column("rollos", "empresa")
