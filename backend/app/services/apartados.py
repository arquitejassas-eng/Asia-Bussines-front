"""Reglas transaccionales del módulo Apartados: reserva de material por
cotización de cliente y su flujo hasta producción y entrega.

La reserva de ROLLO se maneja siempre a nivel de CÓDIGO DE CLASIFICACIÓN
(`Rollo.codigo_interno`, el mismo color + calibre por el que ya se agrupan
los rollos en "Rollos almacenados"), nunca de rollo específico ni de
`Rollo.familia` — ese campo es de reclasificación manual y no se llena en
ningún flujo de carga. Los metros "reservados" de un código son la suma de
lo pendiente (`metros_requeridos - metros_consumidos`) de los ítems de
apartados en un estado activo. No se guarda un contador aparte que se pueda
desincronizar — se deriva siempre de los apartados vigentes, y por eso
liberar un apartado (cancelarlo o terminarlo) libera su reserva sin tocar
ningún otro dato.

La reserva de STOCK (`ModalidadApartado.POR_STOCK`) sigue el mismo principio,
pero identifica el producto por `Producto.id` (`ApartadoItem.producto_id`)
en vez de un código agregado — cada producto es independiente (ej. AM-A y
AM-R nunca se mezclan). Un mismo `Apartado` puede mezclar ítems POR_ROLLO y
POR_STOCK: la modalidad vive en cada `ApartadoItem`, nunca en el `Apartado`.
A diferencia de rollo (que se descuenta en `registrar_produccion`, un
endpoint aparte), el stock de un ítem POR_STOCK se descuenta acá mismo, en
`marcar_produccion_terminada` — nunca al crear el apartado, nunca en
`marcar_entregado` (que ya no vuelve a tocarlo).
"""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.apartado import Apartado, ApartadoItem, EstadoApartado, ModalidadApartado
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.schemas.apartados import ApartadoCrear

ESTADOS_RESERVA_ACTIVA = (
    EstadoApartado.APARTADO,
    EstadoApartado.ENVIADO_A_PRODUCCION,
    EstadoApartado.EN_PRODUCCION,
)

# Flag temporal: la entrega física a cliente es responsabilidad del módulo
# de Despachos, que todavía no existe -- mismo flag y motivo que
# src/Paginas/ApartadosPage.tsx::DESPACHOS_INTEGRADO. Cuando Despachos se
# integre, cambiar a True (o eliminar el chequeo de marcar_entregado) en
# ambos lados.
DESPACHOS_INTEGRADO = False


def metros_reservados_codigo(db: Session, *, bodega_id: int, codigo_interno: str) -> float:
    total = (
        db.query(func.coalesce(func.sum(ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos), 0))
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(
            Apartado.bodega_id == bodega_id,
            Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
            ApartadoItem.codigo_interno == codigo_interno,
        )
        .scalar()
    )
    return round(float(total or 0), 2)


def metros_reservados_por_bodega(db: Session, *, bodega_id: int) -> list[dict]:
    """Metros reservados (apartados activos) agrupados por código, para toda la
    bodega — usado para mostrar el descuento junto al stock físico en
    "Rollos almacenados" sin repetir una consulta por código."""
    filas = (
        db.query(
            ApartadoItem.codigo_interno,
            func.coalesce(func.sum(ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos), 0),
        )
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        # Solo reservas de ROLLO: los ítems POR_STOCK no tienen código (NULL)
        # y producían una fila {codigo_interno: None} que hacía fallar la
        # respuesta -- "Rollos almacenados" terminaba mostrando 0 m reservados.
        .filter(
            Apartado.bodega_id == bodega_id,
            Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
            ApartadoItem.modalidad == ModalidadApartado.POR_ROLLO,
        )
        .group_by(ApartadoItem.codigo_interno)
        .all()
    )
    return [{"codigo_interno": codigo, "metros_reservados": round(float(total or 0), 2)} for codigo, total in filas]


def bloquear_rollos_codigo(db: Session, *, bodega_id: int | None, codigo_interno: str) -> list[Rollo]:
    """Bloquea (FOR UPDATE) TODOS los rollos de un código en una bodega,
    siempre en el mismo orden (por id) para que dos operaciones sobre rollos
    distintos del mismo código no se bloqueen entre sí (deadlock). Es el
    candado que serializa todo lo que toca la reserva de ese código:
    apartados, consumos, producción, salidas y transferencias.
    `populate_existing` recarga los valores ya bloqueados aunque el rollo se
    hubiera leído antes en esta misma sesión."""
    return (
        db.query(Rollo)
        .filter(Rollo.bodega_id == bodega_id, Rollo.codigo_interno == codigo_interno)
        .order_by(Rollo.id)
        .with_for_update()
        .populate_existing()
        .all()
    )


