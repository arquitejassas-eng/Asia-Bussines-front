"""Una sola cotización con material de las dos empresas + préstamos.

- `apartado_items.empresa_material`: empresa de la que sale el material de
  la línea cuando no es la de la cotización ("" = la de la cotización).
- `prestamos_empresa`: lo que una empresa le prestó a una cotización de la
  otra (se anota solo cuando el material sale).
- Las cotizaciones que antes se partían por empresa ("3946" + "3946-AR", o
  "3811-AR" + "3811-ABG") se juntan en una sola, con cada línea marcada con
  la empresa de su material. Lo que ya había salido de la otra empresa queda
  como préstamo. Solo se juntan partes de la misma bodega y en el mismo
  estado; si la cotización sin sufijo no existe, la parte toma ese número.
"""

import re
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op


revision = "20261022_01"
down_revision = "20261021_01"
branch_labels = None
depends_on = None

SUFIJO = re.compile(r"^(.+)-(AR|ABG)(-SAL)?$", re.IGNORECASE)
OTRA = {"AR": "ABG", "ABG": "AR"}


def upgrade() -> None:
    op.add_column("apartado_items", sa.Column("empresa_material", sa.String(10), nullable=False, server_default=""))
    op.create_table(
        "prestamos_empresa",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fecha", sa.DateTime(timezone=True), nullable=False),
        sa.Column("empresa_presta", sa.String(10), nullable=False),
        sa.Column("empresa_recibe", sa.String(10), nullable=False),
        sa.Column("bodega_id", sa.Integer(), sa.ForeignKey("bodegas.id"), nullable=True),
        sa.Column("apartado_id", sa.Integer(), sa.ForeignKey("apartados.id", ondelete="SET NULL"), nullable=True),
        sa.Column("numero_cotizacion", sa.String(32), nullable=False, server_default=""),
        sa.Column("tipo", sa.String(20), nullable=False),
        sa.Column("codigo", sa.String(60), nullable=False),
        sa.Column("descripcion", sa.String(255), nullable=False, server_default=""),
        sa.Column("cantidad", sa.Float(), nullable=False),
        sa.Column("unidad", sa.String(10), nullable=False, server_default=""),
        sa.Column("referencia_rollo", sa.String(60), nullable=False, server_default=""),
        sa.Column("origen", sa.String(30), nullable=False, server_default=""),
        sa.Column("usuario", sa.String(150), nullable=False, server_default=""),
        sa.Column("saldado", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("saldado_por", sa.String(150), nullable=False, server_default=""),
        sa.Column("fecha_saldado", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_prestamos_empresa_bodega_id", "prestamos_empresa", ["bodega_id"])
    op.create_index("ix_prestamos_empresa_apartado_id", "prestamos_empresa", ["apartado_id"])
    op.create_index("ix_prestamos_empresa_saldado_fecha", "prestamos_empresa", ["saldado", "fecha"])
    unir_partes_por_empresa(op.get_bind())


def unir_partes_por_empresa(conexion) -> list[str]:
    """Junta las partes "-AR"/"-ABG" con su cotización. Devuelve lo que hizo
    (y lo que dejó como estaba), una línea por parte. Dos pasadas: una parte
    que espera a que su hermana más grande tome el número se junta en la segunda."""
    ahora = datetime.now(timezone.utc)
    return _pasada(conexion, ahora) + _pasada(conexion, ahora)


def _lineas(conexion, apartado_id: int) -> int:
    return conexion.execute(sa.text("SELECT count(*) FROM apartado_items WHERE apartado_id = :id"), {"id": apartado_id}).scalar()


def _pasada(conexion, ahora) -> list[str]:
    hecho: list[str] = []
    partes = conexion.execute(sa.text(
        "SELECT id, bodega_id, numero_cotizacion, empresa, estado, salida_pendiente FROM apartados "
        "WHERE estado <> 'CANCELADO' ORDER BY id"
    )).mappings().all()
    for parte in partes:
        encontrado = SUFIJO.match((parte["numero_cotizacion"] or "").strip())
        if not encontrado:
            continue
        sufijo = encontrado.group(2).upper()
        base = encontrado.group(1) + (encontrado.group(3) or "")
        empresa_material = (parte["empresa"] or "").upper() or sufijo
        mismas = conexion.execute(sa.text(
            "SELECT id, empresa, estado, salida_pendiente FROM apartados "
            "WHERE bodega_id = :b AND numero_cotizacion = :n AND estado <> 'CANCELADO' AND id <> :id"
        ), {"b": parte["bodega_id"], "n": base, "id": parte["id"]}).mappings().all()
        if mismas and mismas[0]["estado"] != parte["estado"]:
            hecho.append(f"{parte['numero_cotizacion']}: se dejó igual (la {base} está en otro estado).")
            continue
        if mismas:
            destino = mismas[0]
            empresa_cotizacion = (destino["empresa"] or "").upper()
            conexion.execute(sa.text(
                "UPDATE apartados SET salida_pendiente = :sp, observaciones = observaciones || :nota WHERE id = :id"
            ), {"sp": bool(destino["salida_pendiente"] or parte["salida_pendiente"]), "id": destino["id"],
                "nota": f" · Se le unió la parte {parte['numero_cotizacion']} (material de {empresa_material})."})
            destino_id = destino["id"]
        else:
            # "3946-AR" y "3946-ABG" sin "3946" (la carga del Excel partía así):
            # la cotización es de la parte con más líneas; la otra se le junta.
            hermana = conexion.execute(sa.text(
                "SELECT id, estado FROM apartados WHERE bodega_id = :b AND numero_cotizacion = :n "
                "AND estado <> 'CANCELADO' AND id <> :id ORDER BY id"
            ), {"b": parte["bodega_id"], "n": f"{encontrado.group(1)}-{OTRA.get(sufijo, '')}{encontrado.group(3) or ''}",
                "id": parte["id"]}).mappings().first()
            if hermana is not None and hermana["estado"] == parte["estado"]:
                if _lineas(conexion, hermana["id"]) > _lineas(conexion, parte["id"]):
                    continue  # la hermana toma el número y esta se le junta después
                empresa_cotizacion = empresa_material
            else:
                empresa_cotizacion = OTRA.get(sufijo, "") if empresa_material == sufijo else empresa_material
            conexion.execute(sa.text(
                "UPDATE apartados SET numero_cotizacion = :n, empresa = :e, observaciones = observaciones || :nota WHERE id = :id"
            ), {"n": base, "e": empresa_cotizacion, "id": parte["id"],
                "nota": f" · Antes era {parte['numero_cotizacion']}: ahora es la cotización {base} con material de {empresa_material}."})
            destino_id = parte["id"]
        marca = "" if empresa_material == empresa_cotizacion else empresa_material
        _prestamos_de_lo_que_ya_salio(conexion, parte["id"], destino_id, base, parte["bodega_id"],
                                      marca, empresa_cotizacion, ahora)
        conexion.execute(sa.text(
            "UPDATE apartado_items SET apartado_id = :d, empresa_material = :m WHERE apartado_id = :p"
        ), {"d": destino_id, "m": marca, "p": parte["id"]})
        if destino_id != parte["id"]:
            conexion.execute(sa.text("DELETE FROM apartados WHERE id = :id"), {"id": parte["id"]})
            hecho.append(f"{parte['numero_cotizacion']}: unida a la {base}.")
        else:
            hecho.append(f"{parte['numero_cotizacion']}: ahora es la {base}.")
    return hecho


def _prestamos_de_lo_que_ya_salio(conexion, parte_id, destino_id, numero, bodega_id, presta, recibe, ahora) -> None:
    """Lo que ya salió de las líneas de la otra empresa queda como préstamo."""
    if not presta or not recibe or presta == recibe:
        return
    lineas = conexion.execute(sa.text(
        "SELECT i.modalidad, i.codigo_interno, i.descripcion, i.cantidad, i.metros_consumidos, i.stock_descontado, "
        "p.codigo AS producto_codigo, p.descripcion AS producto_descripcion "
        "FROM apartado_items i LEFT JOIN productos p ON p.id = i.producto_id WHERE i.apartado_id = :p"
    ), {"p": parte_id}).mappings().all()
    for linea in lineas:
        if linea["modalidad"] == "por_stock":
            if not linea["stock_descontado"]:
                continue
            tipo, codigo, descripcion, cantidad, unidad = (
                "producto", linea["producto_codigo"] or "", linea["producto_descripcion"] or linea["descripcion"], linea["cantidad"], "und")
        else:
            if not (linea["metros_consumidos"] or 0) > 0.005:
                continue
            tipo, codigo, descripcion, cantidad, unidad = (
                "lamina", linea["codigo_interno"] or "", linea["descripcion"], linea["metros_consumidos"], "m")
        conexion.execute(sa.text(
            "INSERT INTO prestamos_empresa (fecha, empresa_presta, empresa_recibe, bodega_id, apartado_id, numero_cotizacion, "
            "tipo, codigo, descripcion, cantidad, unidad, referencia_rollo, origen, usuario, saldado, saldado_por) "
            "VALUES (:f, :pr, :re, :b, :a, :n, :t, :c, :d, :q, :u, '', 'union_cotizacion', '', :s, '')"
        ), {"f": ahora, "pr": presta, "re": recibe, "b": bodega_id, "a": destino_id, "n": numero, "t": tipo,
            "c": codigo[:60], "d": (descripcion or "")[:255], "q": round(float(cantidad), 2), "u": unidad, "s": False})


def downgrade() -> None:
    # Las cotizaciones unidas no se vuelven a partir.
    op.drop_index("ix_prestamos_empresa_saldado_fecha", table_name="prestamos_empresa")
    op.drop_index("ix_prestamos_empresa_apartado_id", table_name="prestamos_empresa")
    op.drop_index("ix_prestamos_empresa_bodega_id", table_name="prestamos_empresa")
    op.drop_table("prestamos_empresa")
    op.drop_column("apartado_items", "empresa_material")
