"""Cliente del asistente de IA: habla con Gemini (Google) y, si Gemini llega
a su límite o falla, con Groq de respaldo -- los dos gratis dentro de su
límite de uso -- y le da acceso a los datos reales de la bodega mediante "herramientas"
(function calling) — el modelo nunca inventa cifras, las consulta.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.ia_herramientas import HERRAMIENTAS, ejecutar_herramienta

logger = logging.getLogger("arquitejas.ia")

MAX_RONDAS_HERRAMIENTAS = 5
TIMEOUT_SEGUNDOS = 30.0
REINTENTOS_CONEXION = 2  # cubre blips de DNS/red pasajeros, no una caída real del proveedor.
REINTENTOS_SATURADO = 2  # un 503 "mucha demanda" de Gemini suele pasar en segundos.
ESPERA_SATURADO_SEGUNDOS = 2.0

GEMINI_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = (
    "Eres el asistente de inteligencia de negocio de Arquitejas, una empresa de tejas y "
    "materiales de construcción. Ayudas al usuario a entender el inventario, los rollos de "
    "acero, la producción y el abastecimiento de SU bodega.\n\n"
    "Reglas importantes:\n"
    "- NUNCA inventes cifras. Si necesitas un dato (stock, movimientos, rollos, predicciones), "
    "usa las herramientas disponibles para consultarlo.\n"
    "- Si una herramienta no trae lo que necesitas o da un error, dilo con honestidad — no lo reemplaces por un supuesto.\n"
    "- Responde en español, de forma clara, concisa y profesional. Evita relleno.\n"
    "- Si dan recomendaciones (por ejemplo reabastecer algo), basa la recomendación en los números que consultaste."
)

SYSTEM_PROMPT_EXTRA_ADMIN_INVENTARIO = (
    "\n\nEsta cuenta es Admin Inventario: a diferencia del resto de usuarios (que solo ven su "
    "propia bodega), tú SÍ puedes consultar cualquier bodega o compararlas entre sí. Usa "
    "bodega_id o bodega_nombre en las herramientas para preguntar por una bodega específica "
    "(ej. \"¿cuántos rollos tiene la bodega Norte?\"), y usa comparar_bodegas para preguntas "
    "sobre todas a la vez (ej. \"¿qué bodega tiene más rollos?\", \"compara el inventario de "
    "todas las bodegas\"). Si no se especifica ninguna bodega, consulta tu propio pool sin asignar."
)


class ErrorAsistenteIa(Exception):
    """Ningún proveedor está disponible, faltan las API keys, o respondieron con error."""


@dataclass(frozen=True)
class Proveedor:
    nombre: str
    url: str
    api_key: str
    modelo: str


def proveedores_configurados() -> list[Proveedor]:
    """Gemini primero (mejor calidad en su plan gratis) y Groq de respaldo:
    si uno llega a su límite o falla, el chat sigue con el otro. Solo entran
    los que tienen API key; ambos hablan el formato de OpenAI."""
    candidatos = [
        Proveedor("Gemini", GEMINI_CHAT_URL, settings.GEMINI_API_KEY or "", settings.GEMINI_MODEL),
        Proveedor("Groq", GROQ_CHAT_URL, settings.GROQ_API_KEY or "", settings.GROQ_MODEL),
    ]
    return [p for p in candidatos if p.api_key]


class _ProveedorNoDisponible(Exception):
    """Este proveedor falló de forma que vale la pena probar con el siguiente."""


def _llamar(cliente: httpx.Client, proveedor: Proveedor, mensajes: list[dict]) -> dict:
    for intento in range(REINTENTOS_SATURADO + 1):
        respuesta = _enviar(cliente, proveedor, mensajes)
        if respuesta.status_code not in (500, 502, 503) or intento == REINTENTOS_SATURADO:
            break
        logger.warning("ia_saturado proveedor=%s intento=%s", proveedor.nombre, intento + 1)
        time.sleep(ESPERA_SATURADO_SEGUNDOS)

    if respuesta.status_code in (401, 403):
        raise _ProveedorNoDisponible(f"La API key de {proveedor.nombre} es inválida.")
    if respuesta.status_code == 429:
        raise _ProveedorNoDisponible(f"{proveedor.nombre} llegó a su límite de uso.")
    if respuesta.status_code != 200:
        raise _ProveedorNoDisponible(f"{proveedor.nombre} respondió con error {respuesta.status_code}: {respuesta.text[:200]}")
    return respuesta.json()


def _enviar(cliente: httpx.Client, proveedor: Proveedor, mensajes: list[dict]) -> httpx.Response:
    for intento in range(REINTENTOS_CONEXION + 1):
        try:
            return cliente.post(
                proveedor.url,
                headers={"Authorization": f"Bearer {proveedor.api_key}"},
                json={
                    "model": proveedor.modelo,
                    "messages": mensajes,
                    "tools": HERRAMIENTAS,
                    "tool_choice": "auto",
                    "stream": False,
                },
                timeout=TIMEOUT_SEGUNDOS,
            )
        except httpx.ConnectError as exc:
            if intento == REINTENTOS_CONEXION:
                raise _ProveedorNoDisponible(f"No se pudo conectar con {proveedor.nombre}.") from exc
            logger.warning("ia_reintento proveedor=%s intento=%s error=%s", proveedor.nombre, intento + 1, exc)
            time.sleep(0.5)
        except httpx.TimeoutException as exc:
            raise _ProveedorNoDisponible(f"{proveedor.nombre} tardó demasiado en responder.") from exc
    raise AssertionError("inalcanzable")


def _limpiar_para_otro_proveedor(mensajes: list[dict]) -> None:
    for mensaje in mensajes:
        for llamada in mensaje.get("tool_calls") or []:
            llamada.pop("extra_content", None)


def _mensaje_para_historial(mensaje_modelo: dict) -> dict:
    """Solo los campos estándar: si a mitad de la conversación se cambia de
    proveedor, el otro no debe recibir campos propios del primero (p. ej. el
    "reasoning" de Groq)."""
    mensaje = {"role": "assistant", "content": mensaje_modelo.get("content") or ""}
    if mensaje_modelo.get("tool_calls"):
        mensaje["tool_calls"] = mensaje_modelo["tool_calls"]
    return mensaje


def chat_con_herramientas(
    mensaje_usuario: str, historial: list[dict], db: Session, bodega_id: int | None,
    es_admin_inventario: bool = False,
) -> str:
    """Ejecuta el ciclo completo: manda la pregunta al modelo, si pide usar una
    herramienta la ejecuta contra la base de datos real, le devuelve el
    resultado, y repite hasta que el modelo da una respuesta final en texto.
    `bodega_id` es siempre la bodega propia del usuario — `es_admin_inventario`
    es lo único que decide si una herramienta puede consultar otra distinta
    (ver `ia_herramientas._resolver_bodega`, que aplica la regla real)."""
    prompt_sistema = SYSTEM_PROMPT + (SYSTEM_PROMPT_EXTRA_ADMIN_INVENTARIO if es_admin_inventario else "")
    mensajes: list[dict] = [{"role": "system", "content": prompt_sistema}]
    for turno in historial[-10:]:  # los últimos 10 mensajes bastan de contexto y mantienen la conversación rápida.
        rol = "assistant" if turno.get("rol") == "ia" else "user"
        mensajes.append({"role": rol, "content": turno.get("texto", "")})
    mensajes.append({"role": "user", "content": mensaje_usuario})

    proveedores = proveedores_configurados()
    if not proveedores:
        raise ErrorAsistenteIa(
            "Falta configurar GEMINI_API_KEY o GROQ_API_KEY en el backend. Consigue una gratis en "
            "https://aistudio.google.com/apikey o https://console.groq.com/keys"
        )
    actual = 0  # una vez que un proveedor falla, el resto de la conversación sigue con el siguiente.
    with httpx.Client() as cliente:
        for _ in range(MAX_RONDAS_HERRAMIENTAS):
            while True:
                try:
                    datos = _llamar(cliente, proveedores[actual], mensajes)
                    break
                except _ProveedorNoDisponible as exc:
                    logger.warning("ia_proveedor_fallo proveedor=%s error=%s", proveedores[actual].nombre, exc)
                    actual += 1
                    _limpiar_para_otro_proveedor(mensajes)
                    if actual == len(proveedores):
                        raise ErrorAsistenteIa(f"El asistente no está disponible ahora: {exc} Intenta de nuevo en unos minutos.") from exc
            mensaje_modelo = datos["choices"][0]["message"]
            llamadas = mensaje_modelo.get("tool_calls") or []

            if not llamadas:
                return (mensaje_modelo.get("content") or "").strip() or "No obtuve una respuesta del modelo."

            mensajes.append(_mensaje_para_historial(mensaje_modelo))
            for llamada in llamadas:
                funcion = llamada.get("function", {})
                nombre = funcion.get("name", "")
                try:
                    argumentos = json.loads(funcion.get("arguments") or "{}")
                except json.JSONDecodeError:
                    argumentos = {}
                logger.info("ia_tool_call nombre=%s argumentos=%s", nombre, argumentos)
                resultado = ejecutar_herramienta(nombre, argumentos, db, bodega_id, es_admin_inventario)
                mensajes.append(
                    {
                        "role": "tool",
                        "tool_call_id": llamada.get("id", ""),
                        "content": json.dumps(resultado, ensure_ascii=False, default=str),
                    }
                )

    return "No pude completar la consulta después de varios intentos usando las herramientas disponibles. Intenta reformular la pregunta."
