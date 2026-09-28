from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import coincide_bodega, get_db, requiere_rol, usuario_actual
from app.models.equivalencias import (
    TablaColorEquivalencia,
    TablaEspesorEquivalencia,
    TablaTipoMaterialEquivalencia,
)
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.recepcion import Recepcion
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario, Usuario
from app.schemas.recepcion import (
    ConfirmarRecepcionRequest,
    EquivalenciaColorInput,
    EquivalenciaColorResponse,
    EquivalenciaEspesorInput,
    EquivalenciaEspesorResponse,
    EquivalenciaTipoInput,
    EquivalenciaTipoResponse,
    PrevisualizacionRecepcionResponse,
    ProcesarRecepcionRequest,
    RecepcionResponse,
    SeleccionarHojaRecepcionRequest,
    TablasEquivalenciaResponse,
    VerificacionRecepcionResponse,
)
from app.services import clasificacion as srv
from app.services import archivos_recepcion
from app.core.config import settings

router = APIRouter(prefix="/recepcion", tags=["Recepción y Verificación"])

# Las tablas de equivalencias (espesor -> metros por tonelada, color/RAL,
# tipo de material) son UNA sola para toda la empresa: con ellas se calculan
# los metros de cada recepción y el peso de Inventario total de todas las
# sedes. Decisión del negocio: solo Admin Inventario y el superadmin las
# cambian -- antes cualquier administrativo de sede podía, incluso sin
# querer al previsualizar un Excel que trajera esas hojas.
ROLES_EDITAN_EQUIVALENCIAS = (RolUsuario.ADMIN_INVENTARIO, RolUsuario.SUPERADMIN)

# Cache en memoria del último archivo procesado por sesión de usuario, para
# no tener que volver a subirlo entre "previsualizar" y "confirmar".
# TODO producción: mover a Redis o similar si hay más de un worker.


def _tablas_equivalencia_desde_bd(db: Session) -> srv.TablasEquivalencia:
    tablas = srv.TablasEquivalencia()
    for color in db.query(TablaColorEquivalencia).all():
        tablas.colores[srv.normalizar_texto(color.ral)] = {
            "ral": color.ral,
            "nombre": color.nombre,
            "codigo_interno": color.codigo_interno,
        }
        tablas.colores[srv.normalizar_texto(color.nombre)] = {
            "ral": color.ral,
            "nombre": color.nombre,
            "codigo_interno": color.codigo_interno,
        }
    for tipo in db.query(TablaTipoMaterialEquivalencia).all():
        tablas.tipos[srv.normalizar_texto(tipo.nombre)] = {"codigo_interno": tipo.codigo_interno}
    for esp in db.query(TablaEspesorEquivalencia).all():
        # MySQL FLOAT puede devolver 0.200000002..., mientras que el Excel
        # entrega 0.2. La misma clave normalizada evita fallos al clasificar.
        tablas.espesores[round(float(esp.espesor), 4)] = {
            "mt_por_ton": esp.mt_por_ton,
            "peso_por_metro": esp.peso_por_metro,
        }
    return tablas


