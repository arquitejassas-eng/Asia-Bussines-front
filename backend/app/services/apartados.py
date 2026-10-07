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

import re
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.apartado import Apartado, ApartadoItem, EstadoApartado, ModalidadApartado
from app.models.bodega import Bodega
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario, Usuario
from app.services.material_en_camino import metros_en_camino_codigo, metros_por_repartir_codigo
from app.schemas.apartados import SepararApartadoRequest, ApartadoCrear, ApartadoEditar

ESTADOS_RESERVA_ACTIVA = (
    EstadoApartado.APARTADO,
    EstadoApartado.ENVIADO_A_PRODUCCION,
    EstadoApartado.EN_PRODUCCION,
)


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


def _items_activos_en_orden(db: Session, *, bodega_id: int | None, filtro) -> list[ApartadoItem]:
    return (
        db.query(ApartadoItem)
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(Apartado.bodega_id == bodega_id, Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), filtro)
        .order_by(Apartado.fecha_creacion, Apartado.id, ApartadoItem.id)
        .all()
    )


def _repartir_en_orden(items: list[ApartadoItem], pendiente, fisico: float) -> dict[int, float]:
    """Reparte lo físico entre las reservas por orden de creación: la
    cotización más antigua se cubre primero. Con material "en camino" lo
    reservado puede superar lo físico, y lo que falta le toca siempre a las
    más nuevas -- nunca bloquea a una anterior que sí tenía su material."""
    restante = max(float(fisico), 0.0)
    cubierto: dict[int, float] = {}
    for item in items:
        necesita = max(float(pendiente(item)), 0.0)
        cubierto[item.id] = round(min(necesita, restante), 2)
        restante -= cubierto[item.id]
    return cubierto


def cobertura_rollo(db: Session, *, bodega_id: int | None, codigo_interno: str, fisico: float | None = None) -> dict[int, float]:
    """Metros realmente cubiertos de cada ítem POR_ROLLO activo del código."""
    if fisico is None:
        rollos = db.query(Rollo).filter(Rollo.bodega_id == bodega_id, Rollo.codigo_interno == codigo_interno)
        fisico = sum(r.metros_disponibles for r in rollos)
    items = _items_activos_en_orden(db, bodega_id=bodega_id, filtro=ApartadoItem.codigo_interno == codigo_interno)
    return _repartir_en_orden(items, lambda it: (it.metros_requeridos or 0) - (it.metros_consumidos or 0), fisico)


def cobertura_producto(db: Session, *, producto: Producto) -> dict[int, float]:
    """Unidades realmente cubiertas de cada ítem POR_STOCK activo del producto."""
    items = _items_activos_en_orden(db, bodega_id=producto.bodega_id, filtro=ApartadoItem.producto_id == producto.id)
    return _repartir_en_orden(items, lambda it: 0 if it.stock_descontado else it.cantidad, float(producto.stock))


def faltantes_apartado(db: Session, apartado: Apartado) -> list[str]:
    """Lo que todavía no está físicamente en la bodega para este apartado
    (material comprado que viene en camino). Vacío = todo su material ya está."""
    if apartado.estado not in ESTADOS_RESERVA_ACTIVA:
        return []
    faltantes: list[str] = []
    coberturas: dict[str, dict[int, float]] = {}
    for item in apartado.items:
        if item.modalidad == ModalidadApartado.POR_STOCK:
            producto = db.get(Producto, item.producto_id)
            if producto is None or item.stock_descontado:
                continue
            falta = round(item.cantidad - cobertura_producto(db, producto=producto).get(item.id, 0), 2)
            if falta > 0.005:
                faltantes.append(f"faltan {falta:g} de {producto.codigo}")
        else:
            if item.codigo_interno not in coberturas:
                coberturas[item.codigo_interno] = cobertura_rollo(db, bodega_id=apartado.bodega_id, codigo_interno=item.codigo_interno)
            pendiente = (item.metros_requeridos or 0) - (item.metros_consumidos or 0)
            falta = round(pendiente - coberturas[item.codigo_interno].get(item.id, 0), 2)
            if falta > 0.005:
                faltantes.append(f"faltan {falta:g} m de {item.codigo_interno}")
    return faltantes


