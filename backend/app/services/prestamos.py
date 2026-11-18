"""Préstamos entre empresas (Arquitejas y Asia Business comparten bodegas).

Una cotización es de UNA empresa, pero una línea puede llevar material de la
otra (Admin Inventario lo marca al crear la cotización: "material de
Arquitejas"). Cuando ese material sale de verdad -- Planta consume el rollo,
se termina la producción con un producto de stock, o Admin Inventario le da
salida con la hoja de vida -- se anota aquí, solo, un préstamo de la empresa
del material a la empresa de la cotización. Nunca se convierten negativos
viejos en préstamos: solo lo que sale por una cotización.
"""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models.apartado import Apartado
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.prestamo import PrestamoEmpresa
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.services.empresas import EMPRESAS_CONOCIDAS, sigla_empresa_desde_nombre

LAMINA = "lamina"
PRODUCTO = "producto"


def registrar_prestamo(
    db: Session, *, apartado: Apartado, empresa_material: str, tipo: str, codigo: str, descripcion: str,
    cantidad: float, usuario: Usuario, origen: str, referencia_rollo: str = "", fecha: datetime | None = None,
) -> PrestamoEmpresa | None:
    """Anota el préstamo si el material es de una empresa y la cotización de
    la otra. Sin empresa en alguno de los dos (datos antiguos), no hay préstamo."""
    if apartado.traslado_a:
        return None  # un traslado a otra sede no es una venta: nadie le presta a nadie.
    presta, recibe = (empresa_material or "").strip().upper(), (apartado.empresa or "").strip().upper()
    if not presta or not recibe or presta == recibe or cantidad <= 0.005:
        return None
    prestamo = PrestamoEmpresa(
        fecha=fecha or datetime.now(timezone.utc), empresa_presta=presta, empresa_recibe=recibe,
        bodega_id=apartado.bodega_id, apartado_id=apartado.id, numero_cotizacion=apartado.numero_cotizacion,
        tipo=tipo, codigo=codigo, descripcion=(descripcion or "")[:255], cantidad=round(float(cantidad), 2),
        unidad="m" if tipo == LAMINA else "und", referencia_rollo=(referencia_rollo or "")[:60],
        origen=origen, usuario=usuario.correo,
    )
    db.add(prestamo)
    return prestamo


PRESTADOR_EXTERNO = "EXT"


def registrar_prestamo_de_rollo(db: Session, *, rollo: Rollo, prestador: str, usuario: Usuario) -> PrestamoEmpresa:
    """Rollo que nos prestaron (se ingresó a mano): todos sus metros quedan
    como préstamo de quien lo prestó a la empresa del rollo. Si lo prestó
    Arquitejas o Asia Business cuenta igual que los préstamos entre ellas;
    si no, queda a nombre del tercero (empresa_presta = "EXT")."""
    nombre = " ".join((prestador or "").split())
    if not nombre:
        raise HTTPException(status_code=400, detail="Escribe quién prestó el rollo (empresa o persona).")
    sigla = sigla_empresa_desde_nombre(nombre)
    recibe = (rollo.empresa or "").strip().upper()
    if sigla and sigla == recibe:
        raise HTTPException(
            status_code=400,
            detail=f"Ese rollo ya es de {EMPRESAS_CONOCIDAS[sigla]} (por su referencia): no puede ser prestado por ella misma.",
        )
    metros = round(float(rollo.metros_disponibles or 0), 2)
    prestamo = PrestamoEmpresa(
        fecha=rollo.fecha_ingreso or datetime.now(timezone.utc), empresa_presta=sigla or PRESTADOR_EXTERNO,
        empresa_recibe=recibe, prestador="" if sigla else nombre[:150], bodega_id=rollo.bodega_id,
        apartado_id=None, numero_cotizacion="", tipo=LAMINA, codigo=rollo.codigo_interno,
        descripcion=(rollo.descripcion or "")[:255], cantidad=metros, unidad="m",
        referencia_rollo=(rollo.identificador_rollo or "")[:60], origen="ingreso_rollo", usuario=usuario.correo,
    )
    db.add(prestamo)
    return prestamo


# Lo que Admin Inventario le presta a una empresa de afuera (ej. caballetes):
# sale del stock de la bodega y queda aquí hasta que lo devuelvan o lo paguen.
PRESTADO_A_TERCERO = "prestamo_a_tercero"
DEVUELTO_POR_TERCERO = "devuelto_por_tercero"


def nombre_presta(p: PrestamoEmpresa) -> str:
    return p.prestador if p.empresa_presta == PRESTADOR_EXTERNO and p.prestador else p.empresa_presta


def nombre_recibe(p: PrestamoEmpresa) -> str:
    return p.prestador if p.empresa_recibe == PRESTADOR_EXTERNO and p.prestador else p.empresa_recibe


