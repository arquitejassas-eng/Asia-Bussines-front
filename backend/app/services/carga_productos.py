"""Lógica de la carga masiva de productos generales (por stock) desde Excel.

Es la versión simplificada, para productos por cantidad, del mismo patrón que
`clasificacion.py` ya resuelve para rollos por metro: detectar columnas por
alias y dejar que el usuario ajuste el mapeo antes de confirmar. A diferencia
de los rollos, aquí no hay clasificación ni cálculo de metros — solo mapear
columnas y hacer upsert por (bodega_id, código).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from secrets import token_hex

import pandas as pd
from sqlalchemy.exc import IntegrityError

from app.models.producto import Producto
from app.services import clasificacion
from app.services.clasificacion import normalizar_texto

CAMPOS_REQUERIDOS = ["codigo", "descripcion", "stock"]
CAMPOS_OPCIONALES = ["referencia", "codigo_importacion", "familia", "calibre", "entrada"]

ALIAS_CAMPOS: dict[str, list[str]] = {
    "codigo": ["codigo", "codigo producto", "sku"],
    "referencia": ["referencia", "codigo referencia", "ref"],
    "descripcion": ["descripcion", "nombre", "producto", "detalle", "nombre producto"],
    "stock": ["stock", "cantidad", "existencia", "existencias", "cant", "saldo"],
    "entrada": ["entrada", "ingreso", "cantidad inicial"],
    "codigo_importacion": ["codigo importacion", "codigo de importacion", "codigo proveedor", "referencia proveedor"],
    "familia": ["familia", "categoria", "linea"],
    "calibre": ["calibre", "medida"],
}

FAMILIA_ROLLOS_RESERVADA = "rollos de acero"


def auto_detectar_mapeo(encabezados: list[str]) -> dict[str, str]:
    """Adivina, para cada campo interno, qué columna del Excel le corresponde."""
    return clasificacion.auto_detectar_mapeo(encabezados, ALIAS_CAMPOS)


def campos_requeridos_faltantes(mapeo: dict[str, str]) -> list[str]:
    return clasificacion.campos_requeridos_faltantes(mapeo, CAMPOS_REQUERIDOS)


def _valor(fila: pd.Series, mapeo: dict[str, str], campo: str) -> str:
    columna = mapeo.get(campo)
    if not columna or columna not in fila.index:
        return ""
    valor = fila[columna]
    if pd.isna(valor):
        return ""
    return str(valor).strip()


@dataclass
class FilaOmitida:
    fila: int
    codigo: str
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
    filtro_bodega_todos = Producto.bodega_id.is_(None) if bodega_id is None else Producto.bodega_id == bodega_id
    existentes = {
        p.codigo: p
        for p in db.query(Producto).filter(filtro_bodega_todos).all()
    }

    for indice, fila in df.iterrows():
        numero_fila = indice + 2  # +1 por índice 0-based, +1 por la fila de encabezado.
        codigo = _valor(fila, mapeo, "codigo")
        descripcion = _valor(fila, mapeo, "descripcion")
        stock_texto = _valor(fila, mapeo, "stock")

        if not codigo or not descripcion:
            resultado.omitidas.append(FilaOmitida(numero_fila, codigo, "Falta código o descripción."))
            continue

        try:
            stock = float(stock_texto.replace(",", "."))
        except ValueError:
            resultado.omitidas.append(FilaOmitida(numero_fila, codigo, "Cantidad/stock inválido."))
            continue

        entrada_texto = _valor(fila, mapeo, "entrada")
        entrada = stock
        if entrada_texto:
            try:
                entrada = float(entrada_texto.replace(",", "."))
            except ValueError:
                resultado.omitidas.append(FilaOmitida(numero_fila, codigo, "Entrada inválida."))
                continue

        familia = _valor(fila, mapeo, "familia")
        if normalizar_texto(familia) == FAMILIA_ROLLOS_RESERVADA:
            resultado.omitidas.append(
                FilaOmitida(numero_fila, codigo, "Los rollos de acero se cargan desde Recepción y Verificación, no desde aquí.")
            )
            continue

        referencia = _valor(fila, mapeo, "referencia")
        calibre = _valor(fila, mapeo, "calibre")
        codigo_importacion = _valor(fila, mapeo, "codigo_importacion")

        existente = existentes.get(codigo)
        if existente:
            existente.stock = stock
            existente.entrada = entrada
            existente.descripcion = descripcion
            if referencia: existente.referencia = referencia
            if familia: existente.familia = familia
            if calibre: existente.calibre = calibre
            if codigo_importacion: existente.codigo_importacion = codigo_importacion
            resultado.actualizados += 1
        else:
            # Si el Excel no trae código de importación, se genera uno único
            # en vez de dejarlo en blanco (el campo lo espera el resto de la
            # app, ej. la búsqueda de productos por código de importación).
            codigo_importacion_final = codigo_importacion or f"IMP-{token_hex(4).upper()}"
            nuevo = Producto(
                bodega_id=bodega_id, codigo=codigo, referencia=referencia, descripcion=descripcion,
                familia=familia, calibre=calibre, codigo_importacion=codigo_importacion_final,
                entrada=entrada, stock=stock,
            )
            try:
                # SAVEPOINT propio para esta fila: si choca con el
                # UniqueConstraint(bodega_id, codigo) -- alguien más creó
                # este mismo código en el instante entre nuestro chequeo de
                # `existentes` y este insert, una carrera real pero rara --
                # se deshace SOLO esta fila, no el resto de la carga ya
                # procesada en esta misma transacción.
                with db.begin_nested():
                    db.add(nuevo)
                    # Flush defensivo + registrar en el dict: si el mismo
                    # código vuelve a aparecer más abajo en el archivo, la
                    # siguiente iteración lo encuentra en `existentes`
                    # (autoflush=False en esta app — ver app/db/session.py).
                    db.flush()
            except IntegrityError:
                resultado.omitidas.append(
                    FilaOmitida(numero_fila, codigo, "Ese código ya fue creado justo ahora por otra carga -- reintenta esta fila.")
                )
                continue
            existentes[codigo] = nuevo
            resultado.creados += 1

    return resultado
