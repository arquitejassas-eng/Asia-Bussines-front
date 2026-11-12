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
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario
from app.services.clasificacion import peso_actual_toneladas
from app.services.apartados import EMPRESA_DE_LINEA, ESTADOS_RESERVA_ACTIVA
from app.services.empresas import AMBAS_EMPRESAS
from app.models.solicitud import ESTADOS_TRASLADO_EN_CURSO, Solicitud
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


@router.get("/rollos-apartados")
def metros_apartados_de_rollos(db: Session = Depends(get_db)) -> list[dict]:
    """Metros apartados por código, bodega y empresa (cotizaciones activas que
    piden metros de un código, no un rollo en particular): lo que no está
    libre para vender aunque los rollos digan "Sin usar". Las líneas sin
    empresa o de "las dos empresas" cuentan para las dos (como al validar)."""
    bodegas = _nombres_bodegas(db)
    filas = (
        db.query(ApartadoItem.codigo_interno, Apartado.bodega_id, EMPRESA_DE_LINEA, Apartado.numero_cotizacion,
                 ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos)
        .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
        .filter(ApartadoItem.modalidad == ModalidadApartado.POR_ROLLO, ApartadoItem.rollo_id.is_(None),
                ApartadoItem.codigo_interno.isnot(None), Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
                ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos > 0.005)
    )
    grupos: dict[tuple, dict] = {}
    for codigo, bodega_id, empresa, numero, pendientes in filas:
        empresas = ("AR", "ABG") if (empresa or "") in ("", AMBAS_EMPRESAS) else (empresa,)
        for emp in empresas:
            clave = (codigo, emp, bodega_id)
            g = grupos.setdefault(clave, {"codigo": codigo, "empresa": emp, "bodega": bodegas.get(bodega_id, SIN_BODEGA),
                                          "metros_apartados": 0.0, "cotizaciones": []})
            g["metros_apartados"] = round(g["metros_apartados"] + float(pendientes or 0), 2)
            if numero not in g["cotizaciones"]:
                g["cotizaciones"].append(numero)
    return list(grupos.values())


@router.get("/rollos")
def rollos_con_importacion(db: Session = Depends(get_db)) -> list[dict]:
    """Todos los rollos (también los agotados) y los que vienen en camino,
    cada uno con su importación."""
    bodegas = _nombres_bodegas(db)
    espesores = {e.espesor: e for e in db.query(TablaEspesorEquivalencia).all()}
    # Rollos vendidos completos en una cotización activa y rollos que van en un
    # traslado: no se pueden ofrecer para otra venta aunque digan "Sin usar".
    apartados_completos = {
        rollo_id: f"{numero}{f' ({cliente})' if cliente else ''}"
        for rollo_id, numero, cliente in (
            db.query(ApartadoItem.rollo_id, Apartado.numero_cotizacion, Apartado.cliente)
            .join(Apartado, Apartado.id == ApartadoItem.apartado_id)
            .filter(ApartadoItem.rollo_id.isnot(None), Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA),
                    ApartadoItem.metros_requeridos - ApartadoItem.metros_consumidos > 0.005)
        )
    }
    en_traslado = {
        rollo_id: bodegas.get(destino, "otra bodega")
        for rollo_id, destino in db.query(Solicitud.rollo_id, Solicitud.bodega_solicitante_id)
        .filter(Solicitud.rollo_id.isnot(None), Solicitud.estado.in_(ESTADOS_TRASLADO_EN_CURSO))
    }
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
            "apartado_completo": apartados_completos.get(r.id, ""),
            "en_traslado_a": en_traslado.get(r.id, ""),
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
