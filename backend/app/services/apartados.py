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
from app.services.empresas import EMPRESAS_CONOCIDAS
from app.services.productos import nuevo_producto_en_bodega
from app.services.seccionados import metros_de_linea
from app.schemas.apartados import SepararApartadoRequest, ApartadoCrear, ApartadoEditar

ESTADOS_RESERVA_ACTIVA = (
    EstadoApartado.APARTADO,
    EstadoApartado.ENVIADO_A_PRODUCCION,
    EstadoApartado.EN_PRODUCCION,
)


def item_que_aparta_rollo(db: Session, rollo_id: int) -> ApartadoItem | None:
    """La línea de "rollo completo" de una cotización activa que tiene ese rollo apartado."""
    return (
        db.query(ApartadoItem)
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(ApartadoItem.rollo_id == rollo_id, Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
                ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos > 0.005)
        .first()
    )


def exigir_rollo_libre(db: Session, rollo: Rollo, *, item_id: int | None = None) -> None:
    """Un rollo vendido completo en una cotización solo sale por esa línea:
    nadie más lo consume, lo produce ni lo traslada. Lo mismo un rollo
    aceptado para un traslado a otra bodega, mientras no llegue."""
    from app.services.transferencias import traslado_en_curso_del_rollo

    traslado = traslado_en_curso_del_rollo(db, rollo.id)
    if traslado is not None:
        raise HTTPException(
            status_code=400,
            detail=f"El rollo {rollo.identificador_rollo} está apartado para el traslado #{traslado.id} "
            f"({'va en camino' if traslado.estado.value == 'despachada' else 'aceptado, sin despachar'}): no se puede usar para otra cosa.",
        )
    item = item_que_aparta_rollo(db, rollo.id)
    if item is not None and item.id != item_id:
        ap = item.apartado
        raise HTTPException(
            status_code=400,
            detail=f"El rollo {rollo.identificador_rollo} está apartado completo para la cotización "
            f"{ap.numero_cotizacion}{f' ({ap.cliente})' if ap.cliente else ''}: no se puede usar para otra cosa.",
        )


def rollos_apartados_completos(db: Session, rollo_ids) -> set[int]:
    ids = list(rollo_ids)
    if not ids:
        return set()
    filas = (
        db.query(ApartadoItem.rollo_id)
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(ApartadoItem.rollo_id.in_(ids), Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
                ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos > 0.005)
        .all()
    )
    return {f[0] for f in filas}


def kilos_rollo(peso_neto: float | None) -> int | None:
    """Mismo criterio que la pantalla: por debajo de 100 viene en toneladas."""
    if not peso_neto or peso_neto <= 0:
        return None
    return round(peso_neto * 1000 if peso_neto < 100 else peso_neto)


def descripcion_rollo_completo(rollo: Rollo) -> str:
    kilos = kilos_rollo(rollo.peso_neto)
    detalle = " - ".join(p for p in (f"{kilos} KG" if kilos else "", f"{rollo.metros_disponibles:g} MTS") if p)
    nombre = rollo.descripcion or rollo.codigo_interno
    return f"1 ROLLO {nombre} ({detalle}) - rollo {rollo.identificador_rollo}"[:255]


def preparar_rollo_completo(db: Session, linea, bodega_id: int) -> None:
    """Llena la línea con el código y los metros del rollo (1 rollo = todos
    sus metros) y valida que ese rollo se pueda vender completo."""
    from app.services.envios import envio_pendiente_del_rollo

    rollo = db.get(Rollo, linea.rollo_id)
    if rollo is None:
        raise HTTPException(status_code=404, detail="Ese rollo no existe.")
    if rollo.bodega_id != bodega_id:
        raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} no está en la bodega de donde sale esa línea.")
    if (rollo.metros_disponibles or 0) <= 0.005:
        raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} ya está agotado.")
    if envio_pendiente_del_rollo(db, rollo.id) is not None:
        raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} va en un envío pendiente de confirmar.")
    exigir_rollo_libre(db, rollo, item_id=getattr(linea, "id", None))
    linea.modalidad = ModalidadApartado.POR_ROLLO
    linea.codigo_interno = rollo.codigo_interno
    linea.cantidad = 1
    linea.medida = round(rollo.metros_disponibles, 2)
    if not (linea.descripcion or "").strip():
        linea.descripcion = descripcion_rollo_completo(rollo)


