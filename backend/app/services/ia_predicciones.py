"""Predicciones de stock basadas en el historial REAL de movimientos —
reemplaza la fórmula inventada (`stock / 2.5`) que había antes por una
velocidad de consumo calculada de verdad a partir de las salidas registradas.

No usa el modelo de lenguaje: es aritmética simple y verificable. El chat de
IA puede llamar a estas mismas funciones como "herramienta" para responder
preguntas de reabastecimiento con datos reales.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.filtros import coincide_bodega
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto

DIAS_HISTORIAL_DEFECTO = 30
DIAS_COBERTURA_OBJETIVO = 30


def _velocidad_diaria_producto(db: Session, producto: Producto, dias_historial: int) -> tuple[float, float]:
    """Retorna (total_salidas_periodo, velocidad_diaria)."""
    desde = datetime.now(timezone.utc) - timedelta(days=dias_historial)
    total = (
        db.query(func.coalesce(func.sum(Movimiento.cantidad), 0))
        .filter(
            Movimiento.producto_codigo == producto.codigo,
            coincide_bodega(Movimiento.bodega_origen_id, producto.bodega_id),
            Movimiento.tipo == TipoMovimiento.SALIDA,
            Movimiento.fecha >= desde,
        )
        .scalar()
    )
    total = float(total or 0)
    return total, total / dias_historial if dias_historial else 0.0


def predecir_producto(db: Session, producto: Producto, dias_historial: int = DIAS_HISTORIAL_DEFECTO) -> dict:
    """Calcula la predicción de un producto. Si no hay salidas registradas en
    el periodo, retorna None en los campos estimados en vez de inventar un
    número — es más honesto no predecir que predecir con datos inexistentes.
    """
    total_salidas, velocidad_diaria = _velocidad_diaria_producto(db, producto, dias_historial)
    stock_actual = float(producto.stock)

    if velocidad_diaria <= 0:
        return {
            "producto_id": producto.id,
            "producto_codigo": producto.codigo,
            "producto_descripcion": producto.descripcion,
            "stock_actual": stock_actual,
            "dias_estimados_agotamiento": None,
            "cantidad_sugerida_reabastecer": None,
            "confianza": None,
            "nota": f"Sin salidas registradas en los últimos {dias_historial} días — no hay datos suficientes para estimar.",
        }

    dias_estimados = round(stock_actual / velocidad_diaria, 1)
    cantidad_sugerida = max(0.0, round(velocidad_diaria * DIAS_COBERTURA_OBJETIVO - stock_actual, 1))
    # Confianza simple: más movimientos observados en el periodo, más confianza,
    # con un techo conservador — nunca se declara "seguro al 100%".
    confianza = round(min(0.9, 0.4 + total_salidas / 200), 2)

    return {
        "producto_id": producto.id,
        "producto_codigo": producto.codigo,
        "producto_descripcion": producto.descripcion,
        "stock_actual": stock_actual,
        "dias_estimados_agotamiento": dias_estimados,
        "cantidad_sugerida_reabastecer": cantidad_sugerida,
        "confianza": confianza,
        "nota": f"Basado en {total_salidas:g} unidades de salida en los últimos {dias_historial} días ({velocidad_diaria:.2f}/día).",
    }


def predecir_todos_los_productos(db: Session, bodega_id: int | None, dias_historial: int = DIAS_HISTORIAL_DEFECTO) -> list[dict]:
    productos = db.query(Producto).filter(coincide_bodega(Producto.bodega_id, bodega_id)).all()
    return [predecir_producto(db, p, dias_historial) for p in productos]


def tendencia_negocio(db: Session, bodega_id: int | None) -> dict:
    """Compara las salidas del último mes contra el mes anterior — tendencia
    real, no una frase fija. También identifica el producto con más rotación."""
    ahora = datetime.now(timezone.utc)
    inicio_mes_actual = ahora - timedelta(days=30)
    inicio_mes_anterior = ahora - timedelta(days=60)

    def total_salidas(desde: datetime, hasta: datetime) -> float:
        total = (
            db.query(func.coalesce(func.sum(Movimiento.cantidad), 0))
            .filter(
                coincide_bodega(Movimiento.bodega_origen_id, bodega_id),
                Movimiento.tipo == TipoMovimiento.SALIDA,
                Movimiento.fecha >= desde,
                Movimiento.fecha < hasta,
            )
            .scalar()
        )
        return float(total or 0)

    salidas_actual = total_salidas(inicio_mes_actual, ahora)
    salidas_anterior = total_salidas(inicio_mes_anterior, inicio_mes_actual)

    if salidas_anterior > 0:
        cambio_pct = round((salidas_actual - salidas_anterior) / salidas_anterior * 100, 1)
        tendencia = "creciente" if cambio_pct > 5 else "decreciente" if cambio_pct < -5 else "estable"
    else:
        cambio_pct = None
        tendencia = "estable" if salidas_actual == 0 else "creciente"

    top = (
        db.query(Movimiento.producto_codigo, Movimiento.producto_descripcion, func.sum(Movimiento.cantidad).label("total"))
        .filter(
            Movimiento.bodega_origen_id == bodega_id,
            Movimiento.tipo == TipoMovimiento.SALIDA,
            Movimiento.fecha >= inicio_mes_actual,
        )
        .group_by(Movimiento.producto_codigo, Movimiento.producto_descripcion)
        .order_by(func.sum(Movimiento.cantidad).desc())
        .first()
    )

    return {
        "salidas_mes_actual": salidas_actual,
        "salidas_mes_anterior": salidas_anterior,
        "cambio_porcentual": cambio_pct,
        "tendencia": tendencia,
        "producto_mayor_rotacion": {"codigo": top[0], "descripcion": top[1], "cantidad": float(top[2])} if top else None,
    }
