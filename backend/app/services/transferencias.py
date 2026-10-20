from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.bodega import Bodega
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.solicitud import ESTADOS_TRASLADO_EN_CURSO, EstadoSolicitud, Solicitud
from app.models.usuario import Usuario
from app.schemas.bodegas import SolicitudCrear
from app.services.apartados import bloquear_rollos_codigo, exigir_rollo_libre, validar_reserva_producto, validar_reserva_rollos
from app.services.productos import nuevo_producto_en_bodega


def _decimal(valor: float | Decimal) -> Decimal:
    return Decimal(str(valor))


def _rollo_bloqueado_con_su_codigo(db: Session, rollo_id: int) -> tuple[Rollo, list[Rollo]]:
    """El rollo y todos los de su código en SU bodega, bloqueados en orden
    por id (la reserva de apartados es por código; ver
    apartados.bloquear_rollos_codigo)."""
    previo = db.get(Rollo, rollo_id)
    if previo is None:
        raise HTTPException(status_code=404, detail="Rollo no encontrado.")
    rollos_codigo = bloquear_rollos_codigo(db, bodega_id=previo.bodega_id, codigo_interno=previo.codigo_interno)
    rollo = next((r for r in rollos_codigo if r.id == rollo_id), None)
    if rollo is None:
        raise HTTPException(status_code=409, detail="El rollo acaba de cambiar. Recarga e intenta de nuevo.")
    exigir_rollo_libre(db, rollo)
    return rollo, rollos_codigo


def crear_solicitud_transferencia(
    db: Session, datos: SolicitudCrear, usuario: Usuario
) -> Solicitud:
    """Crea una solicitud, aplicando bloqueos y validaciones reutilizables."""
    if usuario.bodega_id is None:
        # Admin Inventario no participa del sistema de Solicitudes entre
        # sedes (además, Solicitud.bodega_solicitante_id es NOT NULL — sin
        # este guard, intentarlo terminaría en un error de integridad).
        raise HTTPException(
            status_code=400,
            detail="Admin Inventario no usa Solicitudes entre sedes; usa /envios para repartir material.",
        )
    if datos.rollo_id is not None:
        rollo, rollos_codigo = _rollo_bloqueado_con_su_codigo(db, datos.rollo_id)
        if rollo.metros_disponibles <= 0:
            raise HTTPException(status_code=400, detail="El rollo no tiene metros disponibles.")
        if rollo.bodega_id == usuario.bodega_id:
            raise HTTPException(status_code=400, detail="Selecciona un rollo de otra bodega.")
        # Se avisa desde ya (y se vuelve a validar al aceptar): un rollo cuyo
        # material está apartado en la otra bodega no se puede pedir.
        validar_reserva_rollos(
            db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno,
            metros_salen=rollo.metros_disponibles, rollos_codigo=rollos_codigo,
        )
        if db.query(Solicitud.id).filter(
            Solicitud.rollo_id == rollo.id, Solicitud.estado == EstadoSolicitud.PENDIENTE
        ).first() is not None:
            raise HTTPException(status_code=409, detail="Este rollo ya tiene una solicitud pendiente de otra bodega.")
        _exigir_bodega_que_traslada(db, rollo.bodega_id)
        return Solicitud(
            fecha=datetime.now(timezone.utc), estado=EstadoSolicitud.PENDIENTE,
            tipo_operacion=datos.tipo_operacion, cantidad=rollo.metros_disponibles,
            producto_codigo=rollo.codigo_interno,
            producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
            rollo_id=rollo.id, bodega_solicitante_id=usuario.bodega_id,
            bodega_propietaria_id=rollo.bodega_id, solicitado_por=usuario.correo,
            observaciones=datos.observaciones, numero_cotizacion=datos.numero_cotizacion.strip(),
        )

    if datos.producto_id is None or datos.cantidad is None:
        raise HTTPException(status_code=400, detail="Selecciona un producto o un rollo.")
    producto = db.query(Producto).filter(Producto.id == datos.producto_id).with_for_update().first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    if producto.bodega_id == usuario.bodega_id:
        raise HTTPException(status_code=400, detail="Selecciona material de otra bodega.")
    if datos.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero.")
    if _decimal(datos.cantidad) > producto.stock:
        raise HTTPException(status_code=400, detail="La cantidad supera la disponibilidad de esa bodega.")
    validar_reserva_producto(db, producto=producto, cantidad=_decimal(datos.cantidad))
    _exigir_bodega_que_traslada(db, producto.bodega_id)
    return Solicitud(
        fecha=datetime.now(timezone.utc), estado=EstadoSolicitud.PENDIENTE,
        tipo_operacion=datos.tipo_operacion, cantidad=datos.cantidad,
        producto_codigo=producto.codigo, producto_descripcion=producto.descripcion, empresa=producto.empresa,
        rollo_id=None, bodega_solicitante_id=usuario.bodega_id,
        bodega_propietaria_id=producto.bodega_id, solicitado_por=usuario.correo,
        observaciones=datos.observaciones, numero_cotizacion=datos.numero_cotizacion.strip(),
    )


