from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy import case
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.apartado import Apartado, ApartadoItem, EstadoApartado, ModalidadApartado
from app.models.bodega import Bodega
from app.models.producto import Producto
from app.services.productos import FAMILIA_ROLLOS
from app.models.usuario import RolUsuario, Usuario
from app.schemas.apartados import (
    ApartadoCrear, ApartadoResponse, DisponibilidadCodigoResponse, DisponibilidadProductoResponse, ReservaCodigoResponse,
    RolloParaApartarResponse,
)
from app.models.rollo import Rollo
from app.core.config import settings
from app.schemas.apartados import ApartadoEditar, ApartadoItemEditar, RegistrarSalidaRequest, SepararApartadoRequest
from app.schemas.inventario import ProductoResponse
from app.services import apartados as srv
from app.services import importar_cotizaciones
from app.services.salida_apartado import registrar_salida

router = APIRouter(prefix="/apartados", tags=["Apartados"])


def _con_faltantes(db: Session, apartados: list[Apartado]) -> list[Apartado]:
    """Anota en cada apartado lo que le falta por llegar (material en camino)."""
    faltantes = srv.faltantes_de_apartados(db, apartados)
    partes = srv.otras_partes(db, apartados)
    for apartado in apartados:
        apartado.faltantes = faltantes.get(apartado.id, [])
        apartado.otras_partes = partes.get(apartado.id, [])
    return apartados


