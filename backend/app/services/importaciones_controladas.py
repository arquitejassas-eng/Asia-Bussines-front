"""Importaciones con costo diferente (ej. la 17 de Arquitejas).

Regla: mientras un rollo de una importación controlada sea de la empresa que
lo importó, NADIE le saca metros (ni Planta al producir ni la salida de una
cotización por corte): solo se vende completo. Si se le vende completo a la
otra empresa, esa ya lo usa normal.

Sus metros sí cuentan como disponibles (los vendedores cotizan igual que
siempre). Pero cuando a una línea por corte le falta material en su bodega y
existe material de una importación controlada, se le crea una alerta a Admin
Inventario con las opciones (traer de otra bodega, vender el rollo completo a
la otra empresa o anular). Mientras la alerta esté pendiente la cotización no
se puede producir. La alerta se revisa sola: si ya no hace falta, se cierra.
"""

import json
import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.apartado import Apartado, ApartadoItem, EstadoApartado, ModalidadApartado
from app.models.bodega import Bodega
from app.models.importacion_controlada import AlertaImportacion, ImportacionControlada
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.services.apartados import (
    ESTADOS_RESERVA_ACTIVA, _items_activos_en_orden, _repartir_lamina, de_la_empresa, rollos_apartados_completos,
    rollos_en_traslado,
)
from app.services.empresas import AMBAS_EMPRESAS, EMPRESAS_CONOCIDAS

PENDIENTE, AUTORIZADA, ANULADA, RESUELTA = "pendiente", "autorizada", "anulada", "resuelta"
ESTADOS_ABIERTOS = (PENDIENTE, AUTORIZADA)
_PREFIJO = re.compile(r"^\s*(\d+)\s*(ABG|AR)", re.IGNORECASE)
TOLERANCIA = 0.005


def clave_de_referencia(referencia: str | None) -> str:
    """"17ARLA50170,33-01" → "17AR"; "" si la referencia no empieza así."""
    encontrado = _PREFIJO.match(referencia or "")
    return f"{int(encontrado.group(1))}{encontrado.group(2).upper()}" if encontrado else ""


def nombre_importacion(clave: str) -> str:
    """"17AR" → "importación 17 de Arquitejas"."""
    encontrado = _PREFIJO.match(clave or "")
    if not encontrado:
        return clave
    return f"importación {int(encontrado.group(1))} de {EMPRESAS_CONOCIDAS.get(encontrado.group(2).upper(), encontrado.group(2))}"


def claves_activas(db: Session) -> dict[str, str]:
    """{"17AR": "AR"}: las importaciones controladas y la empresa que las importó."""
    return {c: e for c, e in db.query(ImportacionControlada.clave, ImportacionControlada.empresa)
            .filter(ImportacionControlada.activa.is_(True))}


def es_controlado(rollo: Rollo, claves: dict[str, str]) -> bool:
    """El rollo es de una importación controlada y sigue siendo de la empresa que la importó."""
    clave = clave_de_referencia(rollo.identificador_rollo)
    return bool(clave) and clave in claves and (rollo.empresa or "") == claves[clave]


def exigir_rollo_no_controlado(db: Session, rollo: Rollo, claves: dict[str, str] | None = None) -> None:
    """Nadie le saca metros a un rollo de una importación controlada."""
    claves = claves_activas(db) if claves is None else claves
    if es_controlado(rollo, claves):
        clave = clave_de_referencia(rollo.identificador_rollo)
        otra = next((n for s, n in EMPRESAS_CONOCIDAS.items() if s != claves[clave]), "la otra empresa")
        raise HTTPException(
            status_code=400,
            detail=f"El rollo {rollo.identificador_rollo} es de la {nombre_importacion(clave)}: esos rollos solo se "
            f"venden completos, no se les pueden sacar metros. Usa otro rollo, o que Admin Inventario le venda "
            f"el rollo completo a {otra}.",
        )


def _pendiente(item: ApartadoItem) -> float:
    return max(float((item.metros_requeridos or 0) - (item.metros_consumidos or 0)), 0.0)


