"""Préstamos entre empresas (Arquitejas y Asia Business comparten bodegas).

Una cotización es de UNA empresa, pero una línea puede llevar material de la
otra (Admin Inventario lo marca al crear la cotización: "material de
Arquitejas"). Cuando ese material sale de verdad -- Planta consume el rollo,
se termina la producción con un producto de stock, o Admin Inventario le da
salida con la hoja de vida -- se anota aquí, solo, un préstamo de la empresa
del material a la empresa de la cotización. Nunca se convierten negativos
viejos en préstamos: solo lo que sale por una cotización.
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.apartado import Apartado
from app.models.prestamo import PrestamoEmpresa
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.services.empresas import EMPRESAS_CONOCIDAS, sigla_empresa_desde_nombre

LAMINA = "lamina"
PRODUCTO = "producto"


def registrar_prestamo(
    db: Session, *, apartado: Apartado, empresa_material: str, tipo: str, codigo: str, descripcion: str,
    cantidad: float, usuario: Usuario, origen: str, referencia_rollo: str = "", fecha: datetime | None = None,
) -> PrestamoEmpresa | None:
    """Anota el préstamo si el material es de una empresa y la cotización de
    la otra. Sin empresa en alguno de los dos (datos antiguos), no hay préstamo."""
    presta, recibe = (empresa_material or "").strip().upper(), (apartado.empresa or "").strip().upper()
    if not presta or not recibe or presta == recibe or cantidad <= 0.005:
        return None
    prestamo = PrestamoEmpresa(
        fecha=fecha or datetime.now(timezone.utc), empresa_presta=presta, empresa_recibe=recibe,
        bodega_id=apartado.bodega_id, apartado_id=apartado.id, numero_cotizacion=apartado.numero_cotizacion,
        tipo=tipo, codigo=codigo, descripcion=(descripcion or "")[:255], cantidad=round(float(cantidad), 2),
        unidad="m" if tipo == LAMINA else "und", referencia_rollo=(referencia_rollo or "")[:60],
        origen=origen, usuario=usuario.correo,
    )
    db.add(prestamo)
    return prestamo


PRESTADOR_EXTERNO = "EXT"


def registrar_prestamo_de_rollo(db: Session, *, rollo: Rollo, prestador: str, usuario: Usuario) -> PrestamoEmpresa:
    """Rollo que nos prestaron (se ingresó a mano): todos sus metros quedan
    como préstamo de quien lo prestó a la empresa del rollo. Si lo prestó
    Arquitejas o Asia Business cuenta igual que los préstamos entre ellas;
    si no, queda a nombre del tercero (empresa_presta = "EXT")."""
    nombre = " ".join((prestador or "").split())
    if not nombre:
        raise HTTPException(status_code=400, detail="Escribe quién prestó el rollo (empresa o persona).")
    sigla = sigla_empresa_desde_nombre(nombre)
    recibe = (rollo.empresa or "").strip().upper()
    if sigla and sigla == recibe:
        raise HTTPException(
            status_code=400,
            detail=f"Ese rollo ya es de {EMPRESAS_CONOCIDAS[sigla]} (por su referencia): no puede ser prestado por ella misma.",
        )
    metros = round(float(rollo.metros_disponibles or 0), 2)
    prestamo = PrestamoEmpresa(
        fecha=rollo.fecha_ingreso or datetime.now(timezone.utc), empresa_presta=sigla or PRESTADOR_EXTERNO,
        empresa_recibe=recibe, prestador="" if sigla else nombre[:150], bodega_id=rollo.bodega_id,
        apartado_id=None, numero_cotizacion="", tipo=LAMINA, codigo=rollo.codigo_interno,
        descripcion=(rollo.descripcion or "")[:255], cantidad=metros, unidad="m",
        referencia_rollo=(rollo.identificador_rollo or "")[:60], origen="ingreso_rollo", usuario=usuario.correo,
    )
    db.add(prestamo)
    return prestamo


def listar(
    db: Session, *, empresa: str = "", bodega_id: int | None = None, desde: datetime | None = None,
    hasta: datetime | None = None, incluir_saldados: bool = False,
) -> list[PrestamoEmpresa]:
    consulta = db.query(PrestamoEmpresa)
    if empresa:
        consulta = consulta.filter((PrestamoEmpresa.empresa_presta == empresa) | (PrestamoEmpresa.empresa_recibe == empresa))
    if bodega_id is not None:
        consulta = consulta.filter(PrestamoEmpresa.bodega_id == bodega_id)
    if desde is not None:
        consulta = consulta.filter(PrestamoEmpresa.fecha >= desde)
    if hasta is not None:
        consulta = consulta.filter(PrestamoEmpresa.fecha < hasta)
    if not incluir_saldados:
        consulta = consulta.filter(PrestamoEmpresa.saldado.is_(False))
    return consulta.order_by(PrestamoEmpresa.fecha.desc(), PrestamoEmpresa.id.desc()).all()


def resumen(prestamos: list[PrestamoEmpresa]) -> list[dict]:
    """Lo que se deben, por material: lo que una empresa le prestó a la otra
    menos lo que la otra le prestó a ella del mismo código (solo sin saldar).
    "debe" es la empresa que recibió de más."""
    # (tipo, código, unidad) -> {(presta, recibe): cantidad}
    por_codigo: dict[tuple[str, str, str], dict[tuple[str, str], float]] = {}
    descripciones: dict[tuple[str, str, str], str] = {}
    for p in prestamos:
        if p.saldado:
            continue
        clave = (p.tipo, p.codigo, p.unidad)
        pares = por_codigo.setdefault(clave, {})
        # Un tercero va por su nombre: lo que se le debe no se cruza con nadie más.
        par = (p.prestador or p.empresa_presta, p.empresa_recibe)
        pares[par] = pares.get(par, 0) + p.cantidad
        descripciones[clave] = descripciones.get(clave) or p.descripcion
    filas = []
    for (tipo, codigo, unidad), pares in por_codigo.items():
        vistos: set[tuple[str, str]] = set()
        for (presta, recibe), cantidad in pares.items():
            if (recibe, presta) in vistos:
                continue
            vistos.add((presta, recibe))
            neto = round(cantidad - pares.get((recibe, presta), 0), 2)
            if abs(neto) <= 0.005:
                continue
            acreedora, deudora = (presta, recibe) if neto > 0 else (recibe, presta)
            filas.append({"tipo": tipo, "codigo": codigo, "descripcion": descripciones[(tipo, codigo, unidad)],
                          "unidad": unidad, "presta": acreedora, "debe": deudora, "cantidad": abs(neto)})
    return sorted(filas, key=lambda f: (f["debe"], f["tipo"], f["codigo"]))


def saldar(db: Session, ids: list[int], usuario: Usuario) -> int:
    """Marca como saldados los préstamos indicados (los ya saldados se dejan igual)."""
    if not ids:
        raise HTTPException(status_code=400, detail="Escoge al menos un préstamo para saldar.")
    prestamos = db.query(PrestamoEmpresa).filter(PrestamoEmpresa.id.in_(set(ids))).with_for_update().all()
    if len(prestamos) != len(set(ids)):
        raise HTTPException(status_code=404, detail="Alguno de esos préstamos ya no existe. Recarga e intenta de nuevo.")
    ahora = datetime.now(timezone.utc)
    cambiados = 0
    for p in prestamos:
        if not p.saldado:
            p.saldado, p.saldado_por, p.fecha_saldado = True, usuario.correo, ahora
            cambiados += 1
    return cambiados
