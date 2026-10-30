"""Subir una cotización del programa a Siigo Nube.

Cada empresa cobra la lámina en una unidad distinta en su Siigo:
- Asia Business, en KILOS: metros × peso por metro del espesor (tabla de
  equivalencias de espesor, con 3 decimales como en la hoja del negocio:
  0,38 -> 3,628 kg/m).
- Arquitejas, en CENTÍMETROS: metros × 100.
Los productos de stock que no son lámina (tornillos, siliconas...) van por
unidad. El programa SUGIERE esa cantidad; el vendedor la puede cambiar.

El detalle de cada línea (ej. "20 TEJAS COLONIAL ... (142 MTS - 515,2 KG)")
va en la descripción de la línea en Siigo: la cotización de la API no tiene
observaciones. El IVA y la retención en la fuente los calcula Siigo con los
impuestos que se marquen; el ReteICA se pone en la factura, no aquí.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.apartado import Apartado, ApartadoItem, ModalidadApartado
from app.models.equivalencias import TablaEspesorEquivalencia
from app.models.producto import Producto
from app.models.siigo import SiigoPreferencia
from app.models.usuario import Usuario
from app.services import siigo
from app.services.empresas import EMPRESAS_CONOCIDAS
from app.services.seccionados import metros_de_linea

UNIDAD_POR_EMPRESA = {"ABG": "kg", "AR": "cm"}
ESPESOR_EN_CODIGO = re.compile(r",(\d{2})$")
ESPESOR_EN_TEXTO = re.compile(r"\b0\s*[.,]\s*(\d{2})\b")

TIPO_PRODUCTO, TIPO_VENDEDOR, TIPO_CLIENTE = "producto", "vendedor", "cliente"


def _espesor(codigo_interno: str | None, *textos: str | None) -> float | None:
    final = ESPESOR_EN_CODIGO.search((codigo_interno or "").strip())
    if final:
        return int(final.group(1)) / 100
    for texto in textos:
        encontrado = ESPESOR_EN_TEXTO.search(texto or "")
        if encontrado:
            return int(encontrado.group(1)) / 100
    return None


def peso_por_metro(db: Session, espesor: float | None) -> float | None:
    """Kilos por metro del espesor, con 3 decimales (como la tabla del negocio)."""
    if espesor is None:
        return None
    for fila in db.query(TablaEspesorEquivalencia).all():
        if abs(fila.espesor - espesor) < 0.0005:
            return round(fila.peso_por_metro, 3)
    return None


def cantidad_sugerida(db: Session, empresa: str, *, modalidad: str, codigo_interno: str | None, descripcion: str,
                      cantidad: float, medida: float | None, tipo_producto: str | None, producto_id: int | None) -> dict:
    """{"cantidad", "unidad", "aviso"}: lo que va en la cantidad de Siigo para
    una línea. `aviso` explica por qué no se pudo calcular (el vendedor la escribe)."""
    unidad_lamina = UNIDAD_POR_EMPRESA.get(empresa, "kg")
    metros: float | None = None
    espesor: float | None = None
    if modalidad == ModalidadApartado.POR_ROLLO.value:
        metros = metros_de_linea(cantidad, medida, tipo_producto)
        espesor = _espesor(codigo_interno, descripcion)
    else:
        producto = db.get(Producto, producto_id) if producto_id else None
        if producto is not None and producto.metros_por_unidad:
            # Teja o lámina de stock: también se cobra por kilo / centímetro.
            metros = round(cantidad * float(producto.metros_por_unidad), 2)
            espesor = _espesor(None, producto.calibre, producto.descripcion, descripcion)
        else:
            return {"cantidad": round(cantidad, 2), "unidad": "und", "aviso": ""}
    if not metros:
        return {"cantidad": None, "unidad": unidad_lamina, "aviso": ""}  # la línea todavía no tiene cantidad y medida
    if unidad_lamina == "cm":
        return {"cantidad": round(metros * 100, 2), "unidad": "cm", "aviso": ""}
    peso = peso_por_metro(db, espesor)
    if peso is None:
        aviso = ("No se sabe el espesor de la línea" if espesor is None
                 else f"El espesor {espesor:.2f}".replace(".", ",") + " no está en la tabla de equivalencias")
        return {"cantidad": None, "unidad": "kg", "aviso": aviso + ": escribe los kilos."}
    return {"cantidad": round(metros * peso, 2), "unidad": "kg", "aviso": ""}


# --- Lo que se recuerda por empresa ---------------------------------------------------------

def recordado(db: Session, empresa: str, tipo: str, clave: str) -> SiigoPreferencia | None:
    clave = (clave or "").strip().upper() if tipo != TIPO_VENDEDOR else (clave or "").strip().lower()
    if not clave:
        return None
    return db.query(SiigoPreferencia).filter_by(empresa=empresa, tipo=tipo, clave=clave).first()


def recordar(db: Session, empresa: str, tipo: str, clave: str, valor: str, nombre: str, usuario: Usuario) -> None:
    clave = (clave or "").strip().upper() if tipo != TIPO_VENDEDOR else (clave or "").strip().lower()
    if not clave:
        return
    fila = db.query(SiigoPreferencia).filter_by(empresa=empresa, tipo=tipo, clave=clave).first()
    if fila is None:
        fila = SiigoPreferencia(empresa=empresa, tipo=tipo, clave=clave[:150])
        db.add(fila)
    fila.valor, fila.nombre = (valor or "")[:150], (nombre or "")[:255]
    fila.actualizado_por, fila.fecha = usuario.correo, datetime.now(timezone.utc)


def clave_de_linea(item) -> str:
    """Con qué se recuerda el producto de Siigo de una línea: el código de
    clasificación (lámina) o el código del producto de stock."""
    if item.codigo_interno:
        return item.codigo_interno
    producto = getattr(item, "producto", None)
    return producto.codigo if producto is not None else ""


# --- Subir ---------------------------------------------------------------------------------

def partes_de_la_cotizacion(db: Session, apartado: Apartado) -> list[Apartado]:
    """La cotización completa: todas sus partes (una por bodega, mismo número y empresa)."""
    from app.models.apartado import EstadoApartado
    return (db.query(Apartado)
            .filter(Apartado.numero_cotizacion == apartado.numero_cotizacion, Apartado.empresa == apartado.empresa,
                    Apartado.estado != EstadoApartado.CANCELADO)
            .order_by(Apartado.id).all())


def _faltantes(apartado: Apartado, items: list[ApartadoItem], config: dict) -> list[str]:
    faltan = []
    if not re.sub(r"[^0-9A-Za-z]", "", apartado.cliente_identificacion or ""):
        faltan.append("la cédula o NIT del cliente")
    if not apartado.siigo_vendedor:
        faltan.append("el vendedor de Siigo")
    if not config["documento"]:
        faltan.append(f"el tipo de cotización de Siigo de {EMPRESAS_CONOCIDAS[apartado.empresa]} (configuración del servidor)")
    if apartado.siigo_iva and not config["iva"]:
        faltan.append("el IVA de Siigo (configuración del servidor)")
    if apartado.siigo_retefuente and not config["retefuente"]:
        faltan.append("la retención en la fuente de Siigo (configuración del servidor)")
    for numero, item in enumerate(items, start=1):
        que = [n for n, falta in (("el producto de Siigo", not item.siigo_producto), ("el valor de la venta", not (item.precio or 0) > 0),
                                  ("la cantidad para Siigo", not (item.siigo_cantidad or 0) > 0)) if falta]
        if que:
            faltan.append(f"línea {numero} ({(item.descripcion or '').strip()[:40]}): {', '.join(que)}")
    return faltan


def cuerpo_para_siigo(apartado: Apartado, items: list[ApartadoItem], config: dict) -> dict:
    impuestos = [{"id": config["iva"]}] if apartado.siigo_iva else []
    if apartado.siigo_retefuente:
        impuestos.append({"id": config["retefuente"]})
    fecha = apartado.fecha_creacion or datetime.now(timezone.utc)
    return {
        "document": {"id": config["documento"]},
        "date": fecha.date().isoformat(),
        "customer": {"identification": re.sub(r"[^0-9A-Za-z]", "", apartado.cliente_identificacion), "branch_office": 0},
        "seller": apartado.siigo_vendedor,
        "items": [{
            "code": item.siigo_producto,
            "description": (item.descripcion or "").strip()[:500],
            "quantity": round(float(item.siigo_cantidad), 2),
            "price": round(float(item.precio), 6),
            "taxes": impuestos,
        } for item in items],
    }


def es_de_siigo(apartado: Apartado) -> bool:
    """La cotización va (o ya está) en Siigo: se creó en el programa con la
    empresa conectada. Las viejas (hechas en Siigo a mano) no se tocan."""
    return bool(apartado.siigo_id or apartado.siigo_pendiente)


def _enviar(db: Session, apartado: Apartado, usuario: Usuario) -> tuple[list[Apartado], dict, bool]:
    """Crea en Siigo la cotización completa (todas sus partes) o, si ya está,
    la actualiza. Guarda en cada parte el id, el número y el total de Siigo.
    Devuelve (partes, lo que respondió Siigo, si se creó). No hace commit."""
    if apartado.orden_interna:
        raise HTTPException(status_code=400, detail="Una orden de producción interna no va a Siigo: no tiene cliente.")
    partes = partes_de_la_cotizacion(db, apartado) or [apartado]
    siigo_id = next((p.siigo_id for p in partes if p.siigo_id), "")
    empresa = apartado.empresa
    try:
        config = siigo._config(empresa)
    except siigo.ErrorSiigo as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not siigo.esta_configurada(empresa):
        raise HTTPException(status_code=400, detail=f"{EMPRESAS_CONOCIDAS[empresa]} todavía no tiene configurado su Siigo.")
    # Los datos de la cotización (cliente, vendedor, impuestos) son los de esta
    # parte para todas: una parte nueva de otra bodega no los trae.
    for parte in partes:
        parte.cliente_identificacion, parte.siigo_vendedor = apartado.cliente_identificacion, apartado.siigo_vendedor
        parte.siigo_iva, parte.siigo_retefuente = apartado.siigo_iva, apartado.siigo_retefuente
    items = [item for parte in partes for item in parte.items]
    faltan = _faltantes(apartado, items, config)
    if faltan:
        raise HTTPException(status_code=400, detail="Para subirla a Siigo falta: " + "; ".join(faltan) + ".")
    cuerpo = cuerpo_para_siigo(apartado, items, config)
    try:
        if siigo.buscar_cliente(empresa, cuerpo["customer"]["identification"]) is None:
            raise HTTPException(status_code=400, detail=(
                f"El cliente con NIT/cédula {apartado.cliente_identificacion} no existe en el Siigo de "
                f"{EMPRESAS_CONOCIDAS[empresa]}: créalo allá primero (o revisa el número)."))
        if siigo_id:
            respuesta = siigo.actualizar_cotizacion(empresa, siigo_id, cuerpo)
        else:
            ya_ligadas = {p.siigo_id for p in db.query(Apartado.siigo_id).filter(Apartado.siigo_id != "")}
            # Al reintentar, primero se busca si el intento anterior sí la creó
            # (Siigo a veces no alcanza a responder): así no queda dos veces.
            reintento = apartado.siigo_error and apartado.fecha_creacion is not None
            respuesta = (siigo.buscar_creada(empresa, cuerpo, ya_ligadas, desde=apartado.fecha_creacion.date()) if reintento else None) \
                or siigo.crear_cotizacion(empresa, cuerpo, ya_usadas=ya_ligadas)
    except siigo.ErrorSiigo as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    ahora = datetime.now(timezone.utc)
    for parte in partes:
        parte.siigo_id = str(respuesta.get("id") or siigo_id)
        parte.siigo_numero = str(respuesta.get("name") or respuesta.get("number") or parte.siigo_numero or "")
        parte.siigo_total, parte.fecha_siigo = respuesta.get("total"), ahora
    # Se recuerda para la próxima: el producto de cada código, el vendedor de
    # este usuario y los impuestos de este cliente.
    for item in items:
        recordar(db, empresa, TIPO_PRODUCTO, clave_de_linea(item), item.siigo_producto, "", usuario)
    recordar(db, empresa, TIPO_VENDEDOR, usuario.correo, str(apartado.siigo_vendedor), "", usuario)
    recordar(db, empresa, TIPO_CLIENTE, apartado.cliente_identificacion,
             ",".join(n for n, si in (("iva", apartado.siigo_iva), ("retefuente", apartado.siigo_retefuente)) if si),
             apartado.cliente, usuario)
    return partes, respuesta, not siigo_id


def sincronizar(db: Session, apartado: Apartado, usuario: Usuario) -> str:
    """Pasa la cotización a Siigo (la crea o la actualiza). Si Siigo falla, la
    cotización queda guardada en el programa marcada "pendiente de Siigo" con
    el motivo, para volver a intentarlo. Devuelve ese motivo ("" si quedó bien).
    La que se crea en Siigo toma su número (la provisional "PEND-..." lo
    cambia). No hace commit."""
    from app.services import apartados as srv

    db.flush()
    db.expire_all()
    apartado = db.get(Apartado, apartado.id)
    partes = partes_de_la_cotizacion(db, apartado) or [apartado]
    try:
        partes, respuesta, creada = _enviar(db, apartado, usuario)
        if creada:
            numero = str(respuesta.get("number") or "").strip()
            try:
                if not numero:
                    raise HTTPException(status_code=502, detail="Siigo creó la cotización pero no devolvió su número.")
                srv.exigir_numero_libre_en_la_empresa(db, numero, apartado.empresa, excepto=[p.id for p in partes])
            except HTTPException:
                # Para no dejar en Siigo una cotización que el programa no tiene ligada.
                try:
                    siigo.borrar_cotizacion(apartado.empresa, respuesta["id"])
                except siigo.ErrorSiigo:
                    pass
                for parte in partes:
                    parte.siigo_id, parte.siigo_numero, parte.siigo_total, parte.fecha_siigo = "", "", None, None
                raise
            for parte in partes:
                parte.numero_cotizacion = numero
        motivo = ""
    except HTTPException as error:
        motivo = str(error.detail)
    for parte in partes:
        parte.siigo_pendiente, parte.siigo_error = bool(motivo), motivo
    db.flush()
    return motivo
