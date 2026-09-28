"""Reglas transaccionales para registrar producción y consumo de rollos."""

import math
import re
from datetime import datetime, timezone
from secrets import token_hex
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.apartado import ApartadoItem, EstadoApartado, ModalidadApartado
from app.models.movimiento import Movimiento, TipoMovimiento
from app.models.produccion import Produccion, RolloUtilizadoProduccion
from app.models.producto import Producto
from app.models.rollo import Rollo
from app.models.usuario import Usuario
from app.schemas.produccion import ProduccionCrear, StockAdicionalItemCrear
from app.services.apartados import bloquear_rollos_codigo, validar_reserva_rollos

# Regla física de los productos "seccionados": el ancho del rollo se divide
# siempre en N partes iguales según el tipo (3 para caballetes, 5 para
# flanches), así que cada corte a lo largo del rollo produce SIEMPRE esas N
# unidades — sin importar cuántas se necesiten. Por eso una necesidad que no
# es múltiplo de N igual exige el corte completo, y el resto (nunca se
# pierde) se declara como stock adicional. Un solo lugar define cuántas
# secciones tiene cada tipo — agregar un producto nuevo de esta misma
# familia física es sumar una entrada aquí, no repetir los `if` de abajo.
# Familia fija por tipo para que el stock se agrupe junto en Inventario, sin
# mezclarse entre sí ni con tejas — el rollo de origen se conserva aparte en
# `Producto.codigo_rollo_origen`.
SECCIONES_POR_TIPO_PRODUCTO = {"caballete": 3, "flanche": 5}
FAMILIA_POR_TIPO_PRODUCTO = {"caballete": "CABALLETES", "flanche": "FLANCHES"}
NOMBRE_POR_TIPO_PRODUCTO = {"caballete": "caballete", "flanche": "flanche"}


def _apartado_item_para_produccion(db: Session, apartado_item_id: int, usuario: Usuario) -> ApartadoItem:
    item = (
        db.query(ApartadoItem)
        .join(ApartadoItem.apartado)
        .filter(ApartadoItem.id == apartado_item_id)
        .with_for_update()
        .first()
    )
    if item is None or item.apartado.bodega_id != usuario.bodega_id:
        raise HTTPException(status_code=404, detail="Solicitud de producción no encontrada.")
    if item.apartado.estado not in (EstadoApartado.ENVIADO_A_PRODUCCION, EstadoApartado.EN_PRODUCCION):
        raise HTTPException(status_code=400, detail="Ese apartado no está disponible para registrar producción.")
    # Si esta cotización también tiene ítems de stock, no se deja avanzar la
    # producción del rollo hasta que alguien confirme (PATCH
    # /apartados/{id}/confirmar-separacion-stock) que ya se separó -- esta es
    # la validación real (el frontend solo pregunta antes para evitar el
    # rechazo, pero el servidor la exige sin importar qué haga el cliente).
    if not item.apartado.stock_separado_confirmado and any(
        i.modalidad == ModalidadApartado.POR_STOCK for i in item.apartado.items
    ):
        raise HTTPException(
            status_code=400,
            detail="Debe confirmarse que el stock de esta cotización ya fue separado "
            "antes de registrar la producción (PATCH /apartados/{}/confirmar-separacion-stock).".format(item.apartado_id),
        )
    return item


def _calibre_identidad(calibre: str | None) -> str:
    """Mismo criterio que `calibreIdentidad()` en el frontend
    (src/Utils/teja.ts): el calibre real es el valor entre paréntesis, si lo
    tiene (formato "NN - (0,NN)" de una parte del catálogo importado por
    Excel — NN es un número de gauge, no el calibre real). Si no trae
    paréntesis, se usa el texto tal cual. Nunca escribe nada en la BD — solo
    se usa para COMPARAR identidad al buscar un producto existente."""
    texto = (calibre or "").strip()
    coincidencia = re.search(r"\(([^)]+)\)", texto)
    return coincidencia.group(1).strip() if coincidencia else texto