def _solo_rollos_completos(items) -> bool:
    """Todo lo de rollo es "rollo completo": no hay nada que producir en Planta."""
    de_rollo = [it for it in items if it.modalidad == ModalidadApartado.POR_ROLLO]
    return bool(de_rollo) and all(it.rollo_id for it in de_rollo)


def metros_reservados_codigo(db: Session, *, bodega_id: int, codigo_interno: str, empresa: str = "") -> float:
    """Con `empresa`, solo lo apartado por cotizaciones de esa empresa."""
    consulta = (
        db.query(func.coalesce(func.sum(ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos), 0))
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(
            Apartado.bodega_id == bodega_id,
            Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
            ApartadoItem.codigo_interno == codigo_interno,
        )
    )
    if empresa:
        consulta = consulta.filter(Apartado.empresa == empresa)
    total = consulta.scalar()
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
    return faltantes_de_apartados(db, [apartado]).get(apartado.id, [])


def faltantes_de_apartados(db: Session, apartados: list[Apartado]) -> dict[int, list[str]]:
    """Lo mismo que faltantes_apartado, pero para una lista entera con pocas
    consultas: la cobertura de cada (bodega, código) se calcula UNA vez (una
    consulta para los metros físicos y otra para las reservas activas), no por
    cada cotización. Con la base remota (Supabase) cada consulta cuesta, y la
    lista de Apartados se volvía eterna con unas decenas de cotizaciones."""
    activos = [a for a in apartados if a.estado in ESTADOS_RESERVA_ACTIVA]
    resultado: dict[int, list[str]] = {}
    if not activos:
        return resultado
    # Por empresa: un rollo de Asia no cubre una cotización de Arquitejas.
    claves = {(a.bodega_id, it.codigo_interno, a.empresa or "") for a in activos for it in a.items
              if it.modalidad != ModalidadApartado.POR_STOCK and it.codigo_interno}
    coberturas: dict[tuple, dict[int, float]] = {}
    if claves:
        bodegas = {b for b, _, _ in claves}
        codigos = {c for _, c, _ in claves}
        fisicos_codigo: dict[tuple, float] = {}
        fisicos: dict[tuple, float] = {}
        for b, c, e, total in (
            db.query(Rollo.bodega_id, Rollo.codigo_interno, Rollo.empresa, func.sum(Rollo.metros_disponibles))
            .filter(Rollo.bodega_id.in_(bodegas), Rollo.codigo_interno.in_(codigos))
            .group_by(Rollo.bodega_id, Rollo.codigo_interno, Rollo.empresa)
        ):
            fisicos[(b, c, e or "")] = float(total or 0)
            fisicos_codigo[(b, c)] = fisicos_codigo.get((b, c), 0.0) + float(total or 0)
        en_orden: dict[tuple, list[ApartadoItem]] = {}
        for item, bodega_id, empresa in (
            db.query(ApartadoItem, Apartado.bodega_id, Apartado.empresa)
            .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
            .filter(Apartado.bodega_id.in_(bodegas), Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
                    ApartadoItem.codigo_interno.in_(codigos))
            .order_by(Apartado.fecha_creacion, Apartado.id, ApartadoItem.id)
        ):
            en_orden.setdefault((bodega_id, item.codigo_interno, empresa or ""), []).append(item)
        for clave in claves:
            b, c, e = clave
            coberturas[clave] = _repartir_en_orden(
                en_orden.get(clave, []), lambda it: (it.metros_requeridos or 0) - (it.metros_consumidos or 0),
                # Cotización sin empresa (antigua): cuenta todo lo del código.
                fisicos.get(clave, 0.0) if e else fisicos_codigo.get((b, c), 0.0),
            )
    coberturas_producto: dict[int, dict[int, float]] = {}
    for apartado in activos:
        faltantes: list[str] = []
        for item in apartado.items:
            if item.modalidad == ModalidadApartado.POR_STOCK:
                if item.stock_descontado:
                    continue
                producto = db.get(Producto, item.producto_id)
                if producto is None:
                    continue
                if producto.id not in coberturas_producto:
                    coberturas_producto[producto.id] = cobertura_producto(db, producto=producto)
                falta = round(item.cantidad - coberturas_producto[producto.id].get(item.id, 0), 2)
                if falta > 0.005:
                    _, donde = disponible_empresa_producto(db, producto=producto, bodega_despacho=apartado.bodega_id)
                    faltantes.append(f"faltan {falta:g} de {producto.codigo}" + (f" (hay en {_texto_donde(donde)})" if donde else ""))
            else:
                pendiente = (item.metros_requeridos or 0) - (item.metros_consumidos or 0)
                clave = (apartado.bodega_id, item.codigo_interno, apartado.empresa or "")
                falta = round(pendiente - coberturas.get(clave, {}).get(item.id, 0), 2)
                if falta > 0.005:
                    _, donde = disponible_empresa_codigo(db, codigo_interno=item.codigo_interno, bodega_despacho=apartado.bodega_id,
                                                         empresa=apartado.empresa or "")
                    faltantes.append(f"faltan {falta:g} m de {item.codigo_interno}" + (f" (hay en {_texto_donde(donde, ' m')})" if donde else ""))
        resultado[apartado.id] = faltantes
    return resultado


