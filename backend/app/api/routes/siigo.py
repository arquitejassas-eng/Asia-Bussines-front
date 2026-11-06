import threading
import time
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db, requiere_rol, usuario_actual
from app.models.apartado import Apartado, ApartadoItem
from app.models.usuario import RolUsuario, Usuario
from app.schemas.apartados import ApartadoResponse
from app.services import apartados as srv_apartados
from app.services import siigo, siigo_cotizacion
from app.services.empresas import EMPRESAS_CONOCIDAS

router = APIRouter(prefix="/siigo", tags=["Siigo"],
                   dependencies=[Depends(requiere_rol(RolUsuario.VENDEDOR, RolUsuario.ADMIN_INVENTARIO))])

# Productos de Siigo por empresa, guardados un rato en memoria: buscar en
# la lista de cientos de productos no puede pedirle a Siigo todo cada vez.
MINUTOS_PRODUCTOS = 30
_productos: dict[str, tuple[float, list[dict]]] = {}
_candado_productos = threading.Lock()


def _empresa(empresa: str) -> str:
    empresa = (empresa or "").strip().upper()
    if empresa not in EMPRESAS_CONOCIDAS:
        raise HTTPException(status_code=400, detail="La empresa debe ser Arquitejas (AR) o Asia Business (ABG).")
    return empresa


def _sin_tildes(texto: str) -> str:
    return unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode().upper()


def _con_errores_de_siigo(funcion, *args, **kwargs):
    try:
        return funcion(*args, **kwargs)
    except siigo.ErrorSiigo as error:
        raise HTTPException(status_code=502 if error.estado != 400 else 400, detail=str(error)) from error


@router.get("/estado")
def estado() -> dict:
    """Qué empresas ya tienen su Siigo configurado."""
    return {empresa: siigo.esta_configurada(empresa) for empresa in EMPRESAS_CONOCIDAS}


@router.get("/{empresa}/catalogos", dependencies=[Depends(requiere_rol(RolUsuario.ADMIN_INVENTARIO))])
def catalogos(empresa: str) -> dict:
    """Tipos de cotización, IVA/retención y vendedores del Siigo de la empresa
    (para configurar el servidor una vez)."""
    return _con_errores_de_siigo(siigo.catalogos, _empresa(empresa))


