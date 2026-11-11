import { createContext } from "react";

// Productos que Planta mandó al stock sin que existieran en el inventario:
// llevan el código provisional de la producción ("PROD-...") hasta que Admin
// Inventario les pone el real (ver backend services/codigo_provisional.py).

export type ProductoSinCodigo = {
  codigo: string; descripcion: string; familia: string; empresa: string; calidad: string; fecha: string | null;
  stock: number; bodegas: { nombre: string; stock: number }[]; sugerencias: { codigo: string; descripcion: string }[];
};

export function productoSinCodigoDesdeApi(p: Record<string, unknown>): ProductoSinCodigo {
  const lista = (valor: unknown) => (Array.isArray(valor) ? valor as Record<string, unknown>[] : []);
  return {
    codigo: String(p.codigo ?? ""), descripcion: String(p.descripcion ?? ""), familia: String(p.familia ?? ""),
    empresa: String(p.empresa ?? ""), calidad: String(p.calidad ?? ""), fecha: p.fecha == null ? null : String(p.fecha),
    stock: Number(p.stock ?? 0),
    bodegas: lista(p.bodegas).map((b) => ({ nombre: String(b.nombre ?? ""), stock: Number(b.stock ?? 0) })),
    sugerencias: lista(p.sugerencias).map((s) => ({ codigo: String(s.codigo ?? ""), descripcion: String(s.descripcion ?? "") })),
  };
}

/** Cuántos productos esperan código: badge de "Inventario total" para Admin
 * Inventario. Lo llena App.tsx desde useAlmacenGlobal. */
export const ProductosSinCodigoContexto = createContext(0);