def _necesidad(db: Session, apartado: Apartado, item: ApartadoItem, claves: dict[str, str],
               bodegas: dict[int, Bodega], cache: dict) -> dict | None:
    """Qué le falta a la línea en su bodega (sin contar los rollos controlados)
    y qué hay para cubrirlo. None si no hace falta alerta: le alcanza con el
    material normal de su bodega, o no hay material controlado de ese código."""
    codigo = item.codigo_interno
    if codigo not in cache:
        rollos = db.query(Rollo).filter(Rollo.codigo_interno == codigo, Rollo.metros_disponibles > TOLERANCIA).all()
        en_traslado = rollos_en_traslado(db, [r.id for r in rollos])
        rollos = [r for r in rollos if r.id not in en_traslado and r.bodega_id is not None]
        vendidos = rollos_apartados_completos(db, [r.id for r in rollos])
        cache[codigo] = (rollos, vendidos)
    rollos, vendidos = cache[codigo]
    controlados = [r for r in rollos if es_controlado(r, claves)]
    if not controlados:
        return None
    empresa = item.empresa_de_linea or ""
    de_la_linea = (lambda r: True) if empresa in ("", AMBAS_EMPRESAS) else (lambda r: (r.empresa or "") == empresa)
    bodega_id = apartado.bodega_id
    normal_en_bodega = sum(r.metros_disponibles for r in rollos
                           if r.bodega_id == bodega_id and de_la_linea(r) and not es_controlado(r, claves))
    filtro = ApartadoItem.codigo_interno == codigo
    if empresa not in ("", AMBAS_EMPRESAS):
        filtro = filtro & de_la_empresa(empresa)
    ids_controlados = {r.id for r in controlados}
    lineas = [it for it in _items_activos_en_orden(db, bodega_id=bodega_id, filtro=filtro) if it.rollo_id not in ids_controlados]
    if not any(it.id == item.id for it in lineas):
        lineas.append(item)
    cubierto = _repartir_lamina(lineas, normal_en_bodega).get(item.id, 0.0)
    requerido = _pendiente(item)
    falta = round(requerido - cubierto, 2)
    if falta <= TOLERANCIA:
        return None
    # Otras bodegas con material normal (se trae con un traslado; si es de la
    # otra empresa queda como préstamo, como siempre).
    otras: dict[tuple[int, str], list[Rollo]] = {}
    for r in rollos:
        if r.bodega_id == bodega_id or es_controlado(r, claves) or r.id in vendidos:
            continue
        bodega = bodegas.get(r.bodega_id)
        if bodega is None or bodega.lejana:
            continue
        otras.setdefault((r.bodega_id, r.empresa or ""), []).append(r)
    return {
        "requerido": round(requerido, 2), "en_bodega": round(cubierto, 2), "falta": falta,
        "importaciones": sorted({clave_de_referencia(r.identificador_rollo) for r in controlados}),
        "opciones": {
            "otras_bodegas": sorted(
                ({"bodega_id": b, "bodega": bodegas[b].nombre, "empresa": e,
                  "metros": round(sum(r.metros_disponibles for r in rs), 2),
                  # Para pedir el traslado desde la alerta: los rollos uno a uno.
                  "rollos": [{"id": r.id, "referencia": r.identificador_rollo, "metros": round(r.metros_disponibles, 2)}
                             for r in sorted(rs, key=lambda r: -r.metros_disponibles)]}
                 for (b, e), rs in otras.items()),
                key=lambda o: -o["metros"]),
            "rollos_controlados": sorted(
                ({"id": r.id, "referencia": r.identificador_rollo, "bodega_id": r.bodega_id,
                  "bodega": bodegas[r.bodega_id].nombre if r.bodega_id in bodegas else "", "empresa": r.empresa or "",
                  "metros": round(r.metros_disponibles, 2), "importacion": clave_de_referencia(r.identificador_rollo),
                  "vendido": r.id in vendidos} for r in controlados),
                key=lambda o: (o["bodega_id"] != bodega_id, -o["metros"])),
        },
    }


