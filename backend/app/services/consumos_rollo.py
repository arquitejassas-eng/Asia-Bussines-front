"""Reglas transaccionales para el consumo individual de rollos."""

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import coincide_bodega
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.rollo import HistorialConsumoRollo, Rollo
from app.models.usuario import Usuario
from app.services.apartados import bloquear_rollos_codigo, validar_reserva_rollos
from app.services.envios import envio_pendiente_del_rollo


# Medio centímetro: por debajo de esto un resto de metros es ruido de
# redondeo, no material real.
TOLERANCIA_METROS = 0.005


def _metros_limpios(valor: float) -> float:
    """Redondea a centímetros y deja en 0 cualquier resto menor a medio
    centímetro (para que el rollo pase a "agotado")."""
    valor = round(valor, 2)
    return 0.0 if valor < TOLERANCIA_METROS else valor


def _rollo_bloqueado_con_su_codigo(db: Session, rollo_id: int, usuario: Usuario) -> tuple[Rollo, list[Rollo]]:
    """Devuelve el rollo y TODOS los rollos de su código, ya bloqueados en
    orden por id: la reserva de los apartados es por código, así que para
    validarla sin carreras hay que bloquear el código completo, no solo el
    rollo (ver apartados.bloquear_rollos_codigo)."""
    previo = (
        db.query(Rollo)
        .filter(Rollo.id == rollo_id, coincide_bodega(Rollo.bodega_id, usuario.bodega_id))
        .first()
    )
    if previo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rollo no encontrado.")
    rollos_codigo = bloquear_rollos_codigo(db, bodega_id=previo.bodega_id, codigo_interno=previo.codigo_interno)
    rollo = next((r for r in rollos_codigo if r.id == rollo_id), None)
    if rollo is None:
        # Le cambiaron el código (ej. una carga masiva) entre la lectura y el bloqueo.
        raise HTTPException(status_code=409, detail="El rollo acaba de cambiar. Recarga e intenta de nuevo.")
    envio = envio_pendiente_del_rollo(db, rollo.id)
    if envio is not None:
        raise HTTPException(
            status_code=400,
            detail=f"El rollo {rollo.identificador_rollo} va en camino en el envío #{envio.id}: "
            "no se puede consumir ni sacar hasta que la sede responda si llegó.",
        )
    return rollo, rollos_codigo


def registrar_consumo_rollo(
    db: Session, *, rollo_id: int, cantidad: float, observaciones: str, usuario: Usuario
) -> Rollo:
    """Bloquea, valida y descuenta un rollo sin confirmar la transacción."""
    rollo, rollos_codigo = _rollo_bloqueado_con_su_codigo(db, rollo_id, usuario)
    if cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero.")
    # Todo a 2 decimales (centímetros): restar sin redondear dejaba restos
    # como 9.599999999999996 m -- la pantalla mostraba 9,6 pero no dejaba
    # consumir 9,6, y el rollo nunca llegaba a "agotado".
    disponibles = round(rollo.metros_disponibles, 2)
    if round(cantidad, 2) > disponibles + TOLERANCIA_METROS:
        raise HTTPException(status_code=400, detail=f"Ese rollo solo tiene {disponibles:g} m disponibles.")
    cantidad = round(min(cantidad, rollo.metros_disponibles), 2)
    validar_reserva_rollos(
        db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno,
        metros_salen=cantidad, rollos_codigo=rollos_codigo,
    )
    ahora = datetime.now(timezone.utc)
    rollo.metros_disponibles = _metros_limpios(rollo.metros_disponibles - cantidad)
    rollo.metros_consumidos = round(rollo.metros_consumidos + cantidad, 2)
    rollo.recalcular_estado()
    db.add(HistorialConsumoRollo(rollo_id=rollo.id, fecha=ahora, cantidad=cantidad, usuario=usuario.correo, observaciones=observaciones))
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo="produccion", producto_codigo=rollo.codigo_interno,
        producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
        rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo,
        bodega_origen_id=usuario.bodega_id, bodega_destino_id=None, cantidad=cantidad, usuario=usuario.correo,
        observaciones=observaciones or "Consumo en producción.",
    ))
    return rollo


def registrar_salida_externa_rollo(
    db: Session, *, rollo_id: int, empresa: str, observaciones: str, usuario: Usuario
) -> Rollo:
    """Saca el rollo COMPLETO hacia otra empresa (intercambio externo, no una
    transferencia entre nuestras bodegas). Reutiliza el mismo mecanismo que
    el consumo: mueve todos los metros disponibles a consumidos y deja que
    `recalcular_estado()` derive AGOTADO -- nunca se toca `estado` a mano."""
    rollo, rollos_codigo = _rollo_bloqueado_con_su_codigo(db, rollo_id, usuario)
    empresa = empresa.strip()
    if not empresa:
        raise HTTPException(status_code=400, detail="El nombre de la empresa es obligatorio.")
    if rollo.metros_disponibles <= 0:
        raise HTTPException(status_code=400, detail="Este rollo ya está agotado, no tiene metros disponibles.")
    validar_reserva_rollos(
        db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno,
        metros_salen=rollo.metros_disponibles, rollos_codigo=rollos_codigo,
    )
    ahora = datetime.now(timezone.utc)
    cantidad = round(rollo.metros_disponibles, 2)
    rollo.metros_consumidos = round(rollo.metros_consumidos + cantidad, 2)
    rollo.metros_disponibles = 0
    rollo.recalcular_estado()
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo="intercambio_externo", producto_codigo=rollo.codigo_interno,
        producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
        rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo,
        bodega_origen_id=usuario.bodega_id, bodega_destino_id=None, cantidad=cantidad, usuario=usuario.correo,
        empresa_externa=empresa, observaciones=observaciones or f"Intercambio con {empresa}.",
    ))
    return rollo
