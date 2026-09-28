"""
Lógica de negocio del módulo "Recepción, Verificación y Clasificación".

Replica en el backend las reglas ya validadas en el prototipo de frontend
(Recepcionverificacion.jsx):

  - Detección automática de columnas del Excel del proveedor por alias.
  - Clasificación automática: tipo + color + espesor, usando las tablas de
    equivalencias configurables (guardadas en BD, no hardcodeadas).
  - Cálculo de metros = Net Weight (toneladas) × MT-por-tonelada del espesor,
    comparado contra los Coil Meters reportados con un margen de tolerancia.

Mantener esta lógica separada de los routers permite testearla de forma
aislada y reutilizarla tanto en la previsualización como en la confirmación.
"""
from __future__ import annotations

from io import BytesIO
import unicodedata
from dataclasses import dataclass, field

import pandas as pd

CAMPOS_REQUERIDOS = ["rollo", "espesor", "net_weight", "coil_meters"]

ALIAS_CAMPOS: dict[str, list[str]] = {
    "rollo": ["codigo", "codigo de rollo", "numero de rollo", "n rollo", "no rollo", "rollo",
              "identificador de rollo", "id rollo", "coil", "coil no"],
    "espesor": ["espesor", "thickness", "calibre"],
    "ancho": ["ancho", "width"],
    "net_weight": ["net weight", "net weight (mt)", "netweight", "peso neto"],
    "gross_weight": ["gross weight", "gross weight (mt)", "grossweight", "peso bruto"],
    "coil_meters": ["coil meters", "coil meter", "metros", "metros reportados", "metraje", "mts"],
    "color_top": ["color top", "top", "color superior"],
    "color_back": ["color back", "back", "color inferior"],
    "codigo_proveedor": ["codigo proveedor", "codigo del proveedor", "supplier code"],
    "tipo_material": ["tipo de material", "tipo material", "material", "informacion del material", "descripcion"],
    "proveedor": ["proveedor", "empresa proveedora", "supplier"],
    "lote": ["lote", "batch"],
}

TOLERANCIA_PORCENTAJE_DEFECTO = 2.0


def normalizar_texto(texto: str | None) -> str:
    if not texto:
        return ""
    sin_tildes = unicodedata.normalize("NFD", str(texto))
    sin_tildes = "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn")
    return sin_tildes.lower().strip()


FILAS_A_REVISAR_ENCABEZADO = 20


def _detectar_fila_encabezado(hoja_cruda: pd.DataFrame) -> int:
    """Encuentra en qué fila (0-index) están los encabezados reales.

    Muchos reportes exportados (ej. "INVENTARIO MAXITEJAS") traen primero un
    título y filas en blanco antes de la fila con los nombres de columna. Sin
    esto, pandas asume que los encabezados están siempre en la fila 0: esa
    fila casi vacía se vuelve el encabezado, y las columnas de verdad quedan
    como "Unnamed: 1", "Unnamed: 2"... — el mapeo automático no reconoce nada
    y el selector manual de columnas en el frontend no tiene nombres reales
    para mostrar. Se asume como encabezado la fila con más celdas no vacías
    entre las primeras `FILAS_A_REVISAR_ENCABEZADO`: una fila de título tiene
    una sola celda con texto, mientras que la fila de encabezados nombra casi
    todas las columnas. Si los encabezados ya están en la fila 0 (caso normal
    hasta ahora), esa sigue siendo la de mayor densidad y el resultado no cambia."""
    mejor_fila = 0
    mejor_cantidad = -1
    limite = min(FILAS_A_REVISAR_ENCABEZADO, len(hoja_cruda))
    for i in range(limite):
        cantidad = int(hoja_cruda.iloc[i].notna().sum())
        if cantidad > mejor_cantidad:
            mejor_cantidad = cantidad
            mejor_fila = i
    return mejor_fila


