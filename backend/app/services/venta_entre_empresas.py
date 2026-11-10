"""Ventas entre Arquitejas y Asia Business (comparten las bodegas).

Cuando una empresa le vende a la otra, la cotización se hace como cualquier
otra, con la otra empresa de cliente. Al salir el material de esa cotización
no se va de la bodega, solo cambia de dueño:
- un producto de stock sale de la empresa que vende y entra, en la misma
  bodega, al mismo producto de la empresa que compra (si no existe, se crea);
- un rollo completo no se gasta: queda en la bodega, ahora de la que compra.
Así no hay que volverle a dar entrada a mano a lo comprado.
"""

import re
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.apartado import Apartado
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.services.empresas import EMPRESAS_CONOCIDAS
from app.services.productos import nuevo_producto_en_bodega

MOTIVO_COMPRA_OTRA_EMPRESA = "compra_otra_empresa"


def empresa_compradora(apartado: Apartado) -> str:
    """"AR" o "ABG" si el cliente de la cotización es una de las dos empresas;
    "" si es un cliente cualquiera. Se exige el nombre completo ("Asia
    Business...", "Arquitejas...") para no confundir un cliente que solo
    empiece por "Asia"."""
    if apartado.orden_interna:
        return ""
    nombre = re.sub(r"[^A-Z]", "", unicodedata.normalize("NFD", apartado.cliente or "").upper())
    if nombre.startswith("ARQUITEJAS"):
        return "AR"
    if nombre.startswith("ASIABUSINESS"):
        return "ABG"
    return ""


def _vende_a_la_otra(apartado: Apartado, empresa_material: str | None) -> str:
    """La empresa que compra, si el material es de la otra; si no, ""."""
    compra = empresa_compradora(apartado)
    vende = (empresa_material or "").strip().upper()
    return compra if compra and vende and vende != compra else ""


def pasar_producto_a_compradora(
    db: Session, *, apartado: Apartado, producto: Producto, cantidad: float, usuario: Usuario,
    fecha: datetime | None = None,
) -> Producto | None:
    """Le da entrada a la empresa que compra de lo que acaba de salir de la
    que vende (llamar después de descontar el stock). None si no es una venta
    entre las dos empresas."""
    compra = _vende_a_la_otra(apartado, producto.empresa)
    if not compra or cantidad <= 0.005:
        return None
    destino = (
        db.query(Producto)
        .filter(Producto.bodega_id == apartado.bodega_id, Producto.codigo == producto.codigo,
                Producto.empresa == compra, Producto.calidad == producto.calidad)
        .with_for_update().first()
    )
    if destino is None:
        destino = nuevo_producto_en_bodega(producto, bodega_id=apartado.bodega_id, cantidad=0)
        destino.empresa = compra
        destino.stock_minimo = None
        db.add(destino)
        db.flush()
    destino.stock = Decimal(str(destino.stock or 0)) + Decimal(str(cantidad))
    destino.entrada = Decimal(str(destino.entrada or 0)) + Decimal(str(cantidad))
    db.add(Movimiento(
        fecha=fecha or datetime.now(timezone.utc), tipo=TipoMovimiento.ENTRADA, motivo=MOTIVO_COMPRA_OTRA_EMPRESA,
        producto_codigo=destino.codigo, producto_descripcion=destino.descripcion,
        bodega_origen_id=None, bodega_destino_id=apartado.bodega_id, cantidad=cantidad, usuario=usuario.correo,
        observaciones=(f"{EMPRESAS_CONOCIDAS.get(compra, compra)} se lo compró a "
                       f"{EMPRESAS_CONOCIDAS.get(producto.empresa, producto.empresa)} con la cotización {apartado.numero_cotizacion}."),
        cotizacion=apartado.numero_cotizacion,
    ))
    return destino


def pasar_rollo_a_compradora(
    db: Session, *, apartado: Apartado, rollo: Rollo, usuario: Usuario, fecha: datetime | None = None,
) -> bool:
    """Rollo completo vendido a la otra empresa: no se gasta, cambia de dueño
    y sigue en la bodega con sus metros. False si no es una venta entre las
    dos empresas (entonces sale como siempre)."""
    vende = rollo.empresa or ""
    compra = _vende_a_la_otra(apartado, vende)
    if not compra:
        return False
    rollo.empresa = compra
    db.add(Movimiento(
        fecha=fecha or datetime.now(timezone.utc), tipo=TipoMovimiento.ENTRADA, motivo=MOTIVO_COMPRA_OTRA_EMPRESA,
        producto_codigo=rollo.codigo_interno, producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})",
        rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo,
        bodega_origen_id=None, bodega_destino_id=apartado.bodega_id, cantidad=rollo.metros_disponibles,
        usuario=usuario.correo,
        observaciones=(f"Rollo vendido: ahora es de {EMPRESAS_CONOCIDAS.get(compra, compra)} "
                       f"(era de {EMPRESAS_CONOCIDAS.get(vende, vende)}). Cotización {apartado.numero_cotizacion}."),
        cotizacion=apartado.numero_cotizacion,
    ))
    return True
