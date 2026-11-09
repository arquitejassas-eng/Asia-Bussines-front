"""Reportes de existencias (solo lectura): cuánto hay de cada tipo de
producto (UPVC, tornillos, tejas, rollos...) y qué rollos trajo cada
importación. Devuelve filas planas; la página agrupa, filtra y exporta."""
import re

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, requiere_rol
from app.models.apartado import Apartado, ApartadoItem, ModalidadApartado
from app.models.bodega import Bodega
from app.models.equivalencias import TablaEspesorEquivalencia
from app.models.material_en_camino import Cargamento, CargamentoRollo
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario
from app.services.clasificacion import peso_actual_toneladas
from app.services.apartados import ESTADOS_RESERVA_ACTIVA
from app.services.material_en_camino import EN_CAMINO

router = APIRouter(
    prefix="/reportes-inventario", tags=["Reportes de inventario"],
    dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO, RolUsuario.SUPERADMIN))],
)

# Material de Admin Inventario que todavía no se ha repartido a una sede.
SIN_BODEGA = "Admin Inventario (por repartir)"

# "17ABGLR30020,24-01" → "17ABG": la referencia empieza con el número de la
# importación y la empresa (los rollos cargados antes de usar el Lote).
_PREFIJO_IMPORTACION = re.compile(r"^\s*(\d+)\s*(ABG|AR)", re.IGNORECASE)


def importacion_de(lote: str | None, referencia: str | None) -> str:
    """El Lote (número de importación elegido al subir el Excel) o, si está
    vacío, el prefijo de la referencia. "" = no se sabe de qué importación es."""
    if lote and lote.strip():
        return lote.strip().upper()
    encontrado = _PREFIJO_IMPORTACION.match(referencia or "")
    return f"{int(encontrado.group(1))}{encontrado.group(2).upper()}" if encontrado else ""


def _kilos(toneladas: float | None) -> float | None:
    return None if toneladas is None else round(toneladas * 1000, 1)


def _nombres_bodegas(db: Session) -> dict[int, str]:
    return {b.id: b.nombre for b in db.query(Bodega).all()}


@router.get("/productos")
def existencias_productos(db: Session = Depends(get_db)) -> list[dict]:
    """Stock de cada producto (no rollos) en cada sede y en Admin
    Inventario, con lo apartado en cotizaciones activas."""
    bodegas = _nombres_bodegas(db)
    apartado = {
        (producto_id, bodega_id): float(total or 0)
        for producto_id, bodega_id, total in (
            db.query(ApartadoItem.producto_id, Apartado.bodega_id, func.sum(ApartadoItem.cantidad))
            .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
            .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), ApartadoItem.modalidad == ModalidadApartado.POR_STOCK,
                    ApartadoItem.stock_descontado.is_(False), ApartadoItem.hay_fisico.is_(False),
                    ApartadoItem.producto_id.isnot(None))
            .group_by(ApartadoItem.producto_id, Apartado.bodega_id)
        )
    }
    filas = []
    for p in db.query(Producto).filter(Producto.familia != "Rollos de acero").order_by(Producto.familia, Producto.codigo):
        stock = float(p.stock or 0)
        reservado = apartado.get((p.id, p.bodega_id), 0.0)
        if stock == 0 and reservado == 0:
            continue
        filas.append({
            "codigo": p.codigo, "descripcion": p.descripcion, "familia": (p.familia or "").strip() or "SIN FAMILIA",
            "empresa": p.empresa or "", "bodega": bodegas.get(p.bodega_id, SIN_BODEGA) if p.bodega_id else SIN_BODEGA,
            "stock": round(stock, 2), "apartado": round(reservado, 2), "libre": round(stock - reservado, 2),
        })
    return filas