def prestar_a_tercero(
    db: Session, *, producto_id: int, cantidad: float, tercero: str, observaciones: str, usuario: Usuario,
) -> PrestamoEmpresa:
    """Unidades de un producto que salen prestadas a una empresa externa: se
    descuentan del stock (sin tocar lo apartado) y quedan sin saldar."""
    from app.services.apartados import validar_reserva_producto

    nombre = _nombre_tercero(tercero)
    cantidad = round(float(cantidad or 0), 2)
    if cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor que 0.")
    producto = db.query(Producto).filter(Producto.id == producto_id).with_for_update().first()
    if producto is None or producto.bodega_id is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado en esa bodega. Recarga la lista.")
    if cantidad > round(float(producto.stock), 2) + 0.005:
        raise HTTPException(status_code=400, detail=f"Solo hay {float(producto.stock):g} de {producto.codigo} en esa bodega.")
    validar_reserva_producto(db, producto=producto, cantidad=cantidad)
    producto.stock -= Decimal(str(cantidad))
    ahora = datetime.now(timezone.utc)
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo=PRESTADO_A_TERCERO, producto_codigo=producto.codigo,
        producto_descripcion=producto.descripcion, bodega_origen_id=producto.bodega_id, cantidad=cantidad,
        usuario=usuario.correo, empresa_externa=nombre[:150],
        observaciones=(observaciones or "").strip() or f"Prestado a {nombre}: debe devolverlo.",
    ))
    prestamo = PrestamoEmpresa(
        fecha=ahora, empresa_presta=(producto.empresa or "").strip().upper(), empresa_recibe=PRESTADOR_EXTERNO,
        prestador=nombre[:150], bodega_id=producto.bodega_id, apartado_id=None, numero_cotizacion="", tipo=PRODUCTO,
        codigo=producto.codigo, descripcion=(producto.descripcion or "")[:255], cantidad=cantidad, unidad="und",
        referencia_rollo="", origen=PRESTADO_A_TERCERO, usuario=usuario.correo,
    )
    db.add(prestamo)
    return prestamo


def prestar_rollo_a_tercero(db: Session, *, rollo_id: int, tercero: str, observaciones: str, usuario: Usuario) -> PrestamoEmpresa:
    """El rollo COMPLETO sale prestado a una empresa externa: sus metros salen
    de la bodega (queda agotado, como en la salida externa) y quedan aquí sin
    saldar hasta que lo devuelvan (vuelve el mismo rollo) o lo paguen."""
    from app.services.apartados import bloquear_rollos_codigo, exigir_rollo_libre, validar_reserva_rollos
    from app.services.transferencias import _exigir_que_no_este_prestado, traslado_en_curso_del_rollo

    nombre = _nombre_tercero(tercero)
    rollo = db.get(Rollo, rollo_id)
    if rollo is None or rollo.bodega_id is None:
        raise HTTPException(status_code=404, detail="Rollo no encontrado en esa bodega. Recarga la lista.")
    rollos_codigo = bloquear_rollos_codigo(db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno)
    rollo = next((r for r in rollos_codigo if r.id == rollo_id), None)
    if rollo is None or rollo.metros_disponibles <= 0:
        raise HTTPException(status_code=400, detail="Ese rollo ya no tiene metros en la bodega. Recarga la lista.")
    if traslado_en_curso_del_rollo(db, rollo.id) is not None:
        raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} tiene un traslado en curso: termínalo o recházalo primero.")
    _exigir_que_no_este_prestado(db, rollo)
    exigir_rollo_libre(db, rollo)
    validar_reserva_rollos(
        db, bodega_id=rollo.bodega_id, codigo_interno=rollo.codigo_interno, metros_salen=rollo.metros_disponibles,
        rollos_codigo=rollos_codigo, empresa=rollo.empresa or "",
    )
    metros = round(rollo.metros_disponibles, 2)
    rollo.metros_consumidos = round(rollo.metros_consumidos + metros, 2)
    rollo.metros_disponibles = 0
    rollo.recalcular_estado()
    ahora = datetime.now(timezone.utc)
    descripcion = f"{rollo.descripcion} (rollo {rollo.identificador_rollo})"
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo=PRESTADO_A_TERCERO, producto_codigo=rollo.codigo_interno,
        producto_descripcion=descripcion, rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo,
        bodega_origen_id=rollo.bodega_id, cantidad=metros, usuario=usuario.correo, empresa_externa=nombre[:150],
        observaciones=(observaciones or "").strip() or f"Rollo completo prestado a {nombre}: debe devolverlo.",
    ))
    prestamo = PrestamoEmpresa(
        fecha=ahora, empresa_presta=(rollo.empresa or "").strip().upper(), empresa_recibe=PRESTADOR_EXTERNO,
        prestador=nombre[:150], bodega_id=rollo.bodega_id, apartado_id=None, numero_cotizacion="", tipo=LAMINA,
        codigo=rollo.codigo_interno, descripcion=(rollo.descripcion or "")[:255], cantidad=metros, unidad="m",
        referencia_rollo=(rollo.identificador_rollo or "")[:60], origen=PRESTADO_A_TERCERO, usuario=usuario.correo,
    )
    db.add(prestamo)
    return prestamo


