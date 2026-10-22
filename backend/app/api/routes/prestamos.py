from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.usuario import RolUsuario, Usuario
from app.schemas.prestamos import ReportePrestamosResponse, SaldarPrestamosRequest
from app.services import prestamos as srv
from app.services.apartados import MOTIVO_SACADO_SIN_EXISTENCIA

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
