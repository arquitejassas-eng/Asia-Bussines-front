from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session, selectinload

from app.api.deps import coincide_bodega, get_db, requiere_rol, usuario_actual
from app.core.config import settings
from app.models.equivalencias import TablaColorEquivalencia, TablaEspesorEquivalencia, TablaTipoMaterialEquivalencia
from app.models.movimiento import Movimiento
from app.models.rollo import EstadoRollo, Rollo
from app.models.usuario import RolUsuario, Usuario
from app.schemas.inventario import MovimientoResponse
from app.schemas.rollos import (
    ActualizarAnchoRollo, ActualizarEmpresaRollo, ActualizarFamiliaRollo, ActualizarObservacionesRollo, ClasificacionSugeridaResponse, ConfirmarCargaRollosRequest,
    ConsumoRolloCrear, PaginaRollos, PrevisualizacionCargaRollosResponse, ResultadoCargaRollosResponse, RolloCrear,
    SalidaExternaRolloCrear,
    RolloResponse, SeleccionarHojaCargaRollosRequest, SugerenciaReferenciaResponse,
)
from app.services import archivos_carga_rollos
from app.services import carga_rollos as srv_carga
from app.services import clasificacion as srv_excel
from app.services.consumos_rollo import registrar_consumo_rollo, registrar_salida_externa_rollo

router = APIRouter(prefix="/rollos", tags=["Rollos almacenados"])


def _rollo_de_mi_bodega(db: Session, rollo_id: int, usuario: Usuario) -> Rollo:
    rollo = db.get(Rollo, rollo_id)
    if rollo is None or rollo.bodega_id != usuario.bodega_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rollo no encontrado.")
    return rollo