def lineas_para_prestar(db: Session, numero: str):
    """Las líneas de productos de stock de la cotización `numero` (todas sus
    partes), las que se anotarían como préstamo. Devuelve (número, partes por
    id, líneas); falla si no existe, ya es préstamo o no tiene productos."""
    from app.models.apartado import ApartadoItem, EstadoApartado, ModalidadApartado
    from app.services.apartados import numero_base

    buscado = numero_base(numero)
    if not buscado:
        raise HTTPException(status_code=400, detail="Escribe el número de la cotización.")
    apartados = [
        a for a in db.query(Apartado).filter(Apartado.numero_cotizacion.like(f"{buscado}%"), Apartado.estado != EstadoApartado.CANCELADO).all()
        if numero_base(a.numero_cotizacion) == buscado
    ]
    if not apartados:
        raise HTTPException(status_code=404, detail=f"No encuentro la cotización {buscado} (o está cancelada).")
    ids = [a.id for a in apartados]
    if db.query(PrestamoEmpresa).filter(PrestamoEmpresa.apartado_id.in_(ids),
                                        PrestamoEmpresa.origen.in_((PRESTADO_A_TERCERO, DEVUELTO_POR_TERCERO))).first():
        raise HTTPException(status_code=400, detail=f"La cotización {buscado} ya está anotada como préstamo.")
    # Productos de stock y rollos completos (la línea vende ese rollo entero).
    lineas = (
        db.query(ApartadoItem)
        .filter(ApartadoItem.apartado_id.in_(ids),
                or_(and_(ApartadoItem.modalidad == ModalidadApartado.POR_STOCK, ApartadoItem.producto_id.isnot(None)),
                    ApartadoItem.rollo_id.isnot(None)))
        .order_by(ApartadoItem.id).all()
    )
    if not lineas:
        raise HTTPException(status_code=400, detail=f"La cotización {buscado} no tiene productos de stock ni rollos completos para prestar.")
    return buscado, {a.id: a for a in apartados}, lineas


def _es_rollo(linea) -> bool:
    return linea.rollo_id is not None


def _linea_salio(linea) -> bool:
    """Producto de stock: ya se descontó. Rollo completo: ya se consumió entero."""
    if _es_rollo(linea):
        return (linea.metros_requeridos or 0) > 0.005 and (linea.metros_consumidos or 0) >= (linea.metros_requeridos or 0) - 0.005
    return bool(linea.stock_descontado)


def _datos_linea(linea) -> dict:
    if _es_rollo(linea):
        rollo = linea.rollo
        return {
            "codigo": (rollo.codigo_interno if rollo else "") or linea.codigo_interno or "",
            "descripcion": f"Rollo {rollo.identificador_rollo}" if rollo else (linea.descripcion or ""),
            "cantidad": round(float(linea.metros_requeridos or 0), 2), "unidad": "m",
        }
    return {
        "codigo": linea.producto.codigo if linea.producto else (linea.codigo_interno or ""),
        "descripcion": (linea.producto.descripcion if linea.producto else "") or linea.descripcion or "",
        "cantidad": round(float(linea.cantidad), 2), "unidad": "und",
    }


def vista_prestamo_desde_cotizacion(db: Session, numero: str) -> dict:
    """Lo que quedaría como préstamo con esa cotización, sin guardar nada."""
    buscado, por_id, lineas = lineas_para_prestar(db, numero)
    return {
        "numero_cotizacion": buscado,
        "cliente": next(iter(por_id.values())).cliente or "",
        "salio": all(_linea_salio(l) for l in lineas),
        "lineas": [{**_datos_linea(l), "bodega": por_id[l.apartado_id].bodega_nombre, "salio": _linea_salio(l)} for l in lineas],
    }


