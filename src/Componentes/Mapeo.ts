type ValorApi = string | number | boolean | null | undefined;
type RegistroApi = Record<string, unknown>;
type BodegasPorId = Record<number, string>;

const numero = (valor: unknown) => Number(valor);
const texto = (valor: unknown) => typeof valor === "string" ? valor : "";
// bodega_id es null para el material de Admin Inventario (sin repartir a
// ninguna sede) — numero(null) daría 0, que se confundiría con un id real.
const numeroOpcional = (valor: unknown) => valor == null ? null : Number(valor);

export function usuarioDesdeApi(u: RegistroApi) {
  return { id: numero(u.id), correo: texto(u.correo), rol: texto(u.rol),
    bodegaId: numeroOpcional(u.bodega_id), activo: Boolean(u.activo) };
}

export function productoDesdeApi(p: RegistroApi) {
  return { id: numero(p.id), bodegaId: numeroOpcional(p.bodega_id), codigoImportacion: texto(p.codigo_importacion),
    codigo: texto(p.codigo), referencia: texto(p.referencia), descripcion: texto(p.descripcion), familia: texto(p.familia), calibre: texto(p.calibre),
    entrada: numero(p.entrada), stock: numero(p.stock), stockMinimo: numeroOpcional(p.stock_minimo),
    pesoNeto: p.peso_neto == null ? null : numero(p.peso_neto), rolloId: p.rollo_id == null ? null : numero(p.rollo_id),
    identificadorRollo: texto(p.identificador_rollo),
    // Solo poblados para el stock adicional que genera Producción — ver
    // Producto.color/ral/calidad/... en el backend.
    color: texto(p.color), ral: texto(p.ral), calidad: p.calidad == null ? null : texto(p.calidad),
    motivoSegunda: texto(p.motivo_segunda), metrosPorUnidad: p.metros_por_unidad == null ? null : numero(p.metros_por_unidad),
    produccionId: p.produccion_id == null ? null : numero(p.produccion_id), fechaProduccion: texto(p.fecha_produccion),
    codigoRolloOrigen: texto(p.codigo_rollo_origen), anchoRollo: p.ancho_rollo == null ? null : numero(p.ancho_rollo),
    tipoProducto: texto(p.tipo_producto) };
}

export function movimientoDesdeApi(m: RegistroApi) {
  return { id: numero(m.id), fecha: texto(m.fecha), tipo: texto(m.tipo), motivo: texto(m.motivo),
    productoCodigo: texto(m.producto_codigo), productoDescripcion: texto(m.producto_descripcion),
    rolloId: m.rollo_id == null ? null : numero(m.rollo_id), identificadorRollo: texto(m.identificador_rollo),
    bodegaOrigenId: numero(m.bodega_origen_id), bodegaDestinoId: numero(m.bodega_destino_id),
    cantidad: numero(m.cantidad), usuario: texto(m.usuario), observaciones: texto(m.observaciones),
    cotizacion: texto(m.cotizacion), empresaExterna: texto(m.empresa_externa) };
}

export function solicitudDesdeApi(s: RegistroApi, bodegasPorId: BodegasPorId = {}) {
  const solicitanteId = numero(s.bodega_solicitante_id);
  const propietariaId = numero(s.bodega_propietaria_id);
  return { id: numero(s.id), fecha: texto(s.fecha), estado: texto(s.estado), tipoOperacion: texto(s.tipo_operacion),
    cantidad: numero(s.cantidad), productoCodigo: texto(s.producto_codigo), productoDescripcion: texto(s.producto_descripcion),
    rolloId: s.rollo_id == null ? null : numero(s.rollo_id),
    bodegaSolicitanteId: solicitanteId, bodegaSolicitanteNombre: bodegasPorId[solicitanteId] || "",
    bodegaPropietariaId: propietariaId, bodegaPropietariaNombre: bodegasPorId[propietariaId] || "",
    solicitadoPor: texto(s.solicitado_por), observaciones: texto(s.observaciones) };
}

