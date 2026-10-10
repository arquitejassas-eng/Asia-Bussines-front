from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.apartado import Apartado, ApartadoItem, EstadoApartado
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
from app.schemas.apartados import ApartadoEditar, RegistrarSalidaRequest, SepararApartadoRequest
from app.schemas.inventario import ProductoResponse
from app.services import apartados as srv
from app.services import importar_cotizaciones
from app.services.salida_apartado import registrar_salida

router = APIRouter(prefix="/apartados", tags=["Apartados"])


def _con_faltantes(db: Session, apartados: list[Apartado]) -> list[Apartado]:
    """Anota en cada apartado lo que le falta por llegar (material en camino)."""
    faltantes = srv.faltantes_de_apartados(db, apartados)
    for apartado in apartados:
        apartado.faltantes = faltantes.get(apartado.id, [])
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
    return srv.disponibilidad_producto(db, bodega_id=bodega, producto_id=producto_id)


@router.get("/productos", response_model=list[ProductoResponse])
def buscar_productos_para_apartar(
    busqueda: str = Query(..., min_length=1), bodega_id: int | None = None,
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Producto]:
    """Productos de stock de la bodega elegida para una línea POR_STOCK. Admin
    Inventario no tiene bodega propia, por eso no sirve /inventario/productos."""
    bodega = srv.bodega_de_consulta(db, usuario, bodega_id)
    termino = f"%{busqueda.strip()}%"
    return (
        db.query(Producto)
        .filter(Producto.bodega_id == bodega, Producto.familia != FAMILIA_ROLLOS)
        .filter(Producto.codigo.ilike(termino) | Producto.codigo_importacion.ilike(termino) | Producto.descripcion.ilike(termino))
        .order_by(Producto.id.desc())
        .limit(8)
        .all()
    )


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
    """Admin Inventario corrige una cotización activa (ver srv.editar_apartado)."""
    apartado = srv.editar_apartado(db, apartado_id, datos, usuario)
    db.commit(); db.refresh(apartado)
    return _con_faltantes(db, [apartado])[0]


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