def prestar_desde_cotizacion(db: Session, *, numero: str, tercero: str, usuario: Usuario) -> list[PrestamoEmpresa]:
    """Hicieron una cotización para el préstamo: sus productos de stock y
    rollos completos quedan como préstamo a la empresa externa, enlazados a esa
    cotización. Nada se descuenta aquí: sale con la Salida de la cotización."""
    nombre = _nombre_tercero(tercero)
    buscado, por_id, lineas = lineas_para_prestar(db, numero)
    # Se puede anotar desde que se crea la cotización (vienen por él otro día):
    # el material sigue apartado para ella y sale con su Salida, como siempre.
    # Mientras no salga, el préstamo queda "por recoger" y no se puede devolver.
    ahora = datetime.now(timezone.utc)
    prestamos = []
    for linea in lineas:
        producto, apartado = linea.producto, por_id[linea.apartado_id]
        if _es_rollo(linea):
            # El rollo salió completo con la cotización: queda prestado; al devolverlo
            # vuelve a ese mismo rollo en su bodega (ver _devolver_al_rollo).
            rollo, datos = linea.rollo, _datos_linea(linea)
            prestamo = PrestamoEmpresa(
                fecha=ahora, empresa_presta=((rollo.empresa if rollo else "") or linea.empresa_de_linea or "").strip().upper(),
                empresa_recibe=PRESTADOR_EXTERNO, prestador=nombre[:150],
                bodega_id=rollo.bodega_id if rollo and rollo.bodega_id is not None else apartado.bodega_id,
                apartado_id=apartado.id, numero_cotizacion=apartado.numero_cotizacion, tipo=LAMINA,
                codigo=datos["codigo"], descripcion=((rollo.descripcion if rollo else "") or linea.descripcion or "")[:255],
                cantidad=datos["cantidad"], unidad="m", referencia_rollo=((rollo.identificador_rollo if rollo else "") or "")[:60],
                origen=PRESTADO_A_TERCERO, usuario=usuario.correo,
            )
            db.add(prestamo)
            prestamos.append(prestamo)
            continue
        prestamo = PrestamoEmpresa(
            fecha=ahora, empresa_presta=((producto.empresa if producto else "") or linea.empresa_de_linea or "").strip().upper(),
            empresa_recibe=PRESTADOR_EXTERNO, prestador=nombre[:150],
            bodega_id=producto.bodega_id if producto and producto.bodega_id is not None else apartado.bodega_id,
            apartado_id=apartado.id, numero_cotizacion=apartado.numero_cotizacion, tipo=PRODUCTO,
            codigo=producto.codigo if producto else (linea.codigo_interno or ""),
            descripcion=((producto.descripcion if producto else "") or linea.descripcion or "")[:255],
            cantidad=round(float(linea.cantidad), 2), unidad="und", referencia_rollo="", origen=PRESTADO_A_TERCERO,
            usuario=usuario.correo,
        )
        db.add(prestamo)
        prestamos.append(prestamo)
    return prestamos


def _nombre_tercero(tercero: str) -> str:
    nombre = " ".join((tercero or "").split())
    if not nombre:
        raise HTTPException(status_code=400, detail="Escribe a quién se le presta (empresa o persona).")
    if sigla_empresa_desde_nombre(nombre):
        raise HTTPException(status_code=400, detail="Entre Arquitejas y Asia Business el préstamo se hace con una cotización: aquí solo empresas de afuera.")
    return nombre


def estado_de_cotizacion_prestada(db: Session, apartado_ids: set[int]) -> dict[int, str]:
    """Para los préstamos anotados con una cotización: "por_recoger" si su
    material todavía no ha salido, "cancelada" si la cotización se canceló sin
    salir. Las que ya salieron no aparecen."""
    from app.models.apartado import ApartadoItem, EstadoApartado

    if not apartado_ids:
        return {}
    estados: dict[int, str] = {}
    for apartado in db.query(Apartado).filter(Apartado.id.in_(apartado_ids)).all():
        lineas = [l for l in db.query(ApartadoItem).filter(ApartadoItem.apartado_id == apartado.id).all()
                  if l.rollo_id is not None or l.producto_id is not None]
        if lineas and all(_linea_salio(l) for l in lineas):
            continue
        estados[apartado.id] = "cancelada" if apartado.estado == EstadoApartado.CANCELADO else "por_recoger"
    return estados