def validar_reserva_rollos(
    db: Session, *, bodega_id: int | None, codigo_interno: str, metros_salen: float,
    rollos_codigo: list[Rollo], metros_reserva_propia: float = 0.0, apartado_item_id: int | None = None,
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
    # Con material "en camino" lo reservado puede superar lo físico: lo libre
    # nunca baja de 0 y la reserva propia solo cuenta lo que de verdad está
    # cubierto (por orden de creación), así una cotización anterior produce
    # aunque una más nueva esté esperando material.
    libre = round(max(fisico - reservado, 0), 2)
    if apartado_item_id is not None:
        cubierto = cobertura_rollo(db, bodega_id=bodega_id, codigo_interno=codigo_interno, fisico=fisico).get(apartado_item_id, 0)
        metros_reserva_propia = min(metros_reserva_propia, cubierto)
    neto = round(metros_salen - metros_reserva_propia, 2)
    if neto > libre + 0.005:
        cotizaciones = _cotizaciones_que_reservan(db, bodega_id=bodega_id, filtro=ApartadoItem.codigo_interno == codigo_interno)
        raise HTTPException(
            status_code=400,
            detail=(
                f"No hay suficiente material libre del código {codigo_interno}: hay {fisico} m en la bodega, "
                f"pero {reservado} m están apartados para cotizaciones{cotizaciones}. "
                f"Libres: {libre} m; esta operación necesita {neto} m. "
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


def metros_esperando_codigo(db: Session, *, codigo_interno: str) -> float:
    """Lo que las bodegas ya apartaron de este código sin tenerlo en su
    bodega (sus faltantes): eso ya está comprometido de la bolsa "en camino /
    por repartir" de la empresa, sea cual sea la bodega que lo apartó."""
    reservado = dict(
        db.query(Apartado.bodega_id, func.sum(ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos))
        .join(ApartadoItem, ApartadoItem.apartado_id == Apartado.id)
        .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), ApartadoItem.codigo_interno == codigo_interno)
        .group_by(Apartado.bodega_id)
        .all()
    )
    if not reservado:
        return 0.0
    fisico = dict(
        db.query(Rollo.bodega_id, func.sum(Rollo.metros_disponibles))
        .filter(Rollo.codigo_interno == codigo_interno, Rollo.bodega_id.in_(list(reservado)))
        .group_by(Rollo.bodega_id)
        .all()
    )
    return round(sum(max(float(r or 0) - float(fisico.get(b) or 0), 0) for b, r in reservado.items()), 2)


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
    # Bolsa de la empresa (no de una bodega): lo que viene en camino más lo
    # que Admin Inventario recibió y no ha repartido, menos lo que las
    # bodegas ya están esperando de ahí.
    en_camino = metros_en_camino_codigo(db, codigo_interno=codigo_interno)
    por_repartir = metros_por_repartir_codigo(db, codigo_interno=codigo_interno)
    esperando = metros_esperando_codigo(db, codigo_interno=codigo_interno)
    bolsa_libre = round(max(en_camino + por_repartir - esperando, 0), 2)
    libre_en_bodega = round(metros_disponibles_rollos - reservados, 2)
    primero = rollos[0] if rollos else None

    return {
        "codigo_interno": codigo_interno,
        "familia": primero.familia if primero else "",
        "color_material": primero.color_material if primero else "",
        "calibre": primero.calibre if primero else 0,
        "cantidad_rollos": len(rollos),
        "metros_disponibles": libre_en_bodega,
        "metros_reservados": reservados,
        # Ver material_en_camino: checklist que no ha llegado y lo recibido
        # por Admin Inventario sin repartir; "esperando" es lo ya apartado de ahí.
        "metros_en_camino": en_camino,
        "metros_por_repartir": por_repartir,
        "metros_esperando": esperando,
        "metros_para_apartar": round(max(libre_en_bodega, 0) + bolsa_libre, 2),
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
            ApartadoItem.stock_descontado.is_(False),
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


def bodega_de_consulta(db: Session, usuario: Usuario, bodega_id: int | None) -> int:
    """Bodega sobre la que se consulta o se aparta material. Admin Inventario
    crea los apartados de todas las bodegas, así que elige cuál (bodega_id);
    los demás roles siempre trabajan sobre la suya, aunque manden otra."""
    if usuario.rol != RolUsuario.ADMIN_INVENTARIO:
        return usuario.bodega_id
    if bodega_id is None or db.get(Bodega, bodega_id) is None:
        raise HTTPException(status_code=400, detail="Elige la bodega de donde sale el material.")
    return bodega_id


def apartado_de_mi_bodega(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    """Admin Inventario puede abrir apartados de cualquier bodega (los crea y
    es quien los cancela); los demás roles, solo los de su bodega."""
    apartado = db.get(Apartado, apartado_id)
    if apartado is None or (usuario.rol != RolUsuario.ADMIN_INVENTARIO and apartado.bodega_id != usuario.bodega_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Apartado no encontrado.")
    return apartado


def _validar_que_quepa(
    db: Session, *, bodega_id: int, solicitado_por_codigo: dict[str, float],
    solicitado_por_producto: dict[int, float], material_en_camino: bool,
) -> None:
    """Lo que se va a apartar (o lo que se aumenta al editar) tiene que caber
    en lo libre de la bodega; con `material_en_camino`, también en lo que
    viene en camino o está por repartir. Misma regla al crear y al editar."""
    for codigo_interno, metros_solicitados in solicitado_por_codigo.items():
        resumen = disponibilidad_por_codigo(db, bodega_id=bodega_id, codigo_interno=codigo_interno, bloquear=True)
        if metros_solicitados <= resumen["metros_disponibles"]:
            continue
        en_bodega = max(resumen["metros_disponibles"], 0)
        de_la_bolsa = round(resumen["metros_para_apartar"] - en_bodega, 2)
        if metros_solicitados > resumen["metros_para_apartar"]:
            # Ni con lo que viene en camino alcanza: solo se aparta material
            # que existe o que está en un checklist ya cargado.
            puede = resumen["metros_para_apartar"]
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Del código '{codigo_interno}' solo puedes apartar {puede} m: {en_bodega} m libres en esta bodega "
                    f"+ {de_la_bolsa} m libres de lo que viene en camino o está por repartir en Admin Inventario. "
                    f"Pediste {metros_solicitados} m: faltan {round(metros_solicitados - puede, 2)} m que no están "
                    "ni en la bodega ni en camino. Si viene otro pedido, sube su checklist en Recepción."
                ),
            )
        if not material_en_camino:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"El código '{codigo_interno}' no tiene material suficiente en esta bodega: "
                    f"libres {en_bodega} m, solicitados {metros_solicitados} m ({de_la_bolsa} m libres en camino o por repartir). "
                    "Para apartar lo que viene en camino, marca 'El material viene en camino'."
                ),
            )

    for producto_id, cantidad_solicitada in solicitado_por_producto.items():
        resumen = disponibilidad_producto(db, bodega_id=bodega_id, producto_id=producto_id, bloquear=True)
        if cantidad_solicitada > resumen["cantidad_disponible"] and not material_en_camino:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"El producto '{resumen['codigo']}' no tiene stock suficiente: "
                    f"disponibles {max(resumen['cantidad_disponible'], 0)}, solicitados {cantidad_solicitada}. "
                    "Si ese material ya viene en camino, marca 'El material viene en camino'."
                ),
            )


