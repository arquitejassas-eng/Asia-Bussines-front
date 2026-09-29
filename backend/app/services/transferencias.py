from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.numeros import a_decimal
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.solicitud import EstadoSolicitud, Solicitud
from app.models.usuario import Usuario
from app.schemas.bodegas import SolicitudCrear
from app.services.apartados import bloquear_rollos_codigo, validar_reserva_producto, validar_reserva_rollos
from app.services.productos import nuevo_producto_en_bodega


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
        return Solicitud(
            fecha=datetime.now(timezone.utc), estado=EstadoSolicitud.PENDIENTE,
            tipo_operacion=datos.tipo_operacion, cantidad=rollo.metros_disponibles,
            producto_codigo=rollo.codigo_interno,
            producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
            rollo_id=rollo.id, bodega_solicitante_id=usuario.bodega_id,
            bodega_propietaria_id=rollo.bodega_id, solicitado_por=usuario.correo,
            observaciones=datos.observaciones,
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
    if a_decimal(datos.cantidad) > producto.stock:
        raise HTTPException(status_code=400, detail="La cantidad supera la disponibilidad de esa bodega.")
    validar_reserva_producto(db, producto=producto, cantidad=a_decimal(datos.cantidad))
    return Solicitud(
        fecha=datetime.now(timezone.utc), estado=EstadoSolicitud.PENDIENTE,
        tipo_operacion=datos.tipo_operacion, cantidad=datos.cantidad,
        producto_codigo=producto.codigo, producto_descripcion=producto.descripcion,
        rollo_id=None, bodega_solicitante_id=usuario.bodega_id,
        bodega_propietaria_id=producto.bodega_id, solicitado_por=usuario.correo,
        observaciones=datos.observaciones,
    )


def rechazar_solicitud_transferencia(
    db: Session, solicitud_id: int, usuario: Usuario
) -> Solicitud:
    """Rechaza una solicitud pendiente de la bodega propietaria."""
    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).with_for_update().first()
    if solicitud is None or solicitud.bodega_propietaria_id != usuario.bodega_id:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    if solicitud.estado != EstadoSolicitud.PENDIENTE:
        raise HTTPException(status_code=400, detail="Esta solicitud ya fue procesada.")
    solicitud.estado = EstadoSolicitud.RECHAZADA
    return solicitud


def aceptar_solicitud_transferencia(
    db: Session, solicitud_id: int, usuario: Usuario
) -> Solicitud:
    """Aplica una transferencia aceptada sin confirmar la transaccion."""
    solicitud = (
        db.query(Solicitud)
        .filter(Solicitud.id == solicitud_id)
        .with_for_update()
        .first()
    )
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
        rollo.bodega_id = solicitud.bodega_solicitante_id
        db.add(Movimiento(
            fecha=datetime.now(timezone.utc), tipo=TipoMovimiento.TRANSFERENCIA,
            motivo=solicitud.tipo_operacion.value, producto_codigo=rollo.codigo_interno,
            producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
            rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo,
            bodega_origen_id=solicitud.bodega_propietaria_id,
            bodega_destino_id=solicitud.bodega_solicitante_id,
            cantidad=rollo.metros_disponibles, usuario=usuario.correo,
            observaciones=f"Transferencia aceptada del rollo {rollo.identificador_rollo}.",
        ))
        solicitud.estado = EstadoSolicitud.ACEPTADA
        return solicitud

    producto_origen = (
        db.query(Producto)
        .filter(Producto.codigo == solicitud.producto_codigo,
                Producto.bodega_id == solicitud.bodega_propietaria_id)
        .with_for_update().first()
    )
    cantidad = a_decimal(solicitud.cantidad)
    if producto_origen is None or producto_origen.stock < cantidad:
        raise HTTPException(status_code=400, detail="Ya no hay stock suficiente para aceptar esta solicitud.")
    validar_reserva_producto(db, producto=producto_origen, cantidad=cantidad)
    producto_origen.stock -= cantidad
    producto_destino = (
        db.query(Producto)
        .filter(Producto.codigo == solicitud.producto_codigo,
                Producto.bodega_id == solicitud.bodega_solicitante_id)
        .with_for_update().first()
    )
    if producto_destino:
        producto_destino.stock += cantidad
        producto_destino.entrada += cantidad
    else:
        db.add(nuevo_producto_en_bodega(producto_origen, bodega_id=solicitud.bodega_solicitante_id, cantidad=solicitud.cantidad))
    db.add(Movimiento(
        fecha=datetime.now(timezone.utc), tipo=TipoMovimiento.TRANSFERENCIA,
        motivo=solicitud.tipo_operacion.value, producto_codigo=solicitud.producto_codigo,
        producto_descripcion=solicitud.producto_descripcion,
        bodega_origen_id=solicitud.bodega_propietaria_id,
        bodega_destino_id=solicitud.bodega_solicitante_id,
        cantidad=solicitud.cantidad, usuario=usuario.correo,
        observaciones=f"Transferencia aceptada ({solicitud.tipo_operacion.value}).",
    ))
    solicitud.estado = EstadoSolicitud.ACEPTADA
    return solicitud
