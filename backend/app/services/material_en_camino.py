"""Material en camino (checklist del proveedor guardado antes de que llegue).

Solo cuenta para apartar: lo que se puede apartar de un código en una bodega
es lo físico + lo que viene en camino - lo ya reservado. Nunca crea rollos
ni movimientos; eso lo hace Recepción cuando el material llega.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.material_en_camino import Cargamento, CargamentoRollo
from app.models.rollo import Rollo

EN_CAMINO = "en_camino"
LLEGO = "llego"


def metros_en_camino_codigo(db: Session, *, bodega_id: int | None, codigo_interno: str) -> float:
    total = (
        db.query(func.coalesce(func.sum(CargamentoRollo.metros), 0))
        .join(Cargamento, Cargamento.id == CargamentoRollo.cargamento_id)
        .filter(Cargamento.bodega_id == bodega_id, Cargamento.estado == EN_CAMINO, CargamentoRollo.codigo_interno == codigo_interno)
        .scalar()
    )
    return round(float(total or 0), 2)


def resumen_cargamento(db: Session, cargamento: Cargamento) -> dict:
    """Totales por código y cuántos de sus rollos ya se registraron en la
    bodega (por referencia): si ya llegaron todos y sigue "en camino", ese
    material se estaría contando dos veces al apartar."""
    por_codigo: dict[str, dict] = {}
    for rollo in cargamento.rollos:
        grupo = por_codigo.setdefault(rollo.codigo_interno, {
            "codigo_interno": rollo.codigo_interno, "descripcion": rollo.descripcion, "rollos": 0, "metros": 0.0,
        })
        grupo["rollos"] += 1
        grupo["metros"] = round(grupo["metros"] + rollo.metros, 2)
    referencias = [r.identificador_rollo for r in cargamento.rollos if r.identificador_rollo]
    ya_registrados = 0
    if referencias:
        ya_registrados = (
            db.query(func.count(Rollo.id))
            .filter(Rollo.bodega_id == cargamento.bodega_id, Rollo.identificador_rollo.in_(referencias))
            .scalar()
        ) or 0
    return {
        "id": cargamento.id,
        "bodega_id": cargamento.bodega_id,
        "bodega_nombre": cargamento.bodega.nombre if cargamento.bodega else "",
        "proveedor": cargamento.proveedor,
        "archivo_origen": cargamento.archivo_origen,
        "creado_por": cargamento.creado_por,
        "fecha_creacion": cargamento.fecha_creacion,
        "estado": cargamento.estado,
        "llego_por": cargamento.llego_por,
        "fecha_llegada": cargamento.fecha_llegada,
        "total_rollos": len(cargamento.rollos),
        "total_metros": round(sum(r.metros for r in cargamento.rollos), 2),
        "rollos_ya_registrados": int(ya_registrados),
        "codigos": sorted(por_codigo.values(), key=lambda g: g["codigo_interno"]),
    }