def _exigir_bodega_que_traslada(db: Session, bodega_id: int | None) -> None:
    bodega = db.get(Bodega, bodega_id) if bodega_id is not None else None
    if bodega is not None and bodega.sin_traslado:
        raise HTTPException(status_code=400, detail=f"Desde {bodega.nombre} no se hacen traslados a otras bodegas.")


def rechazar_solicitud_transferencia(
    db: Session, solicitud_id: int, usuario: Usuario
) -> Solicitud:
    """La bodega dueña rechaza una solicitud pendiente, o suelta una aceptada
    que todavía no ha despachado (el material deja de estar apartado)."""
    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).with_for_update().first()
    if solicitud is None or solicitud.bodega_propietaria_id != usuario.bodega_id:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    if solicitud.estado not in (EstadoSolicitud.PENDIENTE, EstadoSolicitud.ACEPTADA):
        raise HTTPException(status_code=400, detail="Este traslado ya salió o ya fue procesado: no se puede rechazar.")
    solicitud.estado = EstadoSolicitud.RECHAZADA
    return solicitud


def _solicitud_bloqueada(db: Session, solicitud_id: int) -> Solicitud | None:
    return db.query(Solicitud).filter(Solicitud.id == solicitud_id).with_for_update().first()


def aceptar_solicitud_transferencia(
    db: Session, solicitud_id: int, usuario: Usuario
) -> Solicitud:
    """La bodega dueña acepta: el material queda APARTADO para el traslado
    (nadie más lo vende, consume ni traslada) pero no se mueve todavía; sale
    al despacharlo (ver despachar_solicitud)."""
    solicitud = _solicitud_bloqueada(db, solicitud_id)
    if solicitud is None or solicitud.bodega_propietaria_id != usuario.bodega_id:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    if solicitud.estado != EstadoSolicitud.PENDIENTE:
        raise HTTPException(status_code=400, detail="Esta solicitud ya fue procesada.")

    if solicitud.rollo_id is not None:
        previo = db.get(Rollo, solicitud.rollo_id)
        if previo is None or previo.bodega_id != solicitud.bodega_propietaria_id:
            raise HTTPException(status_code=400, detail="El rollo ya no esta disponible en esta bodega.")
        rollo, rollos_codigo = _rollo_bloqueado_con_su_codigo(db, solicitud.rollo_id)
        if rollo.bodega_id != solicitud.bodega_propietaria_id:
            raise HTTPException(status_code=400, detail="El rollo ya no esta disponible en esta bodega.")
        # El rollo sale completo de esta bodega: no puede llevarse metros apartados aquí.
        validar_reserva_rollos(
            db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno,
            metros_salen=rollo.metros_disponibles, rollos_codigo=rollos_codigo,
        )
        solicitud.cantidad = rollo.metros_disponibles
    else:
        producto_origen = _producto_de(db, solicitud, solicitud.bodega_propietaria_id)
        cantidad = _decimal(solicitud.cantidad)
        if producto_origen is None or producto_origen.stock < cantidad:
            raise HTTPException(status_code=400, detail="Ya no hay stock suficiente para aceptar esta solicitud.")
        validar_reserva_producto(db, producto=producto_origen, cantidad=cantidad)
    solicitud.estado = EstadoSolicitud.ACEPTADA
    solicitud.aceptada_por = usuario.correo
    solicitud.fecha_aceptada = datetime.now(timezone.utc)
    return solicitud


def despachar_solicitud(db: Session, solicitud_id: int, usuario: Usuario) -> Solicitud:
    """La bodega dueña despacha (el carro de la empresa se lo lleva): el
    material sale de esa bodega y queda "en camino" hasta que lo reciban.
    Un rollo, igual que en los envíos de Admin Inventario, sigue anotado en
    la bodega dueña pero bloqueado (no se consume ni se saca) y cambia de
    bodega al recibirlo, con los metros que tenía al salir."""
    solicitud = _solicitud_bloqueada(db, solicitud_id)
    if solicitud is None or solicitud.bodega_propietaria_id != usuario.bodega_id:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    if solicitud.estado != EstadoSolicitud.ACEPTADA:
        raise HTTPException(status_code=400, detail="Solo se despacha una solicitud aceptada que todavía no ha salido.")
    ahora = datetime.now(timezone.utc)
    if solicitud.rollo_id is not None:
        rollo = db.query(Rollo).filter(Rollo.id == solicitud.rollo_id).with_for_update().first()
        if rollo is None or rollo.bodega_id != solicitud.bodega_propietaria_id:
            raise HTTPException(status_code=400, detail="El rollo ya no está en esta bodega.")
        solicitud.cantidad = rollo.metros_disponibles
        descripcion = f"{rollo.descripcion} (rollo {rollo.identificador_rollo})"
    else:
        producto_origen = _producto_de(db, solicitud, solicitud.bodega_propietaria_id)
        cantidad = _decimal(solicitud.cantidad)
        if producto_origen is None or producto_origen.stock < cantidad:
            raise HTTPException(status_code=400, detail="Ya no hay stock suficiente para despachar esta solicitud.")
        producto_origen.stock -= cantidad
        descripcion = solicitud.producto_descripcion
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.TRANSFERENCIA, motivo=solicitud.tipo_operacion.value,
        producto_codigo=solicitud.producto_codigo, producto_descripcion=descripcion,
        rollo_id=solicitud.rollo_id, identificador_rollo=_identificador(db, solicitud),
        bodega_origen_id=solicitud.bodega_propietaria_id, bodega_destino_id=solicitud.bodega_solicitante_id,
        cantidad=solicitud.cantidad, usuario=usuario.correo, cotizacion=solicitud.numero_cotizacion or "",
        observaciones=f"Traslado #{solicitud.id} despachado: va en camino.",
    ))
    solicitud.estado = EstadoSolicitud.DESPACHADA
    solicitud.despachada_por = usuario.correo
    solicitud.fecha_despachada = ahora
    return solicitud


