"""Carga de cotizaciones apartadas desde el Excel de control (hoja SALIDA).

Se usó para pasar a la app las cotizaciones que ya estaban apartadas en el
Excel cuando se empezó a usar la app. Una línea de SALIDA sigue apartada
mientras su REFERENCIA (el rollo del que salió) está vacía o dice "NO": la
producción no ha salido. "SI" = ya salió pero no se sabe de qué rollo: se
carga como "pendiente por dar salida" (el material sigue apartado y no va a
Planta) hasta que, con la hoja de vida, se registre la salida con el rollo.
Reglas acordadas con el negocio:

- Filas de MERMA ("# DE COT" o REFERENCIA = MERMA): el rollo está en
  INFORMACION SIIGO y los metros en SALE. Se registran como merma de ese
  rollo (negativo = sobrante), una sola vez: volver a cargar el Excel no la
  repite. En el Excel la merma no se resta en las hojas IMPORT (para ver
  cuánta dejó cada rollo), por eso la app la descuenta al cargar.

- Solo cotizaciones de clientes: "# DE COT" = STOCK / AJUSTE se omiten, y
  los traslados entre bodegas (CODIGO "TRAS R-S", "TRAN R-F"...) también:
  mueven material entre sedes, no lo apartan para un cliente.
- La bodega sale de "BODEGA DE SALIDA"; si no es una bodega de la app (ej. el
  nombre del cliente), esas líneas se omiten y se informan.
- Si una cotización tiene, en la misma bodega, líneas de las dos empresas se
  separa en dos apartados: "3811-AR" y "3811-ABG".
- SOLO se cargan las líneas de rollo (lámina: L + color + RAL + calibre, o
  un código que ya tenga rollos), en metros ("SALE"). Las de productos de
  stock (caballetes, flanches, tornillos, perfiles...) se omiten y no se
  crea ningún producto: ese inventario no se maneja desde esta carga. Una
  cotización que solo tiene productos no se carga.
- Se aparta aunque no haya material (en el Excel ya estaba en negativo): el
  apartado queda "esperando material" y se cubre solo cuando le den ingreso.
- Quedan "enviado a producción" (ya estaban en la cola de Planta), también
  las que esperan material: así no le llegan decenas de avisos de
  "cotización aprobada" a las bodegas. Su faltante se ve en la lista.
- La fecha del apartado es la de la cotización, más un segundo por cada fila
  del Excel: así, dentro del mismo día, conservan el orden en que se
  escribieron (las más antiguas se cubren primero con el material que llegue
  y en la lista la última escrita sale de primera).
"""

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.apartado import Apartado, ApartadoItem, EstadoApartado, ModalidadApartado
from app.models.bodega import Bodega
from app.models.material_en_camino import CargamentoRollo
from app.models.movimiento import Movimiento
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.services import merma_rollo
from app.services.apartados import faltantes_apartado
from app.services.empresas import sigla_empresa_desde_nombre

# Las fechas del Excel son días de Colombia: 00:00 en UTC caía el día anterior.
LARGO_MAXIMO_COTIZACION = 32  # = Apartado.numero_cotizacion (String(32))
HORA_COLOMBIA = timezone(timedelta(hours=-5))
HOJA_PREFERIDA = "SALIDA"
COLUMNAS = {
    "empresa": "DE QUE EMPRESA SALE EL MATERIAL",
    "cotizacion": "# DE COT",
    "fecha": "FECHA",
    "codigo": "CODIGO",
    "referencia": "REFERENCIA",
    "descripcion": "INFORMACION SIIGO",
    "producto": "PRODUCTO",
    "sale": "SALE",
    "cliente": "CLIENTE",
    "vendedor": "RESPONSABLE VENTA",
    "bodega": "BODEGA DE SALIDA",
}
OBLIGATORIAS = ("empresa", "cotizacion", "codigo", "referencia", "sale", "bodega")
NO_SON_DE_CLIENTE = {"STOCK", "AJUSTE"}
PENDIENTE = "NO"  # REFERENCIA "NO" = todavía no ha salido (igual que vacía)
SALIO_SIN_ROLLO = "SI"  # REFERENCIA "SI" = ya salió, falta saber de qué rollo
SUFIJO_SALIDA_PENDIENTE = "SAL"
MERMA = "MERMA"
CODIGO_LAMINA = re.compile(r"^L[A-Z]\d{5},\d{2}$")
CODIGO_TRASLADO = re.compile(r"^TRA[SN]\b", re.IGNORECASE)