def leer_hojas_excel(contenido: bytes) -> dict[str, pd.DataFrame]:
    """Devuelve {nombre_hoja: DataFrame} de todas las hojas del archivo,
    detectando automáticamente en qué fila de cada hoja están los encabezados
    (ver `_detectar_fila_encabezado`)."""
    libro = pd.ExcelFile(BytesIO(contenido))
    hojas: dict[str, pd.DataFrame] = {}
    for hoja in libro.sheet_names:
        cruda = libro.parse(hoja, dtype=str, header=None)
        fila_encabezado = _detectar_fila_encabezado(cruda)
        hojas[hoja] = libro.parse(hoja, dtype=str, header=fila_encabezado)
    return hojas


def _hoja_parece_tabla(df: pd.DataFrame) -> bool:
    """Una hoja "parece" una tabla de datos si la mayoría de sus columnas son
    texto real -- no números crudos ni "Unnamed: N", que aparecen cuando la
    hoja es de cálculos/referencia y no una tabla (ej. una hoja "CAL" cuyos
    "encabezados" resultan ser 127.8, 4138, etc. porque ahí no hay ninguna
    fila real de títulos de columna)."""
    columnas = list(df.columns)
    if not columnas:
        return False
    validas = sum(
        1 for c in columnas
        if isinstance(c, str) and c.strip() and not c.lower().startswith("unnamed:")
    )
    return validas / len(columnas) >= 0.5


def elegir_hoja_principal(hojas: dict[str, pd.DataFrame], excluir: tuple[str, ...] = ()) -> str:
    """Elige la primera hoja (en el orden del archivo) que parezca una tabla
    real, saltándose las de `excluir` (ej. las hojas de equivalencias que ya
    detecta Recepción por nombre). Si ninguna califica, cae al comportamiento
    anterior (la primera disponible) -- el usuario siempre puede corregirlo a
    mano con el selector de hoja que ya existe en Rollos/Inventario/Recepción."""
    candidatas = [h for h in hojas if h not in excluir]
    for nombre in candidatas:
        if _hoja_parece_tabla(hojas[nombre]):
            return nombre
    return candidatas[0]


def auto_detectar_mapeo(
    encabezados: list[str], alias_campos: dict[str, list[str]] = ALIAS_CAMPOS
) -> dict[str, str]:
    """Adivina, para cada campo interno, qué columna del Excel le corresponde.

    Genérica para cualquier flujo de carga por Excel (recepción, carga de
    productos, carga de rollos) — cada uno pasa su propio `alias_campos`;
    si no se pasa ninguno, usa el de recepción (comportamiento histórico)."""
    mapeo: dict[str, str] = {}
    normalizados = {normalizar_texto(e): e for e in encabezados}
    for campo, alias in alias_campos.items():
        columna = next((normalizados[a] for a in alias if a in normalizados), "")
        mapeo[campo] = columna
    return mapeo


def campos_requeridos_faltantes(
    mapeo: dict[str, str], campos_requeridos: list[str] = CAMPOS_REQUERIDOS
) -> list[str]:
    return [c for c in campos_requeridos if not mapeo.get(c)]


@dataclass
class TablasEquivalencia:
    colores: dict[str, dict] = field(default_factory=dict)       # ral/nombre -> {ral, nombre, codigo_interno}
    tipos: dict[str, dict] = field(default_factory=dict)         # nombre -> {codigo_interno}
    espesores: dict[float, dict] = field(default_factory=dict)   # espesor -> {mt_por_ton, peso_por_metro}


@dataclass
class RolloClasificado:
    fila: int
    rollo: str
    codigo_proveedor: str
    espesor: float | None
    ancho: float | None
    net_weight: float | None
    gross_weight: float | None
    coil_meters: float | None
    color_top: str
    color_back: str
    tipo_material: str
    proveedor: str
    lote: str

    clasificado: bool
    codigo_clasificacion: str | None
    color_nombre: str | None
    tipo_nombre: str | None

    metros_calculados: float | None
    diferencia_porcentaje: float | None
    resultado: str  # "ok" | "diferencia" | "pendiente_datos"


