from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import coincide_bodega, get_db, requiere_rol, usuario_actual
from app.core.config import settings
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.producto import Producto
from app.models.unidad_familia import TablaUnidadFamilia
from app.models.usuario import RolUsuario, Usuario
from app.schemas.inventario import (
    ConfirmarCargaProductosRequest, MovimientoCrear, MovimientoResponse, PaginaMovimientos,
    PaginaProductos, PrevisualizacionCargaProductosResponse, ProductoActualizar, ProductoCrear,
    ProductoResponse, ResultadoCargaProductosResponse,
    SeleccionarHojaCargaProductosRequest,
)
from app.schemas.unidad_familia import UnidadFamiliaInput, UnidadFamiliaResponse
from app.services import carga_productos as srv_carga
from app.services import archivos_carga_productos
from app.services import clasificacion as srv_excel
from app.services import productos as srv_productos
from app.services.movimientos import aplicar_stock_editado, registrar_movimiento as aplicar_movimiento
from app.services.unidades_familia import validar_cantidad_entera_si_aplica

router = APIRouter(prefix="/inventario", tags=["Inventario"])


def _producto_de_mi_bodega(db: Session, producto_id: int, usuario: Usuario) -> Producto:
    producto = db.get(Producto, producto_id)
    if producto is None or producto.bodega_id != usuario.bodega_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Producto no encontrado.")
    return producto