def _normalizar(texto) -> str:
    texto = unicodedata.normalize("NFD", str(texto or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texto).strip().upper()


def _texto(valor) -> str:
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return ""
    texto = str(valor).replace("​", "").strip()
    return "" if texto.lower() == "nan" else texto


def _cotizacion(valor) -> str:
    texto = _texto(valor)
    # Excel guarda 3811 como 3811.0
    return texto[:-2] if re.fullmatch(r"\d+\.0", texto) else texto


@dataclass
class LineaImportada:
    fila: int
    codigo: str
    descripcion: str
    cantidad: float
    modalidad: ModalidadApartado
    producto_id: int | None = None
    producto_nuevo: bool = False


@dataclass
class ApartadoImportado:
    numero_cotizacion: str
    bodega_id: int
    bodega_nombre: str
    empresa: str
    cliente: str
    vendedor: str
    fecha: datetime
    salida_pendiente: bool = False
    lineas: list[LineaImportada] = field(default_factory=list)


@dataclass
class MermaImportada:
    fila: int
    referencia: str
    metros: float  # negativo = el rollo rindió de más (sobrante)
    rollo_id: int


@dataclass
class ResultadoImportacion:
    apartados: list[ApartadoImportado] = field(default_factory=list)
    mermas: list[MermaImportada] = field(default_factory=list)
    mermas_ya_registradas: int = 0
    mermas_sin_rollo: int = 0
    mermas_registradas: int = 0
    omitidas: list[dict] = field(default_factory=list)
    lineas_producidas: int = 0
    lineas_stock_ajuste: int = 0
    lineas_traslado: int = 0
    lineas_producto: int = 0


def _leer_hoja(contenido: bytes) -> pd.DataFrame:
    try:
        libro = pd.ExcelFile(BytesIO(contenido))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo. Verifica que sea un Excel válido.") from exc
    hojas = sorted(libro.sheet_names, key=lambda h: _normalizar(h) != HOJA_PREFERIDA)
    for hoja in hojas:
        df = libro.parse(hoja)
        columnas = {_normalizar(c): c for c in df.columns}
        if all(_normalizar(COLUMNAS[c]) in columnas for c in OBLIGATORIAS):
            return df.rename(columns={columnas[_normalizar(v)]: k for k, v in COLUMNAS.items() if _normalizar(v) in columnas})
    faltan = ", ".join(COLUMNAS[c] for c in OBLIGATORIAS)
    raise HTTPException(status_code=400, detail=f"No encontré la hoja de salidas: debe tener las columnas {faltan}.")


def analizar(db: Session, contenido: bytes) -> ResultadoImportacion:
    """Lee el Excel y arma los apartados a crear, sin guardar nada."""
    df = _leer_hoja(contenido)
    resultado = ResultadoImportacion()
    bodegas = {_normalizar(b.nombre): b for b in db.query(Bodega).all()}
    codigos_rollo = {c for (c,) in db.query(Rollo.codigo_interno).distinct()} | {c for (c,) in db.query(CargamentoRollo.codigo_interno).distinct()}

    grupos: dict[tuple[str, int, bool], list[tuple[int, str, dict]]] = {}
    for indice, fila in df.iterrows():
        numero_fila = int(indice) + 2
        codigo = _texto(fila.get("codigo"))
        if not codigo:
            continue
        if CODIGO_TRASLADO.match(codigo):
            resultado.lineas_traslado += 1
            continue
        referencia = _texto(fila.get("referencia"))
        cotizacion = _cotizacion(fila.get("cotizacion"))
        if MERMA in (_normalizar(referencia), _normalizar(cotizacion)):
            _anotar_merma(db, resultado, numero_fila, fila)
            continue
        salida_pendiente = _normalizar(referencia) == SALIO_SIN_ROLLO
        if referencia and _normalizar(referencia) != PENDIENTE and not salida_pendiente:
            resultado.lineas_producidas += 1
            continue
        if not cotizacion or _normalizar(cotizacion) in NO_SON_DE_CLIENTE:
            resultado.lineas_stock_ajuste += 1
            continue
        if not (CODIGO_LAMINA.match(codigo) or codigo in codigos_rollo):
            resultado.lineas_producto += 1
            continue
        nombre_bodega = _texto(fila.get("bodega"))
        bodega = bodegas.get(_normalizar(nombre_bodega))
        if bodega is None:
            resultado.omitidas.append({"fila": numero_fila, "cotizacion": cotizacion, "codigo": codigo,
                                       "motivo": f"La bodega '{nombre_bodega or '(vacía)'}' no existe en la app."})
            continue
        empresa = sigla_empresa_desde_nombre(_texto(fila.get("empresa")))
        if not empresa:
            resultado.omitidas.append({"fila": numero_fila, "cotizacion": cotizacion, "codigo": codigo,
                                       "motivo": f"Empresa no reconocida: '{_texto(fila.get('empresa'))}'."})
            continue
        cantidad = pd.to_numeric(fila.get("sale"), errors="coerce")
        if pd.isna(cantidad) or float(cantidad) <= 0:
            resultado.omitidas.append({"fila": numero_fila, "cotizacion": cotizacion, "codigo": codigo,
                                       "motivo": "La columna SALE está vacía o en 0."})
            continue
        grupos.setdefault((cotizacion, bodega.id, salida_pendiente), []).append((numero_fila, empresa, {
            "codigo": codigo, "cantidad": round(float(cantidad), 2), "fila": fila,
            "descripcion": _texto(fila.get("descripcion")) or _texto(fila.get("producto")) or codigo,
        }))

    for (cotizacion, bodega_id, salida_pendiente), filas in grupos.items():
        bodega = db.get(Bodega, bodega_id)
        empresas = sorted({empresa for _, empresa, _ in filas})
        for empresa in empresas:
            numero = cotizacion if len(empresas) == 1 else f"{cotizacion}-{empresa}"
            if salida_pendiente and (cotizacion, bodega_id, False) in grupos:
                # La misma cotización tiene líneas pendientes por producir: lo que
                # ya salió va aparte (ej. "3776-SAL") para no repetir el número.
                numero = f"{numero}-{SUFIJO_SALIDA_PENDIENTE}"
            ya_existe = (
                db.query(Apartado.id)
                .filter(Apartado.bodega_id == bodega_id, Apartado.numero_cotizacion == numero,
                        Apartado.estado != EstadoApartado.CANCELADO)
                .first()
            )
            propias = [(n, datos) for n, emp, datos in filas if emp == empresa]
            if ya_existe:
                resultado.omitidas.append({"fila": propias[0][0], "cotizacion": numero, "codigo": "",
                                           "motivo": f"La cotización {numero} ya está cargada en {bodega.nombre}."})
                continue
            if len(numero) > LARGO_MAXIMO_COTIZACION:
                resultado.omitidas.append({"fila": propias[0][0], "cotizacion": numero, "codigo": "",
                                           "motivo": f"El número de cotización es muy largo (máximo {LARGO_MAXIMO_COTIZACION} caracteres)."})
                continue
            primera = propias[0][1]["fila"]
            fecha = pd.to_datetime(primera.get("fecha"), errors="coerce", dayfirst=True)
            apartado = ApartadoImportado(
                numero_cotizacion=numero, bodega_id=bodega_id, bodega_nombre=bodega.nombre, empresa=empresa,
                cliente=_texto(primera.get("cliente"))[:150], vendedor=_texto(primera.get("vendedor")),
                salida_pendiente=salida_pendiente,
                fecha=((fecha.to_pydatetime().replace(tzinfo=HORA_COLOMBIA) + timedelta(seconds=propias[0][0])).astimezone(timezone.utc)
                      if not pd.isna(fecha) else datetime.now(timezone.utc)),
            )
            for numero_fila, datos in propias:
                apartado.lineas.append(LineaImportada(numero_fila, datos["codigo"], datos["descripcion"][:255],
                                                      datos["cantidad"], ModalidadApartado.POR_ROLLO))
            resultado.apartados.append(apartado)
    resultado.apartados.sort(key=lambda a: (a.fecha, a.numero_cotizacion))
    return resultado


def _marca_merma(fila: int) -> str:
    return f"Merma del Excel (SALIDA fila {fila})."


def _anotar_merma(db: Session, resultado: ResultadoImportacion, numero_fila: int, fila) -> None:
    referencia = _texto(fila.get("descripcion"))
    metros = pd.to_numeric(fila.get("sale"), errors="coerce")
    rollo = (
        db.query(Rollo).filter(func.upper(func.trim(Rollo.identificador_rollo)) == referencia.upper()).first()
        if referencia else None
    )
    if rollo is None or pd.isna(metros) or float(metros) == 0:
        # Rollo ya agotado en el Excel (no se cargó) o fila sin datos: no hay nada que descontar.
        resultado.mermas_sin_rollo += 1
        return
    ya = (
        db.query(Movimiento.id)
        .filter(Movimiento.rollo_id == rollo.id, Movimiento.observaciones.contains(_marca_merma(numero_fila)))
        .first()
    )
    if ya:
        resultado.mermas_ya_registradas += 1
        return
    resultado.mermas.append(MermaImportada(numero_fila, rollo.identificador_rollo, round(float(metros), 2), rollo.id))


def registrar_mermas(db: Session, resultado: ResultadoImportacion, usuario: Usuario) -> None:
    """Registra en cada rollo la merma (o el sobrante) anotada en el Excel."""
    for merma in resultado.mermas:
        if merma.metros > 0:
            _, salio = merma_rollo.registrar_merma(db, merma.rollo_id, merma.metros, _marca_merma(merma.fila), usuario)
            resultado.mermas_registradas += salio > 0
        else:
            merma_rollo.registrar_sobrante(db, merma.rollo_id, -merma.metros, _marca_merma(merma.fila), usuario)
            resultado.mermas_registradas += 1


def crear(db: Session, resultado: ResultadoImportacion, usuario: Usuario, nombre_archivo: str) -> list[Apartado]:
    """Crea los apartados analizados y registra las mermas (sin confirmar la transacción)."""
    registrar_mermas(db, resultado, usuario)
    ahora = datetime.now(timezone.utc)
    creados: list[Apartado] = []
    for importado in resultado.apartados:
        apartado = Apartado(
            bodega_id=importado.bodega_id, numero_cotizacion=importado.numero_cotizacion, empresa=importado.empresa,
            cliente=importado.cliente, creado_por=usuario.correo, fecha_creacion=importado.fecha,
            estado=EstadoApartado.EN_PRODUCCION if importado.salida_pendiente else EstadoApartado.ENVIADO_A_PRODUCCION,
            enviado_a_produccion_por=usuario.correo, fecha_enviado_a_produccion=ahora,
            salida_pendiente=importado.salida_pendiente,
            observaciones=f'Cargada desde el Excel "{nombre_archivo}" (hoja SALIDA).'
            + (" El material ya salió (REFERENCIA \"SI\"): falta registrar de qué rollo." if importado.salida_pendiente else "")
            + (f" Vendedor: {importado.vendedor}." if importado.vendedor else ""),
        )
        db.add(apartado)
        db.flush()
        for linea in importado.lineas:
            db.add(ApartadoItem(
                apartado_id=apartado.id, modalidad=ModalidadApartado.POR_ROLLO, codigo_interno=linea.codigo,
                descripcion=linea.descripcion, cantidad=linea.cantidad, medida=1, metros_requeridos=linea.cantidad,
            ))
        creados.append(apartado)
    db.flush()
    return creados


def cuantos_esperan_material(db: Session, apartados: list[Apartado]) -> int:
    """Cuántos de los recién creados no tienen todo su material en la bodega."""
    total = 0
    for apartado in apartados:
        db.refresh(apartado)
        total += bool(faltantes_apartado(db, apartado))
    return total


def resumen(resultado: ResultadoImportacion) -> dict:
    return {
        "apartados": [
            {
                "numero_cotizacion": a.numero_cotizacion, "bodega_id": a.bodega_id, "bodega_nombre": a.bodega_nombre,
                "empresa": a.empresa, "cliente": a.cliente, "fecha": a.fecha.date().isoformat(),
                "salida_pendiente": a.salida_pendiente,
                "lineas": [
                    {"fila": ln.fila, "codigo": ln.codigo, "descripcion": ln.descripcion, "cantidad": ln.cantidad,
                     "modalidad": ln.modalidad.value, "producto_nuevo": ln.producto_nuevo}
                    for ln in a.lineas
                ],
            }
            for a in resultado.apartados
        ],
        "omitidas": resultado.omitidas,
        "lineas_producidas": resultado.lineas_producidas,
        "lineas_stock_ajuste": resultado.lineas_stock_ajuste,
        "lineas_traslado": resultado.lineas_traslado,
        "lineas_producto": resultado.lineas_producto,
        "mermas": [{"fila": m.fila, "referencia": m.referencia, "metros": m.metros} for m in resultado.mermas],
        "mermas_ya_registradas": resultado.mermas_ya_registradas,
        "mermas_sin_rollo": resultado.mermas_sin_rollo,
        "total_apartados": len(resultado.apartados),
        "total_salida_pendiente": sum(a.salida_pendiente for a in resultado.apartados),
        "total_lineas": sum(len(a.lineas) for a in resultado.apartados),
        "productos_nuevos": 0,
    }
