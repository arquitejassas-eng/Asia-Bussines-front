"""Reglas de negocio transaccionales para entradas, salidas y traslados."""

from datetime import datetime, timezone
from decimal import Decimal
from secrets import token_hex

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import coincide_bodega
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.usuario import Usuario
from app.schemas.inventario import MovimientoCrear
from app.services.apartados import validar_reserva_producto
from app.services.unidades_familia import validar_cantidad_entera_si_aplica


def _decimal(valor: float | Decimal) -> Decimal:
    return Decimal(str(valor))


def _producto_existente(db: Session, producto_id: int, usuario: Usuario) -> Producto | None:
    return (
        db.query(Producto)
        .filter(Producto.id == producto_id, coincide_bodega(Producto.bodega_id, usuario.bodega_id))
        .with_for_update()
        .first()
    )


def _valor_tras_edicion(producto: Producto, campo: str, nombre: str, nuevo: float, anterior: float | None) -> Decimal:
    """Qué valor de `campo` (stock o entrada) debe quedar al editar el
    producto. El formulario manda también el valor que vio al abrirse
    (`anterior`):
    - si el usuario no lo tocó, se conserva el ACTUAL (aunque una venta o
      una carga lo haya cambiado mientras el formulario estaba abierto);
    - si lo cambió, pero alguien más también lo movió mientras tanto, se
      rechaza en vez de pisar ese cambio.
    Sin `anterior` (cliente viejo) se usa el valor enviado, como antes."""
    actual = _decimal(getattr(producto, campo) or 0)
    if anterior is None:
        return _decimal(nuevo)
    if abs(_decimal(nuevo) - _decimal(anterior)) <= Decimal("0.005"):
        return actual
    if abs(actual - _decimal(anterior)) > Decimal("0.005"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"El {nombre} de {producto.codigo} cambió mientras editabas: ahora es {float(actual):g} "
                f"(cuando abriste el formulario era {float(anterior):g}). Revisa el valor y vuelve a guardar."
            ),
        )
    return _decimal(nuevo)


def aplicar_stock_editado(
    db: Session, producto: Producto, *, stock: float, stock_anterior: float | None,
    entrada: float, entrada_anterior: float | None, usuario: Usuario,
) -> None:
    """Aplica stock y entrada al editar un producto (ya bloqueado) sin pisar
    movimientos ajenos. Si el stock cambia de verdad, es un AJUSTE manual:
    no puede quedar por debajo de lo apartado y queda en el historial como
    una entrada o salida con motivo "ajuste" -- antes cambiaba sin rastro."""
    stock_final = _valor_tras_edicion(producto, "stock", "stock", stock, stock_anterior)
    entrada_final = _valor_tras_edicion(producto, "entrada", "total de entradas", entrada, entrada_anterior)
    stock_actual = _decimal(producto.stock or 0)
    diferencia = stock_final - stock_actual
    if abs(diferencia) > Decimal("0.005"):
        if diferencia < 0:
            validar_reserva_producto(db, producto=producto, cantidad=-diferencia)
        entra = diferencia > 0
        db.add(Movimiento(
            fecha=datetime.now(timezone.utc), tipo=TipoMovimiento.ENTRADA if entra else TipoMovimiento.SALIDA,
            motivo="ajuste", producto_codigo=producto.codigo, producto_descripcion=producto.descripcion,
            bodega_origen_id=None if entra else producto.bodega_id,
            bodega_destino_id=producto.bodega_id if entra else None,
            cantidad=float(abs(diferencia)), usuario=usuario.correo,
            observaciones=f"Ajuste manual al editar el producto: stock {float(stock_actual):g} → {float(stock_final):g}.",
        ))
    producto.stock = stock_final
    producto.entrada = entrada_final


