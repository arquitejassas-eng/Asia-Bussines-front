from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.usuario import RolUsuario

# Mínimo al crear o restablecer (antes se aceptaba hasta 1 carácter). Las
# contraseñas existentes más cortas siguen sirviendo para entrar.
LONGITUD_MINIMA_CONTRASENA = 8


class UsuarioCreate(BaseModel):
    correo: EmailStr
    contrasena: str = Field(min_length=LONGITUD_MINIMA_CONTRASENA, max_length=128)
    rol: RolUsuario
    bodega_id: int | None = None


class UsuarioResponse(BaseModel):
    id: int
    correo: str
    rol: RolUsuario
    bodega_id: int | None
    activo: bool

    class Config:
        from_attributes = True


class UsuarioActualizar(BaseModel):
    """Body de PATCH /usuarios/{id} — SUPERADMIN reasigna rol y/o bodega."""
    model_config = ConfigDict(from_attributes=True)
    rol: RolUsuario
    bodega_id: int | None = None


class RestablecerContrasenaRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    contrasena_nueva: str = Field(min_length=LONGITUD_MINIMA_CONTRASENA, max_length=128)
