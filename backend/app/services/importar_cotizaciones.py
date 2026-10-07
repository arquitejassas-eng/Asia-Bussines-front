"""Carga de cotizaciones apartadas desde el Excel de control (hoja SALIDA).

Se usó para pasar a la app las cotizaciones que ya estaban apartadas en el
Excel cuando se empezó a usar la app. Una línea de SALIDA sigue apartada
mientras su REFERENCIA (el rollo del que salió) está vacía: la producción no
ha salido o no se ha revisado su hoja de vida física. Reglas acordadas con el
negocio:

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
from sqlalchemy.orm import Session

from app.models.apartado import Apartado, ApartadoItem, EstadoApartado, ModalidadApartado
from app.models.bodega import Bodega
from app.models.material_en_camino import CargamentoRollo
from app.models.rollo import Rollo
from app.models.usuario import Usuario
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
    lineas: list[LineaImportada] = field(default_factory=list)


@dataclass
class ResultadoImportacion:
    apartados: list[ApartadoImportado] = field(default_factory=list)
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

    grupos: dict[tuple[str, int], list[tuple[int, str, dict]]] = {}
    for indice, fila in df.iterrows():
        numero_fila = int(indice) + 2
        codigo = _texto(fila.get("codigo"))
        if not codigo:
            continue
        if CODIGO_TRASLADO.match(codigo):
            resultado.lineas_traslado += 1
            continue
        if _texto(fila.get("referencia")):
            resultado.lineas_producidas += 1
            continue
        cotizacion = _cotizacion(fila.get("cotizacion"))
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
        grupos.setdefault((cotizacion, bodega.id), []).append((numero_fila, empresa, {
            "codigo": codigo, "cantidad": round(float(cantidad), 2), "fila": fila,
            "descripcion": _texto(fila.get("descripcion")) or _texto(fila.get("producto")) or codigo,
        }))

    for (cotizacion, bodega_id), filas in grupos.items():
        bodega = db.get(Bodega, bodega_id)
        empresas = sorted({empresa for _, empresa, _ in filas})
        for empresa in empresas:
            numero = cotizacion if len(empresas) == 1 else f"{cotizacion}-{empresa}"
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
                fecha=((fecha.to_pydatetime().replace(tzinfo=HORA_COLOMBIA) + timedelta(seconds=propias[0][0])).astimezone(timezone.utc)
                      if not pd.isna(fecha) else datetime.now(timezone.utc)),
            )
            for numero_fila, datos in propias:
                apartado.lineas.append(LineaImportada(numero_fila, datos["codigo"], datos["descripcion"][:255],
                                                      datos["cantidad"], ModalidadApartado.POR_ROLLO))
            resultado.apartados.append(apartado)
    resultado.apartados.sort(key=lambda a: (a.fecha, a.numero_cotizacion))
    return resultado


def crear(db: Session, resultado: ResultadoImportacion, usuario: Usuario, nombre_archivo: str) -> list[Apartado]:
    """Crea los apartados analizados (sin confirmar la transacción)."""
    ahora = datetime.now(timezone.utc)
    creados: list[Apartado] = []
    for importado in resultado.apartados:
        apartado = Apartado(
            bodega_id=importado.bodega_id, numero_cotizacion=importado.numero_cotizacion, empresa=importado.empresa,
            cliente=importado.cliente, creado_por=usuario.correo, fecha_creacion=importado.fecha,
            estado=EstadoApartado.ENVIADO_A_PRODUCCION, enviado_a_produccion_por=usuario.correo,
            fecha_enviado_a_produccion=ahora,
            observaciones=f'Cargada desde el Excel "{nombre_archivo}" (hoja SALIDA).'
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
        "total_apartados": len(resultado.apartados),
        "total_lineas": sum(len(a.lineas) for a in resultado.apartados),
        "productos_nuevos": 0,
    }