def recibir_solicitud(db: Session, solicitud_id: int, usuario: Usuario) -> Solicitud:
    """La bodega que lo pidió confirma que llegó: el material entra a ella."""
    solicitud = _solicitud_bloqueada(db, solicitud_id)
    if solicitud is None or solicitud.bodega_solicitante_id != usuario.bodega_id:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    if solicitud.estado != EstadoSolicitud.DESPACHADA:
        raise HTTPException(status_code=400, detail="Este traslado no está en camino.")
    ahora = datetime.now(timezone.utc)
    if solicitud.rollo_id is not None:
        rollo = db.query(Rollo).filter(Rollo.id == solicitud.rollo_id).with_for_update().first()
        if rollo is None or rollo.bodega_id != solicitud.bodega_propietaria_id:
            raise HTTPException(status_code=400, detail="El rollo ya no está en la bodega de donde salió.")
        rollo.bodega_id = solicitud.bodega_solicitante_id
        descripcion = f"{rollo.descripcion} (rollo {rollo.identificador_rollo})"
    else:
        producto_origen = _producto_de(db, solicitud, solicitud.bodega_propietaria_id)
        producto_destino = _producto_de(db, solicitud, solicitud.bodega_solicitante_id)
        cantidad = _decimal(solicitud.cantidad)
        if producto_destino:
            producto_destino.stock += cantidad
            producto_destino.entrada += cantidad
        elif producto_origen is not None:
            db.add(nuevo_producto_en_bodega(producto_origen, bodega_id=solicitud.bodega_solicitante_id, cantidad=solicitud.cantidad))
        else:
            raise HTTPException(status_code=400, detail="El producto ya no existe en la bodega de donde salió.")
        descripcion = solicitud.producto_descripcion
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.TRANSFERENCIA, motivo=solicitud.tipo_operacion.value,
        producto_codigo=solicitud.producto_codigo, producto_descripcion=descripcion,
        rollo_id=solicitud.rollo_id, identificador_rollo=_identificador(db, solicitud),
        bodega_origen_id=solicitud.bodega_propietaria_id, bodega_destino_id=solicitud.bodega_solicitante_id,
        cantidad=solicitud.cantidad, usuario=usuario.correo, cotizacion=solicitud.numero_cotizacion or "",
        observaciones=f"Traslado #{solicitud.id} recibido.",
    ))
    solicitud.estado = EstadoSolicitud.RECIBIDA
    solicitud.recibida_por = usuario.correo
    solicitud.fecha_recibida = ahora
    return solicitud


def _producto_de(db: Session, solicitud: Solicitud, bodega_id: int) -> Producto | None:
    return (
        db.query(Producto)
        .filter(Producto.codigo == solicitud.producto_codigo, Producto.empresa == (solicitud.empresa or ""),
                Producto.bodega_id == bodega_id)
        .with_for_update().first()
    )


def _identificador(db: Session, solicitud: Solicitud) -> str:
    if solicitud.rollo_id is None:
        return ""
    rollo = db.get(Rollo, solicitud.rollo_id)
    return rollo.identificador_rollo if rollo else ""


def traslado_en_curso_del_rollo(db: Session, rollo_id: int) -> Solicitud | None:
    """El traslado aceptado o en camino de este rollo: mientras tanto el rollo
    no se consume, ni se vende completo, ni se saca, ni se vuelve a pedir."""
    return (
        db.query(Solicitud)
        .filter(Solicitud.rollo_id == rollo_id, Solicitud.estado.in_(ESTADOS_TRASLADO_EN_CURSO))
        .first()
    )


def cantidad_en_traslado_producto(db: Session, producto: Producto) -> float:
    """Unidades de un producto aceptadas para traslado que todavía no salen:
    siguen en la bodega dueña, pero apartadas para el traslado."""
    total = (
        db.query(func.coalesce(func.sum(Solicitud.cantidad), 0))
        .filter(Solicitud.bodega_propietaria_id == producto.bodega_id, Solicitud.rollo_id.is_(None),
                Solicitud.producto_codigo == producto.codigo, Solicitud.empresa == (producto.empresa or ""),
                Solicitud.estado == EstadoSolicitud.ACEPTADA)
        .scalar()
    )
    return round(float(total or 0), 2)