def _a_float(valor) -> float | None:
    try:
        if valor is None or (isinstance(valor, str) and not valor.strip()):
            return None
        return float(str(valor).replace(",", "."))
    except (TypeError, ValueError):
        return None


def clasificar_y_verificar_filas(
    df: pd.DataFrame,
    mapeo: dict[str, str],
    tablas: TablasEquivalencia,
    tolerancia_porcentaje: float = TOLERANCIA_PORCENTAJE_DEFECTO,
) -> list[RolloClasificado]:
    """Aplica clasificación automática y cálculo/comparación de metros a
    cada fila del Excel ya mapeado."""
    resultados: list[RolloClasificado] = []

    for indice, fila in df.iterrows():
        def obtener(campo: str) -> str:
            columna = mapeo.get(campo, "")
            if not columna or columna not in df.columns:
                return ""
            valor = fila.get(columna)
            return "" if pd.isna(valor) else str(valor).strip()

        espesor = _a_float(obtener("espesor"))
        net_weight = _a_float(obtener("net_weight"))
        coil_meters = _a_float(obtener("coil_meters"))
        color_top = obtener("color_top")
        tipo_material = obtener("tipo_material") or "Lamina"

        # --- clasificación automática (tipo + color + espesor) ---
        info_tipo = tablas.tipos.get(normalizar_texto(tipo_material))
        info_color = tablas.colores.get(normalizar_texto(color_top)) or _buscar_color_por_ral(
            tablas, color_top
        )
        info_espesor = tablas.espesores.get(espesor) if espesor is not None else None

        clasificado = bool(info_tipo and info_color and info_espesor)
        codigo_clasificacion = None
        color_nombre = info_color["nombre"] if info_color else None
        tipo_nombre = tipo_material if info_tipo else None

        if clasificado:
            codigo_clasificacion = _crear_codigo_interno(
                info_tipo["codigo_interno"], info_color, espesor
            )

        # --- cálculo de metros y comparación contra lo reportado ---
        metros_calculados = None
        diferencia_porcentaje = None
        if net_weight is not None and info_espesor is not None:
            metros_calculados = round(net_weight * info_espesor["mt_por_ton"], 2)

        if metros_calculados is not None and coil_meters:
            diferencia_porcentaje = round(
                abs(metros_calculados - coil_meters) / coil_meters * 100, 2
            )

        if metros_calculados is None or coil_meters is None:
            resultado = "pendiente_datos"
        elif diferencia_porcentaje is not None and diferencia_porcentaje > tolerancia_porcentaje:
            resultado = "diferencia"
        else:
            resultado = "ok"

        resultados.append(
            RolloClasificado(
                fila=int(indice) + 2,  # +2: encabezado + índice base-1 de Excel
                rollo=obtener("rollo"),
                codigo_proveedor=obtener("codigo_proveedor"),
                espesor=espesor,
                ancho=_a_float(obtener("ancho")),
                net_weight=net_weight,
                gross_weight=_a_float(obtener("gross_weight")),
                coil_meters=coil_meters,
                color_top=color_top,
                color_back=obtener("color_back"),
                tipo_material=tipo_material,
                proveedor=obtener("proveedor"),
                lote=obtener("lote"),
                clasificado=clasificado,
                codigo_clasificacion=codigo_clasificacion,
                color_nombre=color_nombre,
                tipo_nombre=tipo_nombre,
                metros_calculados=metros_calculados,
                diferencia_porcentaje=diferencia_porcentaje,
                resultado=resultado,
            )
        )

    return resultados


def _buscar_color_por_ral(tablas: TablasEquivalencia, valor: str) -> dict | None:
    color = tablas.colores.get(normalizar_texto(valor))
    if color:
        return color

    # Acepta indistintamente RAL3005 y 3005 cuando exista la equivalencia.
    ral_consultado = normalizar_texto(valor).removeprefix("ral")
    for clave, info in tablas.colores.items():
        if clave.removeprefix("ral") == ral_consultado:
            return info
    return None