@router.get("/rollos")
def rollos_con_importacion(db: Session = Depends(get_db)) -> list[dict]:
    """Todos los rollos (también los agotados) y los que vienen en camino,
    cada uno con su importación."""
    bodegas = _nombres_bodegas(db)
    espesores = {e.espesor: e for e in db.query(TablaEspesorEquivalencia).all()}
    filas = []
    for r in db.query(Rollo).order_by(Rollo.identificador_rollo):
        disponibles = float(r.metros_disponibles or 0)
        consumidos = float(r.metros_consumidos or 0)
        filas.append({
            "importacion": importacion_de(r.lote, r.identificador_rollo),
            "referencia": r.identificador_rollo, "codigo": r.codigo_interno, "descripcion": r.descripcion,
            "empresa": r.empresa or "", "color": r.color_material or "", "calibre": float(r.calibre or 0),
            "kilos": r.peso_neto, "metros_llegada": round(float(r.metros_proveedor or 0) or (disponibles + consumidos), 2),
            # Lo que pesa HOY según los metros que le quedan (None si su calibre
            # no está en la tabla de equivalencias).
            "kilos_actuales": _kilos(peso_actual_toneladas(r.calibre, disponibles, espesores)),
            "metros_disponibles": round(disponibles, 2),
            "bodega": bodegas.get(r.bodega_id, SIN_BODEGA) if r.bodega_id else SIN_BODEGA,
            "estado": r.estado.value if hasattr(r.estado, "value") else str(r.estado),
            "fecha_ingreso": r.fecha_ingreso, "proveedor": r.proveedor or "",
        })
    en_camino = (
        db.query(CargamentoRollo, Cargamento)
        .join(Cargamento, Cargamento.id == CargamentoRollo.cargamento_id)
        .filter(Cargamento.estado == EN_CAMINO, CargamentoRollo.llego.is_(False))
    )
    for r, cargamento in en_camino:
        filas.append({
            "importacion": importacion_de(r.lote, r.identificador_rollo),
            "referencia": r.identificador_rollo, "codigo": r.codigo_interno, "descripcion": r.descripcion,
            "empresa": r.empresa or "", "color": r.color_material or "", "calibre": float(r.calibre or 0),
            "kilos": r.peso_neto, "metros_llegada": round(float(r.metros or 0), 2), "metros_disponibles": round(float(r.metros or 0), 2),
            "kilos_actuales": r.peso_neto,
            "bodega": "En camino", "estado": "en_camino", "fecha_ingreso": cargamento.fecha_creacion,
            "proveedor": r.proveedor or cargamento.proveedor or "",
        })
    return filas


