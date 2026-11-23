import { createContext } from "react";

// Productos que Planta mandó al stock sin que existieran en el inventario:
// llevan el código provisional de la producción ("PROD-...") hasta que Admin
// Inventario les pone el real (ver backend services/codigo_provisional.py).

export type ProductoSinCodigo = {
  codigo: string; descripcion: string; familia: string; empresa: string; calidad: string; fecha: string | null;
  stock: number; bodegas: { nombre: string; stock: number }[]; sugerencias: { codigo: string; descripcion: string }[];
  // La producción que lo dejó en el stock y lo que se estaba produciendo.
  origen: {
    produccion: string; fecha: string | null; bodega: string; cotizacion: string; cliente: string; ordenInterna: boolean;
    linea: string; fabricado: string; responsable: string; registro: string; rollos: string[];
  } | null;
};

export function productoSinCodigoDesdeApi(p: Record<string, unknown>): ProductoSinCodigo {
  const lista = (valor: unknown) => (Array.isArray(valor) ? valor as Record<string, unknown>[] : []);
  return {
    codigo: String(p.codigo ?? ""), descripcion: String(p.descripcion ?? ""), familia: String(p.familia ?? ""),
    empresa: String(p.empresa ?? ""), calidad: String(p.calidad ?? ""), fecha: p.fecha == null ? null : String(p.fecha),
    stock: Number(p.stock ?? 0),
    bodegas: lista(p.bodegas).map((b) => ({ nombre: String(b.nombre ?? ""), stock: Number(b.stock ?? 0) })),
    sugerencias: lista(p.sugerencias).map((s) => ({ codigo: String(s.codigo ?? ""), descripcion: String(s.descripcion ?? "") })),
    origen: origenDesdeApi(p.origen),
  };
}

function origenDesdeApi(valor: unknown): ProductoSinCodigo["origen"] {
  if (!valor || typeof valor !== "object") return null;
  const o = valor as Record<string, unknown>;
  const texto = (v: unknown) => (v == null ? "" : String(v));
  return {
    produccion: texto(o.produccion), fecha: o.fecha == null ? null : String(o.fecha), bodega: texto(o.bodega),
    cotizacion: texto(o.cotizacion), cliente: texto(o.cliente), ordenInterna: Boolean(o.orden_interna),
    linea: texto(o.linea), fabricado: texto(o.fabricado), responsable: texto(o.responsable), registro: texto(o.registro),
    rollos: Array.isArray(o.rollos) ? o.rollos.map(String) : [],
  };
}

/** Cuántos productos esperan código: badge de "Inventario total" para Admin
 * Inventario. Lo llena App.tsx desde useAlmacenGlobal. */
export const ProductosSinCodigoContexto = createContext(0);
// Cotizaciones esperando la decisión de Admin Inventario (importación que solo se vende en rollo completo).
export const AlertasImportacionContexto = createContext(0);