def formatear_calibre(calibre: float) -> str:
    """Calibre como se escribe en el negocio: siempre dos decimales y coma
    (0.2 -> "0,20", nunca "0,2"). Es el mismo texto que llevan los códigos de
    clasificación y las referencias de los rollos."""
    return f"{calibre:.2f}".replace(".", ",")


def _crear_codigo_interno(codigo_tipo: str, color: dict, espesor: float) -> str:
    """Forma el código: tipo + inicial del color + RAL + espesor.

    Ejemplo: Lámina roja RAL3005 de 0.32 mm -> LR30050,32 (y de 0.2 mm ->
    LR30050,20, con los dos decimales, igual que el código escrito a mano).
    """
    nombre_color = str(color.get("nombre", "")).strip()
    inicial_color = normalizar_texto(nombre_color)[:1].upper()
    ral = str(color.get("ral", "")).strip().upper().replace(" ", "")
    ral_sin_prefijo = ral.removeprefix("RAL")

    return f"{codigo_tipo}{inicial_color}{ral_sin_prefijo}{formatear_calibre(espesor)}"


def peso_actual_toneladas(
    calibre: float | None, metros_disponibles: float, espesores: dict[float, "TablaEspesorEquivalencia"]
) -> float | None:
    """Inverso de metros_calculados: cuánto pesa HOY un rollo según los metros
    que le quedan, usando el mismo espesor->mt_por_ton que ya convierte peso a
    metros en Recepción -- nunca se deriva del peso_neto original (que puede
    no existir, ej. ingreso manual), solo del espesor real del rollo."""
    if calibre is None:
        return None
    info_espesor = espesores.get(calibre)
    if info_espesor is None or not info_espesor.mt_por_ton:
        return None
    return round(metros_disponibles / info_espesor.mt_por_ton, 3)


def resumen_verificacion(rollos: list[RolloClasificado]) -> dict:
    return {
        "total_rollos": len(rollos),
        "ok": sum(1 for r in rollos if r.resultado == "ok"),
        "con_diferencia": sum(1 for r in rollos if r.resultado == "diferencia"),
        "pendientes_datos": sum(1 for r in rollos if r.resultado == "pendiente_datos"),
    }


def estado_general_recepcion(rollos: list[RolloClasificado]) -> str:
    resumen = resumen_verificacion(rollos)
    if resumen["pendientes_datos"] > 0:
        return "pendiente_de_datos"
    if resumen["con_diferencia"] > 0:
        return "verificada_con_diferencias"
    return "verificada_sin_diferencias"


ALIAS_EQUIVALENCIA_ESPESOR: dict[str, list[str]] = {
    "espesor": ["espesor", "espesor (mm)", "thickness", "calibre"],
    "mt_por_ton": ["mt x ton", "mt/ton", "metros por tonelada", "mtporton", "mts x ton", "mt por ton"],
    "peso_por_metro": ["peso x metro (kg/m)", "peso x metro", "peso por metro", "kg/m", "peso por metro (kg/m)"],
    "tipo_material": ["tipo material", "tipo de material", "material"],
    "codigo_tipo": ["codigo tipo", "codigo tipo material", "codigo interno"],
}

ALIAS_EQUIVALENCIA_COLOR: dict[str, list[str]] = {
    "ral": ["codigo ral", "ral", "codigo del proveedor", "codigo proveedor"],
    "nombre": ["color", "nombre"],
    "codigo_interno": ["codigo interno", "codigo"],
}


def detectar_hojas_equivalencias(nombres_hojas: list[str]) -> tuple[str | None, str | None]:
    normalizados = [(n, normalizar_texto(n)) for n in nombres_hojas]
    hoja_color = next((n for n, norm in normalizados if "equivalencia" in norm and "color" in norm), None)
    hoja_espesor = next((n for n, norm in normalizados if "equivalencia" in norm and "color" not in norm), None)
    return hoja_espesor, hoja_color