@router.get("/disponibilidad", response_model=DisponibilidadCodigoResponse)
def consultar_disponibilidad(
    codigo_interno: str = Query(..., min_length=1), bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Cuánto material hay de un código de clasificación (color + calibre) antes
    de apartarlo: rollos, metros disponibles, reservados y consumidos."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    return srv.disponibilidad_por_codigo(db, bodega_id=bodega, codigo_interno=codigo_interno)


@router.get("/rollos-para-apartar", response_model=list[RolloParaApartarResponse])
def rollos_para_apartar(
    bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Rollo]:
    """Rollos de la bodega que se pueden vender completos: con metros, sin
    otra cotización que los tenga apartados completos (un rollo en un envío
    pendiente todavía no está en ninguna bodega).
    La búsqueda (código, referencia, kilos) se hace en la pantalla."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    rollos = (
        db.query(Rollo)
        .filter(Rollo.bodega_id == bodega, Rollo.metros_disponibles > 0.005)
        .order_by(Rollo.codigo_interno, Rollo.identificador_rollo)
        .all()
    )
    ocupados = srv.rollos_apartados_completos(db, (r.id for r in rollos))
    return [r for r in rollos if r.id not in ocupados]


@router.get("/disponibilidad-producto", response_model=DisponibilidadProductoResponse)
def consultar_disponibilidad_producto(
    producto_id: int = Query(..., gt=0), bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Cuánto stock hay de un `Producto` concreto antes de apartarlo (POR_STOCK):
    stock físico, cantidad ya reservada por apartados activos, y disponible."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    producto = db.get(Producto, producto_id)
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    # El buscador también ofrece productos de otras bodegas (se traen con un
    # traslado): aquí se responde por la fila de ESE producto en la bodega de
    # la cotización, o con 0 si todavía no existe ahí.
    if producto.bodega_id != bodega:
        propio = (
            db.query(Producto)
            .filter(Producto.bodega_id == bodega, Producto.codigo == producto.codigo, Producto.empresa == (producto.empresa or ""))
            .first()
        )
        resumen = (srv.disponibilidad_producto(db, bodega_id=bodega, producto_id=propio.id) if propio else
                   {"producto_id": producto.id, "codigo": producto.codigo, "descripcion": producto.descripcion,
                    "stock": 0.0, "cantidad_reservada": 0.0, "cantidad_disponible": 0.0})
    else:
        resumen = srv.disponibilidad_producto(db, bodega_id=bodega, producto_id=producto_id)
    empresa, donde = srv.disponible_empresa_producto(db, producto=producto, bodega_despacho=bodega)
    return {**resumen, "disponible_empresa": empresa, "en_otras_bodegas": ", ".join(f"{n} {c:g}" for n, c in donde)}


@router.get("/productos", response_model=list[ProductoResponse])
def buscar_productos_para_apartar(
    busqueda: str = Query(..., min_length=1), bodega_id: int | None = None, empresa: str = "",
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Producto]:
    """Productos de stock de la bodega elegida para una línea POR_STOCK. Admin
    Inventario no tiene bodega propia, por eso no sirve /inventario/productos."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    texto = busqueda.strip()
    termino = f"%{texto}%"
    coincide = Producto.codigo.ilike(termino) | Producto.codigo_importacion.ilike(termino) | Producto.descripcion.ilike(termino)
    # Primero lo que EMPIEZA con lo buscado ("perfil" -> PERFIL...), después lo
    # que solo lo tiene en medio ("per" también está en SUPERMIL).
    empieza = case((Producto.codigo.ilike(f"{texto}%") | Producto.descripcion.ilike(f"{texto}%"), 0), else_=1)
    # Una cotización de Asia Business solo usa material de Asia (y una de
    # Arquitejas, de Arquitejas): los de la otra empresa no salen.
    if empresa.strip():
        coincide = coincide & (Producto.empresa == empresa.strip().upper())
    propios = (
        db.query(Producto)
        .filter(Producto.bodega_id == bodega, Producto.familia != FAMILIA_ROLLOS, coincide)
        .order_by(empieza, Producto.codigo)
        .limit(20)
        .all()
    )
    # Lo que no está en esta bodega pero sí en otra (se trae con un traslado;
    # San Gil no traslada): una fila por código y empresa, la de más stock.
    ya = {(p.codigo, p.empresa) for p in propios}
    sin_traslado = {b.id for b in db.query(Bodega).all() if b.sin_traslado}
    otros: dict[tuple, Producto] = {}
    for p in (
        db.query(Producto)
        .filter(Producto.bodega_id.isnot(None), Producto.bodega_id != bodega, Producto.familia != FAMILIA_ROLLOS,
                Producto.stock > 0, coincide)
        .order_by(empieza, Producto.stock.desc())
        .limit(40)
    ):
        clave = (p.codigo, p.empresa)
        if clave not in ya and clave not in otros and p.bodega_id not in sin_traslado:
            otros[clave] = p
    def empieza_con(p: Producto) -> bool:
        return any((v or "").lower().startswith(texto.lower()) for v in (p.codigo, p.descripcion))

    # Lo de esta bodega primero dentro de cada grupo (los que empiezan y los demás).
    resultado = sorted(propios + list(otros.values()), key=lambda p: (not empieza_con(p), p.bodega_id != bodega))[:20]
    # Cuánto se puede prometer de cada uno en toda la empresa: la pantalla no
    # deja escoger lo que no tiene (ej. un caballete en negativo).
    for p in resultado:
        p.disponible_empresa, _ = srv.disponible_empresa_producto(db, producto=p, bodega_despacho=bodega)
    return resultado


@router.get("/reservas", response_model=list[ReservaCodigoResponse])
def listar_reservas_por_codigo(
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[dict]:
    """Metros reservados por código para toda la bodega, en un solo llamado —
    usado en "Rollos almacenados" para mostrar el stock físico ya descontado
    por apartados activos, sin esperar a que producción los consuma."""
    return srv.metros_reservados_por_bodega(db, bodega_id=usuario.bodega_id)


@router.post("/importar", dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def importar_desde_excel(
    archivo: UploadFile, confirmar: bool = False,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> dict:
    """Carga las cotizaciones que siguen apartadas en el Excel de control
    (hoja SALIDA, REFERENCIA vacía). Sin `confirmar` solo muestra lo que
    se va a crear; con `confirmar=true` lo crea (ver importar_cotizaciones)."""
    nombre = archivo.filename or ""
    if not nombre.lower().endswith((".xlsx", ".xls", ".xlsm")):
        raise HTTPException(status_code=415, detail="Solo se aceptan archivos Excel (.xlsx o .xls).")
    contenido = archivo.file.read(settings.MAX_ARCHIVO_RECEPCION_BYTES + 1)
    if len(contenido) > settings.MAX_ARCHIVO_RECEPCION_BYTES:
        limite_mb = settings.MAX_ARCHIVO_RECEPCION_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"El archivo supera el límite de {limite_mb} MB.")
    resultado = importar_cotizaciones.analizar(db, contenido)
    respuesta = importar_cotizaciones.resumen(resultado)
    if confirmar:
        if not resultado.apartados and not resultado.mermas:
            raise HTTPException(status_code=400, detail="No hay cotizaciones ni mermas nuevas para cargar en este archivo.")
        creados = importar_cotizaciones.crear(db, resultado, usuario, nombre)
        db.commit()
        respuesta["creados"] = len(creados)
        respuesta["mermas_registradas"] = resultado.mermas_registradas
        respuesta["esperando_material"] = importar_cotizaciones.cuantos_esperan_material(db, creados)
    return respuesta


@router.post("/{apartado_id}/registrar-salida", response_model=ApartadoResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def registrar_salida_con_hoja_de_vida(
    apartado_id: int, datos: RegistrarSalidaRequest,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Apartado:
    """Admin Inventario registra la salida con la hoja de vida física: la
    referencia del rollo usado y los metros (ver salida_apartado)."""
    apartado = registrar_salida(db, apartado_id, datos, usuario)
    db.commit(); db.refresh(apartado)
    return _con_faltantes(db, [apartado])[0]


# Los apartados los crea Admin Inventario (cotización aprobada) eligiendo la
# bodega; la bodega solo decide cuándo enviarlo a producción.
@router.post("", response_model=ApartadoResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def crear_apartado(datos: ApartadoCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    """Si las líneas salen de varias bodegas, se crea una cotización por
    bodega con el mismo número (cada bodega despacha su parte), todo junto o
    nada. Devuelve la de la bodega principal."""
    por_bodega: dict[int | None, list] = {}
    for item in datos.items:
        por_bodega.setdefault(item.bodega_id or datos.bodega_id, []).append(item)
    if len(por_bodega) == 1:
        partes = [datos.model_copy(update={"bodega_id": next(iter(por_bodega))})]
    else:
        nombres = {b.id: b.nombre for b in db.query(Bodega).filter(Bodega.id.in_([b for b in por_bodega if b]))}
        principal = datos.bodega_id if datos.bodega_id in por_bodega else next(iter(por_bodega))
        orden = [principal] + [b for b in por_bodega if b != principal]
        todas = ", ".join(nombres.get(b, str(b)) for b in orden)
        partes = [
            datos.model_copy(update={
                "bodega_id": b, "items": por_bodega[b],
                "observaciones": (f"{datos.observaciones} · " if datos.observaciones else "")
                + f"Cotización con material de varias bodegas ({todas}): esta es la parte de {nombres.get(b, b)}.",
            })
            for b in orden
        ]
    creados = []
    for parte in partes:
        try:
            creados.append(srv.crear_apartado(db, parte, usuario))
        except HTTPException as exc:
            if len(partes) > 1:  # que se sepa de cuál bodega es el problema
                nombre = db.get(Bodega, parte.bodega_id).nombre if parte.bodega_id else ""
                raise HTTPException(status_code=exc.status_code, detail=f"{nombre}: {exc.detail}") from exc
            raise
    db.commit()
    for apartado in creados:
        db.refresh(apartado)
    return _con_faltantes(db, creados)[0]


@router.get("", response_model=list[ApartadoResponse])
def listar_apartados(
    estado: EstadoApartado | None = None, numero_cotizacion: str = "",
    # Varios estados a la vez (?estados=a&estados=b). El globo de Planta y
    # Registrar Producción solo necesitan los que están en producción y se
    # refrescan solos: pedir todo el histórico (entregados, cancelados...)
    # en cada recarga gastaba datos de Supabase sin razón.
    estados: list[EstadoApartado] = Query(default=[]),
    bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Apartado]:
    consulta = (
        db.query(Apartado)
        .options(joinedload(Apartado.items).joinedload(ApartadoItem.producciones), joinedload(Apartado.items).joinedload(ApartadoItem.rollo),
                 joinedload(Apartado.bodega))
    )
    # Admin Inventario ve los de todas las bodegas (puede filtrar por una);
    # los demás roles, solo los de la suya.
    if usuario.rol == RolUsuario.ADMIN_INVENTARIO:
        if bodega_id is not None: consulta = consulta.filter(Apartado.bodega_id == bodega_id)
    else:
        consulta = consulta.filter(Apartado.bodega_id == usuario.bodega_id)
    if estado: consulta = consulta.filter(Apartado.estado == estado)
    if estados: consulta = consulta.filter(Apartado.estado.in_(estados))
    if numero_cotizacion: consulta = consulta.filter(Apartado.numero_cotizacion.ilike(f"%{numero_cotizacion}%"))
    return _con_faltantes(db, consulta.order_by(Apartado.fecha_creacion.desc()).all())


@router.get("/{apartado_id}", response_model=ApartadoResponse)
def obtener_apartado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    return _con_faltantes(db, [srv.apartado_de_mi_bodega(db, apartado_id, usuario)])[0]


@router.delete("/{apartado_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def eliminar_apartado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> None:
    srv.eliminar_apartado_cancelado(db, apartado_id, usuario)
    db.commit()


@router.put("/{apartado_id}", response_model=ApartadoResponse,
            dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def editar_apartado(
    apartado_id: int, datos: ApartadoEditar, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Apartado:
    """Admin Inventario corrige una cotización activa (ver srv.editar_apartado).
    Las líneas que salen de OTRA bodega se pasan a la misma cotización en esa
    bodega: se le suman si ya existe ahí, o se crea. Todo junto o nada."""
    if datos.otras_partes_ids:
        apartado = _editar_cotizacion_completa(db, apartado_id, datos, usuario)
        db.commit(); db.refresh(apartado)
        return _con_faltantes(db, [apartado])[0]
    bodega = srv.bodega_de_consulta(db, usuario, datos.bodega_id)
    propias = [linea for linea in datos.items if not linea.bodega_id or linea.bodega_id == bodega]
    por_bodega: dict[int, list] = {}
    for linea in datos.items:
        if linea.bodega_id and linea.bodega_id != bodega:
            # Una línea que ya existía y cambia de bodega sale de esta
            # cotización (si ya tuvo salida, editar_apartado no lo permite)
            # y entra como línea nueva en la otra.
            por_bodega.setdefault(linea.bodega_id, []).append(linea.model_copy(update={"id": None, "bodega_id": None}))
    if not propias:
        # Se quitaron todas las líneas de esta parte (o todas pasan a otra
        # bodega): la parte se borra y queda lo de las otras bodegas.
        origen = srv.apartado_de_mi_bodega(db, apartado_id, usuario)
        numero, bodega_nombre = origen.numero_cotizacion, origen.bodega_nombre
        srv.quitar_parte(db, apartado_id, usuario, pasa_a_otra_bodega=bool(por_bodega))
        _pasar_a_otras_bodegas(db, numero, bodega_nombre, por_bodega, datos, usuario)
        db.commit()
        restante = (
            db.query(Apartado)
            .filter(Apartado.numero_cotizacion.in_([numero, srv.numero_base(numero)]) | Apartado.numero_cotizacion.like(f"{srv.numero_base(numero)}-%"),
                    Apartado.estado.in_(srv.ESTADOS_RESERVA_ACTIVA))
            .order_by(Apartado.id)
            .first()
        )
        if restante is None:
            raise HTTPException(status_code=500, detail="No se encontró la otra parte de la cotización.")
        return _con_faltantes(db, [restante])[0]
    apartado = srv.editar_apartado(db, apartado_id, datos.model_copy(update={"items": propias}), usuario)
    _pasar_a_otras_bodegas(db, apartado.numero_cotizacion, apartado.bodega_nombre, por_bodega, datos, usuario)
    db.commit(); db.refresh(apartado)
    return _con_faltantes(db, [apartado])[0]


def _editar_cotizacion_completa(db: Session, apartado_id: int, datos: ApartadoEditar, usuario: Usuario) -> Apartado:
    """Admin Inventario edita la cotización completa (todas sus bodegas a la
    vez): cada línea dice de qué bodega sale y aquí se reparte. La parte que
    se queda sin líneas se borra, la bodega nueva recibe su parte y las demás
    se editan. Lo que se reduce va primero, para que lo que se libera alcance
    a lo que aumenta en otra bodega. Sin commit: todo junto o nada."""
    principal = srv.apartado_de_mi_bodega(db, apartado_id, usuario)
    partes = [principal]
    for otro_id in dict.fromkeys(datos.otras_partes_ids):
        if otro_id == apartado_id:
            continue
        parte = srv.apartado_de_mi_bodega(db, otro_id, usuario)
        if parte.numero_cotizacion != principal.numero_cotizacion or parte.bodega_id in {p.bodega_id for p in partes}:
            raise HTTPException(status_code=400, detail="Las partes no son de la misma cotización. Recarga e intenta de nuevo.")
        partes.append(parte)
    if any(p.estado not in srv.ESTADOS_RESERVA_ACTIVA for p in partes):
        raise HTTPException(status_code=400, detail="Solo se pueden editar cotizaciones activas (no terminadas, entregadas ni canceladas).")
    if not datos.items:
        raise HTTPException(status_code=400, detail="La cotización debe tener al menos un producto solicitado.")

    bodega_principal = srv.bodega_de_consulta(db, usuario, datos.bodega_id)
    parte_de_item = {item.id: parte for parte in partes for item in parte.items}
    por_bodega: dict[int, list] = {}
    for linea in datos.items:
        bodega = linea.bodega_id or bodega_principal
        if linea.id:
            duena = parte_de_item.get(linea.id)
            if duena is None:
                raise HTTPException(status_code=400, detail="Alguna línea no pertenece a esta cotización. Recarga e intenta de nuevo.")
            if duena.bodega_id != bodega:
                # Cambió de bodega: sale de su parte y entra como nueva en la otra.
                linea = linea.model_copy(update={"id": None})
        por_bodega.setdefault(bodega, []).append(linea.model_copy(update={"bodega_id": None}))

    nombres = {b.id: b.nombre for b in db.query(Bodega).filter(Bodega.id.in_(list(por_bodega) + [p.bodega_id for p in partes]))}
    parte_por_bodega = {p.bodega_id: p for p in partes}

    def con_bodega(nombre: str, accion):
        try:
            return accion()
        except HTTPException as exc:
            raise HTTPException(status_code=exc.status_code, detail=f"{nombre}: {exc.detail}") from exc

    # 1. Las partes que quedan sin líneas se borran (su material queda libre).
    for parte in partes:
        if parte.bodega_id not in por_bodega:
            con_bodega(parte.bodega_nombre, lambda: srv.quitar_parte(db, parte.id, usuario, pasa_a_otra_bodega=True))

    # 2. Las que siguen se editan, primero las que piden menos que antes.
    def cambio(parte: Apartado) -> float:
        antes = sum((it.metros_requeridos or 0) if it.modalidad == ModalidadApartado.POR_ROLLO else it.cantidad for it in parte.items)
        despues = sum(srv.metros_de_linea(l.cantidad, l.medida, l.tipo_producto) if l.modalidad == ModalidadApartado.POR_ROLLO else l.cantidad
                      for l in por_bodega[parte.bodega_id])
        return despues - antes
    for parte in sorted((p for p in partes if p.bodega_id in por_bodega), key=cambio):
        cambios = datos.model_copy(update={
            "bodega_id": parte.bodega_id, "items": por_bodega[parte.bodega_id], "otras_partes_ids": [],
            "observaciones": datos.observaciones if parte.id == principal.id else parte.observaciones,
        })
        con_bodega(parte.bodega_nombre, lambda: srv.editar_apartado(db, parte.id, cambios, usuario))

    # 3. Las bodegas nuevas reciben su parte.
    nuevas = []
    for bodega, lineas in por_bodega.items():
        if bodega in parte_por_bodega:
            continue
        nombre = nombres.get(bodega, str(bodega))
        nuevas.append(con_bodega(nombre, lambda: srv.crear_apartado(db, ApartadoCrear(
            bodega_id=bodega, material_en_camino=datos.material_en_camino, numero_cotizacion=datos.numero_cotizacion,
            empresa=datos.empresa, cliente=datos.cliente,
            observaciones=f"Parte de la cotización {datos.numero_cotizacion} con material de {nombre}.",
            items=lineas,
        ), usuario)))
    db.flush()
    if principal.bodega_id in por_bodega:
        return principal
    restantes = [p for p in partes if p.bodega_id in por_bodega] + nuevas
    return restantes[0]


def _pasar_a_otras_bodegas(
    db: Session, numero: str, bodega_nombre: str, por_bodega: dict[int, list], datos: ApartadoEditar, usuario: Usuario,
) -> None:
    """Las líneas que al editar pasan a otra bodega se suman a la misma
    cotización en esa bodega, o se crea ahí."""
    for otra, lineas in por_bodega.items():
        nombre = db.get(Bodega, otra).nombre if db.get(Bodega, otra) else str(otra)
        try:
            hermana = (
                db.query(Apartado)
                .filter(Apartado.bodega_id == otra, Apartado.numero_cotizacion == numero,
                        Apartado.estado.in_(srv.ESTADOS_RESERVA_ACTIVA))
                .first()
            )
            if hermana is not None:
                actuales = [
                    ApartadoItemEditar(
                        id=it.id, modalidad=it.modalidad, descripcion=it.descripcion, cantidad=it.cantidad,
                        codigo_interno=it.codigo_interno, medida=it.medida, producto_id=it.producto_id, rollo_id=it.rollo_id,
                    )
                    for it in hermana.items
                ]
                srv.editar_apartado(db, hermana.id, ApartadoEditar(
                    bodega_id=otra, material_en_camino=datos.material_en_camino, numero_cotizacion=hermana.numero_cotizacion,
                    empresa=hermana.empresa or datos.empresa, cliente=hermana.cliente, observaciones=hermana.observaciones,
                    items=actuales + lineas,
                ), usuario)
            else:
                srv.crear_apartado(db, ApartadoCrear(
                    bodega_id=otra, material_en_camino=datos.material_en_camino, numero_cotizacion=numero,
                    empresa=datos.empresa, cliente=datos.cliente,
                    observaciones=f"Parte de la cotización {numero} de {bodega_nombre} "
                    f"con material de {nombre}.",
                    items=lineas,
                ), usuario)
        except HTTPException as exc:
            raise HTTPException(status_code=exc.status_code, detail=f"{nombre}: {exc.detail}") from exc


@router.post("/{apartado_id}/separar", response_model=ApartadoResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO, RolUsuario.ADMINISTRATIVO))])
def separar_apartado(
    apartado_id: int, datos: SepararApartadoRequest, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> Apartado:
    """El cliente no se lleva todo (o el carro solo se lleva una parte): lo
    elegido pasa a una cotización nueva (ver srv.separar_apartado). La
    encargada de la bodega solo puede con producción terminada. Devuelve la
    cotización nueva."""
    nueva = srv.separar_apartado(db, apartado_id, datos, usuario)
    db.commit(); db.refresh(nueva)
    return _con_faltantes(db, [nueva])[0]


@router.patch("/{apartado_id}/cancelar", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def cancelar_apartado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.cancelar_apartado(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/enviar-a-produccion", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO))])
def enviar_a_produccion(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.enviar_a_produccion(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/marcar-terminado", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.JEFE_PLANTA))])
def marcar_produccion_terminada(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.marcar_produccion_terminada(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/confirmar-separacion-stock", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.JEFE_PLANTA))])
def confirmar_separacion_stock(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.confirmar_separacion_stock(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado


@router.patch("/{apartado_id}/marcar-entregado", response_model=ApartadoResponse,
              dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO))])
def marcar_entregado(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    apartado = srv.marcar_entregado(db, apartado_id, usuario)
    db.commit(); db.refresh(apartado)
    return apartado