def evaluar_apartados(db: Session, apartados: list[Apartado]) -> None:
    """Crea, actualiza o cierra las alertas de esas cotizaciones."""
    if not apartados:
        return
    claves = claves_activas(db)
    ahora = datetime.now(timezone.utc)
    bodegas = {b.id: b for b in db.query(Bodega).all()}
    cache: dict = {}
    ids = [a.id for a in apartados]
    existentes: dict[int, list[AlertaImportacion]] = {}
    for alerta in db.query(AlertaImportacion).filter(AlertaImportacion.apartado_id.in_(ids),
                                                     AlertaImportacion.estado.in_(ESTADOS_ABIERTOS)):
        existentes.setdefault(alerta.apartado_id, []).append(alerta)
    for apartado in apartados:
        abiertas = {a.apartado_item_id: a for a in existentes.get(apartado.id, [])}
        necesidades: dict[int, tuple[ApartadoItem, dict]] = {}
        if claves and apartado.estado in ESTADOS_RESERVA_ACTIVA and not apartado.orden_interna:
            for item in apartado.items:
                if (item.modalidad != ModalidadApartado.POR_ROLLO or item.rollo_id is not None or not item.codigo_interno
                        or _pendiente(item) <= TOLERANCIA):
                    continue
                datos = _necesidad(db, apartado, item, claves, bodegas, cache)
                if datos is not None:
                    necesidades[item.id] = (item, datos)
        for item_id, alerta in abiertas.items():
            if item_id in necesidades or alerta.estado != PENDIENTE:
                continue
            anulada = apartado.estado == EstadoApartado.CANCELADO
            alerta.estado = ANULADA if anulada else RESUELTA
            alerta.decidida_por = alerta.decidida_por or "sistema"
            alerta.fecha_decision = ahora
            alerta.nota = (alerta.nota + " " if alerta.nota else "") + (
                "La cotización se anuló." if anulada else "Ya no hace falta: la bodega ya tiene el material.")
        for item_id, (item, datos) in necesidades.items():
            alerta = abiertas.get(item_id)
            if alerta is None:
                alerta = AlertaImportacion(apartado_id=apartado.id, apartado_item_id=item.id, estado=PENDIENTE,
                                           fecha_creacion=ahora)
                db.add(alerta)
            elif alerta.estado != PENDIENTE:
                continue  # Ya autorizada: no se vuelve a preguntar.
            alerta.numero_cotizacion = apartado.numero_cotizacion
            alerta.bodega_id = apartado.bodega_id
            alerta.codigo = item.codigo_interno or ""
            alerta.descripcion = (item.descripcion or "")[:255]
            alerta.empresa_linea = item.empresa_de_linea or ""
            alerta.metros_requeridos = datos["requerido"]
            alerta.metros_en_bodega = datos["en_bodega"]
            alerta.metros_faltantes = datos["falta"]
            alerta.importaciones = ", ".join(datos["importaciones"])[:120]
            alerta.opciones = json.dumps(datos["opciones"], ensure_ascii=False)
            alerta.fecha_actualizacion = ahora
    db.flush()


def evaluar_cotizacion(db: Session, numero_cotizacion: str) -> None:
    """Todas las partes (bodegas) de una cotización."""
    if not numero_cotizacion:
        return
    evaluar_apartados(db, db.query(Apartado).filter(Apartado.numero_cotizacion == numero_cotizacion).all())


def evaluar_activas_del_codigo(db: Session, codigos: set[str]) -> None:
    """Al marcar una importación: revisa las cotizaciones activas con líneas por corte de esos códigos."""
    if not codigos:
        return
    apartados = (
        db.query(Apartado).join(ApartadoItem, ApartadoItem.apartado_id == Apartado.id)
        .filter(Apartado.estado.in_(ESTADOS_RESERVA_ACTIVA), ApartadoItem.codigo_interno.in_(codigos),
                ApartadoItem.modalidad == ModalidadApartado.POR_ROLLO, ApartadoItem.rollo_id.is_(None))
        .distinct().all()
    )
    evaluar_apartados(db, apartados)


def exigir_sin_alerta_pendiente(db: Session, apartado: Apartado) -> None:
    """Una cotización con alerta pendiente no se produce. Antes se revisa otra
    vez: si ya llegó el material, la alerta se cierra sola."""
    evaluar_apartados(db, [apartado])
    pendiente = (
        db.query(AlertaImportacion)
        .filter(AlertaImportacion.apartado_id == apartado.id, AlertaImportacion.estado == PENDIENTE)
        .first()
    )
    if pendiente is not None:
        raise HTTPException(
            status_code=400,
            detail=f"La cotización {apartado.numero_cotizacion} está esperando autorización de Admin Inventario: a "
            f"{pendiente.codigo} le faltan {pendiente.metros_faltantes:g} m en esta bodega y hay material de la "
            f"{', '.join(nombre_importacion(c) for c in pendiente.importaciones.split(', ') if c)} (solo se vende "
            "en rollo completo). Hasta que Admin Inventario decida no se puede producir.",
        )


def decidir(db: Session, alerta: AlertaImportacion, estado: str, usuario: Usuario, nota: str = "") -> AlertaImportacion:
    if alerta.estado != PENDIENTE:
        raise HTTPException(status_code=400, detail="Esa alerta ya se decidió.")
    alerta.estado = estado
    alerta.decidida_por = usuario.correo
    alerta.fecha_decision = datetime.now(timezone.utc)
    if nota.strip():
        alerta.nota = (alerta.nota + " " if alerta.nota else "") + nota.strip()[:400]
    db.flush()
    return alerta
