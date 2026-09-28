from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session, joinedload, selectinload
from app.api.deps import coincide_bodega, get_db, requiere_rol, usuario_actual
from app.models.apartado import ApartadoItem
from app.models.produccion import Produccion
from app.models.usuario import RolUsuario, Usuario
from app.schemas.produccion import ProduccionCrear, ProduccionResponse
from app.services.produccion import registrar_produccion as aplicar_produccion

router = APIRouter(prefix="/produccion", tags=["Producción"])

@router.post("", response_model=ProduccionResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(requiere_rol(RolUsuario.JEFE_PLANTA))])
def registrar_produccion(datos: ProduccionCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Produccion:
    produccion = aplicar_produccion(db, datos, usuario)
    db.commit(); db.refresh(produccion)
    return produccion

@router.get("", response_model=list[ProduccionResponse])
def listar_producciones(db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> list[Produccion]:
    """Hoja de Vida: cada sede ve solo sus producciones. Admin Inventario ve
    las de TODAS las sedes, para verificar que el material que sale de cada
    una sea el real (con coincide_bodega no vería ninguna: su bodega_id es
    NULL y toda producción pertenece a una sede)."""
    # Relaciones cargadas por adelantado: antes la respuesta hacía varias
    # consultas por cada producción (rollos, stock generado, cliente del
    # apartado) -- 43 consultas para 20 producciones, cada 20 s en pantalla.
    consulta = db.query(Produccion).options(
        selectinload(Produccion.rollos_utilizados),
        selectinload(Produccion.productos_stock),
        joinedload(Produccion.apartado_item).joinedload(ApartadoItem.apartado),
    )
    if usuario.rol != RolUsuario.ADMIN_INVENTARIO:
        consulta = consulta.filter(coincide_bodega(Produccion.bodega_id, usuario.bodega_id))
    return consulta.order_by(Produccion.fecha.desc()).all()
