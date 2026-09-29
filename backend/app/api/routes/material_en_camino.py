from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.material_en_camino import Cargamento
from app.models.usuario import RolUsuario, Usuario
from app.schemas.material_en_camino import CargamentoResponse, MarcarLlegadaRequest
from app.services import material_en_camino as srv

router = APIRouter(prefix="/material-en-camino", tags=["Material en camino"])

# Lo gestiona Admin Inventario (recibe y reparte); los demás solo lo consultan.
solo_admin_inventario = [Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))]


@router.get("", response_model=list[CargamentoResponse], dependencies=[Depends(usuario_actual)])
def listar_cargamentos(incluir_cerrados: bool = False, db: Session = Depends(get_db)) -> list[dict]:
    consulta = db.query(Cargamento).options(joinedload(Cargamento.rollos))
    if not incluir_cerrados:
        consulta = consulta.filter(Cargamento.estado == srv.EN_CAMINO)
    return [srv.resumen_cargamento(db, c) for c in consulta.order_by(Cargamento.fecha_creacion.desc()).all()]


def _cargamento_abierto(db: Session, cargamento_id: int) -> Cargamento:
    cargamento = db.query(Cargamento).filter(Cargamento.id == cargamento_id).with_for_update().first()
    if cargamento is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No se encontró ese checklist.")
    if cargamento.estado != srv.EN_CAMINO:
        raise HTTPException(status_code=400, detail="Este checklist ya está cerrado.")
    return cargamento


def _cerrar(cargamento: Cargamento, usuario: Usuario) -> None:
    cargamento.estado = srv.CERRADO
    cargamento.cerrado_por = usuario.correo
    cargamento.fecha_cierre = datetime.now(timezone.utc)


@router.patch("/{cargamento_id}/llegada", response_model=CargamentoResponse, dependencies=solo_admin_inventario)
def marcar_llegada(
    cargamento_id: int, datos: MarcarLlegadaRequest,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Marca los rollos que trajo una mula. Dejan de contar "en camino" (pasan
    a Admin Inventario por repartir). Si ya llegó todo, el checklist se cierra solo."""
    cargamento = _cargamento_abierto(db, cargamento_id)
    por_id = {r.id: r for r in cargamento.rollos}
    if any(i not in por_id for i in datos.rollo_ids):
        raise HTTPException(status_code=400, detail="Algunos rollos no pertenecen a este checklist.")
    ahora = datetime.now(timezone.utc)
    for rollo_id in set(datos.rollo_ids):
        rollo = por_id[rollo_id]
        if not rollo.llego:
            rollo.llego, rollo.llego_por, rollo.fecha_llegada = True, usuario.correo, ahora
    if all(r.llego for r in cargamento.rollos):
        _cerrar(cargamento, usuario)
    db.commit(); db.refresh(cargamento)
    return srv.resumen_cargamento(db, cargamento)


@router.patch("/{cargamento_id}/cerrar", response_model=CargamentoResponse, dependencies=solo_admin_inventario)
def cerrar_cargamento(cargamento_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Lo que no ha llegado deja de contar: esos rollos ya no vendrán."""
    cargamento = _cargamento_abierto(db, cargamento_id)
    _cerrar(cargamento, usuario)
    db.commit(); db.refresh(cargamento)
    return srv.resumen_cargamento(db, cargamento)


@router.delete("/{cargamento_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=solo_admin_inventario)
def eliminar_cargamento(cargamento_id: int, db: Session = Depends(get_db)) -> None:
    """Para un checklist subido por error."""
    cargamento = db.query(Cargamento).filter(Cargamento.id == cargamento_id).with_for_update().first()
    if cargamento is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No se encontró ese checklist.")
    db.delete(cargamento)
    db.commit()
