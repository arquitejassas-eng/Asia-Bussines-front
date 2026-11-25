from pydantic import BaseModel, EmailStr

from app.models.usuario import RolUsuario


class LoginRequest(BaseModel):
    correo: EmailStr
    contrasena: str


class BodegaDeSesion(BaseModel):
    id: int
    nombre: str


class SesionResponse(BaseModel):
    correo: str
    bodega_id: int | None
    bodega_nombre: str
    rol: RolUsuario
    # Todas las bodegas que maneja (la suya primero); más de una = selector en el menú.
    bodegas: list[BodegaDeSesion] = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    sesion: SesionResponse
