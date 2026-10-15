import { calibrePantalla, normalizarModeloTeja } from "./teja";

// Los campos Calidad/Longitud/Ancho rollo-sección/Rollo origen solo tienen
// sentido para TEJA (el stock que sale de Producción o del catálogo de
// tejas) — ver el condicional en InventarioPage.tsx que oculta esas 4
// columnas para cualquier otra familia, sin importar si están vacías o no.
export const FAMILIA_TEJA = "TEJA";
export function normalizarFamilia(familia: string) {
  return (familia || "").trim().toUpperCase();
}

/** Lo mínimo que necesita un producto para agruparse en tarjetas: lo usan
 * el inventario de cada bodega (useProductosInventario) y el resumen de
 * productos de Inventario total (AdminInventario.ts). */
export type ProductoAgrupable = {
  familia?: string; tipoProducto?: string; metrosPorUnidad?: number | null;
  descripcion: string; calibre: string | number; referencia?: string;
};

/** Todo el catálogo agrupado por familia, para mostrarlo como tarjetas
 * plegables (mismo patrón visual que Rollos::gruposPorCodigo, pero sobre el
 * catálogo completo — una familia nunca queda partida entre páginas). El
 * stock adicional que genera Producción usa como familia el código de
 * clasificación del rollo de origen, así queda agrupado ahí.
 *
 * Excepción 1 — productos "seccionados" (caballete/flanche — ver
 * tipoProducto): la familia sola no alcanza para identificar la tarjeta —
 * "CABALLETES" de 6 m y "CABALLETES" de 4 m son existencias distintas y NO
 * deben mezclarse en una sola tarjeta. Ahí se agrupa por familia + longitud
 * (metrosPorUnidad).
 *
 * Excepción 2 — productos vendidos "por conversión" (ej. Porcelanato: la
 * unidad física de stock es la CAJA, pero el cliente pide m² — ver
 * metrosPorUnidad = m² por caja): familia sola tampoco alcanza —
 * "PORCELANATO Gris 60x60" y "PORCELANATO Beige 60x60" comparten familia
 * pero son productos distintos. Se identifican por `tipoProducto ===
 * "conversion"` — el MISMO campo estructural que ya distingue
 * caballete/flanche, poblado por el backend al crear/editar el producto
 * (nunca inferido aquí a partir de metrosPorUnidad + produccionId: eso
 * confundía el stock adicional de tejas, que también usa metrosPorUnidad
 * pero para metros lineales, no m² por caja — ver el bug corregido). Se
 * agrupan por familia + descripción + calibre + metrosPorUnidad —
 * descripcion/calibre son campos que YA existen y ya identifican el tipo.
 *
 * `longitud` queda disponible en los dos casos anteriores para que la
 * tarjeta muestre qué medida guarda. Para todo lo demás (incluyendo TECHO
 * PVC, tejas, productos comprados como Tornillos) sigue agrupando solo por
 * familia, sin importar la referencia, el código, el calibre u otra
 * característica — comportamiento sin cambios. */
export type GrupoFamilia<T extends ProductoAgrupable = ProductoAgrupable> = {
  clave: string; familia: string; longitud: number | null;
  tipoGrupo: "seccionado" | "conversion" | "referencia" | "teja" | "simple";
  descripcion: string; calibre: string; referenciaGrupo: string;
  productos: T[];
};
const TIPOS_PRODUCTO_SECCIONADO = ["caballete", "flanche"];

export function agruparProductosPorFamilia<T extends ProductoAgrupable>(productos: T[]): GrupoFamilia<T>[] {
  const mapa = new Map<string, GrupoFamilia<T>>();
  for (const producto of productos) {
    const familia = producto.familia || "Sin familia";
    const esSeccionado = TIPOS_PRODUCTO_SECCIONADO.includes(producto.tipoProducto || "");
    // `tipoProducto` es la fuente estructural de qué es este stock — la
    // misma que ya distingue caballete/flanche. El backend (no este
    // hook) decide "conversion" al crear/editar el producto: un producto
    // creado a mano con m² por caja configurado queda marcado ahí mismo
    // (ver crear_producto/actualizar_producto). Así el stock adicional de
    // TEJAS (que también usa metrosPorUnidad, para metros lineales, no
    // m² por caja) nunca puede confundirse con Porcelanato: su
    // tipoProducto siempre queda "" o "caballete"/"flanche", nunca
    // "conversion" — no depende de inferir nada aquí a partir de
    // produccionId + metrosPorUnidad.
    const tieneConversion = producto.tipoProducto === "conversion";
    // TEJA: la AGRUPACIÓN VISUAL de las tarjetas es solo Familia + Modelo
    // — todas las TEJA de un mismo modelo (SUPERMIL, MASTERMIL,
    // ARQUITECTONICA...) caen en una sola tarjeta, sin importar que
    // difieran en color/rollo origen/calibre/longitud/calidad; esos datos
    // siguen viéndose fila por fila dentro de la tabla expandida. Esto es
    // un concepto DISTINTO de la identidad que usa Producción para decidir
    // si dos producciones son "el mismo producto" (Familia + Modelo +
    // Color + Rollo origen + Calibre real + Longitud + Calidad — ver
    // `_buscar_producto_existente` en backend/app/services/produccion.py):
    // esa identidad, más estricta, decide qué fila de BD recibe el stock;
    // esta clave, más simple, decide solo cómo se agrupan visualmente las
    // tarjetas. No mezclar los dos.
    const esTeja = !esSeccionado && !tieneConversion && normalizarFamilia(familia) === FAMILIA_TEJA;

    let clave: string, longitud: number | null, tipoGrupo: GrupoFamilia<T>["tipoGrupo"], referenciaGrupo = "";
    if (esSeccionado) {
      longitud = producto.metrosPorUnidad ?? null;
      clave = `${familia}|${longitud}`;
      tipoGrupo = "seccionado";
    } else if (tieneConversion) {
      longitud = producto.metrosPorUnidad ?? null;
      clave = `${familia}|${producto.descripcion}|${producto.calibre}|${longitud}`;
      tipoGrupo = "conversion";
    } else if (esTeja) {
      // "Arqui" y "ARQUITECTONICA" son el mismo modelo: una sola tarjeta.
      referenciaGrupo = normalizarModeloTeja(producto.referencia);
      longitud = null;
      clave = `${familia}|${referenciaGrupo}`;
      tipoGrupo = "teja";
    } else {
      longitud = null;
      clave = familia;
      tipoGrupo = "simple";
    }

    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave, familia, longitud, tipoGrupo,
        // Para "conversion" (ej. Porcelanato), la familia sola no
        // identifica el tipo — descripcion/calibre son los campos ya
        // existentes que sí lo hacen (ej. "Porcelanato Gris", "60x60").
        // Todos los productos de este grupo comparten el mismo valor (son
        // parte de la clave), así que tomar el del primero es exacto.
        descripcion: tipoGrupo === "conversion" ? producto.descripcion : "",
        calibre: tipoGrupo === "conversion" ? String(producto.calibre) : tipoGrupo === "teja" ? calibrePantalla(producto.calibre) : "",
        referenciaGrupo,
        productos: [],
      });
    }
    mapa.get(clave)!.productos.push(producto);
  }
  return Array.from(mapa.values()).sort((a, b) => {
    const porFamilia = a.familia.localeCompare(b.familia);
    if (porFamilia !== 0) return porFamilia;
    return (a.longitud ?? 0) - (b.longitud ?? 0);
  });
}
