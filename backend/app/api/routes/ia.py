from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import coincide_bodega, get_db, requiere_rol, usuario_actual
from app.models.rollo import Rollo
from app.models.usuario import RolUsuario, Usuario
from app.schemas.ia import (
    AlertaIaResponse,
    ChatEntrada,
    ChatRespuesta,
    PrediccionNegocioResponse,
    PrediccionStockResponse,
)
from app.services import ia_groq
from app.services import ia_predicciones as srv_pred
from app.services import productos as srv_productos

router = APIRouter(prefix="/ia", tags=["IA e Inteligencia del Negocio"])


@router.post("/chat", response_model=ChatRespuesta,
             dependencies=[Depends(requiere_rol(RolUsuario.ADMINISTRATIVO, RolUsuario.ADMIN_INVENTARIO))])
def chat_asistente(
    datos: ChatEntrada,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> ChatRespuesta:
    # Solo Admin Inventario puede pedir una bodega distinta a la suya (por
    # id aquí, o por id/nombre dentro del chat vía las herramientas — ver
    # ia_herramientas._resolver_bodega). Cualquier otro rol que intente
    # mandar un bodega_id ajeno lo tiene sin efecto: siempre se usa el suyo.
    es_admin_inventario = usuario.rol == RolUsuario.ADMIN_INVENTARIO
    bodega_id = datos.bodega_id if (es_admin_inventario and datos.bodega_id is not None) else usuario.bodega_id
    try:
        respuesta = ia_groq.chat_con_herramientas(datos.mensaje, datos.historial, db, bodega_id, es_admin_inventario)
    except ia_groq.ErrorAsistenteIa as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return ChatRespuesta(respuesta=respuesta)


@router.get("/alertas", response_model=list[AlertaIaResponse])
def listar_alertas(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> list[AlertaIaResponse]:
    alertas: list[AlertaIaResponse] = []
    fecha_actual = datetime.now(timezone.utc).isoformat()

    # 1. Alertas de productos agotados (siempre crítico) o por debajo de su
    # stock_minimo configurado (mismo criterio que Inventario y Reportes —
    # un producto sin stock_minimo configurado nunca genera "stock_bajo").
    agotados = srv_productos.productos_agotados(db, usuario.bodega_id)
    for idx, p in enumerate(agotados):
        alertas.append(
            AlertaIaResponse(
                id=idx + 1,
                nivel="critico",
                tipo="stock_agotado",
                titulo=f"Stock Agotado: {p.descripcion}",
                mensaje=f"El producto {p.codigo} ({p.descripcion}) no tiene existencias disponibles en la bodega.",
                producto_id=p.id,
                producto_codigo=p.codigo,
                producto_descripcion=p.descripcion,
                fecha=fecha_actual,
            )
        )

    ids_agotados = {p.id for p in agotados}
    for idx, p in enumerate(srv_productos.productos_bajo_minimo(db, usuario.bodega_id)):
        if p.id in ids_agotados:
            continue  # ya está en la lista como agotado, no lo dupliques como "bajo".
        alertas.append(
            AlertaIaResponse(
                id=100 + idx,
                nivel="advertencia",
                tipo="stock_bajo",
                titulo=f"Stock Bajo: {p.descripcion}",
                mensaje=f"El producto {p.codigo} cuenta únicamente con {p.stock} unidades en bodega (mínimo configurado: {p.stock_minimo}).",
                producto_id=p.id,
                producto_codigo=p.codigo,
                producto_descripcion=p.descripcion,
                fecha=fecha_actual,
            )
        )

    # 2. Alertas sobre rollos de acero abiertos con metraje muy bajo
    rollos_abiertos = (
        db.query(Rollo)
        .filter(coincide_bodega(Rollo.bodega_id, usuario.bodega_id), Rollo.estado == "abierto")
        .all()
    )
    for idx, r in enumerate(rollos_abiertos):
        if r.metros_disponibles < 50:
            alertas.append(
                AlertaIaResponse(
                    id=200 + idx,
                    nivel="info",
                    tipo="rollo_casi_agotado",
                    titulo=f"Rollo {r.identificador_rollo} por agotarse",
                    mensaje=f"El rollo {r.codigo_interno} ({r.descripcion}) solo cuenta con {r.metros_disponibles}m disponibles.",
                    producto_id=r.id,
                    producto_codigo=r.codigo_interno,
                    producto_descripcion=r.descripcion,
                    fecha=fecha_actual,
                )
            )

    return alertas


@router.get("/predicciones/stock", response_model=list[PrediccionStockResponse])
def obtener_predicciones_stock(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> list[PrediccionStockResponse]:
    return [PrediccionStockResponse(**p) for p in srv_pred.predecir_todos_los_productos(db, usuario.bodega_id)]


@router.get("/predicciones/negocio", response_model=PrediccionNegocioResponse)
def obtener_predicciones_negocio(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_actual),
) -> PrediccionNegocioResponse:
    t = srv_pred.tendencia_negocio(db, usuario.bodega_id)

    if t["cambio_porcentual"] is not None:
        resumen = (
            f"Las salidas del último mes ({t['salidas_mes_actual']:g} unidades) "
            f"{'subieron' if t['cambio_porcentual'] > 0 else 'bajaron' if t['cambio_porcentual'] < 0 else 'se mantuvieron'} "
            f"un {abs(t['cambio_porcentual']):g}% frente al mes anterior ({t['salidas_mes_anterior']:g} unidades)."
        )
    else:
        resumen = f"Se registraron {t['salidas_mes_actual']:g} unidades de salida en el último mes; no hay datos del mes anterior para comparar."

    factores_clave = []
    if t["producto_mayor_rotacion"]:
        p = t["producto_mayor_rotacion"]
        factores_clave.append(f"Mayor rotación: {p['codigo']} ({p['descripcion']}) con {p['cantidad']:g} unidades de salida este mes.")
    else:
        factores_clave.append("No hay salidas registradas en el último mes.")

    recomendaciones = []
    if t["tendencia"] == "creciente":
        recomendaciones.append("La demanda viene en aumento: planifica la recepción de rollos con anticipación.")
    elif t["tendencia"] == "decreciente":
        recomendaciones.append("La demanda viene bajando: es buen momento para consolidar pedidos y revisar sobreinventario.")
    else:
        recomendaciones.append("La demanda se mantiene estable: conserva el ritmo actual de reabastecimiento.")

    return PrediccionNegocioResponse(
        periodo="Últimos 30 días",
        tendencia=t["tendencia"],
        resumen=resumen,
        factores_clave=factores_clave,
        recomendaciones=recomendaciones,
    )