export function rolloDesdeApi(r: RegistroApi) {
  const historial = Array.isArray(r.historial_consumos) ? r.historial_consumos : [];
  return { id: numero(r.id), bodegaId: numeroOpcional(r.bodega_id), codigoInterno: texto(r.codigo_interno),
    identificadorRollo: texto(r.identificador_rollo), codigoProveedor: texto(r.codigo_proveedor), empresa: texto(r.empresa),
    descripcion: texto(r.descripcion), familia: texto(r.familia), colorMaterial: texto(r.color_material),
    calibre: numero(r.calibre), anchoMaterial: numero(r.ancho_material), pesoNeto: r.peso_neto == null ? null : numero(r.peso_neto),
    pesoActualToneladas: r.peso_actual_toneladas == null ? null : numero(r.peso_actual_toneladas),
    metrosProveedor: numero(r.metros_proveedor), metrosCalculados: numero(r.metros_calculados),
    metrosDisponibles: numero(r.metros_disponibles), metrosConsumidos: numero(r.metros_consumidos),
    fechaIngreso: texto(r.fecha_ingreso), estado: texto(r.estado), observaciones: texto(r.observaciones),
    proveedor: texto(r.proveedor), lote: texto(r.lote),
    historialConsumos: historial.map((h) => ({
      fecha: texto(h.fecha), cantidad: numero(h.cantidad), usuario: texto(h.usuario), observaciones: texto(h.observaciones),
    })) };
}

export function disponibilidadCodigoDesdeApi(d: RegistroApi) {
  return { codigoInterno: texto(d.codigo_interno), familia: texto(d.familia), colorMaterial: texto(d.color_material),
    calibre: numero(d.calibre), cantidadRollos: numero(d.cantidad_rollos), metrosDisponibles: numero(d.metros_disponibles),
    metrosReservados: numero(d.metros_reservados), metrosConsumidos: numero(d.metros_consumidos),
    metrosEnCamino: numero(d.metros_en_camino || 0), metrosPorRepartir: numero(d.metros_por_repartir || 0),
    metrosEsperando: numero(d.metros_esperando || 0), metrosParaApartar: numero(d.metros_para_apartar || 0) };
}

export function reservaCodigoDesdeApi(r: RegistroApi) {
  return { codigoInterno: texto(r.codigo_interno), metrosReservados: numero(r.metros_reservados) };
}

// Análogo a `disponibilidadCodigoDesdeApi`, pero para un Producto de stock
// (ver GET /apartados/disponibilidad-producto).
export function disponibilidadProductoDesdeApi(d: RegistroApi) {
  return { productoId: numero(d.producto_id), codigo: texto(d.codigo), descripcion: texto(d.descripcion),
    stock: numero(d.stock), cantidadReservada: numero(d.cantidad_reservada), cantidadDisponible: numero(d.cantidad_disponible) };
}

export function apartadoItemDesdeApi(i: RegistroApi) {
  return { id: numero(i.id), modalidad: texto(i.modalidad) || "por_rollo",
    codigoInterno: i.codigo_interno == null ? null : texto(i.codigo_interno), descripcion: texto(i.descripcion),
    cantidad: numero(i.cantidad), medida: i.medida == null ? null : numero(i.medida),
    metrosRequeridos: i.metros_requeridos == null ? null : numero(i.metros_requeridos),
    metrosConsumidos: numero(i.metros_consumidos),
    productoId: i.producto_id == null ? null : numero(i.producto_id), stockDescontado: Boolean(i.stock_descontado),
    metrosPendientes: i.metros_pendientes == null ? null : numero(i.metros_pendientes),
    tieneProduccionRegistrada: Boolean(i.tiene_produccion_registrada) };
}

export function apartadoDesdeApi(a: RegistroApi) {
  const items = Array.isArray(a.items) ? a.items : [];
  return { id: numero(a.id), bodegaId: numero(a.bodega_id), bodegaNombre: texto(a.bodega_nombre), numeroCotizacion: texto(a.numero_cotizacion),
    cliente: texto(a.cliente), creadoPor: texto(a.creado_por), fechaCreacion: texto(a.fecha_creacion),
    estado: texto(a.estado), enviadoAProduccionPor: texto(a.enviado_a_produccion_por),
    fechaEnviadoAProduccion: a.fecha_enviado_a_produccion == null ? null : texto(a.fecha_enviado_a_produccion),
    canceladoPor: texto(a.cancelado_por), fechaCancelado: a.fecha_cancelado == null ? null : texto(a.fecha_cancelado),
    fechaEntregado: a.fecha_entregado == null ? null : texto(a.fecha_entregado), observaciones: texto(a.observaciones),
    stockSeparadoConfirmado: Boolean(a.stock_separado_confirmado), stockSeparadoPor: texto(a.stock_separado_por),
    stockSeparadoEn: a.stock_separado_en == null ? null : texto(a.stock_separado_en),
    // Lo que todavía no llega a la bodega (material en camino).
    faltantes: Array.isArray(a.faltantes) ? a.faltantes.map(texto) : [],
    items: items.map(apartadoItemDesdeApi) };
}