def devolver_de_tercero(db: Session, prestamo_id: int, cantidad: float, usuario: Usuario) -> PrestamoEmpresa:
    """La empresa externa devolvió todo o parte: vuelve al stock de la bodega
    de donde salió. Lo devuelto queda saldado; lo que falta sigue pendiente."""
    prestamo = db.query(PrestamoEmpresa).filter(PrestamoEmpresa.id == prestamo_id).with_for_update().first()
    if prestamo is None or prestamo.origen != PRESTADO_A_TERCERO or prestamo.saldado:
        raise HTTPException(status_code=404, detail="Ese préstamo ya no está pendiente. Recarga la lista.")
    if _cerrar_si_no_salio(db, prestamo, usuario):
        return prestamo
    cantidad = round(float(cantidad or 0), 2)
    if cantidad <= 0 or cantidad > prestamo.cantidad + 0.005:
        raise HTTPException(status_code=400, detail=f"Escribe cuánto devolvieron: más de 0 y máximo {prestamo.cantidad:g}.")
    # Kilos que vuelven con el mismo rollo (la parte proporcional de lo prestado).
    kilos_vuelven = None
    if prestamo.tipo == LAMINA:
        kilos = kilos_prestados(db, prestamo)
        kilos_vuelven = round(kilos * cantidad / prestamo.cantidad, 1) if kilos and prestamo.cantidad > 0 else None
        _devolver_al_rollo(db, prestamo, cantidad, usuario)
    else:
        _devolver_al_stock(db, prestamo, cantidad, usuario)
    ahora = datetime.now(timezone.utc)
    if cantidad < prestamo.cantidad - 0.005:
        # Devolución parcial: lo devuelto queda aparte como saldado; el resto sigue pendiente.
        prestamo.cantidad = round(prestamo.cantidad - cantidad, 2)
        devuelto = PrestamoEmpresa(
            fecha=prestamo.fecha, empresa_presta=prestamo.empresa_presta, empresa_recibe=prestamo.empresa_recibe,
            prestador=prestamo.prestador, bodega_id=prestamo.bodega_id, apartado_id=None, numero_cotizacion="",
            tipo=prestamo.tipo, codigo=prestamo.codigo, descripcion=prestamo.descripcion, cantidad=cantidad,
            unidad=prestamo.unidad, referencia_rollo=prestamo.referencia_rollo, origen=DEVUELTO_POR_TERCERO,
            usuario=prestamo.usuario, saldado=True, saldado_por=usuario.correo, fecha_saldado=ahora,
            kilos_devueltos=kilos_vuelven, devuelto_con="El mismo rollo" if prestamo.tipo == LAMINA else "",
        )
        db.add(devuelto)
        return devuelto
    prestamo.origen = DEVUELTO_POR_TERCERO
    prestamo.saldado, prestamo.saldado_por, prestamo.fecha_saldado = True, usuario.correo, ahora
    if prestamo.tipo == LAMINA:
        prestamo.kilos_devueltos, prestamo.devuelto_con = kilos_vuelven, "El mismo rollo"
    return prestamo


def _cerrar_si_no_salio(db: Session, prestamo: PrestamoEmpresa, usuario: Usuario) -> bool:
    """Préstamo anotado con una cotización: si todavía no ha salido, no se
    puede devolver; si la cotización se canceló sin salir, se cierra (True)."""
    if prestamo.apartado_id is None:
        return False
    estado = estado_de_cotizacion_prestada(db, {prestamo.apartado_id}).get(prestamo.apartado_id)
    if estado == "por_recoger":
        raise HTTPException(
            status_code=400,
            detail=f"Todavía no lo han recogido: la cotización {prestamo.numero_cotizacion} no ha salido. "
                   "Cuando vengan por él, dale Salida a la cotización; después podrás marcar la devolución.",
        )
    if estado == "cancelada":
        # Nunca salió (se canceló la cotización): se cierra sin tocar el inventario.
        prestamo.origen = DEVUELTO_POR_TERCERO
        prestamo.saldado, prestamo.saldado_por, prestamo.fecha_saldado = True, usuario.correo, datetime.now(timezone.utc)
        return True
    return False


def kilos_prestados(db: Session, prestamo: PrestamoEmpresa) -> float | None:
    """Kilos del rollo prestado según su etiqueta (si se prestó solo una
    parte de sus metros, la parte proporcional)."""
    from app.services.apartados import kilos_rollo

    if prestamo.tipo != LAMINA or not prestamo.referencia_rollo:
        return None
    rollo = (
        db.query(Rollo).filter(Rollo.bodega_id == prestamo.bodega_id, Rollo.identificador_rollo == prestamo.referencia_rollo).first()
        or db.query(Rollo).filter(Rollo.identificador_rollo == prestamo.referencia_rollo).first()
    )
    kilos = kilos_rollo(rollo.peso_neto) if rollo else None
    if not kilos:
        return None
    total = rollo.metros_proveedor or (rollo.metros_disponibles + rollo.metros_consumidos)
    if total > 0.5 and prestamo.cantidad < total - 0.5:
        return round(kilos * prestamo.cantidad / total, 1)
    return float(kilos)