def _calidad_efectiva(calidad: str | None, codigo: str) -> str:
    """Mismo criterio que ya usa el frontend para la columna Calidad de TEJA
    (`esSegundaPorCodigo` en src/Utils/teja.ts): si el producto no trae
    `calidad` explícita — el catálogo cargado por Excel nunca la trae — se
    deriva de si su código empieza por "2T". El stock que genera Producción
    siempre trae `calidad` explícita (el schema la exige), así que este
    respaldo solo entra en juego al comparar contra productos del catálogo."""
    if calidad:
        return calidad
    return "segunda" if (codigo or "").strip().upper().startswith("2T") else "primera"


def _longitud_desde_codigo(codigo: str) -> float | None:
    """Mismo criterio que `longitudDesdeCodigo()` en el frontend
    (src/Utils/teja.ts): el texto después del ÚLTIMO "-" del código, si es
    un número válido (admite coma o punto decimal). Devuelve None si el
    código no trae un sufijo de longitud reconocible."""
    texto = (codigo or "").strip()
    indice = texto.rfind("-")
    if indice == -1:
        return None
    sufijo = texto[indice + 1:].strip()
    if not re.fullmatch(r"\d+([.,]\d+)?", sufijo):
        return None
    return float(sufijo.replace(",", "."))


def _longitud_efectiva(metros_por_unidad: float | None, codigo: str) -> float | None:
    """Mismo criterio que ya usa el frontend para Longitud/agrupación de
    TEJA: si el producto no trae `metros_por_unidad` explícito — el catálogo
    cargado por Excel nunca lo trae — se deriva del código (ver
    `_longitud_desde_codigo`). El stock que genera Producción siempre trae
    `metros_por_unidad` explícito (el schema lo exige cuando hay stock
    adicional), así que este respaldo solo entra en juego al comparar contra
    productos del catálogo."""
    if metros_por_unidad is not None:
        return metros_por_unidad
    return _longitud_desde_codigo(codigo)


def _buscar_producto_existente(
    db: Session,
    usuario: Usuario,
    datos: ProduccionCrear,
    item_stock: StockAdicionalItemCrear,
    familia_stock: str,
    codigo_rollo_origen_stock: str,
    ancho_rollo_stock: float | None,
) -> Producto | None:
    """Busca un `Producto` que ya tenga exactamente la misma identidad que
    generaría esta línea de stock adicional, para sumarle el stock en vez de
    crear una fila nueva. La identidad es distinta por familia — nunca se
    usan los 7 campos de TEJA para Caballetes/Flanches ni viceversa:

      TEJA: Familia + Modelo + Color + Rollo origen + Calibre real + Longitud + Calidad.
      CABALLETES/FLANCHES: Familia + Rollo origen + Ancho rollo + Longitud + Calidad
      (Modelo/Color no aportan nada aparte para estos dos: el código de
      clasificación del rollo —Rollo origen— ya los codifica).

    Las comparaciones de texto usan `func.coalesce(columna, "")` para que
    NULL/""/espacios nunca produzcan un falso "no existe". El calibre
    almacenado NUNCA se modifica aquí — se compara su "calibre real" (lo que
    hay entre paréntesis, si lo tiene) sin tocar la fila.
    `with_for_update()` bloquea los candidatos para que dos producciones
    simultáneas con la misma identidad no puedan crear cada una su propio
    Producto."""
    if familia_stock == "TEJA":
        # `metros_por_unidad` NO se filtra en SQL: el catálogo importado por
        # Excel casi nunca lo trae (queda NULL, la longitud vive codificada
        # en el propio `codigo`), así que comparar la columna cruda dejaría
        # sin encontrar productos reales que sí tienen esa longitud, solo
        # que expresada de otra forma. Se compara la longitud EFECTIVA en
        # Python, igual que calibre y calidad.
        candidatos = (
            db.query(Producto)
            .filter(
                Producto.bodega_id == usuario.bodega_id,
                Producto.familia == "TEJA",
                func.coalesce(Producto.referencia, "") == datos.modelo.strip(),
                func.coalesce(Producto.color, "") == datos.color.strip(),
                func.coalesce(Producto.codigo_rollo_origen, "") == codigo_rollo_origen_stock.strip(),
            )
            .with_for_update()
            .all()
        )
        calibre_nuevo = _calibre_identidad(datos.calibre)
        for candidato in candidatos:
            if (
                _calibre_identidad(candidato.calibre) == calibre_nuevo
                and _calidad_efectiva(candidato.calidad, candidato.codigo) == item_stock.calidad
                and _longitud_efectiva(candidato.metros_por_unidad, candidato.codigo) == datos.metros_por_unidad
            ):
                return candidato
        return None

    return (
        db.query(Producto)
        .filter(
            Producto.bodega_id == usuario.bodega_id,
            Producto.familia == familia_stock,
            func.coalesce(Producto.codigo_rollo_origen, "") == codigo_rollo_origen_stock.strip(),
            Producto.ancho_rollo == ancho_rollo_stock,
            Producto.metros_por_unidad == datos.metros_por_unidad,
            Producto.calidad == item_stock.calidad,
        )
        .with_for_update()
        .first()
    )