export function envioItemDesdeApi(i: RegistroApi) {
  return { id: numero(i.id), rolloId: i.rollo_id == null ? null : numero(i.rollo_id),
    productoCodigo: i.producto_codigo == null ? null : texto(i.producto_codigo),
    descripcion: texto(i.descripcion), cantidad: i.cantidad == null ? null : numero(i.cantidad) };
}

export function envioDesdeApi(e: RegistroApi, bodegasPorId: BodegasPorId = {}) {
  const items = Array.isArray(e.items) ? e.items : [];
  const bodegaDestinoId = numero(e.bodega_destino_id);
  return { id: numero(e.id), bodegaDestinoId, bodegaDestinoNombre: bodegasPorId[bodegaDestinoId] || "",
    estado: texto(e.estado), enviadoPor: texto(e.enviado_por), fechaEnvio: texto(e.fecha_envio),
    respondidoPor: texto(e.respondido_por),
    fechaRespuesta: e.fecha_respuesta == null ? null : texto(e.fecha_respuesta),
    observaciones: texto(e.observaciones), items: items.map(envioItemDesdeApi) };
}

export function alertaIaDesdeApi(a: RegistroApi) {
  return { id: numero(a.id), nivel: texto(a.nivel), tipo: texto(a.tipo), titulo: texto(a.titulo), mensaje: texto(a.mensaje),
    productoId: a.producto_id == null ? null : numero(a.producto_id), productoCodigo: texto(a.producto_codigo),
    productoDescripcion: texto(a.producto_descripcion), fecha: texto(a.fecha) };
}

export function prediccionStockDesdeApi(p: RegistroApi) {
  return { productoId: numero(p.producto_id), productoCodigo: texto(p.producto_codigo), productoDescripcion: texto(p.producto_descripcion),
    stockActual: numero(p.stock_actual), diasEstimadosAgotamiento: p.dias_estimados_agotamiento == null ? null : numero(p.dias_estimados_agotamiento),
    cantidadSugeridaReabastecer: p.cantidad_sugerida_reabastecer == null ? null : numero(p.cantidad_sugerida_reabastecer),
    confianza: p.confianza == null ? null : numero(p.confianza), nota: texto(p.nota) };
}

export function prediccionNegocioDesdeApi(p: RegistroApi) {
  return { periodo: texto(p.periodo), tendencia: texto(p.tendencia), resumen: texto(p.resumen),
    factoresClave: Array.isArray(p.factores_clave) ? p.factores_clave.map(String) : [],
    recomendaciones: Array.isArray(p.recomendaciones) ? p.recomendaciones.map(String) : [] };
}

export function produccionDesdeApi(p: RegistroApi) {
  const rollos = Array.isArray(p.rollos_utilizados) ? p.rollos_utilizados : [];
  const productosStock = Array.isArray(p.productos_stock) ? p.productos_stock : [];
  return { id: numero(p.id), codigoUnico: texto(p.codigo_unico), cotizacion: texto(p.cotizacion), fecha: texto(p.fecha), usuario: texto(p.usuario),
    responsable: texto(p.responsable), bodegaId: numero(p.bodega_id), tipoProducto: texto(p.tipo_producto) || "teja", productoFabricado: texto(p.producto_fabricado),
    modelo: texto(p.modelo), medidaProducto: texto(p.medida_producto), cantidadProductos: numero(p.cantidad_productos),
    codigoClasificacion: texto(p.codigo_clasificacion), totalMetrosConsumidos: numero(p.total_metros_consumidos),
    saldoCodigo: numero(p.saldo_codigo), metrosExcedente: numero(p.metros_excedente), observaciones: texto(p.observaciones),
    apartadoItemId: p.apartado_item_id == null ? null : numero(p.apartado_item_id), clienteApartado: texto(p.cliente_apartado),
    rollosUtilizados: rollos.map((r) => ({ rolloId: numero(r.rollo_id), identificadorRollo: texto(r.identificador_rollo), metrosConsumidos: numero(r.metros_consumidos) })),
    productosStock: productosStock.map((s) => ({
      id: numero(s.id), codigo: texto(s.codigo), descripcion: texto(s.descripcion), stock: numero(s.stock),
      calidad: texto(s.calidad), motivoSegunda: texto(s.motivo_segunda), color: texto(s.color), ral: texto(s.ral),
      calibre: texto(s.calibre), metrosPorUnidad: s.metros_por_unidad == null ? null : numero(s.metros_por_unidad),
      codigoRolloOrigen: texto(s.codigo_rollo_origen), anchoRollo: s.ancho_rollo == null ? null : numero(s.ancho_rollo),
      tipoProducto: texto(s.tipo_producto),
    })) };
}
