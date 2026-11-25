"""
Dependencias reutilizables por los routers:
- `get_db`         -> sesión de base de datos (ver app/db/session.py).
- `usuario_actual`  -> decodifica el JWT y devuelve el Usuario autenticado.
- `requiere_rol()`  -> fábrica de dependencia para restringir un endpoint
                       a un rol específico (equivalente a "soloRol" en
                       BarraLateral.jsx / App.jsx del frontend).
"""

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.core.security import decodificar_token
from app.db.session import get_db
from app.models.usuario import RolUsuario, Usuario

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def usuario_actual(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    x_bodega_id: str | None = Header(default=None),
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

    # Cuenta que maneja varias bodegas: la que escogió en el menú (encabezado
    # X-Bodega-Id) pasa a ser "su bodega" en esta petición. Solo en memoria
    # (set_committed_value no marca el cambio: nunca se guarda en la base), así
    # todo lo que usa usuario.bodega_id funciona igual que con una sola bodega.
    if x_bodega_id and usuario.bodega_id is not None:
        try:
            activa = int(x_bodega_id)
        except ValueError:
            activa = usuario.bodega_id
        if activa != usuario.bodega_id:
            bodega = next((b for b in usuario.bodegas_extra if b.id == activa), None)
            if bodega is None:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="No tienes acceso a esa bodega. Cierra sesión y vuelve a entrar.")
            set_committed_value(usuario, "bodega_id", bodega.id)
            set_committed_value(usuario, "bodega", bodega)

    return usuario


def coincide_bodega(columna, bodega_id: int | None):
    """`columna == bodega_id` se rompe para Admin Inventario: en SQL
    `columna == NULL` nunca es verdadero, así que un `.filter(Rollo.bodega_id
    == usuario.bodega_id)` normal le devolvería siempre vacío en vez de "su"
    material sin asignar. Usar este helper en cualquier `.filter(...)` que
    compare una columna de bodega contra un `bodega_id` que puede ser None
    (típicamente `usuario.bodega_id`) — para el resto de los roles (bodega_id
    real) se comporta exactamente igual que `==`. Recibe el id directo (no el
    `Usuario` completo) para poder usarse también en servicios que solo
    reciben `bodega_id` (ej. `app/services/ia_herramientas.py`)."""
    return columna.is_(None) if bodega_id is None else columna == bodega_id


def requiere_rol(*roles_permitidos: RolUsuario):
    def dependencia(usuario: Usuario = Depends(usuario_actual)) -> Usuario:
        if usuario.rol not in roles_permitidos:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tu usuario no tiene permiso para esta acción.",
            )
        return usuario

    return dependencia
