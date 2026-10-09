"""Merma y sobrante de un rollo, los registra Planta (o Admin Inventario).

Planta es quien decide que un rollo se acabó:

- "Terminar rollo": los metros que el sistema todavía le da al rollo ya no
  existen (puntas, recortes, daño) -> salen como MERMA y el rollo queda
  AGOTADO. Es lo que en el Excel quedaba como STOCK de un rollo AGOTADO.
- "Sobrante": el rollo rindió MÁS de lo que dice el sistema (en el Excel se
  veía como un STOCK negativo, ej. -76 m) -> se le suman esos metros para
  poder registrar la producción completa. Cuenta como merma negativa.

No hay columna nueva: la merma de cada rollo es la suma de sus movimientos
con motivo "merma" y los metros de más, la de los de motivo "sobrante". Se
muestran por separado (ver merma_y_sobrante_por_rollo).
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.rollo import HistorialConsumoRollo, Rollo
from app.models.usuario import RolUsuario, Usuario
from app.services.envios import envio_pendiente_del_rollo

MOTIVO_MERMA = "merma"
MOTIVO_SOBRANTE = "sobrante"


def _puede_ver(usuario: Usuario, rollo: Rollo) -> bool:
    if usuario.rol == RolUsuario.ADMIN_INVENTARIO:
        return True
    return usuario.bodega_id is not None and rollo.bodega_id == usuario.bodega_id


def rollo_por_referencia(db: Session, referencia: str, usuario: Usuario) -> Rollo:
    """El rollo de la hoja de vida, aunque ya esté agotado. Planta solo ve los
    de su bodega; Admin Inventario, los de cualquiera."""
    ref = referencia.strip().upper()
    rollos = db.query(Rollo).filter(func.upper(func.trim(Rollo.identificador_rollo)) == ref).all()
    visibles = [r for r in rollos if _puede_ver(usuario, r)]
    if not visibles:
        detalle = "Ese rollo está en otra bodega." if rollos else f"No existe ningún rollo con la referencia {referencia.strip()}."
        raise HTTPException(status_code=404, detail=detalle)
    return visibles[0]


def _bloquear(db: Session, rollo_id: int, usuario: Usuario) -> Rollo:
    rollo = db.query(Rollo).filter(Rollo.id == rollo_id).with_for_update().populate_existing().first()
    if rollo is None or not _puede_ver(usuario, rollo):
        raise HTTPException(status_code=404, detail="Rollo no encontrado.")
    envio = envio_pendiente_del_rollo(db, rollo.id)
    if envio is not None:
        raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} va en el envío #{envio.id}, pendiente de confirmar.")
    return rollo


def terminar_rollo(db: Session, rollo_id: int, observaciones: str, usuario: Usuario) -> tuple[Rollo, float]:
    """Lo que le queda al rollo en el sistema sale como merma y queda agotado.
    Se permite aunque esté apartado: si el material ya no existe, lo apartado
    pasa a "esperando material" (es la realidad de la bodega)."""
    rollo = _bloquear(db, rollo_id, usuario)
    merma = round(rollo.metros_disponibles, 2)
    if merma <= 0:
        raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} ya está agotado: no le quedan metros.")
    return _sacar_merma(db, rollo, merma, f"Merma al terminar el rollo ({merma:g} m).", observaciones, usuario), merma


def registrar_merma(db: Session, rollo_id: int, metros: float, observaciones: str, usuario: Usuario) -> tuple[Rollo, float]:
    """Merma de una cantidad dada (ej. la que viene anotada en el Excel). Nunca
    deja el rollo en negativo: si pide más de lo que le queda, sale lo que
    queda. Devuelve los metros que realmente salieron (0 si ya no tenía)."""
    rollo = _bloquear(db, rollo_id, usuario)
    merma = round(min(metros, rollo.metros_disponibles), 2)
    if merma <= 0:
        return rollo, 0.0
    return _sacar_merma(db, rollo, merma, f"Merma de {merma:g} m.", observaciones, usuario), merma


def _sacar_merma(db: Session, rollo: Rollo, merma: float, texto: str, observaciones: str, usuario: Usuario) -> Rollo:
    ahora = datetime.now(timezone.utc)
    rollo.metros_consumidos = round(rollo.metros_consumidos + merma, 2)
    rollo.metros_disponibles = round(rollo.metros_disponibles - merma, 2)
    if rollo.metros_disponibles < 0.005:
        rollo.metros_disponibles = 0
    rollo.recalcular_estado()
    nota = texto + (f" {observaciones.strip()}" if observaciones.strip() else "")
    db.add(HistorialConsumoRollo(rollo_id=rollo.id, fecha=ahora, cantidad=merma, usuario=usuario.correo, observaciones=nota))
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo=MOTIVO_MERMA, producto_codigo=rollo.codigo_interno,
        producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
        rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo, bodega_origen_id=rollo.bodega_id,
        bodega_destino_id=None, cantidad=merma, usuario=usuario.correo, observaciones=nota,
    ))
    return rollo


def registrar_sobrante(db: Session, rollo_id: int, metros: float, observaciones: str, usuario: Usuario) -> Rollo:
    """El rollo rindió más de lo que decía el sistema: se le suman los metros."""
    if metros <= 0:
        raise HTTPException(status_code=400, detail="Indica cuántos metros de más rindió el rollo.")
    rollo = _bloquear(db, rollo_id, usuario)
    metros = round(metros, 2)
    ahora = datetime.now(timezone.utc)
    rollo.metros_disponibles = round(rollo.metros_disponibles + metros, 2)
    rollo.recalcular_estado()
    nota = f"Sobrante: el rollo rindió {metros:g} m más de lo registrado." + (f" {observaciones.strip()}" if observaciones.strip() else "")
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.ENTRADA, motivo=MOTIVO_SOBRANTE, producto_codigo=rollo.codigo_interno,
        producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
        rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo, bodega_origen_id=None,
        bodega_destino_id=rollo.bodega_id, cantidad=metros, usuario=usuario.correo, observaciones=nota,
    ))
    return rollo


def merma_y_sobrante_por_rollo(db: Session, rollo_ids: list[int]) -> dict[int, tuple[float, float]]:
    """(merma, metros de más) de cada rollo, por separado."""
    if not rollo_ids:
        return {}
    filas = (
        db.query(
            Movimiento.rollo_id,
            func.sum(case((Movimiento.motivo == MOTIVO_MERMA, Movimiento.cantidad), else_=0)),
            func.sum(case((Movimiento.motivo == MOTIVO_SOBRANTE, Movimiento.cantidad), else_=0)),
        )
        .filter(Movimiento.rollo_id.in_(rollo_ids), Movimiento.motivo.in_((MOTIVO_MERMA, MOTIVO_SOBRANTE)))
        .group_by(Movimiento.rollo_id)
        .all()
    )
    return {rollo_id: (round(float(merma or 0), 2), round(float(sobrante or 0), 2)) for rollo_id, merma, sobrante in filas}


def rollos_con_merma_o_sobrante(db: Session):
    """Subconsulta: ids de los rollos con merma o metros de más registrados."""
    return (
        db.query(Movimiento.rollo_id)
        .filter(Movimiento.rollo_id.isnot(None), Movimiento.motivo.in_((MOTIVO_MERMA, MOTIVO_SOBRANTE)))
        .distinct()
    )


def asignar_merma_y_sobrante(db: Session, rollos: list[Rollo]) -> None:
    """Llena merma_metros y sobrante_metros (atributos de respuesta) de cada rollo."""
    datos = merma_y_sobrante_por_rollo(db, [r.id for r in rollos])
    for rollo in rollos:
        rollo.merma_metros, rollo.sobrante_metros = datos.get(rollo.id, (0.0, 0.0))