def _cotizaciones_que_reservan(db: Session, *, bodega_id: int | None, filtro) -> str:
    cotizaciones = (
        db.query(Apartado.numero_cotizacion)
        .join(ApartadoItem, ApartadoItem.apartado_id == Apartado.id)
        .filter(Apartado.bodega_id == bodega_id, Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), filtro)
        .distinct()
        .limit(6)
        .all()
    )
    nombres = [c for (c,) in cotizaciones]
    if not nombres:
        return ""
    texto = ", ".join(nombres[:5])
    return f" (apartados: {texto}{', ...' if len(nombres) > 5 else ''})"


def validar_reserva_rollos(
    db: Session, *, bodega_id: int | None, codigo_interno: str, metros_salen: float,
    rollos_codigo: list[Rollo], metros_reserva_propia: float = 0.0,
) -> None:
    """Impide que salga material de un código que ya está apartado.

    Lo libre de un código es lo físico (metros de sus rollos en la bodega)
    menos lo reservado por apartados activos. Una operación saca
    `metros_salen`, de los cuales `metros_reserva_propia` salen de SU PROPIA
    reserva (la producción de un apartado consume lo que ese apartado tiene
    reservado): solo el resto tiene que caber en lo libre. Así, después de
    la operación, lo físico nunca queda por debajo de lo reservado.
    `rollos_codigo` deben venir de `bloquear_rollos_codigo` (ya bloqueados)
    para que nadie cambie los números mientras se valida."""
    fisico = round(sum(r.metros_disponibles for r in rollos_codigo), 2)
    reservado = metros_reservados_codigo(db, bodega_id=bodega_id, codigo_interno=codigo_interno)
    libre = round(fisico - reservado, 2)
    neto = round(metros_salen - metros_reserva_propia, 2)
    if neto > libre + 0.005:
        cotizaciones = _cotizaciones_que_reservan(db, bodega_id=bodega_id, filtro=ApartadoItem.codigo_interno == codigo_interno)
        raise HTTPException(
            status_code=400,
            detail=(
                f"No hay suficiente material libre del código {codigo_interno}: hay {fisico} m en la bodega, "
                f"pero {reservado} m están apartados para cotizaciones{cotizaciones}. "
                f"Libres: {max(libre, 0)} m; esta operación necesita {neto} m. "
                "Para usar material apartado, regístralo desde la producción de ese apartado o cancela el apartado."
            ),
        )


def validar_reserva_producto(db: Session, *, producto: Producto, cantidad: float | Decimal) -> None:
    """Igual que `validar_reserva_rollos`, para un producto de stock: lo que
    sale no puede tocar las unidades apartadas (ítems POR_STOCK de apartados
    activos). `producto` debe venir ya bloqueado (FOR UPDATE)."""
    reservado = cantidad_reservada_producto(db, bodega_id=producto.bodega_id, producto_id=producto.id)
    if reservado <= 0:
        return
    stock = round(float(producto.stock), 2)
    libre = round(stock - reservado, 2)
    if float(cantidad) > libre + 0.005:
        cotizaciones = _cotizaciones_que_reservan(db, bodega_id=producto.bodega_id, filtro=ApartadoItem.producto_id == producto.id)
        raise HTTPException(
            status_code=400,
            detail=(
                f"No hay suficiente stock libre de {producto.codigo}: hay {stock}, pero {reservado} están apartados "
                f"para cotizaciones{cotizaciones}. Libres: {max(libre, 0)}; esta operación necesita {float(cantidad):g}."
            ),
        )