def registrar_movimiento(db: Session, datos: MovimientoCrear, usuario: Usuario) -> Movimiento:
    """Aplica la regla completa, sin hacer commit para permitir composicion."""
    cantidad = _decimal(datos.cantidad)
    if cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero.")

    if usuario.bodega_id is None and datos.tipo == TipoMovimiento.TRASLADO:
        # TRASLADO empuja stock directo a otra bodega sin que esta lo confirme
        # (comportamiento ya existente entre sedes). Para Admin Inventario eso
        # se saltaría el flujo de Envíos (que sí exige confirmación de la sede
        # destino antes de mover nada) — se bloquea a propósito.
        raise HTTPException(
            status_code=400,
            detail="Admin Inventario no traslada directo a una sede; usa /envios para que la sede confirme la llegada.",
        )

    # Una entrada manual puede crear el producto en la misma transaccion.
    producto_nuevo = datos.tipo == TipoMovimiento.ENTRADA and datos.producto_id is None
    if producto_nuevo:
        codigo = datos.codigo.strip()
        descripcion = datos.descripcion.strip()
        if not codigo or not descripcion:
            raise HTTPException(status_code=400, detail="Para un producto nuevo indica codigo y descripcion.")
        existente = (
            db.query(Producto)
            .filter(coincide_bodega(Producto.bodega_id, usuario.bodega_id), Producto.codigo == codigo)
            .with_for_update()
            .first()
        )
        if existente:
            raise HTTPException(status_code=409, detail="Ese codigo ya existe. Selecciona el producto para registrar la entrada.")
        producto = Producto(
            bodega_id=usuario.bodega_id,
            codigo_importacion=datos.codigo_importacion.strip(),
            codigo=codigo,
            descripcion=descripcion,
            familia=datos.familia.strip(),
            calibre=datos.calibre.strip(),
            entrada=cantidad,
            stock=cantidad,
        )
        db.add(producto)
        db.flush()
    else:
        if datos.producto_id is None:
            raise HTTPException(status_code=400, detail="Selecciona un producto.")
        producto = _producto_existente(db, datos.producto_id, usuario)
        if producto is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado.")

    validar_cantidad_entera_si_aplica(db, producto.familia, datos.cantidad)

    if datos.tipo == TipoMovimiento.TRASLADO and not datos.bodega_destino_id:
        raise HTTPException(status_code=400, detail="Selecciona a que bodega se traslada el material.")
    if datos.tipo in (TipoMovimiento.SALIDA, TipoMovimiento.TRASLADO):
        if cantidad > producto.stock:
            raise HTTPException(status_code=400, detail="La cantidad supera el stock disponible.")
        # Las unidades apartadas para una cotización no se pueden vender ni trasladar.
        validar_reserva_producto(db, producto=producto, cantidad=cantidad)

    origen: int | None = usuario.bodega_id
    destino: int | None = usuario.bodega_id
    if datos.tipo == TipoMovimiento.ENTRADA:
        if not producto_nuevo:
            producto.stock += cantidad
            producto.entrada += cantidad
        origen = None
    elif datos.tipo == TipoMovimiento.SALIDA:
        producto.stock -= cantidad
        destino = None
    elif datos.tipo == TipoMovimiento.TRASLADO:
        producto.stock -= cantidad
        destino = datos.bodega_destino_id
        producto_destino = (
            db.query(Producto)
            .filter(Producto.codigo == producto.codigo, Producto.bodega_id == destino)
            .with_for_update()
            .first()
        )
        if producto_destino:
            producto_destino.stock += cantidad
            producto_destino.entrada += cantidad
        else:
            db.add(Producto(
                bodega_id=destino, codigo_importacion=producto.codigo_importacion, codigo=producto.codigo,
                descripcion=producto.descripcion, familia=producto.familia, calibre=producto.calibre,
                entrada=cantidad, stock=cantidad,
            ))

    movimiento = Movimiento(
        fecha=datetime.now(timezone.utc), tipo=datos.tipo, motivo=datos.motivo,
        producto_codigo=producto.codigo, producto_descripcion=producto.descripcion,
        bodega_origen_id=origen, bodega_destino_id=destino, cantidad=datos.cantidad,
        usuario=usuario.correo, observaciones=datos.observaciones,
        cotizacion=f"COT-{datetime.now(timezone.utc):%Y}-{token_hex(4).upper()}" if datos.tipo == TipoMovimiento.SALIDA else "",
    )
    db.add(movimiento)
    return movimiento
