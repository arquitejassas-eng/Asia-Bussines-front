"""Empresa dueña de cada rollo. Arquitejas y Asia Business comparten las
mismas bodegas.

La fuente confiable es la columna EMPRESA RECEPTORA del Excel de carga
masiva (`sigla_empresa_desde_nombre`): la referencia puede llevar las
iniciales de otra empresa (ej. un rollo ABG1... recibido por Arquitejas).
Solo si esa columna no viene, se deduce de las iniciales que lleva la
referencia del rollo (`identificador_rollo`), justo después del número de
importación y antes del código de clasificación:

    13 AR  LA50170,50 -05        -> AR  (importación 13, rollo 05)
    2  ABG LA50170,68 -12-2026   -> ABG (importación 2, rollo 12 de 2026)
"""

import re
import unicodedata

# Sigla -> nombre. Solo se usa como respaldo cuando la referencia no contiene
# el código de clasificación del rollo (ver `sigla_empresa_desde_referencia`).
EMPRESAS_CONOCIDAS = {"AR": "Arquitejas", "ABG": "Asia Business"}


def sigla_empresa_desde_nombre(texto: str | None) -> str:
    """Sigla a partir del nombre escrito en el Excel (columna EMPRESA
    RECEPTORA): "ARQUITEJAS" -> "AR", "ASIA" -> "ABG". Acepta también la
    sigla misma o el nombre completo ("Arquitejas S.A.S.", "Asia Business").
    "" si no es ninguna empresa conocida."""
    normalizado = re.sub(r"[^A-Z]", "", unicodedata.normalize("NFD", texto or "").upper())
    if not normalizado:
        return ""
    if normalizado in EMPRESAS_CONOCIDAS:
        return normalizado
    if normalizado.startswith("ARQUITEJAS"):
        return "AR"
    if normalizado.startswith("ASIA"):
        return "ABG"
    return ""


def _compactar(texto: str | None) -> str:
    return re.sub(r"\s+", "", texto or "").upper()


def sigla_empresa_desde_referencia(identificador_rollo: str | None, codigo_interno: str | None) -> str:
    """Devuelve la sigla de la empresa ("AR", "ABG", ...) o "" si la
    referencia no la trae.

    Primero se ubica el código de clasificación del rollo (ej. "LA50170,50")
    dentro de la referencia: lo que queda entre el número de importación y ese
    código son las iniciales de la empresa. Así funciona con cualquier sigla,
    no solo las conocidas. Si el código no aparece tal cual en la referencia,
    se busca una sigla conocida al inicio (la más larga primero, por si una
    sigla corta llega a ser el comienzo de otra más larga)."""
    sin_importacion = _compactar(identificador_rollo).lstrip("0123456789")
    if not sin_importacion:
        return ""

    codigo = _compactar(codigo_interno)
    if codigo:
        posicion = sin_importacion.find(codigo)
        if posicion == 0:
            return ""
        if posicion > 0 and sin_importacion[:posicion].isalpha():
            return sin_importacion[:posicion]

    for sigla in sorted(EMPRESAS_CONOCIDAS, key=len, reverse=True):
        if sin_importacion.startswith(sigla):
            return sigla
    return ""
