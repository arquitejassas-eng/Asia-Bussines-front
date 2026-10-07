"""Salida de una cotización desde Admin Inventario, con la hoja de vida física.

Para las cotizaciones que ya se produjeron (o se están produciendo) y cuya
salida no se había registrado: Admin Inventario escribe la referencia del
rollo que se usó y los metros, y en un solo paso se descuenta el rollo, se
consume lo apartado y queda el movimiento con la cotización -- sin pasar por
la bodega ni por Planta (el flujo normal de Registrar Producción sigue igual
para el día a día).
"""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.apartado import Apartado, EstadoApartado, ModalidadApartado
from app.models.bodega import Bodega
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import HistorialConsumoRollo, Rollo
from app.models.usuario import Usuario
from app.schemas.apartados import RegistrarSalidaRequest
from app.services.apartados import ESTADOS_RESERVA_ACTIVA, bloquear_rollos_codigo, validar_reserva_rollos
from app.services.envios import envio_pendiente_del_rollo

TOLERANCIA = 0.005


def _rollo_por_referencia(db: Session, apartado: Apartado, referencia: str) -> Rollo:
    ref = referencia.strip().upper()
    rollo = (
        db.query(Rollo)
        .filter(Rollo.bodega_id == apartado.bodega_id, func.upper(func.trim(Rollo.identificador_rollo)) == ref)
        .first()
    )
    if rollo is not None:
        return rollo
    en_otra = db.query(Rollo).filter(func.upper(func.trim(Rollo.identificador_rollo)) == ref).first()
    if en_otra is not None:
        donde = db.get(Bodega, en_otra.bodega_id).nombre if en_otra.bodega_id else "Admin Inventario (sin repartir)"
        bodega = db.get(Bodega, apartado.bodega_id).nombre
        raise HTTPException(status_code=400, detail=f"El rollo {referencia} está en {donde}, no en {bodega} (la bodega de esta cotización).")
    raise HTTPException(status_code=400, detail=f"No existe ningún rollo con la referencia {referencia}. Revisa que esté bien escrita.")


def registrar_salida(db: Session, apartado_id: int, datos: RegistrarSalidaRequest, usuario: Usuario) -> Apartado:
    apartado = db.query(Apartado).filter(Apartado.id == apartado_id).with_for_update().populate_existing().first()
    if apartado is None:
        raise HTTPException(status_code=404, detail="Apartado no encontrado.")
    if apartado.estado not in ESTADOS_RESERVA_ACTIVA:
        raise HTTPException(status_code=400, detail="Esta cotización ya terminó, fue entregada o está cancelada.")
    if not datos.rollos and not datos.items_stock:
        raise HTTPException(status_code=400, detail="Indica al menos un rollo usado o un producto a descontar.")
    items = {item.id: item for item in apartado.items}
    ahora = datetime.now(timezone.utc)
    nota = f"Salida de la cotización {apartado.numero_cotizacion} registrada con la hoja de vida física."

    for linea in datos.rollos:
        item = items.get(linea.item_id)
        if item is None or item.modalidad != ModalidadApartado.POR_ROLLO:
            raise HTTPException(status_code=400, detail="Esa línea no es de rollo o no pertenece a esta cotización.")
        rollo = _rollo_por_referencia(db, apartado, linea.referencia)
        if rollo.codigo_interno != item.codigo_interno:
            raise HTTPException(
                status_code=400,
                detail=f"El rollo {rollo.identificador_rollo} es {rollo.codigo_interno}, pero esta línea es de {item.codigo_interno}.",
            )
        rollos_codigo = bloquear_rollos_codigo(db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno)
        rollo = next(r for r in rollos_codigo if r.id == rollo.id)
        envio = envio_pendiente_del_rollo(db, rollo.id)
        if envio is not None:
            raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} va en el envío #{envio.id}, pendiente de confirmar.")
        metros = round(linea.metros, 2)
        disponibles = round(rollo.metros_disponibles, 2)
        if metros > disponibles + TOLERANCIA:
            raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} solo tiene {disponibles:g} m disponibles.")
        metros = min(metros, disponibles)
        pendiente = max((item.metros_requeridos or 0) - (item.metros_consumidos or 0), 0)
        validar_reserva_rollos(
            db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno, metros_salen=metros,
            rollos_codigo=rollos_codigo, metros_reserva_propia=min(metros, pendiente), apartado_item_id=item.id,
        )
        restante = round(rollo.metros_disponibles - metros, 2)
        rollo.metros_disponibles = 0.0 if restante < TOLERANCIA else restante
        rollo.metros_consumidos = round(rollo.metros_consumidos + metros, 2)
        rollo.recalcular_estado()
        item.metros_consumidos = round((item.metros_consumidos or 0) + min(metros, pendiente), 2)
        db.add(HistorialConsumoRollo(rollo_id=rollo.id, fecha=ahora, cantidad=metros, usuario=usuario.correo,
                                     observaciones=f"{nota} {item.descripcion}".strip()))
        db.add(Movimiento(
            fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo="produccion", producto_codigo=rollo.codigo_interno,
            producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
            rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo,
            bodega_origen_id=apartado.bodega_id, bodega_destino_id=None, cantidad=metros, usuario=usuario.correo,
            observaciones=nota, cotizacion=apartado.numero_cotizacion,
        ))

    for item_id in dict.fromkeys(datos.items_stock):
        item = items.get(item_id)
        if item is None or item.modalidad != ModalidadApartado.POR_STOCK:
            raise HTTPException(status_code=400, detail="Esa línea no es de producto o no pertenece a esta cotización.")
        if item.stock_descontado:
            continue
        producto = (
            db.query(Producto)
            .filter(Producto.id == item.producto_id, Producto.bodega_id == apartado.bodega_id)
            .with_for_update().first()
        )
        if producto is None:
            raise HTTPException(status_code=404, detail="El producto de esa línea ya no existe.")
        if float(producto.stock) + TOLERANCIA < item.cantidad:
            raise HTTPException(
                status_code=400,
                detail=f"No hay stock suficiente de {producto.codigo} en la bodega (hay {float(producto.stock):g}, "
                f"la cotización pide {item.cantidad:g}). Dale entrada primero.",
            )
        producto.stock -= Decimal(str(item.cantidad))
        item.stock_descontado = True
        db.add(Movimiento(
            fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo="apartado_stock",
            producto_codigo=producto.codigo, producto_descripcion=producto.descripcion,
            bodega_origen_id=apartado.bodega_id, bodega_destino_id=None, cantidad=item.cantidad,
            usuario=usuario.correo, observaciones=nota, cotizacion=apartado.numero_cotizacion,
        ))

    completa = all(
        (it.stock_descontado if it.modalidad == ModalidadApartado.POR_STOCK
         else (it.metros_requeridos or 0) - (it.metros_consumidos or 0) <= TOLERANCIA)
        for it in apartado.items
    )
    if completa:
        apartado.estado = EstadoApartado.PRODUCCION_TERMINADA
    elif apartado.estado != EstadoApartado.EN_PRODUCCION:
        apartado.estado = EstadoApartado.EN_PRODUCCION
        if not apartado.enviado_a_produccion_por:
            apartado.enviado_a_produccion_por, apartado.fecha_enviado_a_produccion = usuario.correo, ahora
    return apartado