@router.get("", response_model=list[RolloResponse] | PaginaRollos)
def listar_rollos(
    codigo_interno: str = "", identificador_rollo: str = "", codigo_proveedor: str = "", descripcion: str = "", familia: str = "",
    color_material: str = "", calibre: str = "", estado: str = "", proveedor: str = "", empresa: str = "",
    fecha_desde: datetime | None = None,
    fecha_hasta: datetime | None = None, pagina: int = Query(1, ge=1), tamano: int = Query(30, ge=1, le=100),
    paginado: bool = False, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Rollo] | PaginaRollos:
    consulta = (
        db.query(Rollo)
        .options(selectinload(Rollo.historial_consumos))
        .filter(coincide_bodega(Rollo.bodega_id, usuario.bodega_id))
    )
    if codigo_interno: consulta = consulta.filter(Rollo.codigo_interno.ilike(f"%{codigo_interno}%"))
    if identificador_rollo: consulta = consulta.filter(Rollo.identificador_rollo.ilike(f"%{identificador_rollo}%"))
    if codigo_proveedor: consulta = consulta.filter(Rollo.codigo_proveedor.ilike(f"%{codigo_proveedor}%"))
    if descripcion: consulta = consulta.filter(Rollo.descripcion.ilike(f"%{descripcion}%"))
    if familia: consulta = consulta.filter(Rollo.familia == familia)
    if color_material: consulta = consulta.filter(Rollo.color_material.ilike(f"%{color_material}%"))
    if calibre: consulta = consulta.filter(Rollo.calibre == float(calibre))
    if proveedor: consulta = consulta.filter(Rollo.proveedor.ilike(f"%{proveedor}%"))
    if empresa: consulta = consulta.filter(Rollo.empresa == filtro_empresa(empresa))
    # Sin filtro de estado explícito = "inventario activo": los agotados no
    # deben hacer bulto en la búsqueda normal. Para verlos, se pide el estado
    # explícitamente (ej. estado=agotado), igual que cualquier otro filtro.
    if estado: consulta = consulta.filter(Rollo.estado == estado)
    else: consulta = consulta.filter(Rollo.estado != EstadoRollo.AGOTADO)
    if fecha_desde: consulta = consulta.filter(Rollo.fecha_ingreso >= fecha_desde)
    if fecha_hasta: consulta = consulta.filter(Rollo.fecha_ingreso <= fecha_hasta)
    consulta = consulta.order_by(Rollo.codigo_interno.asc(), Rollo.fecha_ingreso.desc())
    if not paginado:
        rollos = consulta.all()
        asignar_peso_actual(db, rollos)
        return rollos
    total = consulta.count()
    items = consulta.offset((pagina - 1) * tamano).limit(tamano).all()
    asignar_peso_actual(db, items)
    return PaginaRollos(items=items, total=total,
                         pagina=pagina, tamano=tamano, total_paginas=max(1, (total + tamano - 1) // tamano))


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
        rollo.peso_actual_toneladas = srv_excel.peso_actual_toneladas(rollo.calibre, rollo.metros_disponibles, espesores)


@router.get("/{rollo_id}/historial", response_model=list[MovimientoResponse])
def historial_de_rollo(
    rollo_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Movimiento]:
    """Hoja de vida de UN rollo: todos los movimientos (entrada, consumo,
    producción, transferencia) que lo tienen como `rollo_id`, nunca mezclados
    con los de otro rollo que comparta la misma clasificación."""
    _rollo_de_mi_bodega(db, rollo_id, usuario)
    return (
        db.query(Movimiento)
        .filter(Movimiento.rollo_id == rollo_id)
        .order_by(Movimiento.fecha)
        .all()
    )


def _match_equivalencias(db: Session, prefijo: str) -> tuple[TablaTipoMaterialEquivalencia, TablaColorEquivalencia] | None:
    """Descompone `prefijo` (todo antes de la ÚLTIMA coma, ej. "LT80040" en
    "LT80040,33") en tipo + color usando las tablas de equivalencias — misma
    convención que `_crear_codigo_interno` en clasificacion.py: código de
    tipo + inicial del color (o el código asignado a mano, si el nombre choca
    con otro) + RAL sin el prefijo "RAL". El calibre siempre se escribe
    "0,XX" (todos los espesores de este negocio son menores a 1mm), así que
    ese "0" queda pegado al final del prefijo — se acepta con o sin él.
    Devuelve None si no encuentra combinación."""
    prefijo_norm = prefijo.strip().upper()
    tipos = db.query(TablaTipoMaterialEquivalencia).all()
    colores = db.query(TablaColorEquivalencia).all()
    for tipo in sorted(tipos, key=lambda t: -len(t.codigo_interno or "")):
        codigo_tipo = (tipo.codigo_interno or "").upper()
        if not codigo_tipo or not prefijo_norm.startswith(codigo_tipo):
            continue
        resto = prefijo_norm[len(codigo_tipo):]
        for color in colores:
            ral_sin_prefijo = color.ral.upper().removeprefix("RAL")
            letras_posibles = {(color.codigo_interno or "").upper(), color.nombre.strip()[:1].upper()}
            esperados = {f"{letra}{ral_sin_prefijo}" for letra in letras_posibles if letra}
            esperados |= {e + "0" for e in esperados}
            if resto in esperados:
                return tipo, color
    return None


def _prefijo_y_calibre(codigo_interno: str) -> tuple[str, str]:
    codigo = codigo_interno.strip()
    if "," in codigo:
        prefijo, calibre_texto = codigo.rsplit(",", 1)
    else:
        prefijo, calibre_texto = codigo, ""
    return prefijo, calibre_texto


def _clasificacion_reconocida(db: Session, usuario: Usuario, prefijo: str) -> bool:
    """True si `prefijo` corresponde a un código ya usado por otro rollo de
    esta bodega, o a una combinación tipo+color que existe en las tablas de
    equivalencias. Se usa para bloquear el ingreso manual de códigos que el
    sistema no puede clasificar de ninguna forma (ver `crear_rollo`)."""
    if not prefijo:
        return False
    existe_hermano = (
        db.query(Rollo.id)
        .filter(coincide_bodega(Rollo.bodega_id, usuario.bodega_id), Rollo.codigo_interno.like(f"{prefijo},%"))
        .first()
        is not None
    )
    return existe_hermano or _match_equivalencias(db, prefijo) is not None


@router.get("/clasificacion-sugerida", response_model=ClasificacionSugeridaResponse)
def sugerir_clasificacion_por_codigo(
    codigo_interno: str = Query(..., min_length=1),
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Sugiere color y descripción para el ingreso manual. Primero busca otro
    rollo ya cargado con el mismo prefijo de código (todo antes de la coma
    del calibre: "LA5017" en "LA50170,20") y reutiliza su color y descripción
    con el calibre nuevo — conserva el formato real ya usado. Si nunca se ha
    cargado ese prefijo, cae a las tablas de equivalencias (Recepción y
    Verificación → Administrar tablas de equivalencias) para deducir tipo y
    color desde cero, que es lo que corresponde para un código genuinamente
    nuevo."""
    prefijo, calibre_texto = _prefijo_y_calibre(codigo_interno)
    if not prefijo:
        return {"encontrado": False}

    candidato = (
        db.query(Rollo)
        .filter(coincide_bodega(Rollo.bodega_id, usuario.bodega_id), Rollo.codigo_interno.like(f"{prefijo},%"))
        .order_by(Rollo.color_material.desc(), Rollo.fecha_ingreso.desc())
        .first()
    )
    if candidato is not None:
        descripcion = candidato.descripcion
        if calibre_texto and descripcion:
            partes = descripcion.rsplit(" ", 1)
            if len(partes) == 2:
                descripcion = f"{partes[0]} 0,{calibre_texto}"

        color_material = candidato.color_material
        if not color_material and descripcion:
            # La descripción sigue el patrón "... COLOR RAL CALIBRE": si el
            # rollo encontrado nunca tuvo el campo color relleno, se recupera de ahí.
            palabras = descripcion.split()
            if len(palabras) >= 3:
                color_material = palabras[-3].capitalize()

        return {"encontrado": True, "descripcion": descripcion, "color_material": color_material}

    match = _match_equivalencias(db, prefijo)
    if match is None:
        return {"encontrado": False}
    tipo, color = match
    ral_sin_prefijo = color.ral.upper().removeprefix("RAL")
    descripcion = f"{tipo.nombre.upper()} {color.nombre.upper()} {ral_sin_prefijo}"
    if calibre_texto:
        descripcion = f"{descripcion} 0,{calibre_texto}"
    return {"encontrado": True, "descripcion": descripcion.strip(), "color_material": color.nombre}


@router.get("/siguiente-referencia", response_model=SugerenciaReferenciaResponse)
def sugerir_siguiente_referencia(
    codigo_interno: str = Query(..., min_length=1),
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Sugiere la referencia del próximo rollo (ej. "LA50170,20-03"). El número
    final se reserva para TODA la bodega, sin importar color ni calibre — dos
    rollos de clasificación distinta nunca terminan en el mismo número, así
    que se busca el primer número libre entre los que ya usa cualquier rollo."""
    codigo = codigo_interno.strip()
    identificadores = db.query(Rollo.identificador_rollo).filter(coincide_bodega(Rollo.bodega_id, usuario.bodega_id)).all()
    usados = set()
    for (identificador,) in identificadores:
        sufijo = identificador.rsplit("-", 1)[-1] if "-" in identificador else ""
        if sufijo.isdigit():
            usados.add(int(sufijo))
    siguiente = 1
    while siguiente in usados:
        siguiente += 1
    return {"identificador_rollo": f"{codigo}-{siguiente:02d}"}


@router.post("", response_model=RolloResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def crear_rollo(
    datos: RolloCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Rollo:
    """Ingreso manual de un solo rollo (a diferencia de `/rollos/carga/*`, que
    procesa un Excel completo). Rechaza referencias duplicadas en la misma
    bodega para no confundir dos rollos físicos distintos, y rechaza códigos
    que el sistema no puede clasificar (ni un rollo hermano ni una
    equivalencia registrada) para no dejar entrar más material "sin color"."""
    identificador_rollo = datos.identificador_rollo.strip()
    existente = (
        db.query(Rollo)
        .filter(coincide_bodega(Rollo.bodega_id, usuario.bodega_id), Rollo.identificador_rollo == identificador_rollo)
        .first()
    )
    if existente:
        raise HTTPException(
            status_code=400,
            detail=f"Ya existe un rollo con la referencia '{identificador_rollo}' en tu bodega.",
        )

    prefijo, _ = _prefijo_y_calibre(datos.codigo_interno)
    if not _clasificacion_reconocida(db, usuario, prefijo):
        raise HTTPException(
            status_code=400,
            detail=(
                f"El código '{datos.codigo_interno.strip()}' no está registrado en la tabla de equivalencias "
                "ni coincide con ningún rollo que ya tengas. Agrega su color en Recepción y Verificación → "
                "Administrar tablas de equivalencias antes de guardar este rollo."
            ),
        )

    metros_proveedor = datos.metros_proveedor or round(datos.metros_disponibles + datos.metros_consumidos, 2)
    rollo = Rollo(
        bodega_id=usuario.bodega_id, recepcion_id=None,
        codigo_interno=datos.codigo_interno.strip(), identificador_rollo=identificador_rollo,
        codigo_proveedor=datos.codigo_proveedor, descripcion=datos.descripcion, familia="Rollos de acero",
        color_material=datos.color_material, calibre=datos.calibre, peso_neto=datos.peso_neto,
        metros_proveedor=metros_proveedor, metros_calculados=metros_proveedor,
        metros_disponibles=datos.metros_disponibles, metros_consumidos=datos.metros_consumidos,
        fecha_ingreso=datetime.now(timezone.utc), proveedor=datos.proveedor, lote=datos.lote,
        observaciones=datos.observaciones,
    )
    rollo.recalcular_estado()
    db.add(rollo)
    db.commit()
    db.refresh(rollo)
    return rollo


@router.post("/{rollo_id}/consumo", response_model=RolloResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def registrar_consumo(
    rollo_id: int, datos: ConsumoRolloCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Rollo:
    """Endpoint delgado; la validación, trazabilidad y bloqueo viven en el servicio."""
    rollo = registrar_consumo_rollo(db, rollo_id=rollo_id, cantidad=datos.cantidad,
                                    observaciones=datos.observaciones, usuario=usuario)
    db.commit()
    db.refresh(rollo)
    return rollo


@router.post("/{rollo_id}/salida-externa", response_model=RolloResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def registrar_salida_externa(
    rollo_id: int, datos: SalidaExternaRolloCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Rollo:
    """Salida del rollo completo hacia otra empresa (intercambio externo)."""
    rollo = registrar_salida_externa_rollo(db, rollo_id=rollo_id, empresa=datos.empresa,
                                           observaciones=datos.observaciones, usuario=usuario)
    db.commit()
    db.refresh(rollo)
    return rollo


@router.patch("/{rollo_id}/observaciones", response_model=RolloResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def actualizar_observaciones(
    rollo_id: int, datos: ActualizarObservacionesRollo, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Rollo:
    rollo = _rollo_de_mi_bodega(db, rollo_id, usuario)
    rollo.observaciones = datos.observaciones
    db.commit()
    db.refresh(rollo)
    return rollo


@router.patch("/{rollo_id}/familia", response_model=RolloResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def actualizar_familia(
    rollo_id: int, datos: ActualizarFamiliaRollo, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Rollo:
    """Reclasifica el rollo a su familia real para que el módulo Inventario
    lo agrupe correctamente (recepción registra todo como "Rollos de acero")."""
    rollo = _rollo_de_mi_bodega(db, rollo_id, usuario)
    rollo.familia = datos.familia
    db.commit()
    db.refresh(rollo)
    return rollo


@router.patch("/{rollo_id}/empresa", response_model=RolloResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def actualizar_empresa(
    rollo_id: int, datos: ActualizarEmpresaRollo, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Rollo:
    """Corrige la empresa dueña del rollo cuando la referencia no la traía
    o se dedujo mal (normalmente se llena sola al crear el rollo)."""
    rollo = _rollo_de_mi_bodega(db, rollo_id, usuario)
    rollo.empresa = datos.empresa.strip().upper()
    db.commit()
    db.refresh(rollo)
    return rollo


@router.patch("/{rollo_id}/ancho", response_model=RolloResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def actualizar_ancho(
    rollo_id: int, datos: ActualizarAnchoRollo, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Rollo:
    """Corrige el ancho real del rollo (default 122 m) para el rollo especial
    que mide distinto — Producción de Caballetes lo usa para calcular el
    ancho de cada sección (ancho ÷ 3)."""
    rollo = _rollo_de_mi_bodega(db, rollo_id, usuario)
    rollo.ancho_material = datos.ancho_material
    db.commit()
    db.refresh(rollo)
    return rollo


@router.post("/carga/previsualizar", response_model=PrevisualizacionCargaRollosResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
async def previsualizar_carga_rollos(
    archivo: UploadFile, usuario: Usuario = Depends(usuario_actual),
) -> PrevisualizacionCargaRollosResponse:
    """Paso 1: lee el Excel de rollos existentes, detecta encabezados y sugiere un mapeo."""
    nombre_archivo = archivo.filename or ""
    if not nombre_archivo.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=415, detail="Solo se aceptan archivos Excel (.xlsx o .xls).")

    contenido = await archivo.read(settings.MAX_ARCHIVO_RECEPCION_BYTES + 1)
    if len(contenido) > settings.MAX_ARCHIVO_RECEPCION_BYTES:
        limite_mb = settings.MAX_ARCHIVO_RECEPCION_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"El archivo supera el límite de {limite_mb} MB.")
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    try:
        hojas = srv_excel.leer_hojas_excel(contenido)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo Excel.") from exc

    hoja_principal = srv_excel.elegir_hoja_principal(hojas)
    try:
        df = hojas[hoja_principal]
        encabezados = [str(c) for c in df.columns]
        mapeo_sugerido = srv_carga.auto_detectar_mapeo(encabezados)

        archivos_carga_rollos.guardar(usuario.id, {
            "nombre_archivo": archivo.filename,
            "hoja_principal": hoja_principal,
            "hojas": hojas,
        })

        return PrevisualizacionCargaRollosResponse(
            nombre_archivo=archivo.filename or "archivo.xlsx",
            hoja_actual=hoja_principal,
            hojas_disponibles=list(hojas.keys()),
            encabezados=encabezados,
            mapeo_sugerido=mapeo_sugerido,
            filas_totales=len(df),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo generar la vista previa de la hoja '{hoja_principal}'. "
            "Puede que esa hoja no tenga una fila de encabezados válida -- elige otra hoja del selector e intenta de nuevo.",
        ) from exc


@router.post("/carga/hoja", response_model=PrevisualizacionCargaRollosResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def cambiar_hoja_carga_rollos(
    datos: SeleccionarHojaCargaRollosRequest, usuario: Usuario = Depends(usuario_actual),
) -> PrevisualizacionCargaRollosResponse:
    """Cambia qué hoja del Excel ya subido se usa, sin tener que volver a subirlo."""
    en_proceso = archivos_carga_rollos.obtener(usuario.id)
    if not en_proceso:
        raise HTTPException(status_code=400, detail="Primero sube un archivo con /rollos/carga/previsualizar.")
    if datos.hoja not in en_proceso["hojas"]:
        raise HTTPException(status_code=400, detail=f"La hoja '{datos.hoja}' no existe en el archivo.")

    en_proceso["hoja_principal"] = datos.hoja
    archivos_carga_rollos.guardar(usuario.id, en_proceso)

    try:
        df = en_proceso["hojas"][datos.hoja]
        encabezados = [str(c) for c in df.columns]
        return PrevisualizacionCargaRollosResponse(
            nombre_archivo=en_proceso["nombre_archivo"] or "archivo.xlsx",
            hoja_actual=datos.hoja,
            hojas_disponibles=list(en_proceso["hojas"].keys()),
            encabezados=encabezados,
            mapeo_sugerido=srv_carga.auto_detectar_mapeo(encabezados),
            filas_totales=len(df),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo generar la vista previa de la hoja '{datos.hoja}'. "
            "Puede que esa hoja no tenga una fila de encabezados válida -- elige otra hoja del selector e intenta de nuevo.",
        ) from exc


@router.post("/carga/confirmar", response_model=ResultadoCargaRollosResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def confirmar_carga_rollos(
    datos: ConfirmarCargaRollosRequest, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> ResultadoCargaRollosResponse:
    """Paso 2: aplica el mapeo confirmado y hace upsert por (bodega_id, identificador_rollo)."""
    en_proceso = archivos_carga_rollos.obtener(usuario.id)
    if not en_proceso:
        raise HTTPException(status_code=400, detail="Primero sube un archivo con /rollos/carga/previsualizar.")

    faltantes = srv_carga.campos_requeridos_faltantes(datos.mapeo)
    if faltantes:
        raise HTTPException(status_code=400, detail=f"Faltan columnas obligatorias: {', '.join(faltantes)}")

    df = en_proceso["hojas"][en_proceso["hoja_principal"]]
    resultado = srv_carga.procesar_filas(df, datos.mapeo, db, usuario.bodega_id)
    db.commit()
    archivos_carga_rollos.eliminar(usuario.id)

    return ResultadoCargaRollosResponse(
        filas_totales=resultado.filas_totales, creados=resultado.creados, actualizados=resultado.actualizados,
        omitidas=len(resultado.omitidas),
        detalle_omitidas=[{"fila": o.fila, "identificador_rollo": o.identificador_rollo, "motivo": o.motivo} for o in resultado.omitidas],
    )
