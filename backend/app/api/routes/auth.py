from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core import limite_login
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


def _ip_del_cliente(request: Request) -> str:
    """En el hosting el backend va detrás de un proxy: request.client es el
    proxy, igual para todos. La IP real la agrega el proxy AL FINAL de
    X-Forwarded-For (lo anterior lo puede escribir cualquiera)."""
    reenviada = request.headers.get("x-forwarded-for", "")
    if reenviada.strip():
        return reenviada.split(",")[-1].strip()
    return request.client.host if request.client else ""


@router.post("/login", response_model=TokenResponse)
def login(datos: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    ip = _ip_del_cliente(request)
    minutos = limite_login.minutos_de_bloqueo(datos.correo, ip)
    if minutos:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos fallidos. Espera {minutos} minuto(s) e intenta de nuevo.",
        )

    usuario = db.query(Usuario).filter(Usuario.correo == datos.correo).first()

    if usuario is None or not verificar_contrasena(datos.contrasena, usuario.contrasena_hash):
        limite_login.registrar_fallo(datos.correo, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Correo o contraseña incorrectos.")
    if not usuario.activo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Esta cuenta está desactivada.")

    limite_login.registrar_exito(datos.correo, ip)
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