def devolver_con_otro_rollo(
    db: Session, prestamo_id: int, *, codigo_interno: str, referencia: str, kilos: float, metros: float, usuario: Usuario,
) -> PrestamoEmpresa:
    """La empresa externa pagó el rollo prestado con OTRO rollo: ese rollo
    entra a la bodega del préstamo (de la empresa que prestó) y el préstamo
    queda devuelto, con los kilos que llegaron. La diferencia de kilos se ve
    en el cuadre: si devolvieron menos, se le factura."""
    prestamo = db.query(PrestamoEmpresa).filter(PrestamoEmpresa.id == prestamo_id).with_for_update().first()
    if prestamo is None or prestamo.origen != PRESTADO_A_TERCERO or prestamo.saldado:
        raise HTTPException(status_code=404, detail="Ese préstamo ya no está pendiente. Recarga la lista.")
    if prestamo.tipo != LAMINA:
        raise HTTPException(status_code=400, detail="Solo un rollo prestado se puede pagar con otro rollo.")
    if _cerrar_si_no_salio(db, prestamo, usuario):
        return prestamo
    codigo = " ".join((codigo_interno or "").split()).upper()
    referencia = " ".join((referencia or "").split()).upper()
    if not codigo or not referencia:
        raise HTTPException(status_code=400, detail="Escribe el código y la referencia del rollo que devolvieron.")
    if not (kilos and kilos > 0) or not (metros and metros > 0):
        raise HTTPException(status_code=400, detail="Escribe los kilos y los metros del rollo que devolvieron.")
    if db.query(Rollo.id).filter(Rollo.bodega_id == prestamo.bodega_id, Rollo.identificador_rollo == referencia).first():
        raise HTTPException(status_code=400, detail=f"Ya hay un rollo con la referencia {referencia} en esa bodega.")
    # Descripción, color, calibre y ancho: del rollo prestado si es el mismo código; si no, de otro rollo de ese código.
    plantilla = None
    if (prestamo.codigo or "").upper() == codigo:
        plantilla = db.query(Rollo).filter(Rollo.identificador_rollo == prestamo.referencia_rollo).first()
    plantilla = plantilla or db.query(Rollo).filter(Rollo.codigo_interno == codigo).order_by(Rollo.id.desc()).first()
    if plantilla is None:
        raise HTTPException(
            status_code=400,
            detail=f"No hay ningún rollo con el código {codigo} para saber su color y calibre. Revisa el código (ej. LR30020,25).",
        )
    metros = round(float(metros), 2)
    kilos = round(float(kilos), 1)
    ahora = datetime.now(timezone.utc)
    rollo = Rollo(
        bodega_id=prestamo.bodega_id, recepcion_id=None, codigo_interno=codigo, identificador_rollo=referencia,
        codigo_proveedor=plantilla.codigo_proveedor or "", descripcion=plantilla.descripcion, familia=plantilla.familia,
        color_material=plantilla.color_material, calibre=plantilla.calibre, ancho_material=plantilla.ancho_material,
        peso_neto=kilos, metros_proveedor=metros, metros_calculados=metros, metros_disponibles=metros, metros_consumidos=0,
        fecha_ingreso=ahora, proveedor=(prestamo.prestador or "")[:120], empresa=prestamo.empresa_presta,
        observaciones=f"Lo devolvió {prestamo.prestador} en pago del rollo prestado {prestamo.referencia_rollo} (préstamo #{prestamo.id}).",
    )
    rollo.recalcular_estado()
    db.add(rollo)
    db.flush()
    db.add(Movimiento(
        fecha=ahora, tipo=TipoMovimiento.ENTRADA, motivo=DEVUELTO_POR_TERCERO, producto_codigo=codigo,
        producto_descripcion=f"{rollo.descripcion} (rollo {referencia})", rollo_id=rollo.id, identificador_rollo=referencia,
        bodega_destino_id=prestamo.bodega_id, cantidad=metros, usuario=usuario.correo, empresa_externa=prestamo.prestador,
        observaciones=f"{prestamo.prestador} devolvió otro rollo ({referencia}, {kilos:g} kg) por el rollo prestado "
                      f"{prestamo.referencia_rollo} (préstamo #{prestamo.id}).",
    ))
    prestamo.origen = DEVUELTO_POR_TERCERO
    prestamo.saldado, prestamo.saldado_por, prestamo.fecha_saldado = True, usuario.correo, ahora
    prestamo.kilos_devueltos = kilos
    prestamo.devuelto_con = f"Rollo {referencia} ({codigo}) · {kilos:g} kg · {metros:g} m"[:255]
    return prestamo


def anotar_factura(db: Session, prestamo_id: int, factura: str) -> PrestamoEmpresa:
    """Factura (o soporte de pago) de la diferencia de kilos, cobrada o pagada (vacío = quitarla)."""
    prestamo = db.get(PrestamoEmpresa, prestamo_id)
    if prestamo is None or prestamo.empresa_recibe != PRESTADOR_EXTERNO or prestamo.tipo != LAMINA:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado. Recarga la lista.")
    prestamo.factura = " ".join((factura or "").split())[:60]
    prestamo.fecha_factura = datetime.now(timezone.utc) if prestamo.factura else None
    return prestamo