@router.get("/producto")
def historia_producto(codigo: str, db: Session = Depends(get_db)) -> dict:
    """Todo lo de un código de producto (ej. CPA) en todas las bodegas y las
    dos empresas: con cuánto se cargó (la "entrada" del Excel o de cuando se
    creó), en qué cotizaciones salió, en cuáles está reservado, los demás
    movimientos (entradas, ajustes, traslados) y cuánto hay hoy."""
    codigo = codigo.strip().upper()
    productos = {p.id: p for p in db.query(Producto).filter(func.upper(Producto.codigo) == codigo)} if codigo else {}
    if not productos:
        return {"codigo": codigo, "existe": False}
    bodegas = _nombres_bodegas(db)
    nombre_bodega = lambda bodega_id: bodegas.get(bodega_id, SIN_BODEGA) if bodega_id else SIN_BODEGA  # noqa: E731
    movimientos = (db.query(Movimiento).filter(func.upper(Movimiento.producto_codigo) == codigo)
                   .order_by(Movimiento.fecha).all())
    # Fecha de la salida de cada cotización en cada bodega (la del movimiento).
    fecha_salida = {(m.cotizacion, m.bodega_origen_id): m.fecha for m in movimientos
                    if m.tipo == TipoMovimiento.SALIDA and m.motivo == "apartado_stock"}

    salidas, reservas = [], []
    lineas = (db.query(ApartadoItem, Apartado).join(Apartado, Apartado.id == ApartadoItem.apartado_id)
              .filter(ApartadoItem.producto_id.in_(productos), ApartadoItem.modalidad == ModalidadApartado.POR_STOCK)
              .order_by(Apartado.fecha_creacion))
    for item, apartado in lineas:
        producto = productos[item.producto_id]
        fila = {
            "cotizacion": apartado.numero_cotizacion, "cliente": apartado.cliente or "",
            "empresa": producto.empresa or "", "bodega": nombre_bodega(apartado.bodega_id),
            "cantidad": float(item.cantidad or 0), "estado": apartado.estado.value,
        }
        if item.stock_descontado:
            salidas.append({**fila, "fecha": fecha_salida.get((apartado.numero_cotizacion, apartado.bodega_id))
                            or apartado.fecha_entregado, "sin_existencia": bool(item.hay_fisico)})
        elif apartado.estado in ESTADOS_RESERVA_ACTIVA and not item.hay_fisico:
            reservas.append({**fila, "fecha": apartado.fecha_creacion})

    # Con cuánto quedó al cargarlo al programa: el stock de hoy menos todo lo
    # que entró y salió de esa bodega desde entonces. Los movimientos no dicen
    # la empresa: si las dos tienen el código en la misma bodega, se calcula
    # entre las dos (al_cargar va en None y sale en bodegas_compartidas).
    neto: dict[int | None, float] = {}
    for m in movimientos:
        if m.bodega_destino_id:
            neto[m.bodega_destino_id] = neto.get(m.bodega_destino_id, 0.0) + float(m.cantidad or 0)
        if m.bodega_origen_id:
            neto[m.bodega_origen_id] = neto.get(m.bodega_origen_id, 0.0) - float(m.cantidad or 0)
    por_id_bodega: dict[int | None, list[Producto]] = {}
    for p in productos.values():
        por_id_bodega.setdefault(p.bodega_id, []).append(p)
    compartidas = [{"bodega": nombre_bodega(b), "al_cargar": round(sum(float(p.stock or 0) for p in ps) - neto.get(b, 0.0), 2)}
                   for b, ps in por_id_bodega.items() if len(ps) > 1]

    por_bodega = []
    for p in sorted(productos.values(), key=lambda p: (p.empresa or "", nombre_bodega(p.bodega_id))):
        bodega = nombre_bodega(p.bodega_id)
        sola = len(por_id_bodega[p.bodega_id]) == 1
        por_bodega.append({
            "empresa": p.empresa or "", "bodega": bodega, "inicial": float(p.entrada or 0),
            "al_cargar": round(float(p.stock or 0) - neto.get(p.bodega_id, 0.0), 2) if sola else None,
            "salio": round(sum(s["cantidad"] for s in salidas if s["empresa"] == (p.empresa or "") and s["bodega"] == bodega), 2),
            "reservado": round(sum(r["cantidad"] for r in reservas if r["empresa"] == (p.empresa or "") and r["bodega"] == bodega), 2),
            "stock": float(p.stock or 0),
        })
    otros = [{
        "fecha": m.fecha, "tipo": m.tipo.value, "motivo": m.motivo or "", "cantidad": float(m.cantidad or 0),
        "bodega_origen": nombre_bodega(m.bodega_origen_id) if m.bodega_origen_id else "",
        "bodega_destino": nombre_bodega(m.bodega_destino_id) if m.bodega_destino_id else "",
        "cotizacion": m.cotizacion or "", "usuario": m.usuario or "", "observaciones": m.observaciones or "",
    } for m in movimientos if not (m.tipo == TipoMovimiento.SALIDA and m.motivo == "apartado_stock")]
    primero = next(iter(productos.values()))
    return {"codigo": primero.codigo, "descripcion": primero.descripcion, "existe": True,
            "por_bodega": por_bodega, "bodegas_compartidas": compartidas, "salidas": salidas, "reservas": reservas, "otros_movimientos": otros}
