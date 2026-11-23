"""Importaciones con costo diferente (solo rollo completo) y sus alertas.
Ver app/services/importaciones_controladas.py."""

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.apartado import Apartado
from app.models.bodega import Bodega
from app.models.importacion_controlada import AlertaImportacion, ImportacionControlada
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario, Usuario
from app.services import apartados as srv
from app.services import importaciones_controladas as ic
from app.services.empresas import EMPRESAS_CONOCIDAS

router = APIRouter(prefix="/importaciones-controladas", tags=["Importaciones controladas"])
solo_admin = [Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))]


class ImportacionCrear(BaseModel):
    # "17AR", "17 AR" o solo "17" con la empresa.
    clave: str = Field(min_length=1, max_length=20)
    empresa: str = Field(default="", max_length=10)
    nota: str = Field(default="", max_length=255)


class Decision(BaseModel):
    nota: str = Field(default="", max_length=400)


class Venta(BaseModel):
    rollo_id: int


def _importacion_dict(i: ImportacionControlada, rollos: list[Rollo]) -> dict:
    propios = [r for r in rollos if ic.clave_de_referencia(r.identificador_rollo) == i.clave and (r.empresa or "") == i.empresa]
    return {
        "id": i.id, "clave": i.clave, "empresa": i.empresa, "numero": i.numero, "nombre": ic.nombre_importacion(i.clave),
        "activa": i.activa, "nota": i.nota, "creada_por": i.creada_por, "fecha_creacion": i.fecha_creacion,
        "rollos": len(propios), "metros": round(sum(r.metros_disponibles for r in propios), 2),
    }


def _rollos_con_metros(db: Session) -> list[Rollo]:
    return db.query(Rollo).filter(Rollo.metros_disponibles > ic.TOLERANCIA).all()


@router.get("", dependencies=solo_admin)
def listar_importaciones(db: Session = Depends(get_db)) -> list[dict]:
    rollos = _rollos_con_metros(db)
    return [_importacion_dict(i, rollos) for i in
            db.query(ImportacionControlada).order_by(ImportacionControlada.activa.desc(), ImportacionControlada.id.desc())]


@router.post("", dependencies=solo_admin)
def marcar_importacion(datos: ImportacionCrear, db: Session = Depends(get_db),
                       usuario: Usuario = Depends(usuario_actual)) -> dict:
    texto = re.sub(r"\s+", "", datos.clave).upper()
    if texto.isdigit():
        empresa = datos.empresa.strip().upper()
        if empresa not in EMPRESAS_CONOCIDAS:
            raise HTTPException(status_code=400, detail="Escoge de qué empresa es la importación.")
        texto = f"{int(texto)}{empresa}"
    clave = ic.clave_de_referencia(texto)
    if not clave or clave != texto:
        raise HTTPException(status_code=400, detail="Escribe el número de la importación y la empresa, ej. 17AR (importación 17 de Arquitejas).")
    empresa = re.sub(r"^\d+", "", clave)
    existente = db.query(ImportacionControlada).filter(ImportacionControlada.clave == clave).first()
    if existente is None:
        existente = ImportacionControlada(clave=clave, empresa=empresa, numero=int(re.match(r"\d+", clave).group()),
                                          fecha_creacion=datetime.now(timezone.utc))
        db.add(existente)
    existente.activa = True
    existente.nota = datos.nota.strip()
    existente.creada_por = usuario.correo
    db.flush()
    # Las cotizaciones activas de los códigos de esa importación se revisan ya.
    rollos = _rollos_con_metros(db)
    codigos = {r.codigo_interno for r in rollos if ic.clave_de_referencia(r.identificador_rollo) == clave}
    ic.evaluar_activas_del_codigo(db, codigos)
    db.commit()
    return _importacion_dict(existente, rollos)


@router.delete("/{importacion_id}", dependencies=solo_admin)
def quitar_importacion(importacion_id: int, db: Session = Depends(get_db)) -> dict:
    importacion = db.get(ImportacionControlada, importacion_id)
    if importacion is None:
        raise HTTPException(status_code=404, detail="Importación no encontrada.")
    importacion.activa = False
    db.flush()
    _revisar_pendientes(db)
    db.commit()
    return _importacion_dict(importacion, _rollos_con_metros(db))


