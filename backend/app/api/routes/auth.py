from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import crear_token_acceso, verificar_contrasena
from app.db.session import get_db
from app.models.usuario import RolUsuario, Usuario
from app.schemas.auth import LoginRequest, SesionResponse, TokenResponse

router = APIRouter(prefix="/auth", tags=["Autenticación"])


def _bodega_nombre_para(usuario: Usuario) -> str:
    """Texto que la barra lateral muestra bajo la marca: la bodega del
    usuario o, para las cuentas sin bodega fija, el nombre de su rol."""
    # El vendedor consulta todas las sedes, así que aunque tenga una bodega
    # asignada se identifica por su rol.
    if usuario.rol == RolUsuario.VENDEDOR:
        return "Vendedor"
    if usuario.bodega_id:
        return usuario.bodega.nombre
    return "Administrador general" if usuario.rol == RolUsuario.SUPERADMIN else "Admin Inventario"


@router.post("/login", response_model=TokenResponse)
def login(datos: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    usuario = db.query(Usuario).filter(Usuario.correo == datos.correo).first()

    if usuario is None or not verificar_contrasena(datos.contrasena, usuario.contrasena_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Correo o contraseña incorrectos.")
    if not usuario.activo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Esta cuenta está desactivada.")

    token = crear_token_acceso({"sub": str(usuario.id)})

    return TokenResponse(
        access_token=token,
        sesion=SesionResponse(
            correo=usuario.correo,
            bodega_id=usuario.bodega_id,
            bodega_nombre=_bodega_nombre_para(usuario),
            rol=usuario.rol,
        ),
    )