def disponibilidad_por_codigo(db: Session, *, bodega_id: int, codigo_interno: str, bloquear: bool = False) -> dict:
    """Agrega los rollos de un código de clasificación (color + calibre); con
    `bloquear=True` los bloquea (FOR UPDATE) para serializar apartados
    concurrentes sobre el mismo código."""
    if bloquear:
        rollos = bloquear_rollos_codigo(db, bodega_id=bodega_id, codigo_interno=codigo_interno)
    else:
        rollos = db.query(Rollo).filter(Rollo.bodega_id == bodega_id, Rollo.codigo_interno == codigo_interno).all()

    metros_disponibles_rollos = round(sum(r.metros_disponibles for r in rollos), 2)
    metros_consumidos = round(sum(r.metros_consumidos for r in rollos), 2)
    reservados = metros_reservados_codigo(db, bodega_id=bodega_id, codigo_interno=codigo_interno)
    primero = rollos[0] if rollos else None

    return {
        "codigo_interno": codigo_interno,
        "familia": primero.familia if primero else "",
        "color_material": primero.color_material if primero else "",
        "calibre": primero.calibre if primero else 0,
        "cantidad_rollos": len(rollos),
        "metros_disponibles": round(metros_disponibles_rollos - reservados, 2),
        "metros_reservados": reservados,
        "metros_consumidos": metros_consumidos,
    }


def cantidad_reservada_producto(db: Session, *, bodega_id: int, producto_id: int) -> float:
    """Análogo a `metros_reservados_codigo`, pero para un `Producto` de stock:
    suma `cantidad` de los ítems POR_STOCK de ese producto en apartados
    activos. Igual que rollo, nunca un contador aparte — siempre en vivo."""
    total = (
        db.query(func.coalesce(func.sum(ApartadoItem.cantidad), 0))
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(
            Apartado.bodega_id == bodega_id,
            Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
            ApartadoItem.modalidad == ModalidadApartado.POR_STOCK,
            ApartadoItem.producto_id == producto_id,
        )
        .scalar()
    )
    return round(float(total or 0), 2)


def disponibilidad_producto(db: Session, *, bodega_id: int, producto_id: int, bloquear: bool = False) -> dict:
    """Stock físico de un `Producto`, lo reservado por apartados activos, y lo
    disponible para apartar — mismo principio que `disponibilidad_por_codigo`,
    identificando por `Producto.id` en vez de un código agregado."""
    consulta = db.query(Producto).filter(Producto.id == producto_id, Producto.bodega_id == bodega_id)
    if bloquear:
        consulta = consulta.with_for_update()
    producto = consulta.first()
    if producto is None:
        raise HTTPException(status_code=404, detail=f"Producto {producto_id} no encontrado.")

    reservado = cantidad_reservada_producto(db, bodega_id=bodega_id, producto_id=producto_id)
    return {
        "producto_id": producto_id,
        "codigo": producto.codigo,
        "descripcion": producto.descripcion,
        "stock": float(producto.stock),
        "cantidad_reservada": reservado,
        "cantidad_disponible": round(float(producto.stock) - reservado, 2),
    }