def _revisar_pendientes(db: Session) -> None:
    """Las alertas pendientes se vuelven a revisar (si ya no hace falta, se cierran)."""
    pendientes = db.query(AlertaImportacion).filter(AlertaImportacion.estado == ic.PENDIENTE).all()
    ahora = datetime.now(timezone.utc)
    for alerta in pendientes:
        if alerta.apartado_id is None:  # La cotización (o esa parte) ya no existe.
            alerta.estado, alerta.decidida_por, alerta.fecha_decision = ic.RESUELTA, "sistema", ahora
            alerta.nota = (alerta.nota + " " if alerta.nota else "") + "La cotización o esa parte ya no existe."
    ids = {a.apartado_id for a in pendientes if a.apartado_id is not None}
    if ids:
        ic.evaluar_apartados(db, db.query(Apartado).filter(Apartado.id.in_(ids)).all())


def _alerta_dict(a: AlertaImportacion, apartados: dict[int, Apartado], bodegas: dict[int, str]) -> dict:
    apartado = apartados.get(a.apartado_id) if a.apartado_id else None
    try:
        opciones = json.loads(a.opciones) if a.opciones else {}
    except ValueError:
        opciones = {}
    return {
        "id": a.id, "apartado_id": a.apartado_id, "apartado_item_id": a.apartado_item_id,
        "numero_cotizacion": a.numero_cotizacion, "cliente": apartado.cliente if apartado else "",
        "empresa_cotizacion": apartado.empresa if apartado else "",
        "estado_cotizacion": apartado.estado.value if apartado else "",
        "bodega_id": a.bodega_id, "bodega": bodegas.get(a.bodega_id, ""), "codigo": a.codigo, "descripcion": a.descripcion,
        "empresa_linea": a.empresa_linea, "metros_requeridos": a.metros_requeridos, "metros_en_bodega": a.metros_en_bodega,
        "metros_faltantes": a.metros_faltantes,
        "importaciones": [{"clave": c, "nombre": ic.nombre_importacion(c)} for c in a.importaciones.split(", ") if c],
        "opciones": opciones, "estado": a.estado, "fecha_creacion": a.fecha_creacion,
        "decidida_por": a.decidida_por, "fecha_decision": a.fecha_decision, "nota": a.nota,
    }


@router.get("/alertas", dependencies=solo_admin)
def listar_alertas(todas: bool = False, db: Session = Depends(get_db)) -> list[dict]:
    _revisar_pendientes(db)
    db.commit()
    consulta = db.query(AlertaImportacion)
    if not todas:
        consulta = consulta.filter(AlertaImportacion.estado == ic.PENDIENTE)
    alertas = consulta.order_by(AlertaImportacion.estado != ic.PENDIENTE, AlertaImportacion.fecha_creacion.desc()).limit(300).all()
    ids = {a.apartado_id for a in alertas if a.apartado_id}
    apartados = {a.id: a for a in db.query(Apartado).filter(Apartado.id.in_(ids))} if ids else {}
    bodegas = {b.id: b.nombre for b in db.query(Bodega).all()}
    return [_alerta_dict(a, apartados, bodegas) for a in alertas]