def validar_reserva_rollos(
    db: Session, *, bodega_id: int | None, codigo_interno: str, metros_salen: float,
    rollos_codigo: list[Rollo], metros_reserva_propia: float = 0.0, apartado_item_id: int | None = None,
    otros_item_ids: list[int] | tuple[int, ...] = (),
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
        # Varias líneas producidas juntas: su reserva propia es la de todas.
        cobertura = cobertura_rollo(db, bodega_id=bodega_id, codigo_interno=codigo_interno, fisico=fisico)
        cubierto = sum(cobertura.get(i, 0) for i in (apartado_item_id, *otros_item_ids))
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


def metros_esperando_codigo(db: Session, *, codigo_interno: str, empresa: str = "") -> float:
    """Lo que las bodegas ya apartaron de este código sin tenerlo en su
    bodega (sus faltantes): eso ya está comprometido de la bolsa "en camino /
    por repartir" de la empresa, sea cual sea la bodega que lo apartó."""
    reservado = dict(
        db.query(Apartado.bodega_id, func.sum(ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos))
        .join(ApartadoItem, ApartadoItem.apartado_id == Apartado.id)
        .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), ApartadoItem.codigo_interno == codigo_interno,
                *((Apartado.empresa == empresa,) if empresa else ()))
        .group_by(Apartado.bodega_id)
        .all()
    )
    if not reservado:
        return 0.0
    fisico = dict(
        db.query(Rollo.bodega_id, func.sum(Rollo.metros_disponibles))
        .filter(Rollo.codigo_interno == codigo_interno, Rollo.bodega_id.in_(list(reservado)),
                *((Rollo.empresa == empresa,) if empresa else ()))
        .group_by(Rollo.bodega_id)
        .all()
    )
    return round(sum(max(float(r or 0) - float(fisico.get(b) or 0), 0) for b, r in reservado.items()), 2)


def disponibilidad_por_codigo(db: Session, *, bodega_id: int, codigo_interno: str, bloquear: bool = False, empresa: str = "") -> dict:
    """Agrega los rollos de un código de clasificación (color + calibre); con
    `bloquear=True` los bloquea (FOR UPDATE) para serializar apartados
    concurrentes sobre el mismo código. Con `empresa`, solo cuenta los rollos
    y las cotizaciones de esa empresa: el mismo código existe en Arquitejas y
    en Asia, y lo de una no se le puede prometer a la otra."""
    if bloquear:
        rollos = bloquear_rollos_codigo(db, bodega_id=bodega_id, codigo_interno=codigo_interno)
    else:
        rollos = db.query(Rollo).filter(Rollo.bodega_id == bodega_id, Rollo.codigo_interno == codigo_interno).all()
    if empresa:
        rollos = [r for r in rollos if r.empresa == empresa]

    metros_disponibles_rollos = round(sum(r.metros_disponibles for r in rollos), 2)
    metros_consumidos = round(sum(r.metros_consumidos for r in rollos), 2)
    reservados = metros_reservados_codigo(db, bodega_id=bodega_id, codigo_interno=codigo_interno, empresa=empresa)
    # Bolsa de la empresa (no de una bodega): lo que viene en camino más lo
    # que Admin Inventario recibió y no ha repartido, menos lo que las
    # bodegas ya están esperando de ahí.
    en_camino = metros_en_camino_codigo(db, codigo_interno=codigo_interno, empresa=empresa)
    por_repartir = metros_por_repartir_codigo(db, codigo_interno=codigo_interno, empresa=empresa)
    esperando = metros_esperando_codigo(db, codigo_interno=codigo_interno, empresa=empresa)
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


