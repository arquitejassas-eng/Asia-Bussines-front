from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario, Usuario
from app.schemas.prestamos import (
    DevolverATerceroRequest, DevolverConOtroRolloRequest, DevolverDeTerceroRequest, FacturaPrestamoRequest, PrestamoResponse, PrestarATerceroRequest, PrestarDesdeCotizacionRequest,
    ReportePrestamosResponse, SaldarPrestamosRequest,
)
from app.services import prestamos as srv
from app.services.apartados import MOTIVO_SACADO_SIN_EXISTENCIA, kilos_rollo

router = APIRouter(
    prefix="/prestamos", tags=["Préstamos entre empresas"],
    dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))],
)

# Las fechas del filtro son días de Colombia.
HORA_COLOMBIA = timezone(timedelta(hours=-5))


def _inicio_del_dia(dia: date | None) -> datetime | None:
    return datetime.combine(dia, time.min, tzinfo=HORA_COLOMBIA) if dia else None


@router.get("", response_model=ReportePrestamosResponse)
def reporte_prestamos(
    empresa: str = "", bodega_id: int | None = None, desde: date | None = None, hasta: date | None = None,
    incluir_saldados: bool = False, db: Session = Depends(get_db),
) -> dict:
    """Cuánto se deben las empresas (sin saldar), el detalle de cada préstamo
    y lo que Planta sacó de la bodega aunque el sistema no lo tenía."""
    inicio, fin = _inicio_del_dia(desde), _inicio_del_dia(hasta + timedelta(days=1) if hasta else None)
    empresa = empresa.strip().upper()
    prestamos = srv.listar(db, empresa=empresa, bodega_id=bodega_id, desde=inicio, hasta=fin, incluir_saldados=incluir_saldados)
    # Los kilos con que llegó cada rollo prestado (los metros solos no dicen cuál rollo es).
    referencias = {p.referencia_rollo for p in prestamos if p.referencia_rollo}
    filas = (db.query(Rollo.identificador_rollo, Rollo.peso_neto, Rollo.metros_proveedor, Rollo.metros_disponibles, Rollo.metros_consumidos)
             .filter(Rollo.identificador_rollo.in_(referencias)).all()) if referencias else []
    pesos = {ref: peso for ref, peso, *_ in filas}
    metros_rollo = {ref: (prov or 0) or ((disp or 0) + (cons or 0)) for ref, _, prov, disp, cons in filas}
    for p in prestamos:
        p.kilos_rollo = kilos_rollo(pesos.get(p.referencia_rollo)) if p.referencia_rollo else None
        # Kilos de lo prestado: metros × (kilos de la etiqueta / metros del rollo). Ej. 418 m de un
        # rollo de 4.314 kg y 1.674 m = 1.077 kg.
        # Igual que srv.kilos_prestados: el rollo entero (o sin metros conocidos) son los kilos de su etiqueta.
        total = metros_rollo.get(p.referencia_rollo) or 0
        if p.unidad != "m" or not p.kilos_rollo:
            p.kilos = None
        elif total > 0.5 and p.cantidad < total - 0.5:
            p.kilos = round(p.kilos_rollo * p.cantidad / total, 1)
        else:
            p.kilos = float(p.kilos_rollo)
    estados = srv.estado_de_cotizacion_prestada(
        db, {p.apartado_id for p in prestamos if p.apartado_id is not None and not p.saldado and p.origen == srv.PRESTADO_A_TERCERO})
    for p in prestamos:
        p.estado_cotizacion = estados.get(p.apartado_id, "") if not p.saldado and p.origen == srv.PRESTADO_A_TERCERO else ""
    sacado = db.query(Movimiento).filter(Movimiento.tipo == TipoMovimiento.ENTRADA, Movimiento.motivo == MOTIVO_SACADO_SIN_EXISTENCIA)
    if bodega_id is not None:
        sacado = sacado.filter(Movimiento.bodega_destino_id == bodega_id)
    if inicio is not None:
        sacado = sacado.filter(Movimiento.fecha >= inicio)
    if fin is not None:
        sacado = sacado.filter(Movimiento.fecha < fin)
    return {
        "resumen": srv.resumen(prestamos),
        "prestamos": prestamos,
        "sacado_sin_existencia": [
            {"fecha": m.fecha, "bodega_id": m.bodega_destino_id, "producto_codigo": m.producto_codigo,
             "producto_descripcion": m.producto_descripcion, "cantidad": m.cantidad, "cotizacion": m.cotizacion or "",
             "usuario": m.usuario or "", "observaciones": m.observaciones or ""}
            for m in sacado.order_by(Movimiento.fecha.desc()).limit(200)
        ],
    }


