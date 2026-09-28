"""Límite de intentos de inicio de sesión.

/auth/login está abierto en internet: sin límite, alguien podría probar miles
de contraseñas contra la cuenta de un vendedor. Tras MAX_INTENTOS fallos
seguidos del mismo correo desde el mismo equipo (IP), ese par queda bloqueado
BLOQUEO_MINUTOS. Se cuenta por correo + IP (no solo por correo) para que un
tercero probando desde afuera no pueda dejar sin acceso al empleado real.

En memoria del proceso: suficiente para el backend actual (un solo proceso).
Si algún día corre con varios workers, cada uno llevaría su propia cuenta.
"""
from datetime import datetime, timedelta, timezone
from threading import Lock

MAX_INTENTOS = 5
BLOQUEO_MINUTOS = 15

_fallos: dict[str, tuple[int, datetime | None]] = {}
_candado = Lock()


def _clave(correo: str, ip: str) -> str:
    return f"{(correo or '').strip().lower()}|{ip}"


def minutos_de_bloqueo(correo: str, ip: str) -> int:
    """Minutos que faltan si ese correo+IP está bloqueado; 0 si puede intentar."""
    with _candado:
        _, hasta = _fallos.get(_clave(correo, ip), (0, None))
        ahora = datetime.now(timezone.utc)
        if hasta is None or hasta <= ahora:
            return 0
        return max(1, int((hasta - ahora).total_seconds() // 60) + 1)


def registrar_fallo(correo: str, ip: str) -> None:
    with _candado:
        clave = _clave(correo, ip)
        ahora = datetime.now(timezone.utc)
        intentos, hasta = _fallos.get(clave, (0, None))
        if hasta is not None and hasta <= ahora:
            intentos = 0  # ya pasó el bloqueo anterior: se empieza de cero
        intentos += 1
        hasta = ahora + timedelta(minutes=BLOQUEO_MINUTOS) if intentos >= MAX_INTENTOS else None
        _fallos[clave] = (intentos, hasta)


def registrar_exito(correo: str, ip: str) -> None:
    with _candado:
        _fallos.pop(_clave(correo, ip), None)
