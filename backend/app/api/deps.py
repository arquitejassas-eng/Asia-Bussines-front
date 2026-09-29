"""
Dependencias reutilizables por los routers:
- `get_db`         -> sesión de base de datos (ver app/db/session.py).
- `usuario_actual`  -> decodifica el JWT y devuelve el Usuario autenticado.
- `requiere_rol()`  -> fábrica de dependencia para restringir un endpoint
                       a un rol específico (equivalente a "soloRol" en
                       BarraLateral.jsx / App.jsx del frontend).
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decodificar_token
from app.db.filtros import coincide_bodega  # noqa: F401 -- se re-exporta para las rutas
from app.db.session import get_db
from app.models.usuario import RolUsuario, Usuario

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def usuario_actual(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas o sesión expirada.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decodificar_token(token)
    if payload is None or "sub" not in payload:
        raise credenciales_invalidas

    usuario = db.get(Usuario, int(payload["sub"]))
    if usuario is None or not usuario.activo:
        raise credenciales_invalidas

    return usuario




def requiere_rol(*roles_permitidos: RolUsuario):
    def dependencia(usuario: Usuario = Depends(usuario_actual)) -> Usuario:
        if usuario.rol not in roles_permitidos:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tu usuario no tiene permiso para esta acción.",
            )
        return usuario

    return dependencia