@router.post("/saldar")
def saldar_prestamos(datos: SaldarPrestamosRequest, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Las empresas ya cuadraron estos préstamos: dejan de contar en lo que se deben."""
    cambiados = srv.saldar(db, datos.ids, usuario)
    db.commit()
    return {"saldados": cambiados}


@router.post("/a-tercero", response_model=PrestamoResponse)
def prestar_a_tercero(datos: PrestarATerceroRequest, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)):
    """Presta a una empresa de afuera unidades de un producto (ej. caballetes) o un rollo completo."""
    if datos.rollo_id is not None:
        prestamo = srv.prestar_rollo_a_tercero(db, rollo_id=datos.rollo_id, tercero=datos.tercero,
                                               observaciones=datos.observaciones, usuario=usuario)
    elif datos.producto_id is not None:
        prestamo = srv.prestar_a_tercero(db, producto_id=datos.producto_id, cantidad=datos.cantidad, tercero=datos.tercero,
                                         observaciones=datos.observaciones, usuario=usuario)
    else:
        raise HTTPException(status_code=400, detail="Elige el producto o el rollo que vas a prestar.")
    db.commit()
    db.refresh(prestamo)
    return prestamo


@router.get("/desde-cotizacion/vista")
def vista_prestamo_desde_cotizacion(numero: str, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Lo que quedaría como préstamo con esa cotización (antes de guardar)."""
    return srv.vista_prestamo_desde_cotizacion(db, numero)


@router.post("/desde-cotizacion", response_model=list[PrestamoResponse])
def prestar_desde_cotizacion(datos: PrestarDesdeCotizacionRequest, db: Session = Depends(get_db),
                             usuario: Usuario = Depends(usuario_actual)):
    """Lo de una cotización hecha para el préstamo queda como préstamo a la empresa externa (aunque no haya salido)."""
    prestamos = srv.prestar_desde_cotizacion(db, numero=datos.numero_cotizacion, tercero=datos.tercero, usuario=usuario)
    db.commit()
    for prestamo in prestamos:
        db.refresh(prestamo)
    estados = srv.estado_de_cotizacion_prestada(db, {p.apartado_id for p in prestamos if p.apartado_id is not None})
    for prestamo in prestamos:
        prestamo.estado_cotizacion = estados.get(prestamo.apartado_id, "")
    return prestamos


@router.post("/{prestamo_id}/devolver", response_model=PrestamoResponse)
def devolver_de_tercero(prestamo_id: int, datos: DevolverDeTerceroRequest, db: Session = Depends(get_db),
                        usuario: Usuario = Depends(usuario_actual)):
    """La empresa externa devolvió todo o parte: vuelve al stock de su bodega."""
    prestamo = srv.devolver_de_tercero(db, prestamo_id, datos.cantidad, usuario)
    db.commit()
    db.refresh(prestamo)
    return prestamo


@router.post("/{prestamo_id}/devolver-otro-rollo", response_model=PrestamoResponse)
def devolver_con_otro_rollo(prestamo_id: int, datos: DevolverConOtroRolloRequest, db: Session = Depends(get_db),
                            usuario: Usuario = Depends(usuario_actual)):
    """Pagaron el rollo prestado con otro rollo: entra a la bodega y queda el cuadre de kilos."""
    prestamo = srv.devolver_con_otro_rollo(db, prestamo_id, codigo_interno=datos.codigo_interno, referencia=datos.referencia,
                                           kilos=datos.kilos, metros=datos.metros, usuario=usuario)
    db.commit()
    db.refresh(prestamo)
    return prestamo


@router.get("/{prestamo_id}/rollos-para-devolver")
def rollos_para_devolver(prestamo_id: int, buscar: str = "", db: Session = Depends(get_db)) -> list[dict]:
    """Rollos con que se le puede devolver a la empresa de afuera que nos prestó."""
    return srv.rollos_para_devolver_a_tercero(db, prestamo_id, buscar)


@router.post("/{prestamo_id}/devolver-a-tercero", response_model=PrestamoResponse)
def devolver_a_tercero(prestamo_id: int, datos: DevolverATerceroRequest, db: Session = Depends(get_db),
                       usuario: Usuario = Depends(usuario_actual)):
    """Le devolvemos (o pagamos con otro rollo) a la empresa de afuera que nos prestó: el rollo sale."""
    prestamo = srv.devolver_a_tercero(db, prestamo_id, datos.rollo_id, usuario)
    db.commit()
    db.refresh(prestamo)
    return prestamo


@router.get("/cuadre-terceros")
def cuadre_rollos_terceros(db: Session = Depends(get_db)) -> list[dict]:
    """Rollos prestados a empresas externas: kilos prestados vs. devueltos y qué falta facturar."""
    return srv.cuadre_rollos_terceros(db)


@router.post("/{prestamo_id}/factura")
def anotar_factura(prestamo_id: int, datos: FacturaPrestamoRequest, db: Session = Depends(get_db)) -> dict:
    """Número de la factura con que se cobró la diferencia de kilos."""
    prestamo = srv.anotar_factura(db, prestamo_id, datos.factura)
    db.commit()
    return {"id": prestamo.id, "factura": prestamo.factura}