@router.post("/previsualizar", response_model=PrevisualizacionRecepcionResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
async def previsualizar_archivo(
    archivo: UploadFile,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> PrevisualizacionRecepcionResponse:
    """Paso 1-2: lee el Excel, detecta encabezados, sugiere el mapeo de
    columnas, e importa automáticamente las hojas de equivalencias que
    traiga el archivo (si las trae)."""
    nombre_archivo = archivo.filename or ""
    if not nombre_archivo.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=415, detail="Solo se aceptan archivos Excel (.xlsx o .xls).")

    # Se lee como máximo un byte por encima del límite para rechazar archivos
    # grandes sin cargar por completo una entrada no confiable en memoria.
    contenido = await archivo.read(settings.MAX_ARCHIVO_RECEPCION_BYTES + 1)
    if len(contenido) > settings.MAX_ARCHIVO_RECEPCION_BYTES:
        limite_mb = settings.MAX_ARCHIVO_RECEPCION_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"El archivo supera el límite de {limite_mb} MB.")
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    try:
        hojas = srv.leer_hojas_excel(contenido)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo Excel.") from exc

    nombres_hojas = list(hojas.keys())
    hoja_espesor, hoja_color = srv.detectar_hojas_equivalencias(nombres_hojas)
    hoja_principal = srv.elegir_hoja_principal(hojas, excluir=(hoja_espesor, hoja_color))

    df = hojas[hoja_principal]
    encabezados = [str(c) for c in df.columns]
    mapeo_sugerido = srv.auto_detectar_mapeo(encabezados)

    importadas_espesor = importadas_color = 0
    nota = ""
    if (hoja_espesor or hoja_color) and usuario.rol not in ROLES_EDITAN_EQUIVALENCIAS:
        # Una sede no cambia las tablas globales: se ignoran esas hojas.
        nota = (
            "El archivo trae hojas de equivalencias (espesores o colores), pero no se importaron: "
            "solo Admin Inventario puede cambiar esas tablas."
        )
        hoja_espesor = hoja_color = None

    if hoja_espesor:
        filas_espesor, filas_tipo = srv.leer_hoja_equivalencia_espesor(hojas[hoja_espesor])
        espesores_existentes = {
            round(float(fila.espesor), 4): fila
            for fila in db.query(TablaEspesorEquivalencia).all()
        }
        for f in filas_espesor:
            clave_espesor = round(float(f["espesor"]), 4)
            fila_db = espesores_existentes.get(clave_espesor)
            if fila_db:
                fila_db.mt_por_ton = f["mt_por_ton"]
                fila_db.peso_por_metro = f["peso_por_metro"]
            else:
                fila_db = TablaEspesorEquivalencia(**f)
                db.add(fila_db)
                # flush defensivo: evita que dos entradas con la misma clave
                # dentro del mismo archivo terminen mandando dos INSERT
                # duplicados a la vez si por alguna razón no llegaran ya
                # deduplicadas desde el servicio de lectura del Excel.
                db.flush()
                espesores_existentes[clave_espesor] = fila_db
        for t in filas_tipo:
            fila_db = db.query(TablaTipoMaterialEquivalencia).filter(TablaTipoMaterialEquivalencia.nombre == t["nombre"]).first()
            if fila_db:
                fila_db.codigo_interno = t["codigo_interno"]
            else:
                db.add(TablaTipoMaterialEquivalencia(**t))
                db.flush()
        importadas_espesor = len(filas_espesor)

    if hoja_color:
        filas_color = srv.leer_hoja_equivalencia_color(hojas[hoja_color])
        for c in filas_color:
            fila_db = db.query(TablaColorEquivalencia).filter(TablaColorEquivalencia.ral == c["ral"]).first()
            if fila_db:
                fila_db.nombre = c["nombre"]
                fila_db.codigo_interno = c["codigo_interno"]
            else:
                db.add(TablaColorEquivalencia(**c))
                db.flush()
        importadas_color = len(filas_color)

    if importadas_espesor or importadas_color:
        db.commit()
        partes = []
        if importadas_espesor:
            partes.append(f"{importadas_espesor} de espesor")
        if importadas_color:
            partes.append(f"{importadas_color} de color")
        nota = f"Se importaron equivalencias del archivo: {' y '.join(partes)}."

    try:
        archivos_recepcion.guardar(usuario.id, {
            "nombre_archivo": archivo.filename,
            "hojas": hojas,
            "hoja_principal": hoja_principal,
        })

        return PrevisualizacionRecepcionResponse(
            nombre_archivo=archivo.filename or "archivo.xlsx",
            hoja_actual=hoja_principal,
            hojas_disponibles=nombres_hojas,
            encabezados=encabezados,
            mapeo_sugerido=mapeo_sugerido,
            filas_totales=len(df),
            nota_importacion_equivalencias=nota,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo generar la vista previa de la hoja '{hoja_principal}'. "
            "Puede que esa hoja no tenga una fila de encabezados válida -- elige otra hoja del selector e intenta de nuevo.",
        ) from exc


