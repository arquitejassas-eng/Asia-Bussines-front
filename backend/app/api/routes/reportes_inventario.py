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
from app.models.material_en_camino import Cargamento, CargamentoRollo
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario
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
    filas = []
    for r in db.query(Rollo).order_by(Rollo.identificador_rollo):
        disponibles = float(r.metros_disponibles or 0)
        consumidos = float(r.metros_consumidos or 0)
        filas.append({
            "importacion": importacion_de(r.lote, r.identificador_rollo),
            "referencia": r.identificador_rollo, "codigo": r.codigo_interno, "descripcion": r.descripcion,
            "empresa": r.empresa or "", "color": r.color_material or "", "calibre": float(r.calibre or 0),
            "kilos": r.peso_neto, "metros_llegada": round(float(r.metros_proveedor or 0) or (disponibles + consumidos), 2),
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
            "bodega": "En camino", "estado": "en_camino", "fecha_ingreso": cargamento.fecha_creacion,
            "proveedor": r.proveedor or cargamento.proveedor or "",
        })
    return filas