def cantidad_reservada_producto(db: Session, *, bodega_id: int, producto_id: int, incluir_traslados: bool = True) -> float:
    """Análogo a `metros_reservados_codigo`, pero para un `Producto` de stock:
    suma `cantidad` de los ítems POR_STOCK de ese producto en apartados
    activos, más lo aceptado para un traslado que todavía no sale. Igual que
    rollo, nunca un contador aparte — siempre en vivo."""
    from app.services.transferencias import cantidad_en_traslado_producto

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
    producto = db.get(Producto, producto_id) if incluir_traslados else None
    en_traslado = cantidad_en_traslado_producto(db, producto) if producto is not None else 0
    return round(float(total or 0) + en_traslado, 2)


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


def _bodegas_por_id(db: Session) -> dict[int, Bodega]:
    return {b.id: b for b in db.query(Bodega).all()}


def _libre_que_cuenta(libre: float, bodega: Bodega | None, bodega_despacho: int) -> float:
    """Lo libre de una bodega que cuenta para la empresa: lo de una bodega
    desde la que no se traslada (San Gil) solo sirve para despachar allá
    mismo; lo que le falta (negativo) sí resta, porque ya está prometido."""
    if bodega is not None and bodega.sin_traslado and bodega.id != bodega_despacho:
        return min(libre, 0)
    return libre


def disponible_empresa_codigo(db: Session, *, codigo_interno: str, bodega_despacho: int, empresa: str = "") -> tuple[float, list[tuple[str, float]]]:
    """Metros de un código que se pueden prometer en TODA la empresa: por cada
    bodega lo físico menos lo apartado (una cotización que espera material
    deja su bodega en negativo, así que lo que ya está prometido de otra
    bodega se resta solo), más lo que viene en camino o está por repartir.
    Devuelve también dónde hay libre fuera de la bodega de despacho."""
    # Con `empresa`, solo sus rollos y sus cotizaciones (ver disponibilidad_por_codigo).
    fisico = dict(
        db.query(Rollo.bodega_id, func.sum(Rollo.metros_disponibles))
        .filter(Rollo.codigo_interno == codigo_interno, Rollo.bodega_id.isnot(None),
                *((Rollo.empresa == empresa,) if empresa else ()))
        .group_by(Rollo.bodega_id).all()
    )
    reservado = dict(
        db.query(Apartado.bodega_id, func.sum(ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos))
        .join(ApartadoItem, ApartadoItem.apartado_id == Apartado.id)
        .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), ApartadoItem.codigo_interno == codigo_interno,
                *((Apartado.empresa == empresa,) if empresa else ()))
        .group_by(Apartado.bodega_id).all()
    )
    bodegas = _bodegas_por_id(db)
    total, donde = 0.0, []
    for bodega_id in set(fisico) | set(reservado):
        libre = float(fisico.get(bodega_id) or 0) - float(reservado.get(bodega_id) or 0)
        total += _libre_que_cuenta(libre, bodegas.get(bodega_id), bodega_despacho)
        bodega = bodegas.get(bodega_id)
        if bodega_id != bodega_despacho and libre > 0.005 and bodega is not None and not bodega.sin_traslado:
            donde.append((bodega.nombre, round(libre, 2)))
    total += (metros_en_camino_codigo(db, codigo_interno=codigo_interno, empresa=empresa)
              + metros_por_repartir_codigo(db, codigo_interno=codigo_interno, empresa=empresa))
    return round(total, 2), sorted(donde, key=lambda d: -d[1])


