"""Consultas de rollos compartidas por varias rutas (Rollos almacenados e
Inventario total). Antes vivían en routes/rollos.py y routes/admin_inventario.py
las importaba de ahí: una ruta dependiendo de otra ruta."""

from sqlalchemy.orm import Session

from app.models.equivalencias import TablaEspesorEquivalencia
from app.models.rollo import Rollo
from app.services.clasificacion import peso_actual_toneladas


def filtro_empresa(empresa: str) -> str:
    """Valor a comparar con `Rollo.empresa` a partir del filtro recibido:
    "sin_empresa" busca los rollos cuya referencia no traía empresa (los que
    hay que corregir a mano)."""
    return "" if empresa == "sin_empresa" else empresa.strip().upper()


def asignar_peso_actual(db: Session, rollos: list[Rollo]) -> None:
    """Una sola consulta a la tabla de equivalencias para toda la página,
    en vez de una por rollo."""
    espesores = {e.espesor: e for e in db.query(TablaEspesorEquivalencia).all()}
    for rollo in rollos:
        rollo.peso_actual_toneladas = peso_actual_toneladas(rollo.calibre, rollo.metros_disponibles, espesores)
