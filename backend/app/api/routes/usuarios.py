from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import requiere_rol, usuario_actual
from app.db.session import get_db
from app.models.usuario import RolUsuario, Usuario
from app.schemas.usuario import RestablecerContrasenaRequest, UsuarioActualizar, UsuarioCreate, UsuarioResponse
from app.services import usuarios as srv

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])


@router.post(
    "", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.SUPERADMIN))],
)
def crear_usuario(
    datos: UsuarioCreate, db: Session = Depends(get_db),
    usuario_creador: Usuario = Depends(usuario_actual),
) -> Usuario:
    usuario = srv.crear_usuario(
        db, correo=datos.correo, contrasena=datos.contrasena, rol=datos.rol,
        bodega_id=datos.bodega_id, creador=usuario_creador,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No se pudo crear el usuario (revisa bodega_id).")
    db.refresh(usuario)
    return usuario


@router.get(
    "", response_model=list[UsuarioResponse],
    dependencies=[Depends(requiere_rol(RolUsuario.SUPERADMIN))],
)
def listar_usuarios(db: Session = Depends(get_db)) -> list[Usuario]:
    return srv.listar_usuarios(db)


@router.patch(
    "/{usuario_id}", response_model=UsuarioResponse,
    dependencies=[Depends(requiere_rol(RolUsuario.SUPERADMIN))],
)
def actualizar_usuario(
    usuario_id: int, datos: UsuarioActualizar, db: Session = Depends(get_db),
    superadmin: Usuario = Depends(usuario_actual),
) -> Usuario:
    usuario = srv.actualizar_usuario(db, usuario_id, rol=datos.rol, bodega_id=datos.bodega_id, superadmin=superadmin,
                                     bodegas_extra_ids=datos.bodegas_extra_ids)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch(
    "/{usuario_id}/activar", response_model=UsuarioResponse,
    dependencies=[Depends(requiere_rol(RolUsuario.SUPERADMIN))],
)
def activar_usuario(usuario_id: int, db: Session = Depends(get_db)) -> Usuario:
    usuario = srv.activar_usuario(db, usuario_id)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch(
    "/{usuario_id}/desactivar", response_model=UsuarioResponse,
    dependencies=[Depends(requiere_rol(RolUsuario.SUPERADMIN))],
)
def desactivar_usuario(
    usuario_id: int, db: Session = Depends(get_db),
    superadmin: Usuario = Depends(usuario_actual),
) -> Usuario:
    usuario = srv.desactivar_usuario(db, usuario_id, superadmin=superadmin)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch(
    "/{usuario_id}/restablecer-contrasena", response_model=UsuarioResponse,
    dependencies=[Depends(requiere_rol(RolUsuario.SUPERADMIN))],
)
def restablecer_contrasena(
    usuario_id: int, datos: RestablecerContrasenaRequest, db: Session = Depends(get_db),
) -> Usuario:
    usuario = srv.restablecer_contrasena(db, usuario_id, contrasena_nueva=datos.contrasena_nueva)
    db.commit()
    db.refresh(usuario)
    return usuario