@router.get("/{empresa}/vendedores")
def vendedores(empresa: str, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> dict:
    """Los vendedores del Siigo de la empresa y el que este usuario usó la
    última vez; y los centros de costo si su Siigo los pide (con el último que usó)."""
    empresa = _empresa(empresa)
    lista = _con_errores_de_siigo(siigo.catalogos, empresa)["vendedores"]
    centros = _con_errores_de_siigo(siigo.centros_de_costo, empresa)
    mio = siigo_cotizacion.recordado(db, empresa, siigo_cotizacion.TIPO_VENDEDOR, usuario.correo)
    centro = siigo_cotizacion.recordado(db, empresa, siigo_cotizacion.TIPO_CENTRO_COSTO, usuario.correo)
    return {"vendedores": lista, "recordado": int(mio.valor) if mio and mio.valor.isdigit() else None,
            "centros_costo": centros,
            "centro_recordado": int(centro.valor) if centro and centro.valor.isdigit() else None}


@router.get("/{empresa}/clientes/{identificacion}")
def cliente(empresa: str, identificacion: str, db: Session = Depends(get_db)) -> dict:
    """El cliente de Siigo con esa cédula/NIT (o existe=False) y los impuestos
    que se le pusieron la última vez."""
    empresa = _empresa(empresa)
    encontrado = _con_errores_de_siigo(siigo.buscar_cliente, empresa, identificacion)
    impuestos = siigo_cotizacion.recordado(db, empresa, siigo_cotizacion.TIPO_CLIENTE, identificacion)
    return {
        "existe": encontrado is not None,
        "nombre": encontrado["nombre"] if encontrado else "",
        "impuestos_recordados": impuestos.valor.split(",") if impuestos and impuestos.valor else ([] if impuestos else None),
    }


_impuestos: dict[str, tuple[float, dict]] = {}


@router.get("/{empresa}/impuestos")
def impuestos(empresa: str) -> dict:
    """Porcentajes del IVA y la retención configurados (para el total aproximado del formulario)."""
    empresa = _empresa(empresa)
    guardado = _impuestos.get(empresa)
    if guardado is None or guardado[0] < time.monotonic():
        guardado = (time.monotonic() + MINUTOS_PRODUCTOS * 60, _con_errores_de_siigo(siigo.porcentajes_impuestos, empresa))
        _impuestos[empresa] = guardado
    return guardado[1]


_cargando_productos: set[str] = set()


def _cargar_productos(empresa: str) -> None:
    try:
        lista = siigo.productos(empresa)
        with _candado_productos:
            _productos[empresa] = (time.monotonic() + MINUTOS_PRODUCTOS * 60, lista)
    except siigo.ErrorSiigo:
        pass  # la próxima búsqueda lo vuelve a intentar
    finally:
        with _candado_productos:
            _cargando_productos.discard(empresa)


@router.get("/{empresa}/productos")
def productos(empresa: str, buscar: str = Query("", max_length=80), recargar: bool = False) -> list[dict]:
    """Productos del Siigo de la empresa que contienen el texto (código o nombre), máximo 30.
    La lista se trae de Siigo por detrás (puede tardar si son muchos); mientras
    llega, se busca solo el código exacto."""
    empresa = _empresa(empresa)
    with _candado_productos:
        guardado = _productos.get(empresa)
        vencida = recargar or guardado is None or guardado[0] < time.monotonic()
        if vencida and empresa not in _cargando_productos:
            _cargando_productos.add(empresa)
            threading.Thread(target=_cargar_productos, args=(empresa,), daemon=True).start()
        lista = guardado[1] if guardado else []
    palabras = _sin_tildes(buscar).split()
    encontrados = [p for p in lista if all(palabra in _sin_tildes(f"{p['codigo']} {p['nombre']}") for palabra in palabras)]
    if not encontrados and buscar.strip() and len(palabras) == 1:
        # La lista todavía no llega (o no lo trae): se busca el código exacto.
        exacto = _con_errores_de_siigo(siigo.buscar_producto, empresa, buscar.strip())
        encontrados = [exacto] if exacto else []
    return encontrados[:30]


class LineaParaSugerir(BaseModel):
    modalidad: str = "por_rollo"
    codigo_interno: str | None = None
    descripcion: str = ""
    cantidad: float = Field(default=0, ge=0)
    medida: float | None = None
    tipo_producto: str = ""
    producto_id: int | None = None


class SugerenciasRequest(BaseModel):
    empresa: str
    lineas: list[LineaParaSugerir]


@router.post("/sugerencias")
def sugerencias(datos: SugerenciasRequest, db: Session = Depends(get_db)) -> list[dict]:
    """Para cada línea del formulario: la cantidad en la unidad de Siigo (kilos
    para Asia Business, centímetros para Arquitejas) y el producto de Siigo que
    se usó la última vez con ese código."""
    from app.models.producto import Producto
    empresa = _empresa(datos.empresa)
    respuesta = []
    for linea in datos.lineas:
        sugerida = siigo_cotizacion.cantidad_sugerida(
            db, empresa, modalidad=linea.modalidad, codigo_interno=linea.codigo_interno, descripcion=linea.descripcion,
            cantidad=linea.cantidad, medida=linea.medida, tipo_producto=linea.tipo_producto, producto_id=linea.producto_id)
        clave = linea.codigo_interno or (db.get(Producto, linea.producto_id).codigo if linea.producto_id and db.get(Producto, linea.producto_id) else "")
        producto = siigo_cotizacion.recordado(db, empresa, siigo_cotizacion.TIPO_PRODUCTO, clave)
        respuesta.append({**sugerida, "siigo_producto": producto.valor if producto else ""})
    return respuesta


@router.post("/cotizaciones/{apartado_id}", response_model=ApartadoResponse)
def subir_cotizacion(apartado_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_actual)) -> Apartado:
    """Vuelve a intentar subir (o actualizar) en Siigo una cotización que quedó
    pendiente porque Siigo falló. Si vuelve a fallar, queda el motivo nuevo."""
    apartado = srv_apartados.apartado_de_mi_bodega(db, apartado_id, usuario)
    if not siigo_cotizacion.es_de_siigo(apartado):
        raise HTTPException(status_code=400, detail="Esta cotización no se creó para Siigo (se hizo en Siigo a mano o es una orden interna).")
    siigo_id_antes = apartado.siigo_id
    motivo = siigo_cotizacion.sincronizar(db, apartado, usuario)
    siigo_cotizacion.guardar_o_deshacer_en_siigo(db, apartado, siigo_id_antes)
    if motivo:
        raise HTTPException(status_code=400, detail=motivo)
    return (db.query(Apartado).options(selectinload(Apartado.items).selectinload(ApartadoItem.producciones))
            .filter(Apartado.id == apartado_id).populate_existing().one())
