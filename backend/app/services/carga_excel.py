"""Pasos comunes de las tres cargas por Excel (Recepción, carga masiva de
rollos y carga masiva de productos): validar y leer el archivo subido, armar
la vista previa de una hoja y cambiar de hoja sin volver a subirlo. Antes
estaban copiados casi línea por línea en los tres routers."""

from collections.abc import Callable

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.core.config import settings
from app.services.clasificacion import leer_hojas_excel

DetectorDeMapeo = Callable[[list[str]], dict[str, str]]


async def leer_excel_subido(archivo: UploadFile) -> dict[str, pd.DataFrame]:
    """Valida extensión, tamaño y que no esté vacío, y devuelve sus hojas."""
    nombre_archivo = archivo.filename or ""
    if not nombre_archivo.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=415, detail="Solo se aceptan archivos Excel (.xlsx o .xls).")

    # Se lee como máximo un byte por encima del límite para rechazar archivos
    # grandes sin cargar por completo una entrada no confiable en memoria.
    contenido = await archivo.read(settings.MAX_ARCHIVO_RECEPCION_BYTES + 1)
    if len(contenido) > settings.MAX_ARCHIVO_RECEPCION_BYTES:
        limite_mb = settings.MAX_ARCHIVO_RECEPCION_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"El archivo supera el límite de {limite_mb} MB.")
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    try:
        return leer_hojas_excel(contenido)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo Excel.") from exc


def vista_previa(nombre_archivo: str | None, hojas: dict[str, pd.DataFrame], hoja: str,
                 detectar_mapeo: DetectorDeMapeo) -> dict:
    """Encabezados, mapeo sugerido y total de filas de `hoja`. Si la hoja no
    tiene una fila de encabezados usable, 400 con un mensaje claro (antes, en
    Recepción, esto terminaba en un error 500)."""
    try:
        df = hojas[hoja]
        encabezados = [str(c) for c in df.columns]
        return {
            "nombre_archivo": nombre_archivo or "archivo.xlsx",
            "hoja_actual": hoja,
            "hojas_disponibles": list(hojas.keys()),
            "encabezados": encabezados,
            "mapeo_sugerido": detectar_mapeo(encabezados),
            "filas_totales": len(df),
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo generar la vista previa de la hoja '{hoja}'. "
            "Puede que esa hoja no tenga una fila de encabezados válida -- elige otra hoja del selector e intenta de nuevo.",
        ) from exc


def cambiar_hoja(almacen, usuario_id: int, hoja: str, ruta_previsualizar: str,
                 detectar_mapeo: DetectorDeMapeo) -> dict:
    """Cambia qué hoja del Excel ya subido se usa. `almacen` es el módulo de
    almacenamiento temporal de ese flujo (archivos_recepcion, etc.)."""
    en_proceso = almacen.obtener(usuario_id)
    if not en_proceso:
        raise HTTPException(status_code=400, detail=f"Primero sube un archivo con {ruta_previsualizar}.")
    if hoja not in en_proceso["hojas"]:
        raise HTTPException(status_code=400, detail=f"La hoja '{hoja}' no existe en el archivo.")
    en_proceso["hoja_principal"] = hoja
    almacen.guardar(usuario_id, en_proceso)
    return vista_previa(en_proceso["nombre_archivo"], en_proceso["hojas"], hoja, detectar_mapeo)


def valor_celda(fila: pd.Series, mapeo: dict[str, str], campo: str) -> str:
    """Texto de la celda que el usuario asignó a `campo` en el mapeo de
    columnas, sin espacios; "" si la columna no se mapeó o la celda está vacía."""
    columna = mapeo.get(campo)
    if not columna or columna not in fila.index:
        return ""
    valor = fila[columna]
    if pd.isna(valor):
        return ""
    return str(valor).strip()
