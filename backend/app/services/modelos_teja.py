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


def modelo_en_descripcion(texto: str | None) -> str:
    """El modelo que trae escrito una línea de cotización, ej. "11 TEJAS DE
    5.10 MTR ARQUITECTONICA CAL 31..." -> ARQUITECTONICA; "60 UNIDADES MASTER
    MIL..." -> MASTERMIL. "" si no nombra ningún modelo conocido."""
    for palabra in normalizar_texto(texto).split():
        compacta = "".join(c for c in palabra if c.isalnum())
        for nombre, comienzos in MODELOS_TEJA.items():
            if compacta.startswith(comienzos):
                return nombre
    return ""


def normalizar_modelo_teja(texto: str | None) -> str:
    compacto = "".join(c for c in normalizar_texto(texto) if c.isalnum())
    if not compacto:
        return ""
    for nombre, comienzos in MODELOS_TEJA.items():
        if compacto.startswith(comienzos):
            return nombre
    return " ".join(str(texto).split()).upper()
