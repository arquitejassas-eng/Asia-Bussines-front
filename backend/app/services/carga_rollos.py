"""Lógica de la carga masiva de rollos EXISTENTES desde Excel (una foto del
inventario actual, no un envío nuevo del proveedor). A diferencia de
`clasificacion.py` (que verifica un envío contra lo reportado y calcula
metros a partir del peso), aquí el archivo ya trae el metraje disponible
calculado — solo hace falta mapear columnas y hacer upsert por rollo.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pandas as pd

from app.models.rollo import Rollo
from app.services import clasificacion
from app.services.clasificacion import normalizar_texto
from app.services.empresas import sigla_empresa_desde_nombre

CAMPOS_REQUERIDOS = ["codigo_interno", "identificador_rollo", "metros_disponibles"]
CAMPOS_OPCIONALES = [
    "empresa", "descripcion", "calibre", "peso_neto", "color_material",
    "metros_consumidos", "metros_totales", "proveedor", "lote", "estado_origen",
]

ALIAS_CAMPOS: dict[str, list[str]] = {
    "codigo_interno": ["codigo de producto", "codigo producto", "codigo interno", "codigo clasificacion", "codigo"],
    "identificador_rollo": ["referencia", "identificador de rollo", "id rollo", "n rollo"],
    # Dueña del material. Es la fuente confiable de la empresa del rollo; si
    # no se mapea, se deduce de la referencia (ver app/services/empresas.py).
    "empresa": ["empresa receptora", "empresa", "empresa ingreso", "propietario"],
    "descripcion": ["descripcion"],
    # "espesor" antes que "cal /esp": en los Excel del negocio ESPESOR trae el
    # número limpio (0.29), mientras CAL /ESP es texto escrito a mano
    # ("30 - (0,29)") y un paréntesis olvidado cambia el calibre leído.
    "calibre": ["calibre", "espesor", "cal /esp"],
    "peso_neto": ["peso", "peso neto", "kg net=neto", "net weight"],
    "color_material": ["color"],
    "metros_disponibles": ["disponible sticker", "disponible real", "disponible practico", "disponible", "metros disponibles"],
    "metros_consumidos": ["salida total mt", "salida", "metros consumidos"],
    "metros_totales": ["entrada total mt", "entrada", "mt", "metros totales", "metros proveedor"],
    "proveedor": ["proveedor", "origen"],
    "lote": ["lote"],
    "estado_origen": ["estado"],
}

ESTADOS_VIGENTES = {"cerrado", "abierto"}

# Todos los espesores de este negocio son menores a 1 mm (ver
# `_match_equivalencias` en routes/rollos.py): un calibre de 1 o más es un
# error de lectura o de digitación, nunca un rollo real.
CALIBRE_MAXIMO = 1.0

# Mismos colores que reconoce el frontend en Utils/colorRollo.ts — si el
# Excel no trae una columna de color separada (como la hoja CONTROL, que solo
# la tiene mezclada dentro de DESCRIPCION), se detecta buscando estas
# palabras dentro del texto de la descripción.
COLORES_CONOCIDOS = {
    "azul": "Azul", "blanco": "Blanco", "negro": "Negro", "rojo": "Rojo",
    "verde": "Verde", "amarillo": "Amarillo", "gris": "Gris", "plata": "Plata", "natural": "Natural",
}


def _extraer_color_de_texto(texto: str) -> str:
    palabras = normalizar_texto(texto).split()
    for palabra in palabras:
        if palabra in COLORES_CONOCIDOS:
            return COLORES_CONOCIDOS[palabra]
    return ""


def auto_detectar_mapeo(encabezados: list[str]) -> dict[str, str]:
    return clasificacion.auto_detectar_mapeo(encabezados, ALIAS_CAMPOS)


def campos_requeridos_faltantes(mapeo: dict[str, str]) -> list[str]:
    return clasificacion.campos_requeridos_faltantes(mapeo, CAMPOS_REQUERIDOS)


def _texto(fila: pd.Series, mapeo: dict[str, str], campo: str) -> str:
    columna = mapeo.get(campo)
    if not columna or columna not in fila.index:
        return ""
    valor = fila[columna]
    if pd.isna(valor):
        return ""
    return str(valor).strip()


def _parsear_numero(texto: str) -> float | None:
    """Intenta leer un número tal cual; si no puede (ej. "32 - (0,20)"),
    busca el número entre paréntesis o el primer número decimal del texto.
    El paréntesis de cierre es opcional: "30 - (0,29" (olvidado al escribir)
    se lee 0,29 y no 30."""
    if not texto:
        return None
    limpio = texto.strip().replace(",", ".")
    try:
        return float(limpio)
    except ValueError:
        pass
    entre_parentesis = re.search(r"\(\s*(\d+(?:[.,]\d+)?)", texto)
    if entre_parentesis:
        try:
            return float(entre_parentesis.group(1).replace(",", "."))
        except ValueError:
            pass
    cualquier_numero = re.search(r"\d+[.,]\d+|\d+", texto)
    if cualquier_numero:
        try:
            return float(cualquier_numero.group(0).replace(",", "."))
        except ValueError:
            pass
    return None


@dataclass
class FilaOmitida:
    fila: int
    identificador_rollo: str
    motivo: str


@dataclass
class ResultadoCarga:
    filas_totales: int = 0
    creados: int = 0
    actualizados: int = 0
    omitidas: list[FilaOmitida] = field(default_factory=list)


def procesar_filas(df: pd.DataFrame, mapeo: dict[str, str], db, bodega_id: int | None) -> ResultadoCarga:
    resultado = ResultadoCarga(filas_totales=len(df))

    # Una sola consulta para toda la bodega en vez de un SELECT por fila del
    # Excel (mismo patrón que ya usa recepcion.py para la tabla de
    # equivalencia de espesores).
    filtro_bodega_todos = Rollo.bodega_id.is_(None) if bodega_id is None else Rollo.bodega_id == bodega_id
    existentes = {
        r.identificador_rollo: r
        for r in db.query(Rollo).filter(filtro_bodega_todos).all()
    }

    for indice, fila in df.iterrows():
        numero_fila = indice + 2  # +1 índice 0-based, +1 fila de encabezado.
        codigo_interno = _texto(fila, mapeo, "codigo_interno")
        identificador_rollo = _texto(fila, mapeo, "identificador_rollo")

        if not codigo_interno or not identificador_rollo:
            resultado.omitidas.append(FilaOmitida(numero_fila, identificador_rollo, "Falta código interno o referencia del rollo."))
            continue

        estado_origen = normalizar_texto(_texto(fila, mapeo, "estado_origen"))
        if mapeo.get("estado_origen") and estado_origen and estado_origen not in ESTADOS_VIGENTES:
            resultado.omitidas.append(FilaOmitida(numero_fila, identificador_rollo, f"Estado '{estado_origen}' no vigente (no se carga)."))
            continue

        metros_disponibles = _parsear_numero(_texto(fila, mapeo, "metros_disponibles"))
        if metros_disponibles is None:
            resultado.omitidas.append(FilaOmitida(numero_fila, identificador_rollo, "Metros disponibles inválidos."))
            continue
        if metros_disponibles <= 0:
            resultado.omitidas.append(FilaOmitida(numero_fila, identificador_rollo, "Sin metros disponibles (agotado)."))
            continue

        metros_consumidos = _parsear_numero(_texto(fila, mapeo, "metros_consumidos")) or 0.0
        metros_totales = _parsear_numero(_texto(fila, mapeo, "metros_totales"))
        if metros_totales is None:
            metros_totales = round(metros_disponibles + metros_consumidos, 2)

        calibre_texto = _texto(fila, mapeo, "calibre")
        calibre = _parsear_numero(calibre_texto) or 0.0
        if calibre >= CALIBRE_MAXIMO:
            resultado.omitidas.append(FilaOmitida(
                numero_fila, identificador_rollo,
                f"Calibre '{calibre_texto}' no válido (se leyó {calibre:g}; debe ser menor a 1 mm, ej. 0,29). Corrige la celda.",
            ))
            continue
        peso_neto = _parsear_numero(_texto(fila, mapeo, "peso_neto"))
        # "" (columna sin mapear, vacía o con una empresa desconocida) deja
        # que el rollo nuevo la deduzca de su referencia al guardarse.
        empresa = sigla_empresa_desde_nombre(_texto(fila, mapeo, "empresa"))
        descripcion = _texto(fila, mapeo, "descripcion")
        color_material = _texto(fila, mapeo, "color_material") or _extraer_color_de_texto(descripcion)
        proveedor = _texto(fila, mapeo, "proveedor")
        lote = _texto(fila, mapeo, "lote")

        existente = existentes.get(identificador_rollo)
        if existente:
            existente.codigo_interno = codigo_interno
            existente.metros_disponibles = metros_disponibles
            existente.metros_consumidos = metros_consumidos
            existente.metros_proveedor = metros_totales
            existente.metros_calculados = metros_totales
            if empresa: existente.empresa = empresa
            if descripcion: existente.descripcion = descripcion
            if calibre: existente.calibre = calibre
            if peso_neto is not None: existente.peso_neto = peso_neto
            if color_material: existente.color_material = color_material
            if proveedor: existente.proveedor = proveedor
            if lote: existente.lote = lote
            existente.recalcular_estado()
            resultado.actualizados += 1
        else:
            nuevo = Rollo(
                bodega_id=bodega_id, recepcion_id=None,
                codigo_interno=codigo_interno, identificador_rollo=identificador_rollo, empresa=empresa,
                descripcion=descripcion, familia="Rollos de acero", color_material=color_material,
                calibre=calibre, peso_neto=peso_neto,
                metros_proveedor=metros_totales, metros_calculados=metros_totales,
                metros_disponibles=metros_disponibles, metros_consumidos=metros_consumidos,
                fecha_ingreso=pd.Timestamp.now(tz="UTC").to_pydatetime(),
                proveedor=proveedor, lote=lote,
            )
            nuevo.recalcular_estado()
            db.add(nuevo)
            # Flush defensivo + registrar en el dict: si la misma referencia
            # vuelve a aparecer más abajo en el archivo, la siguiente
            # iteración la encuentra en `existentes` (autoflush=False).
            db.flush()
            existentes[identificador_rollo] = nuevo
            resultado.creados += 1

    return resultado