def registrar_produccion(db: Session, datos: ProduccionCrear, usuario: Usuario) -> Produccion:
    if not datos.rollos: raise HTTPException(status_code=400, detail="Selecciona al menos un rollo y sus metros a consumir.")
    ahora = datetime.now(timezone.utc)
    ids = [item.rollo_id for item in datos.rollos]
    if len(set(ids)) != len(ids): raise HTTPException(status_code=400, detail="No puedes usar el mismo rollo más de una vez.")
    # Primero se leen sin bloquear solo para saber el código; después se
    # bloquea el código COMPLETO en orden por id (ver
    # apartados.bloquear_rollos_codigo): bloquear en el orden del formulario
    # permitía que dos producciones con [A, B] y [B, A] se trabaran.
    previos = {r.id: r for r in db.query(Rollo).filter(Rollo.id.in_(ids), Rollo.bodega_id == usuario.bodega_id).all()}
    for rollo_id in ids:
        if rollo_id not in previos: raise HTTPException(status_code=404, detail=f"Rollo {rollo_id} no encontrado.")
    codigo = previos[ids[0]].codigo_interno
    if any(r.codigo_interno != codigo for r in previos.values()): raise HTTPException(status_code=400, detail="Todos los rollos deben pertenecer al mismo código de clasificación.")
    rollos_codigo = bloquear_rollos_codigo(db, bodega_id=usuario.bodega_id, codigo_interno=codigo)
    por_id = {r.id: r for r in rollos_codigo}
    if any(rollo_id not in por_id for rollo_id in ids):
        raise HTTPException(status_code=409, detail="Uno de los rollos acaba de cambiar. Recarga e intenta de nuevo.")
    bloqueados: list[Rollo] = [por_id[rollo_id] for rollo_id in ids]
    for item, rollo in zip(datos.rollos, bloqueados, strict=True):
        if rollo.estado == "agotado" or item.metros > rollo.metros_disponibles:
            raise HTTPException(status_code=400, detail=f"El rollo {rollo.identificador_rollo} no tiene metros suficientes.")

    apartado_item = _apartado_item_para_produccion(db, datos.apartado_item_id, usuario) if datos.apartado_item_id else None
    if apartado_item is not None:
        # Hallazgo #12 de la auditoría: la producción de un apartado debe
        # salir de rollos DEL CÓDIGO que ese apartado reservó. Antes se
        # aceptaba cualquier código: se descontaba un rollo de otro color y
        # se daba por atendida la reserva del apartado, que quedaba liberada
        # para otros. Un ítem de stock no tiene metros (esa reserva se
        # descuenta al marcar la producción terminada) y terminaba en 500.
        if apartado_item.modalidad != ModalidadApartado.POR_ROLLO:
            raise HTTPException(
                status_code=400,
                detail="Ese ítem del apartado es de producto de stock, no de rollo: no se registra con rollos "
                "(su stock se descuenta al marcar la producción como terminada).",
            )
        if apartado_item.codigo_interno != codigo:
            raise HTTPException(
                status_code=400,
                detail=f"Este apartado es de {apartado_item.codigo_interno} y elegiste rollos de {codigo}. "
                f"Selecciona rollos del código {apartado_item.codigo_interno}.",
            )

    # Cuánto se consume del rollo: para tejas es libre (lo que el usuario
    # seleccionó); para productos seccionados (caballete/flanche) es un
    # número EXACTO, no una elección — cada corte produce siempre las
    # mismas N unidades sin importar cuántas se necesiten, así que una
    # necesidad que no es múltiplo de N igual exige el corte completo (ver
    # SECCIONES_POR_TIPO_PRODUCTO arriba).
    sobrante_seccionado = 0
    if datos.tipo_producto in SECCIONES_POR_TIPO_PRODUCTO:
        secciones = SECCIONES_POR_TIPO_PRODUCTO[datos.tipo_producto]
        nombre = NOMBRE_POR_TIPO_PRODUCTO[datos.tipo_producto]
        longitud = datos.metros_por_unidad  # ya validado como obligatorio en el schema
        cortes = math.ceil(datos.cantidad_productos / secciones)
        producido_fisico = cortes * secciones
        metros_necesarios = round(cortes * longitud, 2)
        total = round(sum(item.metros for item in datos.rollos), 2)
        if abs(total - metros_necesarios) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Para fabricar {datos.cantidad_productos} {nombre}(s) de {longitud} m se necesitan "
                    f"exactamente {cortes} corte(s) de rollo = {metros_necesarios} m (cada corte de {longitud} m "
                    f"de largo produce {secciones} {nombre}s, porque el ancho del rollo se divide siempre en "
                    f"{secciones} — sin importar cuántos se necesiten). Ajusta los metros seleccionados de los "
                    f"rollos para que sumen exactamente {metros_necesarios} m."
                ),
            )
        sobrante_seccionado = producido_fisico - datos.cantidad_productos
    else:
        total = round(sum(item.metros for item in datos.rollos), 2)

    # El apartado nunca se carga más allá de lo que le faltaba: si se
    # consumió más de lo pendiente, el resto queda como "excedente" (no se
    # rechaza la producción ni se bloquea nada por esto). Esto es lo único
    # que garantiza que el reservado (metros_requeridos - metros_consumidos,
    # ver apartados.py::metros_reservados_codigo) nunca quede negativo.
    #
    # Para tejas la reserva se mide en metros y coincide con lo físicamente
    # consumido (cantidad × medida = metros): "aplicado" es sencillamente
    # min(consumido, pendiente).
    #
    # Para productos seccionados NO puede ser así: por la regla de N
    # unidades por corte, lo que se consume físicamente (cortes × longitud)
    # casi siempre es MENOS que lo que el apartado reservó (cantidad ×
    # longitud, la misma fórmula genérica de apartados.py). Si se aplicara
    # el metraje físico, el apartado quedaría con pendiente aunque ya se le
    # hayan entregado todas las unidades que pedía. Por eso aquí "aplicado"
    # se calcula en UNIDADES (cuántas de las fabricadas cubren lo que el
    # apartado seguía necesitando) y se convierte a metros con la MISMA
    # longitud, para que el pendiente del apartado baje exactamente lo que
    # corresponde a esas unidades — sin importar cuánto rollo se usó de
    # verdad para cortarlas.
    if datos.tipo_producto in SECCIONES_POR_TIPO_PRODUCTO:
        unidades_excedentes_apartado = 0
        if apartado_item is not None:
            longitud = datos.metros_por_unidad
            pendiente_metros = max(0.0, round(apartado_item.metros_requeridos - apartado_item.metros_consumidos, 2))
            pendiente_unidades = round(pendiente_metros / longitud) if longitud else 0
            unidades_hacia_apartado = min(datos.cantidad_productos, max(0, pendiente_unidades))
            aplicado_al_apartado = round(unidades_hacia_apartado * longitud, 2)
            unidades_excedentes_apartado = datos.cantidad_productos - unidades_hacia_apartado
        else:
            aplicado_al_apartado = 0.0
        # No hay "excedente de metros" para productos seccionados — lo
        # físico (total) casi siempre es menor que lo acreditado al
        # apartado (aplicado), porque un corte rinde N unidades por el
        # precio de 1. El concepto de sobrante aquí es en UNIDADES
        # (sobrante_seccionado), no metros.
        metros_excedente = max(0.0, round(total - aplicado_al_apartado, 2))
    else:
        # Misma regla para tejas — la reserva del apartado siempre se mide
        # en metros, y ahí sí coincide 1:1 con el consumo físico.
        if apartado_item is not None:
            pendiente = max(0.0, round(apartado_item.metros_requeridos - apartado_item.metros_consumidos, 2))
            aplicado_al_apartado = min(total, pendiente)
            metros_excedente = round(total - aplicado_al_apartado, 2)
        else:
            aplicado_al_apartado = 0.0
            metros_excedente = total

    if datos.tipo_producto in SECCIONES_POR_TIPO_PRODUCTO:
        # El sobrante de un producto seccionado tiene dos orígenes posibles,
        # y ninguno es una elección del usuario ni algo que se pierda: (a) el
        # redondeo del corte (cada corte produce N unidades exactas, así que
        # una necesidad que no es múltiplo de N deja sobrante), y (b) si se
        # fabricaron más unidades de las que el apartado todavía necesitaba
        # (sección 11: eso NO se bloquea, simplemente el resto también entra
        # como stock). Todo lo que no va a la necesidad tiene que quedar
        # declarado, ni más ni menos — a diferencia de tejas, aquí no basta
        # con que "alcance el material": tiene que coincidir EXACTO.
        sobrante_seccionado += unidades_excedentes_apartado
        stock_declarado = sum(item.cantidad for item in datos.stock_adicional)
        if stock_declarado != sobrante_seccionado:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Este corte produce físicamente {cortes * secciones} {nombre}s "
                    f"({cortes} corte(s) × {secciones}); {datos.cantidad_productos - unidades_excedentes_apartado} "
                    f"van para la necesidad y {sobrante_seccionado} deben quedar declarados como stock adicional "
                    f"(ahora declaraste {stock_declarado}). Ningún {nombre} cortado se pierde: ajusta las líneas "
                    "de stock adicional para que sumen exactamente ese sobrante."
                ),
            )
    elif datos.stock_adicional:
        # El stock adicional de tejas SÍ tiene que estar respaldado por
        # material real: si se declaran unidades adicionales, los metros que
        # sobraron del apartado (o, en producción libre, todo lo consumido)
        # deben alcanzar para cubrirlas — si no, esas unidades habrían
        # salido de la nada sin descontar el rollo. Esto no es la misma
        # regla que bloquea la producción por superar el apartado (esa no
        # aplica); es una validación distinta, sobre que el material sí se
        # haya descontado de verdad. A diferencia de caballetes, aquí "al
        # menos" alcanza — la cantidad de stock sigue siendo elección libre.
        metros_necesarios = round(sum(item.cantidad * datos.metros_por_unidad for item in datos.stock_adicional), 2)
        if metros_excedente + 0.01 < metros_necesarios:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"El stock adicional que declaraste necesita {metros_necesarios} m, pero el material "
                    f"que seleccionaste de los rollos solo deja {metros_excedente} m disponibles después "
                    "de cubrir el apartado. Aumenta los metros que seleccionas del rollo o reduce las "
                    "unidades adicionales — el material de esas unidades también debe salir del rollo."
                ),
            )

    # Lo que se aplica al apartado sale de SU PROPIA reserva; solo el resto
    # (producción libre, o lo que exceda al apartado) tiene que caber en el
    # material libre del código -- nunca en lo que otros apartados reservaron.
    validar_reserva_rollos(
        db, bodega_id=usuario.bodega_id, codigo_interno=codigo, metros_salen=total,
        metros_reserva_propia=aplicado_al_apartado, rollos_codigo=rollos_codigo,
    )

    sello = ahora.strftime("%Y%m%d%H%M%S"); codigo_unico = f"PROD-{sello}-{token_hex(3).upper()}"
    cotizacion = apartado_item.apartado.numero_cotizacion if apartado_item else f"P{token_hex(4).upper()}"

    produccion = Produccion(codigo_unico=codigo_unico, cotizacion=cotizacion, fecha=ahora, usuario=usuario.correo, responsable=datos.responsable, bodega_id=usuario.bodega_id, tipo_producto=datos.tipo_producto, apartado_item_id=apartado_item.id if apartado_item else None, producto_fabricado=datos.producto_fabricado, modelo=datos.modelo, medida_producto=datos.medida_producto, cantidad_productos=datos.cantidad_productos, codigo_clasificacion=codigo, total_metros_consumidos=total, saldo_codigo=0, metros_excedente=metros_excedente, observaciones=datos.observaciones)
    db.add(produccion); db.flush(); saldo = 0.0
    for item, rollo in zip(datos.rollos, bloqueados, strict=True):
        rollo.metros_disponibles = round(rollo.metros_disponibles - item.metros, 2); rollo.metros_consumidos = round(rollo.metros_consumidos + item.metros, 2); rollo.recalcular_estado(); saldo += rollo.metros_disponibles
        db.add(RolloUtilizadoProduccion(produccion_id=produccion.id, rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo, metros_consumidos=item.metros))
        db.add(Movimiento(fecha=ahora, tipo=TipoMovimiento.SALIDA, motivo="produccion", producto_codigo=rollo.codigo_interno, producto_descripcion=f"{rollo.descripcion} (rollo {rollo.identificador_rollo})", rollo_id=rollo.id, identificador_rollo=rollo.identificador_rollo, bodega_origen_id=usuario.bodega_id, bodega_destino_id=None, cantidad=item.metros, usuario=usuario.correo, observaciones=f"Producción {codigo_unico}.", cotizacion=cotizacion))
    produccion.saldo_codigo = round(saldo, 2)

    if apartado_item is not None:
        apartado_item.metros_consumidos = round(apartado_item.metros_consumidos + aplicado_al_apartado, 2)
        if apartado_item.apartado.estado == EstadoApartado.ENVIADO_A_PRODUCCION:
            apartado_item.apartado.estado = EstadoApartado.EN_PRODUCCION

    # Stock adicional: unidades que quedaron disponibles más allá del
    # apartado (o, en producción libre, unidades que se quieren dejar en
    # inventario ya clasificadas). Antes de crear una fila nueva, se busca
    # si ya existe un `Producto` con exactamente la misma identidad (ver
    # `_buscar_producto_existente`) — si existe, se le suma el stock; si no,
    # se crea uno nuevo, igual que antes. Cada fila nueva reutiliza el mismo
    # modelo de inventario por unidades que ya usan Movimientos/
    # Transferencias/Envíos, así queda vendible/transferible de inmediato
    # con las reglas existentes, sin nada paralelo.
    #
    # Tejas: familia FIJA "TEJA" (antes era el código de clasificación del
    # rollo de origen — ese código ahora se conserva aparte, en
    # `codigo_rollo_origen`, como trazabilidad, no como identidad).
    # Productos seccionados: familia FIJA por tipo ("CABALLETES"/"FLANCHES",
    # nunca mezclados entre sí ni con tejas), con el rollo de origen
    # guardado igual en `codigo_rollo_origen`. `tipo_producto` queda también
    # en el `Producto` (no solo en la `Produccion`) porque es la fuente
    # estructural confiable para saber qué divisor de ancho aplica — no
    # depender de comparar el texto de `familia`.
    if datos.tipo_producto in SECCIONES_POR_TIPO_PRODUCTO:
        familia_stock = FAMILIA_POR_TIPO_PRODUCTO[datos.tipo_producto]
        codigo_rollo_origen_stock = codigo
        tipo_producto_stock = datos.tipo_producto
        # Puramente informativo (ver Rollo.ancho_material) — el ancho del
        # rollo de origen (normalmente 122 m, distinto solo si alguien lo
        # corrigió en Rollos), para que el stock quede clasificado con esa
        # trazabilidad. No participa en el cálculo de metros ni de cortes.
        ancho_rollo_stock = bloqueados[0].ancho_material
    else:
        familia_stock = "TEJA"
        codigo_rollo_origen_stock = codigo
        tipo_producto_stock = ""
        ancho_rollo_stock = None

    descripcion_base = (datos.producto_fabricado or datos.modelo).strip()
    for indice, item_stock in enumerate(datos.stock_adicional, start=1):
        descripcion = descripcion_base + (" (Segunda)" if item_stock.calidad == "segunda" else "")

        producto_existente = _buscar_producto_existente(
            db, usuario, datos, item_stock, familia_stock, codigo_rollo_origen_stock, ancho_rollo_stock,
        )

        if producto_existente is not None:
            producto_existente.stock = round(producto_existente.stock + item_stock.cantidad, 2)
            producto_existente.entrada = round(producto_existente.entrada + item_stock.cantidad, 2)
            producto_existente.produccion_id = produccion.id
            producto_existente.fecha_produccion = ahora
            codigo_producto_movimiento = producto_existente.codigo
        else:
            producto_stock = Producto(
                bodega_id=usuario.bodega_id,
                codigo=f"{codigo_unico}-{indice}",
                descripcion=descripcion,
                familia=familia_stock,
                codigo_rollo_origen=codigo_rollo_origen_stock,
                ancho_rollo=ancho_rollo_stock,
                tipo_producto=tipo_producto_stock,
                calibre=datos.calibre,
                color=datos.color,
                ral=datos.ral,
                referencia=datos.modelo.strip() if familia_stock == "TEJA" else "",
                calidad=item_stock.calidad,
                motivo_segunda=item_stock.motivo_segunda if item_stock.calidad == "segunda" else "",
                metros_por_unidad=datos.metros_por_unidad,
                produccion_id=produccion.id,
                fecha_produccion=ahora,
                entrada=item_stock.cantidad, stock=item_stock.cantidad,
            )
            db.add(producto_stock)
            db.flush()
            codigo_producto_movimiento = producto_stock.codigo

        db.add(Movimiento(
            fecha=ahora, tipo=TipoMovimiento.ENTRADA, motivo="produccion_excedente",
            producto_codigo=codigo_producto_movimiento, producto_descripcion=descripcion,
            bodega_origen_id=None, bodega_destino_id=usuario.bodega_id,
            cantidad=item_stock.cantidad, usuario=usuario.correo,
            observaciones=f"Stock adicional generado por la producción {codigo_unico}.",
            # Nunca la cotización real del apartado: esta unidad no salió con
            # el cliente de esa cotización, se quedó como inventario. Si aquí
            # quedara la cotización real, el Kardex daría a entender que esa
            # unidad también se le entregó a ese cliente.
            cotizacion="Stock",
        ))

    return produccion