@router.get("/alertas/pendientes")
def alertas_pendientes(db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> list[dict]:
    """Para todos: qué cotizaciones están esperando la decisión (aviso en su fila)."""
    return [
        {"apartado_id": a.apartado_id, "numero_cotizacion": a.numero_cotizacion, "codigo": a.codigo,
         "metros_faltantes": a.metros_faltantes,
         "importaciones": ", ".join(ic.nombre_importacion(c) for c in a.importaciones.split(", ") if c)}
        for a in db.query(AlertaImportacion).filter(AlertaImportacion.estado == ic.PENDIENTE,
                                                    AlertaImportacion.apartado_id.isnot(None))
    ]


def _alerta(db: Session, alerta_id: int) -> AlertaImportacion:
    alerta = db.get(AlertaImportacion, alerta_id)
    if alerta is None:
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")
    return alerta


@router.post("/alertas/{alerta_id}/autorizar", dependencies=solo_admin)
def autorizar(alerta_id: int, datos: Decision, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Se cubre con otro material (ej. un traslado de otra bodega): se puede
    producir. Los rollos de la importación controlada siguen sin poder cortarse."""
    ic.decidir(db, _alerta(db, alerta_id), ic.AUTORIZADA, usuario, datos.nota or "Autorizada para producir con otro material.")
    db.commit()
    return {"ok": True}


@router.post("/alertas/{alerta_id}/vender", dependencies=solo_admin)
def preparar_venta(alerta_id: int, datos: Venta, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Escogió vender un rollo completo a la otra empresa: queda anotado y se
    devuelve lo necesario para abrir la cotización de venta. La alerta sigue
    pendiente hasta que el rollo sea de la otra empresa (se cierra sola)."""
    alerta = _alerta(db, alerta_id)
    if alerta.estado != ic.PENDIENTE:
        raise HTTPException(status_code=400, detail="Esa alerta ya se decidió.")
    rollo = db.get(Rollo, datos.rollo_id)
    if rollo is None:
        raise HTTPException(status_code=404, detail="Rollo no encontrado.")
    compra = alerta.empresa_linea if alerta.empresa_linea in EMPRESAS_CONOCIDAS else ""
    if not compra and alerta.apartado_id:
        apartado = db.get(Apartado, alerta.apartado_id)
        compra = apartado.empresa if apartado else ""
    vende = rollo.empresa or ""
    if compra == vende:
        raise HTTPException(
            status_code=400,
            detail=f"El rollo {rollo.identificador_rollo} ya es de {EMPRESAS_CONOCIDAS.get(vende, vende)}, la misma empresa "
            "de la cotización: para usarlo, la línea tiene que venderse como rollo completo (edita la cotización) o anularla.",
        )
    alerta.nota = ((alerta.nota + " ") if alerta.nota else "") + (
        f"{datetime.now(timezone.utc):%Y-%m-%d} {usuario.correo} abrió la venta del rollo completo {rollo.identificador_rollo} "
        f"de {EMPRESAS_CONOCIDAS.get(vende, vende)} a {EMPRESAS_CONOCIDAS.get(compra, compra)}.")[:500]
    db.commit()
    return {
        "rollo_id": rollo.id, "referencia": rollo.identificador_rollo, "codigo": rollo.codigo_interno,
        "metros": round(rollo.metros_disponibles, 2), "bodega_id": rollo.bodega_id,
        "empresa_vende": vende, "empresa_compra": compra, "cliente": EMPRESAS_CONOCIDAS.get(compra, compra),
        "numero_cotizacion": alerta.numero_cotizacion,
    }


@router.post("/alertas/{alerta_id}/anular", dependencies=solo_admin)
def anular(alerta_id: int, datos: Decision, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Anula la cotización (todas sus partes activas) con la anulación de
    siempre: lo apartado queda libre y no se descuenta nada."""
    from app.api.routes.apartados import _anular_en_siigo

    alerta = _alerta(db, alerta_id)
    if alerta.estado != ic.PENDIENTE:
        raise HTTPException(status_code=400, detail="Esa alerta ya se decidió.")
    partes = (db.query(Apartado).filter(Apartado.numero_cotizacion == alerta.numero_cotizacion,
                                        Apartado.estado.in_(srv.ESTADOS_CANCELABLES)).all()
              if alerta.numero_cotizacion else [])
    for parte in partes:
        anulada = srv.cancelar_apartado(db, parte.id, usuario)
        if anulada.siigo_id:
            _anular_en_siigo(db, anulada, usuario)
    ic.decidir(db, alerta, ic.ANULADA, usuario, datos.nota or "Cotización anulada por Admin Inventario.")
    ic.evaluar_apartados(db, partes)  # Las otras alertas de esas partes quedan anuladas.
    db.commit()
    return {"ok": True, "anuladas": len(partes)}
