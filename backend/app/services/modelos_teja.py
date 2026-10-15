"""Nombre oficial del modelo de una teja a partir de lo que se escribe.

"arqui", "Arq.", "arquitectónica" -> ARQUITECTONICA; "super", "Super Mil"
-> SUPERMIL; "master" -> MASTERMIL. Lo demás queda tal cual, en
mayúsculas. Así el stock de un mismo modelo cae siempre en la misma tarjeta
aunque cada quien lo escriba distinto. Misma lista en src/Utils/teja.ts.
"""

from app.services.clasificacion import normalizar_texto

# Nombre oficial -> cómo puede empezar lo que se escribe (sin tildes ni espacios).
MODELOS_TEJA: dict[str, tuple[str, ...]] = {
    "ARQUITECTONICA": ("arq",),
    "SUPERMIL": ("super",),
    "MASTERMIL": ("master",),
}


def normalizar_modelo_teja(texto: str | None) -> str:
    compacto = "".join(c for c in normalizar_texto(texto) if c.isalnum())
    if not compacto:
        return ""
    for nombre, comienzos in MODELOS_TEJA.items():
        if compacto.startswith(comienzos):
            return nombre
    return " ".join(str(texto).split()).upper()