def disponible_empresa_producto(db: Session, *, producto: Producto, bodega_despacho: int) -> tuple[float, list[tuple[str, float]]]:
    """Lo mismo para un producto de stock (mismo código y empresa en todas las
    bodegas). Lo apartado para un traslado no se resta aquí: ese material ya
    está prometido a la cotización que lo espera (que deja su bodega en
    negativo); lo que va en camino (despachado, sin recibir) sí se suma."""
    from app.models.solicitud import EstadoSolicitud, Solicitud

    bodegas = _bodegas_por_id(db)
    total, donde = 0.0, []
    for p in db.query(Producto).filter(Producto.codigo == producto.codigo, Producto.empresa == (producto.empresa or "")).all():
        libre = float(p.stock) - cantidad_reservada_producto(db, bodega_id=p.bodega_id, producto_id=p.id, incluir_traslados=False)
        total += _libre_que_cuenta(libre, bodegas.get(p.bodega_id), bodega_despacho)
        bodega = bodegas.get(p.bodega_id)
        if p.bodega_id != bodega_despacho and libre > 0.005 and (bodega is None or not bodega.sin_traslado):
            donde.append((bodega.nombre if bodega else "Admin Inventario", round(libre, 2)))
    en_camino = (
        db.query(func.coalesce(func.sum(Solicitud.cantidad), 0))
        .filter(Solicitud.rollo_id.is_(None), Solicitud.producto_codigo == producto.codigo,
                Solicitud.empresa == (producto.empresa or ""), Solicitud.estado == EstadoSolicitud.DESPACHADA)
        .scalar()
    )
    total += float(en_camino or 0)
    return round(total, 2), sorted(donde, key=lambda d: -d[1])


def _texto_donde(donde: list[tuple[str, float]], unidad: str = "") -> str:
    return ", ".join(f"{nombre} {cantidad:g}{unidad}" for nombre, cantidad in donde)


def exigir_producto_de_la_empresa(db: Session, producto_id: int | None, empresa: str) -> None:
    """Una cotización de Asia Business solo lleva productos de Asia (y una de
    Arquitejas, de Arquitejas): el mismo código existe en las dos empresas."""
    producto = db.get(Producto, producto_id) if producto_id is not None else None
    if producto is not None and producto.empresa and empresa and producto.empresa != empresa:
        del_producto, de_la_cotizacion = (EMPRESAS_CONOCIDAS.get(e, e) for e in (producto.empresa, empresa))
        raise HTTPException(
            status_code=400,
            detail=f"El producto {producto.codigo} que escogiste es de {del_producto} y la cotización es de "
            f"{de_la_cotizacion}: escoge el de {de_la_cotizacion}.",
        )


def producto_en_bodega(db: Session, producto_id: int | None, bodega_id: int) -> int | None:
    """Una línea de stock puede pedir un producto que hoy solo está en otra
    bodega (se trae con un traslado): la cotización usa la fila de ESE
    producto en la bodega de despacho, y si no existe la crea en 0."""
    if producto_id is None:
        return None
    producto = db.get(Producto, producto_id)
    if producto is None or producto.bodega_id == bodega_id:
        return producto_id
    propio = (
        db.query(Producto)
        .filter(Producto.bodega_id == bodega_id, Producto.codigo == producto.codigo, Producto.empresa == (producto.empresa or ""))
        .first()
    )
    if propio is None:
        propio = nuevo_producto_en_bodega(producto, bodega_id=bodega_id, cantidad=0)
        db.add(propio)
        db.flush()
    return propio.id


