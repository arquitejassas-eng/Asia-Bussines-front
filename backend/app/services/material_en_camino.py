"""Material en camino (checklist del proveedor guardado antes de que llegue).

Es una bolsa de la EMPRESA, no de una bodega: llega a Admin Inventario, que
después lo reparte. Para apartar en una bodega cuenta:

    libre en esa bodega
    + lo que viene en camino (rollos del checklist que no han llegado)
    + lo que Admin Inventario ya recibió y no ha repartido (rollos sin bodega)
    - lo que las bodegas ya están esperando de esa bolsa (sus faltantes).

Nunca crea rollos ni movimientos; eso lo hace Recepción cuando el material llega.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.material_en_camino import Cargamento, CargamentoRollo
from app.models.rollo import Rollo

EN_CAMINO = "en_camino"
CERRADO = "cerrado"


def metros_en_camino_codigo(db: Session, *, codigo_interno: str) -> float:
    """Metros de los rollos del checklist que todavía no han llegado."""
    total = (
        db.query(func.coalesce(func.sum(CargamentoRollo.metros), 0))
        .join(Cargamento, Cargamento.id == CargamentoRollo.cargamento_id)
        .filter(Cargamento.estado == EN_CAMINO, CargamentoRollo.llego.is_(False), CargamentoRollo.codigo_interno == codigo_interno)
        .scalar()
    )
    return round(float(total or 0), 2)


def metros_por_repartir_codigo(db: Session, *, codigo_interno: str) -> float:
    """Lo que Admin Inventario ya recibió (rollos sin bodega) y no ha repartido."""
    total = (
        db.query(func.coalesce(func.sum(Rollo.metros_disponibles), 0))
        .filter(Rollo.bodega_id.is_(None), Rollo.codigo_interno == codigo_interno)
        .scalar()
    )
    return round(float(total or 0), 2)


def resumen_cargamento(db: Session, cargamento: Cargamento) -> dict:
    """Avance del checklist (cuántos rollos llegaron) y, para ayudar a marcar
    cada mula, qué rollos pendientes ya tienen ingreso en Recepción (misma
    referencia registrada en cualquier bodega o en Admin Inventario)."""
    referencias = [r.identificador_rollo for r in cargamento.rollos if r.identificador_rollo and not r.llego]
    ya_ingresaron: set[str] = set()
    if referencias:
        ya_ingresaron = {ref for (ref,) in db.query(Rollo.identificador_rollo).filter(Rollo.identificador_rollo.in_(referencias))}
    rollos = [
        {
            "id": r.id, "identificador_rollo": r.identificador_rollo, "codigo_interno": r.codigo_interno,
            "descripcion": r.descripcion, "metros": r.metros, "llego": r.llego, "llego_por": r.llego_por,
            "fecha_llegada": r.fecha_llegada,
            "ya_tiene_ingreso": not r.llego and r.identificador_rollo in ya_ingresaron,
        }
        for r in cargamento.rollos
    ]
    pendientes = [r for r in cargamento.rollos if not r.llego]
    return {
        "id": cargamento.id,
        "proveedor": cargamento.proveedor,
        "archivo_origen": cargamento.archivo_origen,
        "creado_por": cargamento.creado_por,
        "fecha_creacion": cargamento.fecha_creacion,
        "estado": cargamento.estado,
        "cerrado_por": cargamento.cerrado_por,
        "fecha_cierre": cargamento.fecha_cierre,
        "total_rollos": len(cargamento.rollos),
        "rollos_llegados": len(cargamento.rollos) - len(pendientes),
        "total_metros": round(sum(r.metros for r in cargamento.rollos), 2),
        "metros_pendientes": round(sum(r.metros for r in pendientes), 2),
        "rollos_ya_con_ingreso": len(ya_ingresaron),
        "rollos": rollos,
    }
