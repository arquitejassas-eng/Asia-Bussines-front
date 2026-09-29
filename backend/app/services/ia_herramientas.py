"""Herramientas (function-calling) que el modelo de IA puede invocar para
responder con datos REALES de la bodega del usuario — nunca inventa cifras:
si necesita un dato, llama a una de estas funciones, que consulta la base de
datos igual que el resto de la app.

Cada función recibe siempre `db`, `bodega_id_propio` y `es_admin_inventario`
inyectados por el backend (nunca los decide el modelo). Para cualquier rol
que no sea Admin Inventario, la bodega consultada es SIEMPRE la propia —
cualquier `bodega_id`/`bodega_nombre` que el modelo intente pasar en los
argumentos de la herramienta se ignora por completo (`_resolver_bodega`).
Solo Admin Inventario (sin bodega fija) puede pedir una bodega específica —
por id o por nombre— o comparar todas a la vez con `comparar_bodegas`.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.db.filtros import coincide_bodega
from app.models.bodega import Bodega
from app.models.movimiento import Movimiento
from app.models.produccion import Produccion
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.services import ia_predicciones as srv_pred
from app.services import productos as srv_productos

LIMITE_RESULTADOS = 15


def _resolver_bodega(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    bodega_id: int | None = None, bodega_nombre: str = "",
) -> tuple[int | None, str | None, str | None]:
    """Decide contra qué bodega consultar: `(bodega_id, error, aviso)`. Los
    roles normales SIEMPRE consultan `bodega_id_propio`, sin importar qué
    haya mandado el modelo — si de todos modos pidió otra bodega, se devuelve
    un `aviso` explícito para que el modelo se lo diga al usuario en vez de
    fingir que la consultó (los datos igual son siempre los de su propia
    bodega, nunca los de la ajena). Solo Admin Inventario puede pedir otra
    bodega, por id o por nombre; sin especificar ninguna, también usa la
    propia (su pool sin asignar)."""
    if not es_admin_inventario:
        aviso = (
            "Tu cuenta solo puede consultar su propia bodega; se ignoró la bodega solicitada "
            "y estos datos son los de tu propia bodega."
        ) if (bodega_id is not None or bodega_nombre) else None
        return bodega_id_propio, None, aviso
    if bodega_nombre:
        bodega = db.query(Bodega).filter(Bodega.nombre.ilike(f"%{bodega_nombre}%")).first()
        if bodega is None:
            return None, f"No se encontró ninguna bodega con el nombre '{bodega_nombre}'.", None
        return bodega.id, None, None
    if bodega_id is not None:
        return bodega_id, None, None
    return bodega_id_propio, None, None


def _con_aviso(resultado: dict, aviso: str | None) -> dict:
    if aviso:
        resultado["aviso"] = aviso
    return resultado


def _resumen_bodega(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    bodega_id: int | None = None, bodega_nombre: str = "", **_: Any,
) -> dict:
    bid, error, aviso = _resolver_bodega(db, es_admin_inventario, bodega_id_propio, bodega_id, bodega_nombre)
    if error:
        return {"error": error}
    productos = db.query(Producto).filter(coincide_bodega(Producto.bodega_id, bid)).all()
    agotados = srv_productos.productos_agotados(db, bid)
    ids_agotados = {p.id for p in agotados}
    bajo_minimo = [p for p in srv_productos.productos_bajo_minimo(db, bid) if p.id not in ids_agotados]
    rollos = db.query(Rollo).filter(coincide_bodega(Rollo.bodega_id, bid)).all()
    return _con_aviso({
        "total_productos": len(productos),
        "productos_agotados": len(agotados),
        "productos_stock_bajo": len(bajo_minimo),
        "total_rollos": len(rollos),
        "rollos_abiertos": sum(1 for r in rollos if r.estado.value == "abierto"),
        "rollos_por_agotarse": sum(1 for r in rollos if r.estado.value == "abierto" and r.metros_disponibles < 50),
    }, aviso)


def _comparar_bodegas(db: Session, es_admin_inventario: bool, bodega_id_propio: int | None, **_: Any) -> dict:
    """Solo para Admin Inventario: resumen de cada bodega real, lado a lado,
    para responder preguntas como "qué bodega tiene más rollos" o "compara
    el inventario de todas las bodegas". Reutiliza `_resumen_bodega` por
    cada bodega en vez de duplicar las consultas."""
    if not es_admin_inventario:
        return {"error": "Esta herramienta solo está disponible para la cuenta Admin Inventario."}
    bodegas = db.query(Bodega).order_by(Bodega.nombre).all()
    return {
        "bodegas": [
            {"nombre": b.nombre, **_resumen_bodega(db, True, bodega_id_propio, bodega_id=b.id)}
            for b in bodegas
        ],
    }


def _buscar_productos(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    termino: str = "", solo_stock_bajo: bool = False, bodega_id: int | None = None, bodega_nombre: str = "", **_: Any,
) -> dict:
    bid, error, aviso = _resolver_bodega(db, es_admin_inventario, bodega_id_propio, bodega_id, bodega_nombre)
    if error:
        return {"error": error}
    consulta = db.query(Producto).filter(coincide_bodega(Producto.bodega_id, bid))
    if termino:
        patron = f"%{termino}%"
        consulta = consulta.filter((Producto.codigo.ilike(patron)) | (Producto.descripcion.ilike(patron)))
    if solo_stock_bajo:
        consulta = consulta.filter(Producto.stock_minimo.isnot(None), Producto.stock < Producto.stock_minimo)
    productos = consulta.order_by(Producto.stock.asc()).limit(LIMITE_RESULTADOS).all()
    return _con_aviso({
        "resultados": [
            {"codigo": p.codigo, "descripcion": p.descripcion, "stock": float(p.stock), "familia": p.familia}
            for p in productos
        ],
        "total_encontrados": consulta.count(),
    }, aviso)


def _buscar_rollos(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    termino: str = "", solo_disponibles: bool = True, bodega_id: int | None = None, bodega_nombre: str = "", **_: Any,
) -> dict:
    bid, error, aviso = _resolver_bodega(db, es_admin_inventario, bodega_id_propio, bodega_id, bodega_nombre)
    if error:
        return {"error": error}
    consulta = db.query(Rollo).filter(coincide_bodega(Rollo.bodega_id, bid))
    if termino:
        patron = f"%{termino}%"
        consulta = consulta.filter(
            (Rollo.codigo_interno.ilike(patron))
            | (Rollo.identificador_rollo.ilike(patron))
            | (Rollo.color_material.ilike(patron))
        )
    if solo_disponibles:
        consulta = consulta.filter(Rollo.metros_disponibles > 0)
    rollos = consulta.order_by(Rollo.metros_disponibles.desc()).limit(LIMITE_RESULTADOS).all()
    return _con_aviso({
        "resultados": [
            {
                "codigo_interno": r.codigo_interno, "referencia": r.identificador_rollo,
                "color": r.color_material, "calibre": r.calibre,
                "metros_disponibles": r.metros_disponibles, "estado": r.estado.value,
            }
            for r in rollos
        ],
        "total_encontrados": consulta.count(),
    }, aviso)


def _consultar_movimientos(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    dias: int = 7, tipo: str = "", bodega_id: int | None = None, bodega_nombre: str = "", **_: Any,
) -> dict:
    # Misma regla que GET /inventario/historial: el historial de movimientos
    # es solo de cada sede. Una cuenta sin bodega (Admin Inventario) no lo
    # consulta, ni de todas las sedes ni de una en particular.
    if bodega_id_propio is None:
        return {"error": "Esta cuenta no tiene acceso al historial de movimientos; cada bodega consulta solo el suyo."}
    bid, error, aviso = _resolver_bodega(db, es_admin_inventario, bodega_id_propio, bodega_id, bodega_nombre)
    if error:
        return {"error": error}
    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    consulta = db.query(Movimiento).filter(
        coincide_bodega(Movimiento.bodega_origen_id, bid) | coincide_bodega(Movimiento.bodega_destino_id, bid),
        Movimiento.fecha >= desde,
    )
    if tipo:
        consulta = consulta.filter(Movimiento.tipo == tipo.lower())
    movimientos = consulta.order_by(Movimiento.fecha.desc()).limit(LIMITE_RESULTADOS).all()
    return _con_aviso({
        "periodo_dias": dias,
        "total_movimientos": consulta.count(),
        "resultados": [
            {
                "fecha": m.fecha.isoformat(), "tipo": m.tipo.value, "producto": m.producto_descripcion,
                "cantidad": m.cantidad, "usuario": m.usuario,
            }
            for m in movimientos
        ],
    }, aviso)


def _consultar_producciones(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    dias: int = 30, bodega_id: int | None = None, bodega_nombre: str = "", **_: Any,
) -> dict:
    bid, error, aviso = _resolver_bodega(db, es_admin_inventario, bodega_id_propio, bodega_id, bodega_nombre)
    if error:
        return {"error": error}
    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    consulta = db.query(Produccion).filter(Produccion.bodega_id == bid, Produccion.fecha >= desde)
    producciones = consulta.order_by(Produccion.fecha.desc()).limit(LIMITE_RESULTADOS).all()
    return _con_aviso({
        "periodo_dias": dias,
        "total_producciones": consulta.count(),
        "resultados": [
            {
                "codigo_unico": p.codigo_unico, "fecha": p.fecha.isoformat(), "producto_fabricado": p.producto_fabricado,
                "modelo": p.modelo, "cantidad_productos": p.cantidad_productos, "metros_consumidos": p.total_metros_consumidos,
            }
            for p in producciones
        ],
    }, aviso)


def _predecir_producto(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    codigo: str = "", bodega_id: int | None = None, bodega_nombre: str = "", **_: Any,
) -> dict:
    if not codigo:
        return {"error": "Debes indicar el código del producto."}
    bid, error, aviso = _resolver_bodega(db, es_admin_inventario, bodega_id_propio, bodega_id, bodega_nombre)
    if error:
        return {"error": error}
    producto = db.query(Producto).filter(coincide_bodega(Producto.bodega_id, bid), Producto.codigo == codigo).first()
    if not producto:
        return {"error": f"No se encontró ningún producto con código '{codigo}' en esa bodega."}
    return _con_aviso(srv_pred.predecir_producto(db, producto), aviso)


def _tendencia_negocio(
    db: Session, es_admin_inventario: bool, bodega_id_propio: int | None,
    bodega_id: int | None = None, bodega_nombre: str = "", **_: Any,
) -> dict:
    bid, error, aviso = _resolver_bodega(db, es_admin_inventario, bodega_id_propio, bodega_id, bodega_nombre)
    if error:
        return {"error": error}
    return _con_aviso(srv_pred.tendencia_negocio(db, bid), aviso)


# ── Registro de herramientas ────────────────────────────────────────────────
# Formato de "function calling" que entiende Groq (compatible con el
# estándar de OpenAI): cada tool es {"type": "function", "function": {...}}.

_PARAMS_BODEGA_ADMIN_INVENTARIO = {
    "bodega_id": {"type": "integer", "description": "Solo para Admin Inventario: id de una bodega específica a consultar en vez de la propia."},
    "bodega_nombre": {"type": "string", "description": "Solo para Admin Inventario: nombre (o parte del nombre) de la bodega a consultar, como alternativa a bodega_id."},
}

HERRAMIENTAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "resumen_bodega",
            "description": "Da un resumen general del estado actual de la bodega: totales de productos y rollos, cuántos están agotados o bajos de stock.",
            "parameters": {"type": "object", "properties": {**_PARAMS_BODEGA_ADMIN_INVENTARIO}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "comparar_bodegas",
            "description": "Solo para Admin Inventario: compara el resumen de inventario y rollos de TODAS las bodegas a la vez, para responder qué bodega tiene más o menos existencias.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "buscar_productos",
            "description": "Busca productos generales (tornillos, amarres, etc.) por código o descripción, con su stock actual. Usa solo_stock_bajo=true para listar solo los que tienen poco stock.",
            "parameters": {
                "type": "object",
                "properties": {
                    "termino": {"type": "string", "description": "Texto a buscar en código o descripción. Vacío para listar los de menor stock."},
                    "solo_stock_bajo": {"type": "boolean", "description": "Si es true, solo trae productos por debajo de su stock mínimo configurado (los que no tienen mínimo configurado no cuentan como bajos)."},
                    **_PARAMS_BODEGA_ADMIN_INVENTARIO,
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "buscar_rollos",
            "description": "Busca rollos de acero por código interno, referencia o color, con sus metros disponibles y estado.",
            "parameters": {
                "type": "object",
                "properties": {
                    "termino": {"type": "string", "description": "Texto a buscar en código interno, referencia o color."},
                    "solo_disponibles": {"type": "boolean", "description": "Si es true (por defecto), solo trae rollos con metros disponibles > 0."},
                    **_PARAMS_BODEGA_ADMIN_INVENTARIO,
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_movimientos",
            "description": "Consulta el historial reciente de movimientos de inventario (entradas, salidas, traslados).",
            "parameters": {
                "type": "object",
                "properties": {
                    "dias": {"type": "integer", "description": "Cuántos días hacia atrás consultar. Por defecto 7."},
                    "tipo": {"type": "string", "description": "Filtrar por tipo: entrada, salida, traslado o transferencia. Vacío para todos."},
                    **_PARAMS_BODEGA_ADMIN_INVENTARIO,
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_producciones",
            "description": "Consulta las producciones recientes registradas (qué se fabricó, con qué rollos, cuántos metros se consumieron).",
            "parameters": {
                "type": "object",
                "properties": {
                    "dias": {"type": "integer", "description": "Cuántos días hacia atrás consultar. Por defecto 30."},
                    **_PARAMS_BODEGA_ADMIN_INVENTARIO,
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "predecir_producto",
            "description": "Calcula, con base en el historial real de salidas, en cuántos días se agotaría un producto específico y cuánto conviene reabastecer. Requiere el código exacto del producto (usa buscar_productos primero si no lo sabes).",
            "parameters": {
                "type": "object",
                "properties": {
                    "codigo": {"type": "string", "description": "Código exacto del producto."},
                    **_PARAMS_BODEGA_ADMIN_INVENTARIO,
                },
                "required": ["codigo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tendencia_negocio",
            "description": "Compara las salidas de inventario del último mes contra el mes anterior, e identifica el producto con más rotación.",
            "parameters": {"type": "object", "properties": {**_PARAMS_BODEGA_ADMIN_INVENTARIO}},
        },
    },
]

_IMPLEMENTACIONES: dict[str, Callable[..., dict]] = {
    "resumen_bodega": _resumen_bodega,
    "comparar_bodegas": _comparar_bodegas,
    "buscar_productos": _buscar_productos,
    "buscar_rollos": _buscar_rollos,
    "consultar_movimientos": _consultar_movimientos,
    "consultar_producciones": _consultar_producciones,
    "predecir_producto": _predecir_producto,
    "tendencia_negocio": _tendencia_negocio,
}


def ejecutar_herramienta(
    nombre: str, argumentos: dict, db: Session, bodega_id_propio: int | None, es_admin_inventario: bool = False,
) -> dict:
    implementacion = _IMPLEMENTACIONES.get(nombre)
    if implementacion is None:
        return {"error": f"Herramienta '{nombre}' no existe."}
    try:
        return implementacion(db=db, es_admin_inventario=es_admin_inventario, bodega_id_propio=bodega_id_propio, **argumentos)
    except TypeError as exc:
        return {"error": f"Argumentos inválidos para '{nombre}': {exc}"}