@router.post("/hoja", response_model=PrevisualizacionRecepcionResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def cambiar_hoja_recepcion(
    datos: SeleccionarHojaRecepcionRequest, usuario: Usuario = Depends(usuario_actual),
) -> PrevisualizacionRecepcionResponse:
    """Cambia qué hoja del Excel ya subido se usa, sin tener que volver a subirlo."""
    en_proceso = archivos_recepcion.obtener(usuario.id)
    if not en_proceso:
        raise HTTPException(status_code=400, detail="Primero sube un archivo con /recepcion/previsualizar.")
    if datos.hoja not in en_proceso["hojas"]:
        raise HTTPException(status_code=400, detail=f"La hoja '{datos.hoja}' no existe en el archivo.")

    en_proceso["hoja_principal"] = datos.hoja
    archivos_recepcion.guardar(usuario.id, en_proceso)

    try:
        df = en_proceso["hojas"][datos.hoja]
        encabezados = [str(c) for c in df.columns]
        return PrevisualizacionRecepcionResponse(
            nombre_archivo=en_proceso["nombre_archivo"] or "archivo.xlsx",
            hoja_actual=datos.hoja,
            hojas_disponibles=list(en_proceso["hojas"].keys()),
            encabezados=encabezados,
            mapeo_sugerido=srv.auto_detectar_mapeo(encabezados),
            filas_totales=len(df),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo generar la vista previa de la hoja '{datos.hoja}'. "
            "Puede que esa hoja no tenga una fila de encabezados válida -- elige otra hoja del selector e intenta de nuevo.",
        ) from exc


@router.post("/verificar", response_model=VerificacionRecepcionResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def verificar(
    datos: ProcesarRecepcionRequest,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> VerificacionRecepcionResponse:
    """Paso 3: aplica el mapeo confirmado por el usuario, clasifica cada
    rollo y compara metros calculados vs. reportados."""
    en_proceso = archivos_recepcion.obtener(usuario.id)
    if not en_proceso:
        raise HTTPException(status_code=400, detail="Primero sube un archivo con /recepcion/previsualizar.")

    faltantes = srv.campos_requeridos_faltantes(datos.mapeo)
    if faltantes:
        raise HTTPException(status_code=400, detail=f"Faltan columnas obligatorias: {', '.join(faltantes)}")

    df = en_proceso["hojas"][en_proceso["hoja_principal"]]
    tablas = _tablas_equivalencia_desde_bd(db)
    rollos = srv.clasificar_y_verificar_filas(df, datos.mapeo, tablas, datos.tolerancia_porcentaje)
    _marcar_problemas_de_referencia(db, rollos, usuario.bodega_id)

    en_proceso["rollos_verificados"] = rollos
    en_proceso["tolerancia_porcentaje"] = datos.tolerancia_porcentaje
    archivos_recepcion.guardar(usuario.id, en_proceso)

    return VerificacionRecepcionResponse(
        rollos=[_rollo_a_schema(r) for r in rollos],
        resumen=srv.resumen_verificacion(rollos),
        estado_recepcion=srv.estado_general_recepcion(rollos),
    )


def _rollo_a_schema(r: srv.RolloClasificado) -> dict:
    return {
        "fila": r.fila,
        "rollo": r.rollo,
        "codigo_proveedor": r.codigo_proveedor,
        "espesor": r.espesor,
        "ancho": r.ancho,
        "net_weight": r.net_weight,
        "gross_weight": r.gross_weight,
        "coil_meters": r.coil_meters,
        "color_top": r.color_top,
        "color_back": r.color_back,
        "tipo_material": r.tipo_material,
        "proveedor": r.proveedor,
        "lote": r.lote,
        "empresa": r.empresa,
        "clasificado": r.clasificado,
        "codigo_clasificacion": r.codigo_clasificacion,
        "color_nombre": r.color_nombre,
        "tipo_nombre": r.tipo_nombre,
        "metros_calculados": r.metros_calculados,
        "diferencia_porcentaje": r.diferencia_porcentaje,
        "resultado": r.resultado,
        "problema_referencia": getattr(r, "problema_referencia", ""),
    }


def _marcar_problemas_de_referencia(db: Session, rollos: list[srv.RolloClasificado], bodega_id: int | None) -> None:
    """La referencia es el identificador único del rollo físico: marca las
    filas sin referencia, las repetidas dentro del mismo archivo y las que
    ya están registradas en esta bodega (ej. el mismo packing list subido
    dos veces). Se recalcula al confirmar, por si otro usuario registró
    algo entre la verificación y la confirmación."""
    referencias = [(r.rollo or "").strip() for r in rollos]
    conteo = Counter(ref for ref in referencias if ref)
    existentes: set[str] = set()
    if conteo:
        existentes = {
            ref for (ref,) in db.query(Rollo.identificador_rollo)
            .filter(Rollo.bodega_id == bodega_id, Rollo.identificador_rollo.in_(list(conteo)))
            .all()
        }
    for rollo, ref in zip(rollos, referencias):
        if not ref:
            rollo.problema_referencia = "sin_referencia"
        elif conteo[ref] > 1:
            rollo.problema_referencia = "repetida_en_archivo"
        elif ref in existentes:
            rollo.problema_referencia = "ya_existe"
        else:
            rollo.problema_referencia = ""


def _lista_corta(referencias: list[str]) -> str:
    unicas = list(dict.fromkeys(referencias))
    return ", ".join(unicas[:6]) + (f" y {len(unicas) - 6} más" if len(unicas) > 6 else "")


@router.post("/confirmar", response_model=RecepcionResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def confirmar(
    datos: ConfirmarRecepcionRequest,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> Recepcion:
    """Paso 4: registra cada rollo verificado como un elemento INDEPENDIENTE
    en `rollos` — nunca se unen ni se suman sus metros."""
    en_proceso = archivos_recepcion.obtener(usuario.id)
    rollos_verificados: list[srv.RolloClasificado] | None = (
        en_proceso.get("rollos_verificados") if en_proceso else None
    )
    if not rollos_verificados:
        raise HTTPException(status_code=400, detail="Primero verifica el archivo con /recepcion/verificar.")

    # Nunca registrar dos veces el mismo rollo físico (hallazgo #8 de la
    # auditoría). Además, la restricción única uq_rollos_bodega_identificador
    # frena un doble clic o dos confirmaciones simultáneas del mismo archivo.
    _marcar_problemas_de_referencia(db, rollos_verificados, usuario.bodega_id)
    sin_referencia = [r for r in rollos_verificados if r.problema_referencia == "sin_referencia"]
    repetidas = [r.rollo.strip() for r in rollos_verificados if r.problema_referencia == "repetida_en_archivo"]
    if sin_referencia:
        filas = _lista_corta([str(r.fila) for r in sin_referencia])
        raise HTTPException(status_code=400, detail=f"Hay rollos sin referencia en el Excel (filas {filas}). Corrige el archivo y vuelve a subirlo.")
    if repetidas:
        raise HTTPException(
            status_code=400,
            detail=f"Estas referencias aparecen más de una vez en el Excel: {_lista_corta(repetidas)}. Deja una sola fila por rollo y vuelve a subirlo.",
        )
    omitidos = [r.rollo.strip() for r in rollos_verificados if r.problema_referencia == "ya_existe"]
    a_registrar = [r for r in rollos_verificados if r.problema_referencia != "ya_existe"]
    # Hallazgo #9: un rollo sin peso o sin metros reportados no se puede
    # verificar y entraba con 0 m. La pantalla ya no deja confirmar así,
    # pero el servidor lo exige igual, sin importar qué haga el cliente.
    sin_datos = [r for r in a_registrar if r.resultado == "pendiente_datos"]
    if sin_datos:
        raise HTTPException(
            status_code=400,
            detail=f"Hay {len(sin_datos)} rollo(s) con datos faltantes (peso o metros), por ejemplo "
            f"{_lista_corta([r.rollo.strip() for r in sin_datos])}. Complétalos en el Excel o revisa las columnas elegidas.",
        )
    if not a_registrar:
        raise HTTPException(
            status_code=400,
            detail="Todos los rollos de este archivo ya están registrados en esta bodega; no hay nada nuevo que confirmar.",
        )

    ahora = datetime.now(timezone.utc)

    recepcion = Recepcion(
        fecha=ahora,
        bodega_id=usuario.bodega_id,
        encargado=usuario.correo,
        proveedor=datos.proveedor_principal or (rollos_verificados[0].proveedor or "No especificado"),
        archivo_origen=en_proceso["nombre_archivo"],
        tolerancia_porcentaje=datos.tolerancia_porcentaje,
        estado="registrada_en_inventario",
    )
    db.add(recepcion)
    db.flush()

    for r in a_registrar:
        codigo_interno = r.codigo_clasificacion or f"SC-{r.tipo_material or '?'}-{r.color_top or '?'}-{r.espesor or '?'}"
        descripcion = (
            f"{r.tipo_nombre or r.tipo_material} {r.color_nombre or r.color_top}"
            f"{' / ' + r.color_back if r.color_back else ''} {r.espesor}"
            if r.clasificado
            else f"Sin clasificar ({r.tipo_material or 'tipo'} / {r.color_top or 'color'})"
        )
        metros = round(r.metros_calculados if r.metros_calculados is not None else (r.coil_meters or 0), 2)

        rollo = Rollo(
            bodega_id=usuario.bodega_id,
            recepcion_id=recepcion.id,
            codigo_interno=codigo_interno,
            identificador_rollo=r.rollo.strip(),
            empresa=r.empresa,
            codigo_proveedor=r.codigo_proveedor,
            descripcion=descripcion,
            familia="Rollos de acero",
            color_material=r.color_nombre or r.color_top or "",
            calibre=r.espesor or 0,
            peso_neto=r.net_weight,
            metros_proveedor=r.coil_meters or 0,
            metros_calculados=r.metros_calculados or 0,
            metros_disponibles=metros,
            metros_consumidos=0,
            fecha_ingreso=ahora,
            estado="cerrado",
            proveedor=r.proveedor,
            lote=r.lote,
        )
        db.add(rollo)
        db.flush()

        db.add(
            Movimiento(
                fecha=ahora,
                tipo=TipoMovimiento.ENTRADA,
                motivo="recepcion_proveedor",
                producto_codigo=codigo_interno,
                producto_descripcion=f"{descripcion} (rollo {r.rollo})",
                rollo_id=rollo.id,
                identificador_rollo=rollo.identificador_rollo,
                bodega_origen_id=None,
                bodega_destino_id=usuario.bodega_id,
                cantidad=metros,
                usuario=usuario.correo,
                observaciones=f'Recepción Excel "{en_proceso["nombre_archivo"]}" — proveedor: {r.proveedor or "no especificado"}.',
            )
        )

    db.commit()
    db.refresh(recepcion)
    archivos_recepcion.eliminar(usuario.id)
    # Solo para la respuesta (no son columnas): cuántos se registraron y
    # cuáles se omitieron por estar ya en la bodega.
    recepcion.rollos_registrados = len(a_registrar)
    recepcion.rollos_omitidos = omitidos
    return recepcion


@router.get("/historial", response_model=list[RecepcionResponse])
def historial_recepciones(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> list[Recepcion]:
    return (
        db.query(Recepcion)
        .filter(coincide_bodega(Recepcion.bodega_id, usuario.bodega_id))
        .order_by(Recepcion.fecha.desc())
        .all()
    )


@router.get("/equivalencias", response_model=TablasEquivalenciaResponse)
def obtener_equivalencias(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> TablasEquivalenciaResponse:
    return TablasEquivalenciaResponse(
        colores=db.query(TablaColorEquivalencia).order_by(TablaColorEquivalencia.nombre).all(),
        tipos=db.query(TablaTipoMaterialEquivalencia).order_by(TablaTipoMaterialEquivalencia.nombre).all(),
        espesores=db.query(TablaEspesorEquivalencia).order_by(TablaEspesorEquivalencia.espesor).all(),
    )


@router.post("/equivalencias/colores", response_model=EquivalenciaColorResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(*ROLES_EDITAN_EQUIVALENCIAS))])
def guardar_equivalencia_color(
    datos: EquivalenciaColorInput,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> TablaColorEquivalencia:
    fila = db.query(TablaColorEquivalencia).filter(TablaColorEquivalencia.ral == datos.ral).first()
    if fila:
        fila.nombre = datos.nombre
        fila.codigo_interno = datos.codigo_interno
    else:
        fila = TablaColorEquivalencia(**datos.model_dump())
        db.add(fila)
    db.commit()
    db.refresh(fila)
    return fila


@router.post("/equivalencias/tipos", response_model=EquivalenciaTipoResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(*ROLES_EDITAN_EQUIVALENCIAS))])
def guardar_equivalencia_tipo(
    datos: EquivalenciaTipoInput,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> TablaTipoMaterialEquivalencia:
    fila = db.query(TablaTipoMaterialEquivalencia).filter(TablaTipoMaterialEquivalencia.nombre == datos.nombre).first()
    if fila:
        fila.codigo_interno = datos.codigo_interno
    else:
        fila = TablaTipoMaterialEquivalencia(**datos.model_dump())
        db.add(fila)
    db.commit()
    db.refresh(fila)
    return fila


@router.post("/equivalencias/espesor", response_model=EquivalenciaEspesorResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(*ROLES_EDITAN_EQUIVALENCIAS))])
def guardar_equivalencia_espesor(
    datos: EquivalenciaEspesorInput,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> TablaEspesorEquivalencia:
    # MySQL puede guardar FLOAT como 0.27000001, mientras que el formulario
    # envía 0.27. Comparar los flotantes directamente intentaba insertar una
    # fila duplicada y terminaba en un error 500.
    espesor_normalizado = round(float(datos.espesor), 4)
    fila = next(
        (
            existente
            for existente in db.query(TablaEspesorEquivalencia).all()
            if round(float(existente.espesor), 4) == espesor_normalizado
        ),
        None,
    )

    if fila:
        fila.mt_por_ton = datos.mt_por_ton
        fila.peso_por_metro = datos.peso_por_metro
    else:
        fila = TablaEspesorEquivalencia(**datos.model_dump())
        db.add(fila)

    db.commit()
    db.refresh(fila)
    return fila
