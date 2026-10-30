"""Conexión con Siigo Nube (Siigo API): cada empresa (Arquitejas, Asia
Business) tiene su propio Siigo y sus propias credenciales.

Siigo entrega un token que dura 24 h (se guarda en memoria y se renueva
solo), pide esperar unos segundos si se le hacen muchas consultas seguidas
(429) y, a veces, tarda tanto en responder que la petición se corta aunque
la cotización SÍ quedó creada: por eso, antes de dar por fallida una
creación, se busca si ya está (ver crear_cotizacion).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import date

import httpx

from app.core.config import settings
from app.services.empresas import EMPRESAS_CONOCIDAS

logger = logging.getLogger("arquitejas.siigo")

TIMEOUT_SEGUNDOS = 60.0
REINTENTOS_LIMITE = 4      # veces que se espera cuando Siigo dice "muchas consultas" (429)
ESPERA_MAXIMA_LIMITE = 30  # segundos máximos de cada espera

_tokens: dict[str, tuple[str, float]] = {}  # empresa -> (token, vence en time.monotonic())
_candado_tokens = threading.Lock()


class ErrorSiigo(Exception):
    """Siigo rechazó la petición, no respondió o la empresa no está configurada.
    El mensaje se le puede mostrar al usuario."""

    def __init__(self, mensaje: str, *, estado: int | None = None, codigo: str = ""):
        super().__init__(mensaje)
        self.estado = estado
        self.codigo = codigo


def _config(empresa: str) -> dict:
    empresa = (empresa or "").strip().upper()
    if empresa not in EMPRESAS_CONOCIDAS:
        raise ErrorSiigo("Elige la empresa (Arquitejas o Asia Business) para conectar con su Siigo.")
    valor = lambda campo: getattr(settings, f"SIIGO_{empresa}_{campo}")  # noqa: E731
    return {
        "empresa": empresa, "usuario": valor("USUARIO"), "llave": valor("LLAVE"),
        "documento": valor("DOCUMENTO_COTIZACION"), "iva": valor("IVA"), "retefuente": valor("RETEFUENTE"),
    }


def esta_configurada(empresa: str) -> bool:
    try:
        config = _config(empresa)
    except ErrorSiigo:
        return False
    return bool(config["usuario"] and config["llave"])


def _mensaje_de_error(respuesta: httpx.Response) -> tuple[str, str]:
    """(código, mensaje) del formato de errores de Siigo:
    {"Errors": [{"Code": "...", "Message": "...", "Params": [...]}]}."""
    try:
        errores = respuesta.json().get("Errors") or []
    except ValueError:
        return "", respuesta.text[:300]
    if not errores:
        return "", respuesta.text[:300]
    primero = errores[0]
    detalle = "; ".join(f"{e.get('Message', '')} ({', '.join(e.get('Params') or [])})".replace(" ()", "") for e in errores)
    return primero.get("Code", ""), detalle


def _token(cliente: httpx.Client, config: dict, renovar: bool = False) -> str:
    empresa = config["empresa"]
    with _candado_tokens:
        guardado = _tokens.get(empresa)
        if guardado and not renovar and guardado[1] > time.monotonic():
            return guardado[0]
        if not (config["usuario"] and config["llave"]):
            raise ErrorSiigo(f"{EMPRESAS_CONOCIDAS[empresa]} todavía no tiene configurado su Siigo (usuario API y llave).")
        try:
            respuesta = cliente.post(f"{settings.SIIGO_URL.rstrip('/')}/auth", headers={"Partner-Id": settings.SIIGO_PARTNER_ID},
                                     json={"username": config["usuario"], "access_key": config["llave"]})
        except httpx.HTTPError as error:
            raise ErrorSiigo("No se pudo conectar con Siigo. Revisa el internet e intenta de nuevo.") from error
        if respuesta.status_code not in (200, 201):
            codigo, mensaje = _mensaje_de_error(respuesta)
            logger.warning("Siigo /auth %s: %s %s", empresa, respuesta.status_code, mensaje)
            raise ErrorSiigo(f"Siigo no aceptó el usuario API o la llave de {EMPRESAS_CONOCIDAS[empresa]}.",
                             estado=respuesta.status_code, codigo=codigo)
        datos = respuesta.json()
        # Se renueva un poco antes de que venza.
        _tokens[empresa] = (datos["access_token"], time.monotonic() + max(60, int(datos.get("expires_in", 86400)) - 300))
        return datos["access_token"]


def pedir(empresa: str, metodo: str, ruta: str, *, json: dict | None = None, params: dict | None = None) -> dict | list:
    """Una petición a Siigo con el token de la empresa. Si Siigo pide esperar
    (429) se espera lo que diga; si el token venció (401) se pide otro."""
    config = _config(empresa)
    url = f"{settings.SIIGO_URL.rstrip('/')}{ruta}"
    with httpx.Client(timeout=TIMEOUT_SEGUNDOS) as cliente:
        token = _token(cliente, config)
        renovado = False
        for _ in range(REINTENTOS_LIMITE + 1):
            cabeceras = {"Authorization": f"Bearer {token}", "Partner-Id": settings.SIIGO_PARTNER_ID}
            try:
                respuesta = cliente.request(metodo, url, headers=cabeceras, json=json, params=params)
            except httpx.TimeoutException as error:
                raise ErrorSiigo("Siigo no respondió a tiempo.", codigo="timeout") from error
            except httpx.HTTPError as error:
                raise ErrorSiigo("No se pudo conectar con Siigo. Revisa el internet e intenta de nuevo.") from error
            if respuesta.status_code == 401 and not renovado:
                token, renovado = _token(cliente, config, renovar=True), True
                continue
            if respuesta.status_code == 429:
                _, mensaje = _mensaje_de_error(respuesta)
                segundos = re.search(r"in (\d+) seconds", mensaje)
                time.sleep(min(ESPERA_MAXIMA_LIMITE, (int(segundos.group(1)) if segundos else 10) + 1))
                continue
            if respuesta.status_code >= 400:
                codigo, mensaje = _mensaje_de_error(respuesta)
                logger.warning("Siigo %s %s (%s): %s %s", metodo, ruta, config["empresa"], respuesta.status_code, mensaje)
                raise ErrorSiigo(f"Siigo rechazó la petición: {mensaje}", estado=respuesta.status_code, codigo=codigo)
            return respuesta.json() if respuesta.content else {}
    raise ErrorSiigo("Siigo está recibiendo muchas consultas. Espera un minuto e intenta de nuevo.", estado=429, codigo="requests_limit")


def _todas_las_paginas(empresa: str, ruta: str, params: dict | None = None, maximo: int = 2000) -> list[dict]:
    filas: list[dict] = []
    pagina = 1
    while len(filas) < maximo:
        respuesta = pedir(empresa, "GET", ruta, params={**(params or {}), "page": pagina, "page_size": 100})
        if isinstance(respuesta, list):  # algunos catálogos no vienen paginados
            return respuesta
        resultados = respuesta.get("results") or []
        filas.extend(resultados)
        total = (respuesta.get("pagination") or {}).get("total_results") or 0
        if not resultados or len(filas) >= total:
            break
        pagina += 1
    return filas


def catalogos(empresa: str) -> dict:
    """Lo que hay que escoger una vez por empresa (tipo de cotización, IVA,
    retención) y los vendedores para emparejar con los usuarios."""
    tipos = pedir(empresa, "GET", "/v1/document-types", params={"type": "C"})
    impuestos = pedir(empresa, "GET", "/v1/taxes")
    vendedores = _todas_las_paginas(empresa, "/v1/users")
    config = _config(empresa)
    return {
        "empresa": config["empresa"],
        "configurado": {"documento_cotizacion": config["documento"], "iva": config["iva"], "retefuente": config["retefuente"]},
        "tipos_cotizacion": [{"id": t["id"], "codigo": t.get("code", ""), "nombre": t.get("name", ""), "descripcion": t.get("description", "")}
                             for t in tipos if t.get("active", True)],
        "impuestos": [{"id": t["id"], "tipo": t.get("type", ""), "nombre": t.get("name", ""), "porcentaje": t.get("percentage")}
                      for t in impuestos if t.get("active", True) and t.get("type") in ("IVA", "Retefuente")],
        "vendedores": [{"id": u["id"], "nombre": " ".join(filter(None, [u.get("first_name"), u.get("last_name")])).strip() or u.get("username", ""),
                        "correo": u.get("email", "")} for u in vendedores if u.get("active", True)],
    }


def buscar_cliente(empresa: str, identificacion: str) -> dict | None:
    """El cliente (tercero) de Siigo con esa cédula/NIT, o None si no existe."""
    identificacion = re.sub(r"[^0-9A-Za-z]", "", identificacion or "")
    if not identificacion:
        return None
    respuesta = pedir(empresa, "GET", "/v1/customers", params={"identification": identificacion})
    resultados = respuesta.get("results") if isinstance(respuesta, dict) else respuesta
    if not resultados:
        return None
    cliente = resultados[0]
    nombre = cliente.get("name")
    return {
        "identificacion": cliente.get("identification", identificacion),
        "nombre": " ".join(nombre) if isinstance(nombre, list) else (nombre or cliente.get("commercial_name") or ""),
        "activo": cliente.get("active", True),
    }


def buscar_producto(empresa: str, codigo: str) -> dict | None:
    """El producto de Siigo con ese código exacto, o None."""
    codigo = (codigo or "").strip()
    if not codigo:
        return None
    respuesta = pedir(empresa, "GET", "/v1/products", params={"code": codigo})
    resultados = respuesta.get("results") if isinstance(respuesta, dict) else respuesta
    for producto in resultados or []:
        if producto.get("code") == codigo:
            return {"codigo": producto["code"], "nombre": producto.get("name", ""), "activo": producto.get("active", True),
                    "unidad": (producto.get("unit") or {}).get("name", "")}
    return None


def productos(empresa: str, maximo: int = 5000) -> list[dict]:
    """Los productos activos del Siigo de la empresa (para escoger el de cada línea)."""
    return [{"codigo": p["code"], "nombre": p.get("name", ""), "unidad": (p.get("unit") or {}).get("name", "")}
            for p in _todas_las_paginas(empresa, "/v1/products", maximo=maximo) if p.get("active", True)]


def _misma_cotizacion(encontrada: dict, cuerpo: dict) -> bool:
    lineas = lambda items: sorted((i.get("code"), round(float(i.get("quantity") or 0), 2), round(float(i.get("price") or 0), 2))  # noqa: E731
                                  for i in items or [])
    return (str((encontrada.get("customer") or {}).get("identification")) == str(cuerpo["customer"]["identification"])
            and lineas(encontrada.get("items")) == lineas(cuerpo["items"]))


def crear_cotizacion(empresa: str, cuerpo: dict, ya_usadas: set[str] = frozenset()) -> dict:
    """Crea la cotización en Siigo y devuelve lo que Siigo guardó (id, number,
    name "C-1-22", total). Si Siigo se demora y la conexión se corta, o dice
    "documento duplicado", se busca la que se acaba de crear (mismo cliente,
    mismas líneas, de hoy y que no esté ya ligada a otra cotización: `ya_usadas`)
    para no crearla dos veces."""
    try:
        return pedir(empresa, "POST", "/v1/quotations", json=cuerpo)
    except ErrorSiigo as error:
        if error.codigo not in ("timeout", "duplicated_document"):
            raise
        logger.warning("Siigo: la creación de la cotización no respondió (%s); se busca si quedó creada.", error.codigo)
        time.sleep(5)
        recientes = _todas_las_paginas(empresa, "/v1/quotations", {
            "created_start": date.today().isoformat(), "customer_identification": cuerpo["customer"]["identification"]}, maximo=300)
        for encontrada in sorted(recientes, key=lambda q: q.get("number") or 0, reverse=True):
            if encontrada.get("id") not in ya_usadas and _misma_cotizacion(encontrada, cuerpo):
                return encontrada
        raise ErrorSiigo("Siigo no confirmó si creó la cotización. Revisa en Siigo antes de volver a intentar.",
                         codigo=error.codigo) from error


def borrar_cotizacion(empresa: str, siigo_id: str) -> None:
    pedir(empresa, "DELETE", f"/v1/quotations/{siigo_id}")