def cuadre_rollos_terceros(db: Session) -> list[dict]:
    """Cada rollo prestado a una empresa externa: kilos que se fueron, con qué
    lo devolvieron y cuántos kilos volvieron. Diferencia > 0 = devolvieron
    menos: se le factura ("por_facturar"). < 0 = devolvieron de más: les
    debemos esos kilos ("por_pagar") hasta anotar con qué se les pagó."""
    prestamos = (
        db.query(PrestamoEmpresa)
        .filter(PrestamoEmpresa.empresa_recibe == PRESTADOR_EXTERNO, PrestamoEmpresa.tipo == LAMINA,
                PrestamoEmpresa.origen.in_((PRESTADO_A_TERCERO, DEVUELTO_POR_TERCERO)))
        .order_by(PrestamoEmpresa.fecha.desc(), PrestamoEmpresa.id.desc()).all()
    )
    por_recoger = estado_de_cotizacion_prestada(
        db, {p.apartado_id for p in prestamos if p.apartado_id is not None and p.origen == PRESTADO_A_TERCERO})
    filas = []
    for p in prestamos:
        prestados = kilos_prestados(db, p)
        devuelto = p.origen == DEVUELTO_POR_TERCERO
        diferencia = None
        if devuelto and prestados is not None and p.kilos_devueltos is not None:
            diferencia = round(prestados - p.kilos_devueltos, 1)
        if not devuelto:
            estado = por_recoger.get(p.apartado_id, "pendiente") if p.apartado_id is not None else "pendiente"
        elif not p.devuelto_con:
            estado = "cerrado"  # cotización cancelada, o devuelto antes de este cuadre
        elif diferencia is None:
            estado = "sin_kilos"
        elif abs(diferencia) < 1:
            estado = "cuadrado"
        elif diferencia < 0:
            # Devolvieron más kilos de los prestados: les debemos la diferencia.
            estado = "pagado" if p.factura else "por_pagar"
        else:
            estado = "facturado" if p.factura else "por_facturar"
        filas.append({
            "id": p.id, "fecha": p.fecha, "prestador": p.prestador, "numero_cotizacion": p.numero_cotizacion or "",
            "bodega_id": p.bodega_id, "empresa_presta": p.empresa_presta, "codigo": p.codigo,
            "referencia_rollo": p.referencia_rollo, "metros": p.cantidad, "kilos_prestados": prestados,
            "devuelto_con": p.devuelto_con or "", "kilos_devueltos": p.kilos_devueltos,
            "fecha_devuelto": p.fecha_saldado if devuelto else None,
            "diferencia": diferencia, "estado": estado, "factura": p.factura or "", "fecha_factura": p.fecha_factura,
        })
    return filas

def _devolver_al_rollo(db: Session, prestamo: PrestamoEmpresa, metros: float, usuario: Usuario) -> None:
    """Vuelve el mismo rollo: recupera los metros que trae, en su bodega."""
    rollo = (
        db.query(Rollo)
        .filter(Rollo.bodega_id == prestamo.bodega_id, Rollo.identificador_rollo == prestamo.referencia_rollo)
        .with_for_update().first()
    )
    if rollo is None:
        raise HTTPException(status_code=404, detail=f"No encuentro el rollo {prestamo.referencia_rollo} en su bodega.")
    metros = min(metros, round(rollo.metros_consumidos, 2))
    rollo.metros_disponibles = round(rollo.metros_disponibles + metros, 2)
    rollo.metros_consumidos = round(rollo.metros_consumidos - metros, 2)
    rollo.recalcular_estado()
    db.add(Movimiento(
        fecha=datetime.now(timezone.utc), tipo=TipoMovimiento.ENTRADA, motivo=DEVUELTO_POR_TERCERO,
        producto_codigo=rollo.codigo_interno, producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
        rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo, bodega_destino_id=rollo.bodega_id,
        cantidad=metros, usuario=usuario.correo, empresa_externa=prestamo.prestador,
        observaciones=f"{prestamo.prestador} devolvió el rollo prestado (préstamo #{prestamo.id}).",
    ))


def _devolver_al_stock(db: Session, prestamo: PrestamoEmpresa, cantidad: float, usuario: Usuario) -> None:
    producto = (
        db.query(Producto)
        .filter(Producto.bodega_id == prestamo.bodega_id, Producto.codigo == prestamo.codigo,
                Producto.empresa == prestamo.empresa_presta)
        .with_for_update().first()
    )
    if producto is not None:
        producto.stock += Decimal(str(cantidad))
    else:
        from app.services.productos import nuevo_producto_en_bodega

        plantilla = (
            db.query(Producto).filter(Producto.codigo == prestamo.codigo, Producto.empresa == prestamo.empresa_presta)
            .order_by(Producto.id).first()
        )
        db.add(nuevo_producto_en_bodega(plantilla, bodega_id=prestamo.bodega_id, cantidad=cantidad) if plantilla else Producto(
            bodega_id=prestamo.bodega_id, codigo=prestamo.codigo, descripcion=prestamo.descripcion,
            empresa=prestamo.empresa_presta, entrada=cantidad, stock=cantidad,
        ))
    db.add(Movimiento(
        fecha=datetime.now(timezone.utc), tipo=TipoMovimiento.ENTRADA, motivo=DEVUELTO_POR_TERCERO,
        producto_codigo=prestamo.codigo, producto_descripcion=prestamo.descripcion, bodega_destino_id=prestamo.bodega_id,
        cantidad=cantidad, usuario=usuario.correo, empresa_externa=prestamo.prestador,
        observaciones=f"{prestamo.prestador} devolvió lo prestado (préstamo #{prestamo.id}).",
    ))