def _validar_que_quepa(
    db: Session, *, bodega_id: int, solicitado_por_codigo: dict[str, float],
    solicitado_por_producto: dict[int, float], material_en_camino: bool, empresa: str = "",
) -> None:
    """Lo que se va a apartar (o lo que se aumenta al editar) tiene que caber
    en lo libre de TODA la empresa: la bodega de despacho, las otras bodegas
    (desde donde se trae con un traslado; San Gil no traslada) y lo que viene
    en camino o está por repartir. Nunca se promete más de lo que hay. Si en
    la bodega de despacho no alcanza, la cotización queda "esperando
    material" (no se puede enviar a producción hasta que llegue). Misma regla
    al crear y al editar. `material_en_camino` ya no hace falta: se deja por
    compatibilidad con la pantalla."""
    for codigo_interno, metros_solicitados in solicitado_por_codigo.items():
        # Bloquea los rollos del código en la bodega (serializa apartados
        # simultáneos). Siempre se mira la empresa, aunque la bodega lo tenga:
        # su material puede estar prometido a una cotización de otra bodega
        # que lo está esperando.
        disponibilidad_por_codigo(db, bodega_id=bodega_id, codigo_interno=codigo_interno, bloquear=True)
        libre_empresa, _ = disponible_empresa_codigo(db, codigo_interno=codigo_interno, bodega_despacho=bodega_id, empresa=empresa)
        if metros_solicitados > libre_empresa + 0.005:
            de = f" de {EMPRESAS_CONOCIDAS.get(empresa, empresa)}" if empresa else ""
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No hay suficiente '{codigo_interno}'{de} en toda la empresa: pediste {metros_solicitados:g} m y solo hay "
                    f"{max(round(libre_empresa, 2), 0) + 0:g} m sin prometer (sumando todas las bodegas y lo que viene en camino). "
                    f"Faltan {round(metros_solicitados - max(libre_empresa, 0), 2) + 0:g} m."
                ),
            )

    for producto_id, cantidad_solicitada in solicitado_por_producto.items():
        resumen = disponibilidad_producto(db, bodega_id=bodega_id, producto_id=producto_id, bloquear=True)
        producto = db.get(Producto, producto_id)
        empresa, _ = disponible_empresa_producto(db, producto=producto, bodega_despacho=bodega_id)
        if cantidad_solicitada > empresa + 0.005:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No hay suficiente '{resumen['codigo']}' en toda la empresa: pediste {cantidad_solicitada:g} y solo hay "
                    f"{max(round(empresa, 2), 0) + 0:g} sin prometer (sumando todas las bodegas). "
                    f"Faltan {round(cantidad_solicitada - max(empresa, 0), 2) + 0:g}."
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

    rollos_pedidos = [item.rollo_id for item in datos.items if item.rollo_id]
    if len(rollos_pedidos) != len(set(rollos_pedidos)):
        raise HTTPException(status_code=400, detail="El mismo rollo está dos veces en la cotización.")
    for item in datos.items:
        if item.rollo_id:
            preparar_rollo_completo(db, item, bodega_id)
        if item.modalidad == ModalidadApartado.POR_STOCK:
            exigir_producto_de_la_empresa(db, item.producto_id, datos.empresa)
            item.producto_id = producto_en_bodega(db, item.producto_id, bodega_id)

    solicitado_por_codigo: dict[str, float] = {}
    solicitado_por_producto: dict[int, float] = {}
    for item in datos.items:
        if item.modalidad == ModalidadApartado.POR_STOCK:
            solicitado_por_producto[item.producto_id] = solicitado_por_producto.get(item.producto_id, 0) + item.cantidad
        else:
            metros = metros_de_linea(item.cantidad, item.medida, item.tipo_producto)
            solicitado_por_codigo[item.codigo_interno] = solicitado_por_codigo.get(item.codigo_interno, 0) + metros
    # Un rollo completo es material que ya está en la bodega: no puede ser "en camino".
    _validar_que_quepa(db, bodega_id=bodega_id, solicitado_por_codigo=solicitado_por_codigo, empresa=datos.empresa,
                       solicitado_por_producto=solicitado_por_producto,
                       material_en_camino=datos.material_en_camino and not rollos_pedidos)

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
        # Aunque solo tenga rollos completos va a Planta: allá alistan y mueven
        # el rollo, lo marcan terminado y entonces queda por dar salida.
    )
    db.add(apartado)
    db.flush()

    for item in datos.items:
        if item.modalidad == ModalidadApartado.POR_STOCK:
            db.add(ApartadoItem(
                apartado_id=apartado.id, modalidad=ModalidadApartado.POR_STOCK,
                producto_id=item.producto_id, descripcion=item.descripcion, cantidad=item.cantidad,
                medida=item.medida,  # opcional: cortar cada unidad a esta medida (m)
            ))
        else:
            db.add(ApartadoItem(
                apartado_id=apartado.id, modalidad=ModalidadApartado.POR_ROLLO,
                codigo_interno=item.codigo_interno, descripcion=item.descripcion,
                cantidad=item.cantidad, medida=item.medida, metros_requeridos=metros_de_linea(item.cantidad, item.medida, item.tipo_producto),
                tipo_producto=item.tipo_producto,
                rollo_id=item.rollo_id,
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
    for linea in datos.items:
        if linea.modalidad == ModalidadApartado.POR_STOCK:
            # Solo lo nuevo o cambiado: las cotizaciones cargadas del Excel pueden traer productos mezclados.
            if not linea.id or actuales.get(linea.id) is None or actuales[linea.id].producto_id != linea.producto_id:
                exigir_producto_de_la_empresa(db, linea.producto_id, datos.empresa)
            linea.producto_id = producto_en_bodega(db, linea.producto_id, bodega_id)
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
    rollos_pedidos = [linea.rollo_id for linea in datos.items if linea.rollo_id]
    if len(rollos_pedidos) != len(set(rollos_pedidos)):
        raise HTTPException(status_code=400, detail="El mismo rollo está dos veces en la cotización.")
    for linea in datos.items:
        if linea.id and (linea.rollo_id or None) != (actuales[linea.id].rollo_id or None):
            raise HTTPException(status_code=400, detail="No se puede cambiar el rollo de una línea de rollo completo: quítala y agrega otra.")
        if linea.id and linea.rollo_id:
            # La línea de rollo completo no se edita: queda como estaba.
            item = actuales[linea.id]
            linea.modalidad, linea.codigo_interno = item.modalidad, item.codigo_interno
            linea.cantidad, linea.medida = item.cantidad, item.medida
        elif linea.rollo_id:
            preparar_rollo_completo(db, linea, bodega_id)
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
            nuevos = metros_de_linea(linea.cantidad, linea.medida, linea.tipo_producto)
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
            despues_codigo[linea.codigo_interno] = despues_codigo.get(linea.codigo_interno, 0) + metros_de_linea(linea.cantidad, linea.medida, linea.tipo_producto)
    aumento_codigo = {c: round(m - antes_codigo.get(c, 0), 2) for c, m in despues_codigo.items() if m - antes_codigo.get(c, 0) > 0.005}
    aumento_producto = {p: round(q - antes_producto.get(p, 0), 2) for p, q in despues_producto.items() if q - antes_producto.get(p, 0) > 0.005}
    _validar_que_quepa(db, bodega_id=bodega_id, solicitado_por_codigo=aumento_codigo, empresa=datos.empresa,
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
                item.producto_id, item.cantidad, item.medida = linea.producto_id, linea.cantidad, linea.medida
            else:
                item.codigo_interno, item.cantidad, item.medida = linea.codigo_interno, linea.cantidad, linea.medida
                item.tipo_producto = linea.tipo_producto
                item.metros_requeridos = metros_de_linea(linea.cantidad, linea.medida, linea.tipo_producto)
        elif linea.modalidad == ModalidadApartado.POR_STOCK:
            apartado.items.append(ApartadoItem(
                modalidad=ModalidadApartado.POR_STOCK, producto_id=linea.producto_id,
                descripcion=linea.descripcion, cantidad=linea.cantidad, medida=linea.medida,
            ))
        else:
            apartado.items.append(ApartadoItem(
                modalidad=ModalidadApartado.POR_ROLLO, codigo_interno=linea.codigo_interno, descripcion=linea.descripcion,
                cantidad=linea.cantidad, medida=linea.medida, metros_requeridos=metros_de_linea(linea.cantidad, linea.medida, linea.tipo_producto),
                tipo_producto=linea.tipo_producto,
                rollo_id=linea.rollo_id,
            ))
    if apartado.estado == EstadoApartado.APARTADO:
        apartado.salida_pendiente = False
    db.flush()
    return apartado


def numero_base(numero_cotizacion: str) -> str:
    """Número de la cotización sin el sufijo de la parte: "3811-AR", "3811-ABG",
    "3776-SAL" y "3811-AR-SAL" son partes de la 3811 (ver importar_cotizaciones)."""
    return re.sub(r"(-(AR|ABG))?(-SAL)?$", "", (numero_cotizacion or "").strip(), flags=re.IGNORECASE)


def otras_partes(db: Session, apartados: list[Apartado]) -> dict[int, list[str]]:
    """Por cada apartado, las OTRAS partes activas de la misma cotización (otra
    bodega u otra empresa): "SANTANDER" o "3811-AR (RICAURTE)". Así nadie
    piensa que una parte cancelada o quitada era la cotización completa."""
    if not apartados:
        return {}
    bases = {numero_base(a.numero_cotizacion) for a in apartados}
    activos = (
        db.query(Apartado.id, Apartado.numero_cotizacion, Bodega.nombre)
        .join(Bodega, Bodega.id == Apartado.bodega_id)
        .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA))
        .all()
    )
    por_base: dict[str, list[tuple[int, str, str]]] = {}
    for id_, numero, bodega in activos:
        base = numero_base(numero)
        if base in bases:
            por_base.setdefault(base, []).append((id_, numero, bodega))
    resultado = {}
    for apartado in apartados:
        resultado[apartado.id] = [
            bodega if numero == apartado.numero_cotizacion else f"{numero} ({bodega})"
            for id_, numero, bodega in por_base.get(numero_base(apartado.numero_cotizacion), []) if id_ != apartado.id
        ]
    return resultado


def quitar_parte(db: Session, apartado_id: int, usuario: Usuario, *, pasa_a_otra_bodega: bool = False) -> None:
    """Al editar se quitaron TODAS las líneas de una parte de la cotización (ej.
    se eliminó lo que salía de Ricaurte y lo de Santander sigue): esa parte se
    borra, no se cancela, para que en "canceladas" no aparezca la cotización
    como si se hubiera cancelado completa. Solo si la cotización sigue activa
    en otra parte (o sus líneas pasan a otra bodega) y si esta parte no tiene
    nada con salida: lo que ya salió o se produjo no se pierde."""
    apartado_de_mi_bodega(db, apartado_id, usuario)
    apartado = db.query(Apartado).filter(Apartado.id == apartado_id).with_for_update().populate_existing().one()
    if apartado.estado not in ESTADOS_RESERVA_ACTIVA:
        raise HTTPException(status_code=400, detail="Solo se pueden editar cotizaciones activas (no terminadas, entregadas ni canceladas).")
    if not pasa_a_otra_bodega and not otras_partes(db, [apartado])[apartado.id]:
        raise HTTPException(
            status_code=400,
            detail=f"La cotización {apartado.numero_cotizacion} solo está en {apartado.bodega_nombre}: no puede quedar sin líneas. "
            "Si se canceló completa, usa Cancelar.",
        )
    for item in apartado.items:
        if _tiene_salida(item):
            raise HTTPException(
                status_code=400,
                detail=f"No puedes quitar la línea '{item.descripcion or item.codigo_interno}': ya tiene salida registrada.",
            )
    db.delete(apartado)
    db.flush()


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
        tipo_producto=item.tipo_producto,
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
        if item.rollo_id and cantidad < item.cantidad - TOLERANCIA_CANTIDAD:
            raise HTTPException(status_code=400, detail=f"El rollo completo {item.rollo_referencia} no se puede partir: pásalo completo o déjalo.")
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
    db.expire(nueva, ["items"])
    if not producida and original.salida_pendiente:
        nueva.salida_pendiente = True

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
    if apartado.salida_pendiente and not _solo_rollos_completos(apartado.items):
        raise HTTPException(status_code=400, detail="Esta cotización no tiene nada que producir: se le da salida desde Apartados.")
    # Un rollo completo también pasa por Planta (alistan el rollo); las
    # creadas antes de esto quedaban "por dar salida" sin poder enviarse.
    apartado.salida_pendiente = False
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

    # Las líneas de rollo completo no pasan por Planta (salen desde Apartados).
    items_rollo = [item for item in apartado.items if item.modalidad == ModalidadApartado.POR_ROLLO and not item.rollo_id]
    items_stock = [item for item in apartado.items if item.modalidad == ModalidadApartado.POR_STOCK and not item.stock_descontado]
    rollos_completos_sin_salida = [item for item in apartado.items if item.rollo_id and not _linea_completa(item)]

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

    if rollos_completos_sin_salida:
        # Planta terminó, pero falta darle salida al rollo completo: la
        # cotización sigue activa (el rollo sigue apartado) y pasa a
        # "Pendientes por dar salida"; al darle salida queda Entregada.
        apartado.salida_pendiente = True
        apartado.estado = EstadoApartado.EN_PRODUCCION
        return apartado

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
