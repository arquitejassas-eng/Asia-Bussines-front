from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.bodega import Bodega
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.solicitud import EstadoSolicitud, Solicitud
from app.models.usuario import RolUsuario, Usuario
from app.schemas.bodegas import BodegaCrear, BodegaResponse, SolicitudCrear, SolicitudResponse
from app.schemas.inventario import ProductoResponse
from app.services import bodegas as srv_bodegas
from app.services.clasificacion import formatear_calibre
from app.services.transferencias import (
    aceptar_solicitud_transferencia,
    crear_solicitud_transferencia,
    rechazar_solicitud_transferencia,
)

router = APIRouter(prefix="/bodegas", tags=["Bodegas"])

DIAS_HISTORIAL_SOLICITUDES = 60


@router.post("", response_model=BodegaResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.SUPERADMIN))])
def crear_bodega(datos: BodegaCrear, db: Session = Depends(get_db)) -> Bodega:
    bodega = srv_bodegas.crear_bodega(db, nombre=datos.nombre)
    db.commit()
    db.refresh(bodega)
    return bodega


@router.get("", response_model=list[BodegaResponse])
def listar_bodegas(
    nombre: str = "", db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)
) -> list[Bodega]:
    consulta = db.query(Bodega)
    # Admin Inventario (bodega_id None) no tiene "su propia bodega" que
    # excluir — ve todas, las necesita para elegir destino de un envío.
    if usuario.bodega_id is not None:
        consulta = consulta.filter(Bodega.id != usuario.bodega_id)
    if nombre:
        consulta = consulta.filter(Bodega.nombre.ilike(f"%{nombre}%"))
    return consulta.all()


@router.get("/{bodega_id}/inventario", response_model=list[ProductoResponse])
def inventario_de_bodega(
    bodega_id: int, busqueda: str = "", db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> list[Producto | dict]:
    consulta = db.query(Producto).filter(
        Producto.bodega_id == bodega_id, Producto.familia != "Rollos de acero", Producto.stock > 0
    )
    if busqueda:
        termino = f"%{busqueda.lower()}%"
        consulta = consulta.filter(Producto.descripcion.ilike(termino) | Producto.codigo.ilike(termino))
    productos = list(consulta.all())
    rollos = db.query(Rollo).filter(Rollo.bodega_id == bodega_id, Rollo.metros_disponibles > 0).all()
    filas_rollos = [{
        "id": -rollo.id, "bodega_id": rollo.bodega_id,
        "codigo_importacion": rollo.codigo_proveedor or "", "codigo": rollo.codigo_interno,
        "descripcion": rollo.descripcion, "familia": "Rollos de acero", "calibre": formatear_calibre(rollo.calibre),
        "peso_neto": rollo.peso_neto, "entrada": round(rollo.metros_disponibles + rollo.metros_consumidos, 2),
        "stock": rollo.metros_disponibles, "rollo_id": rollo.id,
        "identificador_rollo": rollo.identificador_rollo,
    } for rollo in rollos]
    if busqueda:
        termino = busqueda.lower()
        filas_rollos = [fila for fila in filas_rollos if termino in fila["codigo"].lower()
                         or termino in fila["descripcion"].lower()
                         or termino in fila["identificador_rollo"].lower()]
    return [*productos, *filas_rollos]


@router.post("/solicitudes", response_model=SolicitudResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO))])
def enviar_solicitud(
    datos: SolicitudCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)
) -> Solicitud:
    solicitud = crear_solicitud_transferencia(db, datos, usuario)
    db.add(solicitud)
    db.commit()
    db.refresh(solicitud)
    return solicitud


@router.get("/solicitudes/recibidas", response_model=list[SolicitudResponse])
def solicitudes_pendientes_para_mi(
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)
) -> list[Solicitud]:
    return db.query(Solicitud).filter(
        Solicitud.bodega_propietaria_id == usuario.bodega_id,
        Solicitud.estado == EstadoSolicitud.PENDIENTE,
    ).order_by(Solicitud.fecha.desc()).all()


@router.get("/solicitudes/enviadas", response_model=list[SolicitudResponse])
def mis_solicitudes_enviadas(
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)
) -> list[Solicitud]:
    # Las pendientes siempre; las ya respondidas solo de los últimos
    # DIAS_HISTORIAL_SOLICITUDES días: esta lista se refresca sola cada 10 s
    # y mandar todo el histórico en cada recarga gastaba datos de Supabase.
    desde = datetime.now(timezone.utc) - timedelta(days=DIAS_HISTORIAL_SOLICITUDES)
    return db.query(Solicitud).filter(
        Solicitud.bodega_solicitante_id == usuario.bodega_id,
        (Solicitud.estado == EstadoSolicitud.PENDIENTE) | (Solicitud.fecha >= desde),
    ).order_by(Solicitud.fecha.desc()).all()


@router.patch("/solicitudes/{solicitud_id}/aceptar", response_model=SolicitudResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO))])
def aceptar_solicitud(
    solicitud_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)
) -> Solicitud:
    solicitud = aceptar_solicitud_transferencia(db, solicitud_id, usuario)
    db.commit()
    db.refresh(solicitud)
    return solicitud


@router.patch("/solicitudes/{solicitud_id}/rechazar", response_model=SolicitudResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO))])
def rechazar_solicitud(
    solicitud_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)
) -> Solicitud:
    solicitud = rechazar_solicitud_transferencia(db, solicitud_id, usuario)
    db.commit()
    db.refresh(solicitud)
    return solicitud