def apartado_de_mi_bodega(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    apartado = db.get(Apartado, apartado_id)
    if apartado is None or apartado.bodega_id != usuario.bodega_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Apartado no encontrado.")
    return apartado


def crear_apartado(db: Session, datos: ApartadoCrear, usuario: Usuario) -> Apartado:
    if not datos.items:
        raise HTTPException(status_code=400, detail="El apartado debe tener al menos un producto solicitado.")

    ya_existe = (
        db.query(Apartado.id)
        .filter(Apartado.bodega_id == usuario.bodega_id, Apartado.numero_cotizacion == datos.numero_cotizacion)
        .first()
    )
    if ya_existe:
        raise HTTPException(status_code=400, detail=f"Ya existe un apartado con la cotización {datos.numero_cotizacion}.")

    # Sin restricción de modalidad uniforme -- un mismo apartado puede
    # mezclar ítems POR_ROLLO y POR_STOCK libremente. Cada rama valida
    # únicamente su propio subconjunto de ítems, sin interferirse.
    items_rollo = [item for item in datos.items if item.modalidad == ModalidadApartado.POR_ROLLO]
    items_stock = [item for item in datos.items if item.modalidad == ModalidadApartado.POR_STOCK]

    # POR_ROLLO: exactamente la validación que ya existía (sin ningún cambio
    # de comportamiento) -- solo que ahora agrupa `items_rollo` en vez de
    # `datos.items` completo, para no mezclar con las cantidades de stock.
    solicitado_por_codigo: dict[str, float] = {}
    for item in items_rollo:
        metros = round(item.cantidad * item.medida, 2)
        solicitado_por_codigo[item.codigo_interno] = solicitado_por_codigo.get(item.codigo_interno, 0) + metros

    for codigo_interno, metros_solicitados in solicitado_por_codigo.items():
        resumen = disponibilidad_por_codigo(db, bodega_id=usuario.bodega_id, codigo_interno=codigo_interno, bloquear=True)
        if metros_solicitados > resumen["metros_disponibles"]:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"El código '{codigo_interno}' no tiene material suficiente: "
                    f"disponibles {resumen['metros_disponibles']} m, solicitados {metros_solicitados} m."
                ),
            )

    # POR_STOCK: mismo principio, pero por producto_id -- nunca descuenta
    # Producto.stock aquí, solo valida que la reserva quepa en lo disponible.
    solicitado_por_producto: dict[int, float] = {}
    for item in items_stock:
        solicitado_por_producto[item.producto_id] = solicitado_por_producto.get(item.producto_id, 0) + item.cantidad

    for producto_id, cantidad_solicitada in solicitado_por_producto.items():
        resumen = disponibilidad_producto(db, bodega_id=usuario.bodega_id, producto_id=producto_id, bloquear=True)
        if cantidad_solicitada > resumen["cantidad_disponible"]:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"El producto '{resumen['codigo']}' no tiene stock suficiente: "
                    f"disponibles {resumen['cantidad_disponible']}, solicitados {cantidad_solicitada}."
                ),
            )

    ahora = datetime.now(timezone.utc)
    apartado = Apartado(
        bodega_id=usuario.bodega_id,
        numero_cotizacion=datos.numero_cotizacion,
        cliente=datos.cliente,
        creado_por=usuario.correo,
        fecha_creacion=ahora,
        estado=EstadoApartado.APARTADO,
        observaciones=datos.observaciones,
    )
    db.add(apartado)
    db.flush()

    for item in datos.items:
        if item.modalidad == ModalidadApartado.POR_STOCK:
            db.add(ApartadoItem(
                apartado_id=apartado.id, modalidad=ModalidadApartado.POR_STOCK,
                producto_id=item.producto_id, descripcion=item.descripcion, cantidad=item.cantidad,
            ))
        else:
            db.add(ApartadoItem(
                apartado_id=apartado.id, modalidad=ModalidadApartado.POR_ROLLO,
                codigo_interno=item.codigo_interno, descripcion=item.descripcion,
                cantidad=item.cantidad, medida=item.medida, metros_requeridos=round(item.cantidad * item.medida, 2),
            ))

    return apartado


