/** Regla física de los productos "seccionados": el ancho del rollo se
 * divide siempre en N partes iguales según el tipo, así que cada corte
 * produce SIEMPRE esas N unidades. Un solo lugar (reutilizado por el
 * controlador de Producción y por Inventario) define cuántas secciones
 * tiene cada tipo — agregar un producto nuevo de esta misma familia física
 * es sumar una entrada aquí, no repetir el número por toda la app. Debe
 * coincidir exactamente con SECCIONES_POR_TIPO_PRODUCTO del backend
 * (app/services/produccion.py). */
export const SECCIONES_POR_TIPO_PRODUCTO: Record<string, number> = { caballete: 3, flanche: 5 };
export const NOMBRE_POR_TIPO_PRODUCTO: Record<string, string> = { caballete: "caballete", flanche: "flanche" };

type ApartadoItemPendiente = {
  id: number; modalidad: string; codigoInterno: string | null; descripcion: string;
  cantidad: number; medida: number | null; metrosPendientes: number | null;
};
type ApartadoParaProduccion = { id: number; numeroCotizacion: string; cliente: string; empresa?: string; items: ApartadoItemPendiente[] };
export type SolicitudProduccionPendiente = {
  itemId: number; apartadoId: number; numeroCotizacion: string; cliente: string; empresa: string;
  codigoInterno: string | null; descripcion: string; cantidad: number; medida: number | null; metrosPendientes: number;
};

/** Ítems POR_ROLLO de apartados ya enviados a producción que todavía tienen
 * metros pendientes por producir -- explícito por `modalidad` (nunca por un
 * efecto colateral de que `metrosPendientes` sea `null` en los ítems
 * POR_STOCK). Compartido entre el panel de "Registrar Producción" y el
 * botón "Iniciar Producción" de Apartados, para no duplicar el criterio. */
export function calcularSolicitudesPendientes(apartados: ApartadoParaProduccion[]): SolicitudProduccionPendiente[] {
  return apartados.flatMap((ap) =>
    ap.items
      .filter((it) => it.modalidad === "por_rollo" && (it.metrosPendientes ?? 0) > 0)
      .map((it) => ({
        itemId: it.id, apartadoId: ap.id, numeroCotizacion: ap.numeroCotizacion, cliente: ap.cliente, empresa: ap.empresa || "",
        codigoInterno: it.codigoInterno, descripcion: it.descripcion, cantidad: it.cantidad, medida: it.medida,
        metrosPendientes: it.metrosPendientes ?? 0,
      }))
  );
}

/** `ancho_rollo` (m) de un stock, dividido por el número de secciones que
 * le corresponde según su `tipoProducto` — o null si no aplica (tejas y
 * cualquier producto que no venga de un tipo seccionado). */
export function anchoPorSeccion(anchoRollo: number | null | undefined, tipoProducto: string) {
  const secciones = SECCIONES_POR_TIPO_PRODUCTO[tipoProducto];
  if (anchoRollo == null || !secciones) return null;
  return Math.round((anchoRollo / secciones) * 10000) / 10000;
}

type ProductoStockItem = {
  id: number | string; calidad?: string; motivoSegunda?: string;
  metrosPorUnidad?: number | null; stock: number; codigoRolloOrigen?: string;
};
type RolloUtilizado = { identificadorRollo: string };
type ProduccionParaStock = {
  id: number | string; codigoUnico: string; fecha: string; responsable: string;
  productoFabricado: string; modelo: string; medidaProducto: string;
  codigoClasificacion: string; saldoCodigo: number;
  productosStock?: ProductoStockItem[]; rollosUtilizados?: RolloUtilizado[];
};

/** Cada unidad de stock adicional que generó una producción se muestra como
 * una fila aparte en el historial (Hoja de Vida / Producciones registradas),
 * nunca fusionada con la fila de la cotización real: mismo código de
 * producción que la fila de arriba, pero con Cotización = "STOCK" y
 * Cliente = "-", para que quede claro que esa unidad no salió con el
 * cliente de esa cotización, sino que quedó disponible en inventario. */
export function filasStockAdicional(prod: ProduccionParaStock) {
  if (!prod.productosStock || prod.productosStock.length === 0) return [];
  const referencia = (prod.rollosUtilizados || []).map((r) => r.identificadorRollo).join(", ");
  return prod.productosStock.map((item) => {
    // Genérico a propósito: no asume "teja" ni ningún otro producto — la
    // columna Producto/Modelo de la misma fila ya dice qué se fabricó.
    let observaciones = item.calidad === "segunda" ? "Segunda" : "Primera";
    if (item.calidad === "segunda" && item.motivoSegunda) observaciones += `: ${item.motivoSegunda}`;
    const metrosConsumidos = item.metrosPorUnidad != null
      ? Math.round(item.stock * item.metrosPorUnidad * 100) / 100
      : null;
    return {
      key: `${prod.id}-stock-${item.id}`,
      codigoProduccion: prod.codigoUnico,
      cotizacion: "STOCK",
      cliente: "-",
      fecha: prod.fecha,
      responsable: prod.responsable,
      productoFabricado: prod.productoFabricado,
      modelo: prod.modelo,
      medida: prod.medidaProducto,
      cantidad: item.stock,
      codigoClasificacion: prod.codigoClasificacion,
      referencia,
      metrosConsumidos,
      saldoRestante: prod.saldoCodigo,
      codigoRolloOrigen: item.codigoRolloOrigen,
      observaciones,
    };
  });
}