def crear_apartado(db: Session, datos: ApartadoCrear, usuario: Usuario) -> Apartado:
    if not datos.items:
        raise HTTPException(status_code=400, detail="El apartado debe tener al menos un producto solicitado.")
    bodega_id = bodega_de_consulta(db, usuario, datos.bodega_id)

    ya_existe = (
        db.query(Apartado.id)
        .filter(Apartado.bodega_id == bodega_id, Apartado.numero_cotizacion == datos.numero_cotizacion,
                Apartado.estado != EstadoApartado.CANCELADO)
        .first()
    )
    if ya_existe:
        raise HTTPException(status_code=400, detail=f"Ya existe un apartado con la cotización {datos.numero_cotizacion} en esa bodega.")

    solicitado_por_codigo: dict[str, float] = {}
    solicitado_por_producto: dict[int, float] = {}
    for item in datos.items:
        if item.modalidad == ModalidadApartado.POR_STOCK:
            solicitado_por_producto[item.producto_id] = solicitado_por_producto.get(item.producto_id, 0) + item.cantidad
        else:
            metros = round(item.cantidad * item.medida, 2)
            solicitado_por_codigo[item.codigo_interno] = solicitado_por_codigo.get(item.codigo_interno, 0) + metros
    _validar_que_quepa(db, bodega_id=bodega_id, solicitado_por_codigo=solicitado_por_codigo,
                       solicitado_por_producto=solicitado_por_producto, material_en_camino=datos.material_en_camino)

    ahora = datetime.now(timezone.utc)
    apartado = Apartado(
        bodega_id=bodega_id,
        numero_cotizacion=datos.numero_cotizacion,
        empresa=datos.empresa,
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


def _tiene_salida(item: ApartadoItem) -> bool:
    return (item.metros_consumidos or 0) > 0.005 or bool(item.producciones) or bool(item.stock_descontado)


def editar_apartado(db: Session, apartado_id: int, datos: ApartadoEditar, usuario: Usuario) -> Apartado:
    """Admin Inventario corrige una cotización activa. Lo que ya tuvo salida
    (metros consumidos, producción registrada o stock descontado) no se puede
    quitar ni bajar de lo que ya salió; la bodega solo cambia si no ha salido
    nada. Lo que se AUMENTA se valida igual que al crear (_validar_que_quepa)."""
    apartado_de_mi_bodega(db, apartado_id, usuario)
    apartado = db.query(Apartado).filter(Apartado.id == apartado_id).with_for_update().populate_existing().one()
    if apartado.estado not in ESTADOS_RESERVA_ACTIVA:
        raise HTTPException(status_code=400, detail="Solo se pueden editar cotizaciones activas (no terminadas, entregadas ni canceladas).")
    if not datos.items:
        raise HTTPException(status_code=400, detail="El apartado debe tener al menos un producto solicitado.")
    bodega_id = bodega_de_consulta(db, usuario, datos.bodega_id)
    actuales = {item.id: item for item in apartado.items}
    con_salida = [item for item in apartado.items if _tiene_salida(item)]
    if bodega_id != apartado.bodega_id and con_salida:
        raise HTTPException(status_code=400, detail="No se puede cambiar la bodega: esta cotización ya tiene salidas registradas.")

    repetida = (
        db.query(Apartado.id)
        .filter(Apartado.bodega_id == bodega_id, Apartado.numero_cotizacion == datos.numero_cotizacion,
                Apartado.estado != EstadoApartado.CANCELADO, Apartado.id != apartado.id)
        .first()
    )
    if repetida:
        raise HTTPException(status_code=400, detail=f"Ya existe un apartado con la cotización {datos.numero_cotizacion} en esa bodega.")

    ids_nuevos = {item.id for item in datos.items if item.id}
    if any(i not in actuales for i in ids_nuevos):
        raise HTTPException(status_code=400, detail="Alguna línea no pertenece a esta cotización. Recarga e intenta de nuevo.")
    for item in con_salida:
        if item.id not in ids_nuevos:
            raise HTTPException(status_code=400, detail=f"No puedes quitar la línea '{item.descripcion or item.codigo_interno}': ya tiene salida registrada.")
    for linea in datos.items:
        if not linea.id:
            continue
        item = actuales[linea.id]
        if linea.modalidad != item.modalidad:
            raise HTTPException(status_code=400, detail="No se puede cambiar el tipo de una línea existente: quítala y agrega una nueva.")
        if not _tiene_salida(item):
            continue
        if item.modalidad == ModalidadApartado.POR_STOCK:
            if linea.producto_id != item.producto_id or abs(linea.cantidad - item.cantidad) > 0.005:
                raise HTTPException(status_code=400, detail=f"La línea '{item.descripcion}' ya se descontó del stock: no se puede cambiar.")
        else:
            if linea.codigo_interno != item.codigo_interno:
                raise HTTPException(status_code=400, detail=f"La línea de {item.codigo_interno} ya tiene salida: no se puede cambiar el código.")
            nuevos = round(linea.cantidad * linea.medida, 2)
            if nuevos + 0.005 < (item.metros_consumidos or 0):
                raise HTTPException(
                    status_code=400,
                    detail=f"La línea de {item.codigo_interno} ya tiene {item.metros_consumidos:g} m de salida: no puede quedar en {nuevos:g} m.",
                )

    # Solo se valida lo que AUMENTA (lo que ya estaba apartado ya era suyo);
    # si cambia de bodega, todo es nuevo en la otra bodega.
    misma_bodega = bodega_id == apartado.bodega_id
    antes_codigo: dict[str, float] = {}
    antes_producto: dict[int, float] = {}
    if misma_bodega:
        for item in apartado.items:
            if item.modalidad == ModalidadApartado.POR_STOCK:
                if not item.stock_descontado:
                    antes_producto[item.producto_id] = antes_producto.get(item.producto_id, 0) + item.cantidad
            else:
                antes_codigo[item.codigo_interno] = antes_codigo.get(item.codigo_interno, 0) + (item.metros_requeridos or 0)
    despues_codigo: dict[str, float] = {}
    despues_producto: dict[int, float] = {}
    for linea in datos.items:
        if linea.modalidad == ModalidadApartado.POR_STOCK:
            if linea.id and actuales[linea.id].stock_descontado:
                continue
            despues_producto[linea.producto_id] = despues_producto.get(linea.producto_id, 0) + linea.cantidad
        else:
            despues_codigo[linea.codigo_interno] = despues_codigo.get(linea.codigo_interno, 0) + round(linea.cantidad * linea.medida, 2)
    aumento_codigo = {c: round(m - antes_codigo.get(c, 0), 2) for c, m in despues_codigo.items() if m - antes_codigo.get(c, 0) > 0.005}
    aumento_producto = {p: round(q - antes_producto.get(p, 0), 2) for p, q in despues_producto.items() if q - antes_producto.get(p, 0) > 0.005}
    _validar_que_quepa(db, bodega_id=bodega_id, solicitado_por_codigo=aumento_codigo,
                       solicitado_por_producto=aumento_producto, material_en_camino=datos.material_en_camino)

    apartado.bodega_id = bodega_id
    apartado.numero_cotizacion = datos.numero_cotizacion
    apartado.empresa = datos.empresa
    apartado.cliente = datos.cliente
    apartado.observaciones = datos.observaciones
    for item in list(apartado.items):
        if item.id not in ids_nuevos:
            apartado.items.remove(item)
            db.delete(item)
    for linea in datos.items:
        if linea.id:
            item = actuales[linea.id]
            item.descripcion = linea.descripcion
            if item.modalidad == ModalidadApartado.POR_STOCK:
                item.producto_id, item.cantidad = linea.producto_id, linea.cantidad
            else:
                item.codigo_interno, item.cantidad, item.medida = linea.codigo_interno, linea.cantidad, linea.medida
                item.metros_requeridos = round(linea.cantidad * linea.medida, 2)
        elif linea.modalidad == ModalidadApartado.POR_STOCK:
            apartado.items.append(ApartadoItem(
                modalidad=ModalidadApartado.POR_STOCK, producto_id=linea.producto_id,
                descripcion=linea.descripcion, cantidad=linea.cantidad,
            ))
        else:
            apartado.items.append(ApartadoItem(
                modalidad=ModalidadApartado.POR_ROLLO, codigo_interno=linea.codigo_interno, descripcion=linea.descripcion,
                cantidad=linea.cantidad, medida=linea.medida, metros_requeridos=round(linea.cantidad * linea.medida, 2),
            ))
    db.flush()
    return apartado


ESTADOS_CANCELABLES = (EstadoApartado.APARTADO, EstadoApartado.ENVIADO_A_PRODUCCION, EstadoApartado.EN_PRODUCCION)


def _linea_completa(item: ApartadoItem) -> bool:
    if item.modalidad == ModalidadApartado.POR_STOCK:
        return bool(item.stock_descontado)
    return (item.metros_requeridos or 0) - (item.metros_consumidos or 0) <= 0.005


ESTADOS_SEPARABLES = (*ESTADOS_RESERVA_ACTIVA, EstadoApartado.PRODUCCION_TERMINADA)
TOLERANCIA_CANTIDAD = 0.0001
CANTIDAD_AL_INICIO = re.compile(r"^\s*(\d+(?:[.,]\d+)?)(?=\s)")


def _cantidad_en_descripcion(descripcion: str, cantidad_actual: float, cantidad_nueva: float) -> str:
    """ "18 TEJA ARQUI..." -> "9 TEJA ARQUI..." si el número del inicio es la cantidad de la línea."""
    encontrado = CANTIDAD_AL_INICIO.match(descripcion or "")
    if not encontrado or abs(float(encontrado.group(1).replace(",", ".")) - cantidad_actual) > TOLERANCIA_CANTIDAD:
        return descripcion
    return f"{cantidad_nueva:g}".replace(".", ",") + descripcion[encontrado.end(1):]


def _partir_linea(item: ApartadoItem, cantidad: float, nueva_id: int) -> ApartadoItem:
    """Saca `cantidad` de la línea hacia una línea nueva de la otra cotización,
    repartiendo en proporción los metros pedidos y los ya producidos."""
    proporcion = cantidad / item.cantidad
    copia = ApartadoItem(
        apartado_id=nueva_id, modalidad=item.modalidad, codigo_interno=item.codigo_interno,
        descripcion=_cantidad_en_descripcion(item.descripcion, item.cantidad, cantidad),
        cantidad=cantidad, medida=item.medida, producto_id=item.producto_id, stock_descontado=item.stock_descontado,
    )
    if item.metros_requeridos is not None:
        copia.metros_requeridos = round(item.metros_requeridos * proporcion, 2)
        item.metros_requeridos = round(item.metros_requeridos - copia.metros_requeridos, 2)
    copia.metros_consumidos = round((item.metros_consumidos or 0) * proporcion, 2)
    item.metros_consumidos = round((item.metros_consumidos or 0) - copia.metros_consumidos, 2)
    item.descripcion = _cantidad_en_descripcion(item.descripcion, item.cantidad, item.cantidad - cantidad)
    item.cantidad = round(item.cantidad - cantidad, 4)
    return copia


def separar_apartado(db: Session, apartado_id: int, datos: SepararApartadoRequest, usuario: Usuario) -> Apartado:
    """Lo que el cliente no se lleva ahora pasa a una cotización NUEVA con el
    número que se indique, en la misma bodega y empresa. Se puede pasar una
    línea completa o solo parte (ej. 9 de las 18 tejas); el material o lo ya
    producido se reparte en proporción, así que nada se pierde ni se reserva
    de más.

    - Cotización abierta (sin terminar): solo Admin Inventario, y solo
      líneas sin salida ni producción. La nueva queda "Apartado".
    - Producción terminada (ej. el carro solo se lleva una parte): Admin
      Inventario o la encargada de la bodega; cualquier línea. La nueva queda
      "Producción terminada", lista para darle Salida en otro viaje.

    La nueva conserva la fecha de la original (mismo turno para cubrir
    material esperado)."""
    apartado_de_mi_bodega(db, apartado_id, usuario)
    original = db.query(Apartado).filter(Apartado.id == apartado_id).with_for_update().populate_existing().one()
    if original.estado not in ESTADOS_SEPARABLES:
        raise HTTPException(status_code=400, detail="Esta cotización ya fue entregada o cancelada: no se puede separar.")
    producida = original.estado == EstadoApartado.PRODUCCION_TERMINADA
    if usuario.rol != RolUsuario.ADMIN_INVENTARIO and not producida:
        raise HTTPException(status_code=403, detail="Solo Admin Inventario puede separar una cotización que no ha terminado su producción.")

    por_id = {item.id: item for item in original.items}
    pedido: dict[int, float] = {}
    for linea in datos.lineas:
        if linea.item_id not in por_id:
            raise HTTPException(status_code=400, detail="Alguna de esas líneas no pertenece a esta cotización.")
        pedido[linea.item_id] = pedido.get(linea.item_id, 0) + linea.cantidad
    for item_id, cantidad in pedido.items():
        item = por_id[item_id]
        if cantidad > item.cantidad + TOLERANCIA_CANTIDAD:
            raise HTTPException(status_code=400, detail=f"De \"{item.descripcion}\" solo hay {item.cantidad:g}: no se pueden pasar {cantidad:g}.")
        if not producida and _tiene_salida(item):
            raise HTTPException(
                status_code=400,
                detail=f"No se pueden pasar líneas que ya tienen salida o producción: {item.descripcion or item.codigo_interno}.",
            )
    completas = {item_id for item_id, cantidad in pedido.items() if cantidad >= por_id[item_id].cantidad - TOLERANCIA_CANTIDAD}
    if len(completas) == len(original.items):
        raise HTTPException(status_code=400, detail="Deja algo en la cotización original (si no se lleva nada, mejor cámbiale el número).")

    numero = datos.numero_cotizacion.strip()
    repetida = (
        db.query(Apartado.id)
        .filter(Apartado.bodega_id == original.bodega_id, Apartado.numero_cotizacion == numero,
                Apartado.estado != EstadoApartado.CANCELADO)
        .first()
    )
    if repetida:
        raise HTTPException(status_code=400, detail=f"Ya existe un apartado con la cotización {numero} en esa bodega.")

    ahora = datetime.now(timezone.utc)
    hay_stock = any(por_id[item_id].modalidad == ModalidadApartado.POR_STOCK for item_id in pedido)
    nueva = Apartado(
        bodega_id=original.bodega_id,
        numero_cotizacion=numero,
        empresa=original.empresa,
        cliente=(datos.cliente if datos.cliente is not None else original.cliente).strip(),
        creado_por=usuario.correo,
        fecha_creacion=original.fecha_creacion,
        estado=EstadoApartado.PRODUCCION_TERMINADA if producida else EstadoApartado.APARTADO,
        enviado_a_produccion_por=original.enviado_a_produccion_por if producida else "",
        fecha_enviado_a_produccion=original.fecha_enviado_a_produccion if producida else None,
        observaciones=f"Separada de la cotización {original.numero_cotizacion} el {ahora:%d/%m/%Y} por {usuario.correo}.",
        stock_separado_confirmado=original.stock_separado_confirmado and hay_stock,
        stock_separado_por=original.stock_separado_por if hay_stock else "",
        stock_separado_en=original.stock_separado_en if hay_stock else None,
    )
    db.add(nueva)
    db.flush()
    for item_id, cantidad in pedido.items():
        item = por_id[item_id]
        if item_id in completas:
            item.apartado_id = nueva.id
        else:
            db.add(_partir_linea(item, cantidad, nueva.id))
    nota = f"Se pasaron {len(pedido)} línea(s) a la cotización {numero} el {ahora:%d/%m/%Y}."
    original.observaciones = f"{original.observaciones}\n{nota}".strip() if original.observaciones else nota
    db.flush()
    db.expire(original, ["items"])

    # Si lo que queda en la original ya salió completo, la original termina.
    if original.estado in (EstadoApartado.ENVIADO_A_PRODUCCION, EstadoApartado.EN_PRODUCCION) and all(
        _linea_completa(item) for item in original.items
    ):
        original.estado = EstadoApartado.PRODUCCION_TERMINADA
    return nueva


def cancelar_apartado(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    """Cancela un apartado mientras no haya terminado su producción. Antes
    solo se podía en APARTADO: si el cliente desistía después de enviarlo a
    producción, la reserva quedaba bloqueada para siempre. Al cancelar, lo
    que faltaba por producir deja de estar reservado (la reserva se deriva
    del estado, ver metros_reservados_codigo); lo ya producido no se revierte.
    El stock de ítems POR_STOCK solo se descuenta al terminar la producción,
    así que en estos estados todavía no hay nada que devolver."""
    apartado_de_mi_bodega(db, apartado_id, usuario)
    apartado = db.query(Apartado).filter(Apartado.id == apartado_id).with_for_update().populate_existing().one()
    if apartado.estado not in ESTADOS_CANCELABLES:
        raise HTTPException(status_code=400, detail="Este apartado ya terminó su producción, fue entregado o ya estaba cancelado: no se puede cancelar.")
    apartado.estado = EstadoApartado.CANCELADO
    apartado.cancelado_por = usuario.correo
    apartado.fecha_cancelado = datetime.now(timezone.utc)
    return apartado


def eliminar_apartado_cancelado(db: Session, apartado_id: int, usuario: Usuario) -> None:
    """Borra una cotización cancelada (ej. quedó mal y se creó de nuevo).
    Solo canceladas: las activas se cancelan primero. Nunca una con
    producción registrada, para no perder el registro de lo producido."""
    apartado_de_mi_bodega(db, apartado_id, usuario)
    apartado = db.query(Apartado).filter(Apartado.id == apartado_id).with_for_update().populate_existing().one()
    if apartado.estado != EstadoApartado.CANCELADO:
        raise HTTPException(status_code=400, detail="Solo se pueden eliminar cotizaciones canceladas. Cancélala primero.")
    if any(item.producciones for item in apartado.items):
        raise HTTPException(
            status_code=400,
            detail="Esta cotización tiene producción registrada: no se puede eliminar para no perder ese registro.",
        )
    db.delete(apartado)


def enviar_a_produccion(db: Session, apartado_id: int, usuario: Usuario) -> Apartado:
    apartado = apartado_de_mi_bodega(db, apartado_id, usuario)
    if apartado.estado != EstadoApartado.APARTADO:
        raise HTTPException(status_code=400, detail="Este apartado ya fue enviado a producción o no está activo.")
    faltantes = faltantes_apartado(db, apartado)
    if faltantes:
        raise HTTPException(
            status_code=400,
            detail=f"Esperando material: {'; '.join(faltantes)}. Se podrá enviar a producción cuando le des ingreso a ese material.",
        )
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
    """La encargada de la bodega da la "Salida": el pedido ya salió de la
    bodega y se entregó al cliente. No mueve inventario -- los metros del
    rollo se descuentan al registrar cada producción y el stock al marcar la
    producción terminada; esto solo cierra la cotización."""
    apartado = apartado_de_mi_bodega(db, apartado_id, usuario)
    if apartado.estado != EstadoApartado.PRODUCCION_TERMINADA:
        raise HTTPException(status_code=400, detail="Este apartado todavía no tiene la producción terminada.")
    apartado.estado = EstadoApartado.ENTREGADO
    apartado.fecha_entregado = datetime.now(timezone.utc)
    return apartado
