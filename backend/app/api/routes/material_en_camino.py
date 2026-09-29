from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.material_en_camino import Cargamento
from app.models.usuario import RolUsuario, Usuario
from app.schemas.material_en_camino import CargamentoResponse
from app.services import material_en_camino as srv

router = APIRouter(prefix="/material-en-camino", tags=["Material en camino"])


@router.get("", response_model=list[CargamentoResponse])
def listar_cargamentos(
    incluir_llegados: bool = False,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[dict]:
    """Admin Inventario ve lo que viene para todas las bodegas; cada bodega,
    solo lo que viene para ella."""
    consulta = db.query(Cargamento).options(joinedload(Cargamento.rollos), joinedload(Cargamento.bodega))
    if usuario.rol not in (RolUsuario.ADMIN_INVENTARIO, RolUsuario.VENDEDOR):
        consulta = consulta.filter(Cargamento.bodega_id == usuario.bodega_id)
    if not incluir_llegados:
        consulta = consulta.filter(Cargamento.estado == srv.EN_CAMINO)
    cargamentos = consulta.order_by(Cargamento.fecha_creacion.desc()).all()
    return [srv.resumen_cargamento(db, c) for c in cargamentos]


def _cargamento(db: Session, cargamento_id: int) -> Cargamento:
    cargamento = db.query(Cargamento).filter(Cargamento.id == cargamento_id).with_for_update().first()
    if cargamento is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No se encontró ese material en camino.")
    return cargamento


@router.patch("/{cargamento_id}/llego", response_model=CargamentoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def marcar_llegada(cargamento_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Deja de contar como "en camino": su material ya entró (o entra) por Recepción."""
    cargamento = _cargamento(db, cargamento_id)
    if cargamento.estado != srv.EN_CAMINO:
        raise HTTPException(status_code=400, detail="Este material ya estaba marcado como llegado.")
    cargamento.estado = srv.LLEGO
    cargamento.llego_por = usuario.correo
    cargamento.fecha_llegada = datetime.now(timezone.utc)
    db.commit(); db.refresh(cargamento)
    return srv.resumen_cargamento(db, cargamento)


@router.delete("/{cargamento_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def eliminar_cargamento(cargamento_id: int, db: Session = Depends(get_db)) -> None:
    """Para un checklist subido por error o un pedido que se canceló."""
    db.delete(_cargamento(db, cargamento_id))
    db.commit()
