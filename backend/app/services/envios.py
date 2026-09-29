"""Reglas transaccionales del despacho de material de Admin Inventario hacia
las sedes ("Envíos"). A diferencia de `transferencias.py` (una bodega le pide
material a otra y esta aprueba antes de mover nada), aquí el origen — siempre
Admin Inventario, `bodega_id IS NULL` — decide y despacha primero; la sede
destino confirma después si el material realmente llegó. Un rollo nunca
cambia de `bodega_id` hasta que la sede confirme "Sí" (ver
`confirmar_envio_recibido`); si responde "No", nunca se tocó y sigue siendo
de Admin Inventario sin ninguna reversión que hacer. Para productos (por
unidades, sí fungibles) el stock se descuenta de Admin Inventario ya al
crear el envío — queda "en tránsito" — y se devuelve si la sede dice "No".
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.numeros import a_decimal
from app.models.envio import Envio, EnvioItem, EstadoEnvio
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.schemas.envios import EnvioCrear
from app.services.productos import nuevo_producto_en_bodega
from app.services.unidades_familia import validar_cantidad_entera_si_aplica


def envio_pendiente_del_rollo(db: Session, rollo_id: int) -> Envio | None:
    """El envío PENDIENTE (en camino) en el que va este rollo, si hay uno.
    Mientras un rollo va en camino no se le puede consumir ni sacar (ver
    consumos_rollo.py): la sede lo recibe con los metros que tenía al salir."""
    return (
        db.query(Envio)
        .join(EnvioItem, EnvioItem.envio_id == Envio.id)
        .filter(EnvioItem.rollo_id == rollo_id, Envio.estado == EstadoEnvio.PENDIENTE_CONFIRMACION)
        .first()
    )


def _envio_de_mi_bodega(db: Session, envio_id: int, usuario: Usuario) -> Envio:
    envio = db.query(Envio).filter(Envio.id == envio_id).with_for_update().first()
    if envio is None or envio.bodega_destino_id != usuario.bodega_id:
        raise HTTPException(status_code=404, detail="Envío no encontrado.")
    if envio.estado != EstadoEnvio.PENDIENTE_CONFIRMACION:
        raise HTTPException(status_code=400, detail="Este envío ya fue respondido.")
    return envio


def crear_envio(db: Session, datos: EnvioCrear, usuario: Usuario) -> Envio:
    """Admin Inventario despacha rollos/productos propios hacia una sede."""
    if usuario.bodega_id is not None:
        raise HTTPException(status_code=403, detail="Solo Admin Inventario puede crear envíos.")
    if not datos.items:
        raise HTTPException(status_code=400, detail="El envío debe tener al menos un ítem.")
    # El chequeo de "ya tiene un envío pendiente" de abajo no ve los ítems
    # agregados en este mismo envío (autoflush=False): sin esto, el mismo
    # rollo podía ir dos veces y generar dos transferencias al confirmar.
    rollo_ids = [item.rollo_id for item in datos.items if item.rollo_id is not None]
    if len(rollo_ids) != len(set(rollo_ids)):
        raise HTTPException(status_code=400, detail="El mismo rollo está más de una vez en el envío.")

    ahora = datetime.now(timezone.utc)
    envio = Envio(
        bodega_destino_id=datos.bodega_destino_id, estado=EstadoEnvio.PENDIENTE_CONFIRMACION,
        enviado_por=usuario.correo, fecha_envio=ahora, observaciones=datos.observaciones,
    )
    db.add(envio)
    db.flush()

    for item in datos.items:
        if item.rollo_id is not None:
            rollo = db.query(Rollo).filter(Rollo.id == item.rollo_id).with_for_update().first()
            if rollo is None or rollo.bodega_id is not None:
                raise HTTPException(status_code=404, detail=f"Rollo {item.rollo_id} no está disponible en Admin Inventario.")
            if rollo.metros_disponibles <= 0:
                raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} está agotado, no se puede enviar.")
            if envio_pendiente_del_rollo(db, rollo.id) is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"El rollo {rollo.identificador_rollo} ya tiene un envío pendiente de confirmar.",
                )
            db.add(EnvioItem(
                envio_id=envio.id, rollo_id=rollo.id,
                descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
            ))
        else:
            producto = (
                db.query(Producto)
                .filter(Producto.codigo == item.producto_codigo, Producto.bodega_id.is_(None))
                .with_for_update()
                .first()
            )
            cantidad = a_decimal(item.cantidad)
            if producto is None or a_decimal(producto.stock) < cantidad:
                raise HTTPException(
                    status_code=400,
                    detail=f"No hay stock suficiente de '{item.producto_codigo}' en Admin Inventario.",
                )
            validar_cantidad_entera_si_aplica(db, producto.familia, item.cantidad)
            producto.stock -= cantidad
            db.add(EnvioItem(
                envio_id=envio.id, producto_codigo=producto.codigo, descripcion=producto.descripcion,
                cantidad=item.cantidad,
            ))

    return envio


def confirmar_envio_recibido(db: Session, envio_id: int, usuario: Usuario) -> Envio:
    envio = _envio_de_mi_bodega(db, envio_id, usuario)
    ahora = datetime.now(timezone.utc)

    for item in envio.items:
        if item.rollo_id is not None:
            rollo = db.query(Rollo).filter(Rollo.id == item.rollo_id).with_for_update().first()
            if rollo is None:
                raise HTTPException(status_code=400, detail="Uno de los rollos del envío ya no existe.")
            # Se revalida al recibir: el rollo tiene que seguir en Admin
            # Inventario y con metros. Antes se movía sin mirar, y una sede
            # podía "recibir" un rollo que ya había salido de la empresa.
            if rollo.bodega_id is not None or rollo.metros_disponibles <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"El rollo {rollo.identificador_rollo} ya no está disponible en Admin Inventario "
                    "(se movió o se agotó mientras venía en camino). Si no llegó, marca el envío como "
                    "'No llegó'; si llegó, pide a Admin Inventario que revise ese rollo.",
                )
            rollo.bodega_id = usuario.bodega_id
            db.add(Movimiento(
                fecha=ahora, tipo=TipoMovimiento.TRANSFERENCIA, motivo="envio_admin_inventario",
                producto_codigo=rollo.codigo_interno,
                producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
                rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo,
                bodega_origen_id=None, bodega_destino_id=usuario.bodega_id,
                cantidad=rollo.metros_disponibles, usuario=usuario.correo,
                observaciones=f"Envío #{envio.id} confirmado recibido.",
            ))
        else:
            cantidad = a_decimal(item.cantidad or 0)
            producto_destino = (
                db.query(Producto)
                .filter(Producto.codigo == item.producto_codigo, Producto.bodega_id == usuario.bodega_id)
                .with_for_update()
                .first()
            )
            if producto_destino:
                producto_destino.stock += cantidad
                producto_destino.entrada += cantidad
            else:
                # Copia la identidad COMPLETA del producto de Admin Inventario
                # (siempre existe: es de donde salió el envío) -- ver
                # productos.nuevo_producto_en_bodega.
                producto_origen = (
                    db.query(Producto)
                    .filter(Producto.codigo == item.producto_codigo, Producto.bodega_id.is_(None))
                    .first()
                )
                if producto_origen is not None:
                    db.add(nuevo_producto_en_bodega(producto_origen, bodega_id=usuario.bodega_id, cantidad=item.cantidad))
                else:
                    db.add(Producto(
                        bodega_id=usuario.bodega_id, codigo=item.producto_codigo, descripcion=item.descripcion,
                        entrada=item.cantidad, stock=item.cantidad,
                    ))
            db.add(Movimiento(
                fecha=ahora, tipo=TipoMovimiento.TRANSFERENCIA, motivo="envio_admin_inventario",
                producto_codigo=item.producto_codigo, producto_descripcion=item.descripcion,
                bodega_origen_id=None, bodega_destino_id=usuario.bodega_id,
                cantidad=item.cantidad, usuario=usuario.correo,
                observaciones=f"Envío #{envio.id} confirmado recibido.",
            ))

    envio.estado = EstadoEnvio.RECIBIDO
    envio.respondido_por = usuario.correo
    envio.fecha_respuesta = ahora
    return envio


def marcar_envio_no_llego(db: Session, envio_id: int, usuario: Usuario) -> Envio:
    envio = _envio_de_mi_bodega(db, envio_id, usuario)

    for item in envio.items:
        if item.producto_codigo is not None:
            cantidad = a_decimal(item.cantidad or 0)
            producto_admin = (
                db.query(Producto)
                .filter(Producto.codigo == item.producto_codigo, Producto.bodega_id.is_(None))
                .with_for_update()
                .first()
            )
            if producto_admin:
                producto_admin.stock += cantidad
            else:
                db.add(Producto(
                    bodega_id=None, codigo=item.producto_codigo, descripcion=item.descripcion,
                    entrada=item.cantidad, stock=item.cantidad,
                ))
        # Los rollos nunca cambiaron de bodega_id — no hay nada que revertir.

    envio.estado = EstadoEnvio.NO_LLEGO
    envio.respondido_por = usuario.correo
    envio.fecha_respuesta = datetime.now(timezone.utc)
    return envio
