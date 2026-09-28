"""Administración de cuentas: creación (con las restricciones de alcance de
cada rol), listado, edición de rol/bodega, activar/desactivar y restablecer
contraseña. Dominio exclusivo de gestión de usuarios — no participa de
ningún flujo operativo (inventario, apartados, producción, etc.).
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import hashear_contrasena
from app.models.usuario import RolUsuario, Usuario


def _validar_alcance_creacion(rol: RolUsuario, bodega_id: int | None, creador: Usuario) -> None:
    """SUPERADMIN no tiene restricción: crea cualquier rol en cualquier
    bodega. Un ADMINISTRATIVO solo puede crear cuentas de su propia bodega,
    con un rol que no exceda su propio alcance (ni ADMIN_INVENTARIO, ni
    SUPERADMIN, ni VENDEDOR, que ve el inventario de todas las sedes)."""
    if creador.rol == RolUsuario.SUPERADMIN:
        return
    if rol in (RolUsuario.ADMIN_INVENTARIO, RolUsuario.SUPERADMIN, RolUsuario.VENDEDOR):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes permiso para crear una cuenta con ese rol.")
    if bodega_id != creador.bodega_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo puedes crear usuarios para tu propia bodega.")


def crear_usuario(
    db: Session, *, correo: str, contrasena: str, rol: RolUsuario, bodega_id: int | None, creador: Usuario,
) -> Usuario:
    _validar_alcance_creacion(rol, bodega_id, creador)

    existente = db.query(Usuario).filter(Usuario.correo == correo).first()
    if existente is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ese correo ya está registrado.")

    usuario = Usuario(correo=correo, contrasena_hash=hashear_contrasena(contrasena), rol=rol, bodega_id=bodega_id)
    db.add(usuario)
    return usuario


def listar_usuarios(db: Session) -> list[Usuario]:
    return db.query(Usuario).order_by(Usuario.correo.asc()).all()


def _usuario_o_404(db: Session, usuario_id: int) -> Usuario:
    usuario = db.get(Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")
    return usuario


def actualizar_usuario(
    db: Session, usuario_id: int, *, rol: RolUsuario, bodega_id: int | None, superadmin: Usuario,
) -> Usuario:
    usuario = _usuario_o_404(db, usuario_id)
    if usuario.id == superadmin.id:
        if rol != RolUsuario.SUPERADMIN:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes quitarte a ti mismo el rol SUPERADMIN.")
        if bodega_id != usuario.bodega_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes cambiar tu propia bodega como SUPERADMIN.")
    usuario.rol = rol
    usuario.bodega_id = bodega_id
    return usuario


def desactivar_usuario(db: Session, usuario_id: int, *, superadmin: Usuario) -> Usuario:
    usuario = _usuario_o_404(db, usuario_id)
    if usuario.id == superadmin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes desactivar tu propia cuenta.")
    usuario.activo = False
    return usuario


def activar_usuario(db: Session, usuario_id: int) -> Usuario:
    usuario = _usuario_o_404(db, usuario_id)
    usuario.activo = True
    return usuario


def restablecer_contrasena(db: Session, usuario_id: int, *, contrasena_nueva: str) -> Usuario:
    usuario = _usuario_o_404(db, usuario_id)
    usuario.contrasena_hash = hashear_contrasena(contrasena_nueva)
    return usuario