def listar(
    db: Session, *, empresa: str = "", bodega_id: int | None = None, desde: datetime | None = None,
    hasta: datetime | None = None, incluir_saldados: bool = False,
) -> list[PrestamoEmpresa]:
    consulta = db.query(PrestamoEmpresa)
    if empresa:
        consulta = consulta.filter((PrestamoEmpresa.empresa_presta == empresa) | (PrestamoEmpresa.empresa_recibe == empresa))
    if bodega_id is not None:
        consulta = consulta.filter(PrestamoEmpresa.bodega_id == bodega_id)
    if desde is not None:
        consulta = consulta.filter(PrestamoEmpresa.fecha >= desde)
    if hasta is not None:
        consulta = consulta.filter(PrestamoEmpresa.fecha < hasta)
    if not incluir_saldados:
        consulta = consulta.filter(PrestamoEmpresa.saldado.is_(False))
    return consulta.order_by(PrestamoEmpresa.fecha.desc(), PrestamoEmpresa.id.desc()).all()


def resumen(prestamos: list[PrestamoEmpresa]) -> list[dict]:
    """Lo que se deben, por material: lo que una empresa le prestó a la otra
    menos lo que la otra le prestó a ella del mismo código (solo sin saldar).
    "debe" es la empresa que recibió de más."""
    # (tipo, código, unidad) -> {(presta, recibe): cantidad}
    por_codigo: dict[tuple[str, str, str], dict[tuple[str, str], float]] = {}
    descripciones: dict[tuple[str, str, str], str] = {}
    # Rollos de cada material y par, con los kilos con que llegaron (la ruta pone kilos_rollo).
    rollos: dict[tuple, dict[str, int | None]] = {}
    for p in prestamos:
        if p.saldado:
            continue
        clave = (p.tipo, p.codigo, p.unidad)
        pares = por_codigo.setdefault(clave, {})
        # Un tercero va por su nombre: lo que se le debe no se cruza con nadie más.
        par = (nombre_presta(p), nombre_recibe(p))
        pares[par] = pares.get(par, 0) + p.cantidad
        if p.referencia_rollo:
            rollos.setdefault((clave, par), {})[p.referencia_rollo] = getattr(p, "kilos_rollo", None)
        descripciones[clave] = descripciones.get(clave) or p.descripcion
    filas = []
    for (tipo, codigo, unidad), pares in por_codigo.items():
        vistos: set[tuple[str, str]] = set()
        for (presta, recibe), cantidad in pares.items():
            if (recibe, presta) in vistos:
                continue
            vistos.add((presta, recibe))
            neto = round(cantidad - pares.get((recibe, presta), 0), 2)
            if abs(neto) <= 0.005:
                continue
            acreedora, deudora = (presta, recibe) if neto > 0 else (recibe, presta)
            de_la_fila = rollos.get(((tipo, codigo, unidad), (acreedora, deudora)), {})
            filas.append({"tipo": tipo, "codigo": codigo, "descripcion": descripciones[(tipo, codigo, unidad)],
                          "unidad": unidad, "presta": acreedora, "debe": deudora, "cantidad": abs(neto),
                          "rollos": [{"referencia": ref, "kilos": kilos} for ref, kilos in sorted(de_la_fila.items())]})
    return sorted(filas, key=lambda f: (f["debe"], f["tipo"], f["codigo"]))


def saldar(db: Session, ids: list[int], usuario: Usuario) -> int:
    """Marca como saldados los préstamos indicados (los ya saldados se dejan igual)."""
    if not ids:
        raise HTTPException(status_code=400, detail="Escoge al menos un préstamo para saldar.")
    prestamos = db.query(PrestamoEmpresa).filter(PrestamoEmpresa.id.in_(set(ids))).with_for_update().all()
    if len(prestamos) != len(set(ids)):
        raise HTTPException(status_code=404, detail="Alguno de esos préstamos ya no existe. Recarga e intenta de nuevo.")
    ahora = datetime.now(timezone.utc)
    cambiados = 0
    for p in prestamos:
        if not p.saldado:
            p.saldado, p.saldado_por, p.fecha_saldado = True, usuario.correo, ahora
            cambiados += 1
    return cambiados