@router.get("/productos", response_model=list[ProductoResponse] | PaginaProductos)
def listar_productos(
    busqueda: str = "", pagina: int = Query(1, ge=1), tamano: int = Query(30, ge=1, le=100),
    paginado: bool = False, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Producto] | PaginaProductos:
    # Los rollos (materia prima) ya no aparecen aquí como filas individuales:
    # su detalle vive en /rollos ("Rollos almacenados"). Este listado es solo
    # el catálogo de `Producto`.
    consulta = db.query(Producto).filter(coincide_bodega(Producto.bodega_id, usuario.bodega_id), Producto.familia != "Rollos de acero")
    if busqueda:
        termino = f"%{busqueda.lower()}%"
        consulta = consulta.filter(Producto.codigo.ilike(termino) | Producto.codigo_importacion.ilike(termino) | Producto.descripcion.ilike(termino))
    consulta = consulta.order_by(Producto.id.desc())
    if not paginado:
        return consulta.all()
    total = consulta.order_by(None).count()
    productos = consulta.offset((pagina - 1) * tamano).limit(tamano).all()
    return PaginaProductos(items=productos, total=total, pagina=pagina, tamano=tamano,
                           total_paginas=max(1, (total + tamano - 1) // tamano))


@router.get("/productos/alertas", response_model=list[ProductoResponse])
def listar_productos_bajo_minimo(
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Producto]:
    """Productos de mi bodega con `stock_minimo` configurado y `stock` por
    debajo de ese umbral — para la campana de alertas de Inventario."""
    return srv_productos.productos_bajo_minimo(db, usuario.bodega_id)


@router.post("/productos", response_model=ProductoResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def crear_producto(datos: ProductoCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Producto:
    validar_cantidad_entera_si_aplica(db, datos.familia, datos.entrada)
    validar_cantidad_entera_si_aplica(db, datos.familia, datos.stock)
    codigo = datos.codigo.strip()
    existente = (
        db.query(Producto)
        .filter(coincide_bodega(Producto.bodega_id, usuario.bodega_id), Producto.codigo == codigo)
        .with_for_update()
        .first()
    )
    if existente:
        raise HTTPException(status_code=409, detail=f"Ya existe un producto con el código '{codigo}' en tu bodega.")
    producto = Producto(bodega_id=usuario.bodega_id, **{**datos.model_dump(), "codigo": codigo})
    # Producto.tipo_producto es la fuente estructural de qué tipo de stock es
    # esta fila (ver Producción: "caballete"/"flanche") — un producto creado
    # aquí (a mano) NUNCA viene de Producción, así que si además configuraron
    # metros_por_unidad (m² por caja) es, por definición, un producto "por
    # conversión" (ej. Porcelanato). Derivarlo aquí, y no en el frontend a
    # partir de produccion_id + metros_por_unidad, evita que cualquier otro
    # producto (ej. Tornillos) con metros_por_unidad puesto por error quede
    # ambiguo: el campo que dice "qué es esto" queda escrito una sola vez,
    # en la fuente, no inferido cada vez que se agrupa o se muestra.
    producto.tipo_producto = "conversion" if (producto.metros_por_unidad or 0) > 0 else ""
    db.add(producto); db.commit(); db.refresh(producto)
    return producto


@router.put("/productos/{producto_id}", response_model=ProductoResponse,
            dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def actualizar_producto(producto_id: int, datos: ProductoActualizar, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Producto:
    _producto_de_mi_bodega(db, producto_id, usuario)
    # Bloqueado: el stock se decide con el valor actual (ver aplicar_stock_editado).
    producto = db.query(Producto).filter(Producto.id == producto_id).with_for_update().populate_existing().one()
    validar_cantidad_entera_si_aplica(db, datos.familia, datos.entrada)
    validar_cantidad_entera_si_aplica(db, datos.familia, datos.stock)
    campos_de_stock = {"stock", "entrada", "stock_anterior", "entrada_anterior"}
    for campo, valor in datos.model_dump(exclude=campos_de_stock).items(): setattr(producto, campo, valor)
    aplicar_stock_editado(
        db, producto, stock=datos.stock, stock_anterior=datos.stock_anterior,
        entrada=datos.entrada, entrada_anterior=datos.entrada_anterior, usuario=usuario,
    )
    # Mismo criterio que en crear_producto: si esta edición quita el m² por
    # caja, el producto deja de ser "por conversión"; si lo agrega, lo pasa
    # a ser. No toca tipo_producto si el producto viene de Producción
    # (nunca se edita por esta ruta con metros_por_unidad relevante para
    # caballetes/flanches, que ya traen su propio tipo_producto correcto).
    if producto.produccion_id is None:
        producto.tipo_producto = "conversion" if (producto.metros_por_unidad or 0) > 0 else ""
    db.commit(); db.refresh(producto)
    return producto


@router.delete("/productos/{producto_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def eliminar_producto(producto_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> None:
    db.delete(_producto_de_mi_bodega(db, producto_id, usuario)); db.commit()


@router.post("/productos/carga/previsualizar", response_model=PrevisualizacionCargaProductosResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
async def previsualizar_carga_productos(
    archivo: UploadFile, usuario: Usuario = Depends(usuario_actual),
) -> PrevisualizacionCargaProductosResponse:
    """Paso 1: lee el Excel de productos, detecta encabezados y sugiere un mapeo."""
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

        archivos_carga_productos.guardar(usuario.id, {
            "nombre_archivo": archivo.filename,
            "hoja_principal": hoja_principal,
            "hojas": hojas,
        })

        return PrevisualizacionCargaProductosResponse(
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


@router.post("/productos/carga/hoja", response_model=PrevisualizacionCargaProductosResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def cambiar_hoja_carga_productos(
    datos: SeleccionarHojaCargaProductosRequest, usuario: Usuario = Depends(usuario_actual),
) -> PrevisualizacionCargaProductosResponse:
    """Cambia qué hoja del Excel ya subido se usa, sin tener que volver a subirlo."""
    en_proceso = archivos_carga_productos.obtener(usuario.id)
    if not en_proceso:
        raise HTTPException(status_code=400, detail="Primero sube un archivo con /inventario/productos/carga/previsualizar.")
    if datos.hoja not in en_proceso["hojas"]:
        raise HTTPException(status_code=400, detail=f"La hoja '{datos.hoja}' no existe en el archivo.")

    en_proceso["hoja_principal"] = datos.hoja
    archivos_carga_productos.guardar(usuario.id, en_proceso)

    try:
        df = en_proceso["hojas"][datos.hoja]
        encabezados = [str(c) for c in df.columns]
        return PrevisualizacionCargaProductosResponse(
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


@router.post("/productos/carga/confirmar", response_model=ResultadoCargaProductosResponse,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def confirmar_carga_productos(
    datos: ConfirmarCargaProductosRequest, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> ResultadoCargaProductosResponse:
    """Paso 2: aplica el mapeo confirmado y hace upsert por (bodega_id, código)."""
    en_proceso = archivos_carga_productos.obtener(usuario.id)
    if not en_proceso:
        raise HTTPException(status_code=400, detail="Primero sube un archivo con /inventario/productos/carga/previsualizar.")

    faltantes = srv_carga.campos_requeridos_faltantes(datos.mapeo)
    if faltantes:
        raise HTTPException(status_code=400, detail=f"Faltan columnas obligatorias: {', '.join(faltantes)}")

    df = en_proceso["hojas"][en_proceso["hoja_principal"]]
    resultado = srv_carga.procesar_filas(df, datos.mapeo, db, usuario.bodega_id)
    db.commit()
    archivos_carga_productos.eliminar(usuario.id)

    return ResultadoCargaProductosResponse(
        filas_totales=resultado.filas_totales, creados=resultado.creados, actualizados=resultado.actualizados,
        omitidas=len(resultado.omitidas),
        detalle_omitidas=[{"fila": o.fila, "codigo": o.codigo, "motivo": o.motivo} for o in resultado.omitidas],
    )


@router.post("/movimientos", response_model=MovimientoResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def registrar_movimiento(datos: MovimientoCrear, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Movimiento:
    movimiento = aplicar_movimiento(db, datos, usuario)
    db.commit(); db.refresh(movimiento)
    return movimiento


@router.get("/historial", response_model=list[MovimientoResponse] | PaginaMovimientos)
def historial(
    codigo_producto: str = "", codigo_rollo: str = "", cotizacion: str = "", empresa_externa: str = "", tipo: TipoMovimiento | None = None, fecha_desde: datetime | None = None,
    fecha_hasta: datetime | None = None, pagina: int = Query(1, ge=1), tamano: int = Query(30, ge=1, le=100),
    paginado: bool = False, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[Movimiento] | PaginaMovimientos:
    # Una bodega solo ve los movimientos en que fue origen o destino. Admin
    # Inventario ve los de TODAS las sedes. El resto de cuentas sin bodega
    # (vendedor, superadmin) no tiene historial: antes el filtro "origen o
    # destino IS NULL" les mostraba todas las entradas y salidas de todas
    # las sedes, porque cada entrada tiene origen NULL y cada salida destino NULL.
    consulta = db.query(Movimiento)
    if usuario.rol == RolUsuario.ADMIN_INVENTARIO:
        pass
    elif usuario.bodega_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tu usuario no tiene acceso al historial de movimientos.")
    else:
        consulta = consulta.filter(
            (Movimiento.bodega_origen_id == usuario.bodega_id) | (Movimiento.bodega_destino_id == usuario.bodega_id)
        )
    if codigo_producto: consulta = consulta.filter(Movimiento.producto_codigo.ilike(f"%{codigo_producto}%"))
    if codigo_rollo: consulta = consulta.filter(Movimiento.identificador_rollo.ilike(f"%{codigo_rollo}%"))
    if cotizacion: consulta = consulta.filter(Movimiento.cotizacion.ilike(f"%{cotizacion}%"))
    if empresa_externa: consulta = consulta.filter(Movimiento.empresa_externa.ilike(f"%{empresa_externa}%"))
    if tipo: consulta = consulta.filter(Movimiento.tipo == tipo)
    if fecha_desde: consulta = consulta.filter(Movimiento.fecha >= fecha_desde)
    if fecha_hasta: consulta = consulta.filter(Movimiento.fecha <= fecha_hasta)
    consulta = consulta.order_by(Movimiento.fecha.desc())
    if not paginado: return consulta.all()
    total = consulta.count()
    return PaginaMovimientos(items=consulta.offset((pagina - 1) * tamano).limit(tamano).all(), total=total,
                             pagina=pagina, tamano=tamano, total_paginas=max(1, (total + tamano - 1) // tamano))


@router.get("/unidades-familia", response_model=list[UnidadFamiliaResponse])
def listar_unidades_familia(
    db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> list[TablaUnidadFamilia]:
    """Unidad de medida configurada por familia de producto (global, no por
    bodega) — para mostrar "unidades", "metros", "kg", etc. junto al stock."""
    return db.query(TablaUnidadFamilia).order_by(TablaUnidadFamilia.familia).all()


@router.post("/unidades-familia", response_model=UnidadFamiliaResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def guardar_unidad_familia(
    datos: UnidadFamiliaInput, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual),
) -> TablaUnidadFamilia:
    fila = db.query(TablaUnidadFamilia).filter(TablaUnidadFamilia.familia == datos.familia).first()
    if fila:
        fila.unidad = datos.unidad
        fila.permite_decimales = datos.permite_decimales
    else:
        fila = TablaUnidadFamilia(familia=datos.familia, unidad=datos.unidad, permite_decimales=datos.permite_decimales)
        db.add(fila)
    db.commit()
    db.refresh(fila)
    return fila