def _mapeo_por_alias(encabezados: list[str], alias: dict[str, list[str]]) -> dict[str, str]:
    mapeo = {}
    normalizados = {normalizar_texto(e): e for e in encabezados}
    for campo, lista in alias.items():
        mapeo[campo] = next((normalizados[a] for a in lista if a in normalizados), "")
    return mapeo


def leer_hoja_equivalencia_espesor(df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    mapeo = _mapeo_por_alias(list(df.columns), ALIAS_EQUIVALENCIA_ESPESOR)
    if not mapeo["espesor"]:
        return [], []

    # IMPORTANTE: se usan dicts (no listas) para deduplicar por clave.
    # Si el Excel trae varias filas con el mismo tipo de material (por
    # ejemplo "Lámina" repetida una vez por cada espesor), aquí solo debe
    # sobrevivir UNA entrada por nombre. Si se dejaran duplicados, el router
    # intentaría insertar el mismo `nombre` dos veces dentro de la misma
    # transacción y MySQL lanzaría IntegrityError por el UNIQUE de esa
    # columna (Duplicate entry '...' for key 'nombre').
    espesores_por_valor: dict[float, dict] = {}
    tipos_por_nombre: dict[str, dict] = {}

    for _, fila in df.iterrows():
        espesor = _a_float(fila.get(mapeo["espesor"]))
        if espesor is None:
            continue
        mt_por_ton = _a_float(fila.get(mapeo["mt_por_ton"])) if mapeo["mt_por_ton"] else None
        peso_por_metro = _a_float(fila.get(mapeo["peso_por_metro"])) if mapeo["peso_por_metro"] else None
        if mt_por_ton is None and peso_por_metro:
            mt_por_ton = round(1000 / peso_por_metro, 2)
        elif peso_por_metro is None and mt_por_ton:
            peso_por_metro = round(1000 / mt_por_ton, 3)
        if mt_por_ton is not None and peso_por_metro is not None:
            espesores_por_valor[espesor] = {
                "espesor": espesor,
                "mt_por_ton": mt_por_ton,
                "peso_por_metro": peso_por_metro,
            }

        tipo_material = str(fila.get(mapeo["tipo_material"]) or "").strip() if mapeo["tipo_material"] else ""
        codigo_tipo = str(fila.get(mapeo["codigo_tipo"]) or "").strip() if mapeo["codigo_tipo"] else ""
        if tipo_material and codigo_tipo:
            tipos_por_nombre[normalizar_texto(tipo_material)] = {
                "nombre": tipo_material,
                "codigo_interno": codigo_tipo,
            }

    return list(espesores_por_valor.values()), list(tipos_por_nombre.values())


def leer_hoja_equivalencia_color(df: pd.DataFrame) -> list[dict]:
    mapeo = _mapeo_por_alias(list(df.columns), ALIAS_EQUIVALENCIA_COLOR)
    if not mapeo["ral"]:
        return []

    # Mismo motivo que arriba: deduplicar por `ral` para no intentar
    # insertar dos veces el mismo código dentro de la misma transacción.
    filas_por_ral: dict[str, dict] = {}

    for _, fila in df.iterrows():
        ral = str(fila.get(mapeo["ral"]) or "").strip()
        if not ral:
            continue
        nombre = str(fila.get(mapeo["nombre"]) or "").strip() if mapeo["nombre"] else ""
        codigo_interno = str(fila.get(mapeo["codigo_interno"]) or "").strip() if mapeo["codigo_interno"] else ""
        if not codigo_interno:
            continue
        ral_normalizado = ral.upper().replace(" ", "")
        if not ral_normalizado.startswith("RAL"):
            ral_normalizado = f"RAL{ral_normalizado}"
        filas_por_ral[ral_normalizado] = {
            "ral": ral_normalizado,
            "nombre": nombre,
            "codigo_interno": codigo_interno,
        }

    return list(filas_por_ral.values())