def cancelar_apartado(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    apartado = apartado_de_mi_bodega(db, apartado_id, usuario)
    if apartado.estado != EstadoApartado.APARTADO:
        raise HTTPException(status_code=400, detail="Solo se puede cancelar un apartado que aún no fue enviado a producción.")
    apartado.estado = EstadoApartado.CANCELADO
    apartado.cancelado_por = usuario.correo
    apartado.fecha_cancelado = datetime.now(timezone.utc)
    return apartado


def enviar_a_produccion(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    apartado = apartado_de_mi_bodega(db, apartado_id, usuario)
    if apartado.estado != EstadoApartado.APARTADO:
        raise HTTPException(status_code=400, detail="Este apartado ya fue enviado a producción o no está activo.")
    apartado.estado = EstadoApartado.ENVIADO_A_PRODUCCION
    apartado.enviado_a_produccion_por = usuario.correo
    apartado.fecha_enviado_a_produccion = datetime.now(timezone.utc)
    return apartado


def marcar_produccion_terminada(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    apartado = (
        db.query(Apartado)
        .filter(Apartado.id == apartado_id, Apartado.bodega_id == usuario.bodega_id)
        .with_for_update()
        .first()
    )
    if apartado is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Apartado no encontrado.")
    if apartado.estado not in (EstadoApartado.ENVIADO_A_PRODUCCION, EstadoApartado.EN_PRODUCCION):
        raise HTTPException(status_code=400, detail="Este apartado no está en producción.")

    items_rollo = [item for item in apartado.items if item.modalidad == ModalidadApartado.POR_ROLLO]
    items_stock = [item for item in apartado.items if item.modalidad == ModalidadApartado.POR_STOCK and not item.stock_descontado]

    # POR_ROLLO: EXACTAMENTE la misma validación que ya existía (si nunca se
    # registró producción para ningún ítem de rollo, se rechaza) -- solo que
    # ahora se aplica al subconjunto `items_rollo` en vez de a todo
    # `apartado.items`, para no interferir con los ítems de stock del mismo
    # apartado. Para un apartado 100% rollo, items_rollo == apartado.items:
    # comportamiento idéntico al actual. Nunca llama registrar_produccion():
    # ese registro ya ocurrió antes, en un POST /produccion aparte, en su
    # propia transacción ya confirmada -- aquí solo se lee esa relación.
    if items_rollo and not any(item.producciones for item in items_rollo):
        raise HTTPException(
            status_code=400,
            detail="Todavía no se ha registrado ninguna producción para este apartado. "
            "Usa \"Iniciar producción\" y registra los metros consumidos y el responsable antes de marcarla como terminada.",
        )

    # POR_STOCK -- FASE 1: validar TODOS los productos (agrupados por
    # producto_id, por si el mismo producto aparece en más de un ítem) antes
    # de descontar nada, para que un fallo en cualquiera de ellos no deje
    # descuentos parciales de los demás.
    cantidad_por_producto: dict[int, float] = {}
    for item in items_stock:
        cantidad_por_producto[item.producto_id] = cantidad_por_producto.get(item.producto_id, 0) + item.cantidad

    productos_bloqueados: dict[int, Producto] = {}
    for producto_id, cantidad_total in cantidad_por_producto.items():
        producto = (
            db.query(Producto)
            .filter(Producto.id == producto_id, Producto.bodega_id == apartado.bodega_id)
            .with_for_update()
            .first()
        )
        if producto is None:
            raise HTTPException(status_code=404, detail=f"Producto {producto_id} no encontrado.")
        if cantidad_total > producto.stock:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente de '{producto.codigo}' para completar este apartado.",
            )
        productos_bloqueados[producto_id] = producto

    # FASE 2: todas las validaciones ya pasaron -- ahora sí, descontar y
    # registrar Kardex. Nunca toca Rollo, nunca llama registrar_produccion().
    ahora = datetime.now(timezone.utc)
    for item in items_stock:
        producto = productos_bloqueados[item.producto_id]
        # Producto.stock es Numeric (Decimal en tiempo de ejecucion) mientras
        # que ApartadoItem.cantidad es Float -- no se pueden restar
        # directamente (TypeError). Mismo patron de conversion que ya usa
        # movimientos.py._decimal() para esta misma combinacion de tipos.
        producto.stock -= Decimal(str(item.cantidad))
        item.stock_descontado = True
        db.add(Movimiento(
            fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo="apartado_stock",
            producto_codigo=producto.codigo, producto_descripcion=producto.descripcion,
            bodega_origen_id=apartado.bodega_id, bodega_destino_id=None,
            cantidad=item.cantidad, usuario=usuario.correo,
            observaciones=f"Apartado {apartado.numero_cotizacion}.", cotizacion=apartado.numero_cotizacion,
        ))

    # Al pasar el estado, los metros/cantidades reservados no consumidos de
    # este apartado dejan de contar en `metros_reservados_codigo`/
    # `cantidad_reservada_producto` y vuelven a disponibles automáticamente.
    apartado.estado = EstadoApartado.PRODUCCION_TERMINADA
    return apartado


def confirmar_separacion_stock(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    """Confirma que el stock (ítems POR_STOCK) de esta cotización ya fue
    separado físicamente -- requisito para poder registrar la producción de
    sus ítems POR_ROLLO (ver `registrar_produccion._apartado_item_para_produccion`).
    Se guarda a nivel de Apartado, no por ítem: los ítems se crean todos
    juntos al crear el apartado y la confirmación es una sola acción."""
    apartado = apartado_de_mi_bodega(db, apartado_id, usuario)
    if not any(item.modalidad == ModalidadApartado.POR_STOCK for item in apartado.items):
        raise HTTPException(status_code=400, detail="Este apartado no tiene ítems de stock por separar.")
    apartado.stock_separado_confirmado = True
    apartado.stock_separado_por = usuario.correo
    apartado.stock_separado_en = datetime.now(timezone.utc)
    return apartado


def marcar_entregado(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    if not DESPACHOS_INTEGRADO:
        raise HTTPException(
            status_code=403,
            detail="La entrega de material aún no está habilitada -- pendiente de integrar el módulo de Despachos.",
        )
    apartado = apartado_de_mi_bodega(db, apartado_id, usuario)
    if apartado.estado != EstadoApartado.PRODUCCION_TERMINADA:
        raise HTTPException(status_code=400, detail="Este apartado todavía no tiene la producción terminada.")
    apartado.estado = EstadoApartado.ENTREGADO
    apartado.fecha_entregado = datetime.now(timezone.utc)
    return apartado
