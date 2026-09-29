from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.apartado import Apartado, ApartadoItem, EstadoApartado
from app.models.producto import Producto
from app.services.productos import FAMILIA_ROLLOS
from app.models.usuario import RolUsuario, Usuario
from app.schemas.apartados import (
    ApartadoCrear, ApartadoResponse, DisponibilidadCodigoResponse, DisponibilidadProductoResponse, ReservaCodigoResponse,
)
from app.schemas.inventario import ProductoResponse
from app.services import apartados as srv

router = APIRouter(prefix="/apartados", tags=["Apartados"])


def _con_faltantes(db: Session, apartados: list[Apartado]) -> list[Apartado]:
    """Anota en cada apartado lo que le falta por llegar (material en camino)."""
    for apartado in apartados:
        apartado.faltantes = srv.faltantes_apartado(db, apartado)
    return apartados


@router.get("/disponibilidad", response_model=DisponibilidadCodigoResponse)
def consultar_disponibilidad(
    codigo_interno: str = Query(..., min_length=1), bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Cuánto material hay de un código de clasificación (color + calibre) antes
    de apartarlo: rollos, metros disponibles, reservados y consumidos."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    return srv.disponibilidad_por_codigo(db, bodega_id=bodega, codigo_interno=codigo_interno)


@router.get("/disponibilidad-producto", response_model=DisponibilidadProductoResponse)
def consultar_disponibilidad_producto(
    producto_id: int = Query(..., gt=0), bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Cuánto stock hay de un `Producto` concreto antes de apartarlo (POR_STOCK):
    stock físico, cantidad ya reservada por apartados activos, y disponible."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    return srv.disponibilidad_producto(db, bodega_id=bodega, producto_id=producto_id)


@router.get("/productos", response_model=list[ProductoResponse])
def buscar_productos_para_apartar(
    busqueda: str = Query(..., min_length=1), bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Producto]:
    """Productos de stock de la bodega elegida para una línea POR_STOCK. Admin
    Inventario no tiene bodega propia, por eso no sirve /inventario/productos."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    termino = f"%{busqueda.strip()}%"
    return (
        db.query(Producto)
        .filter(Producto.bodega_id == bodega, Producto.familia != FAMILIA_ROLLOS)
        .filter(Producto.codigo.ilike(termino) | Producto.codigo_importacion.ilike(termino) | Producto.descripcion.ilike(termino))
        .order_by(Producto.id.desc())
        .limit(8)
        .all()
    )


@router.get("/reservas", response_model=list[ReservaCodigoResponse])
def listar_reservas_por_codigo(
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[dict]:
    """Metros reservados por código para toda la bodega, en un solo llamado —
    usado en "Rollos almacenados" para mostrar el stock físico ya descontado
    por apartados activos, sin esperar a que producción los consuma."""
    return srv.metros_reservados_por_bodega(db, bodega_id=usuario.bodega_id)


# Los apartados los crea Admin Inventario (cotización aprobada) eligiendo la
# bodega; la bodega solo decide cuándo enviarlo a producción.
@router.post("", response_model=ApartadoResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def crear_apartado(datos: ApartadoCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.crear_apartado(db, datos, usuario)
    db.commit(); db.refresh(apartado)
    return _con_faltantes(db, [apartado])[0]


@router.get("", response_model=list[ApartadoResponse])
def listar_apartados(
    estado: EstadoApartado | None = None, numero_cotizacion: str = "",
    # Varios estados a la vez (?estados=a&estados=b). El globo de Planta y
    # Registrar Producción solo necesitan los que están en producción y se
    # refrescan solos: pedir todo el histórico (entregados, cancelados...)
    # en cada recarga gastaba datos de Supabase sin razón.
    estados: list[EstadoApartado] = Query(default=[]),
    bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Apartado]:
    consulta = (
        db.query(Apartado)
        .options(joinedload(Apartado.items).joinedload(ApartadoItem.producciones), joinedload(Apartado.bodega))
    )
    # Admin Inventario ve los de todas las bodegas (puede filtrar por una);
    # los demás roles, solo los de la suya.
    if usuario.rol == RolUsuario.ADMIN_INVENTARIO:
        if bodega_id is not None: consulta = consulta.filter(Apartado.bodega_id == bodega_id)
    else:
        consulta = consulta.filter(Apartado.bodega_id == usuario.bodega_id)
    if estado: consulta = consulta.filter(Apartado.estado == estado)
    if estados: consulta = consulta.filter(Apartado.estado.in_(estados))
    if numero_cotizacion: consulta = consulta.filter(Apartado.numero_cotizacion.ilike(f"%{numero_cotizacion}%"))
    return _con_faltantes(db, consulta.order_by(Apartado.fecha_creacion.desc()).all())


@router.get("/{apartado_id}", response_model=ApartadoResponse)
def obtener_apartado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    return _con_faltantes(db, [srv.apartado_de_mi_bodega(db, apartado_id, usuario)])[0]


@router.delete("/{apartado_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def eliminar_apartado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> None:
    srv.eliminar_apartado_cancelado(db, apartado_id, usuario)
    db.commit()


@router.patch("/{apartado_id}/cancelar", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def cancelar_apartado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.cancelar_apartado(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/enviar-a-produccion", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO))])
def enviar_a_produccion(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.enviar_a_produccion(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/marcar-terminado", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.JEFE_PLANTA))])
def marcar_produccion_terminada(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.marcar_produccion_terminada(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/confirmar-separacion-stock", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.JEFE_PLANTA))])
def confirmar_separacion_stock(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.confirmar_separacion_stock(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/marcar-entregado", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO))])
def marcar_entregado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.marcar_entregado(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado
