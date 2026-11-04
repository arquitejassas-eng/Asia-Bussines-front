import { createContext } from "react";

/** Rollo que una bodega le pidió a otra y todavía no llega. Admin Inventario
 * no aprueba ni despacha estos traslados, pero tiene que saber que el rollo
 * ya está comprometido (ver /admin-inventario/traslados-rollos). */
export type TrasladoRollo = {
  id: number; estado: "pendiente" | "aceptada" | "despachada"; rolloId: number; referencia: string; codigo: string;
  empresa: string; metros: number; kilos: number | null; desde: string; hacia: string;
  cotizacion: string; fecha: string; solicitadoPor: string;
};

export function trasladoRolloDesdeApi(t: Record<string, unknown>): TrasladoRollo {
  return {
    id: Number(t.id), estado: String(t.estado) as TrasladoRollo["estado"], rolloId: Number(t.rollo_id),
    referencia: String(t.referencia ?? ""), codigo: String(t.codigo ?? ""), empresa: String(t.empresa ?? ""),
    metros: Number(t.metros ?? 0), kilos: t.kilos == null ? null : Number(t.kilos),
    desde: String(t.desde ?? ""), hacia: String(t.hacia ?? ""), cotizacion: String(t.cotizacion ?? ""),
    fecha: String(t.fecha ?? ""), solicitadoPor: String(t.solicitado_por ?? ""),
  };
}

/** En qué paso va el traslado, dicho desde la bodega que lo pidió. */
export function pasoDelTraslado(t: TrasladoRollo): string {
  if (t.estado === "pendiente") return `Pedido por ${t.hacia} – falta que ${t.desde} lo acepte`;
  if (t.estado === "aceptada") return `Aceptado para ${t.hacia} – falta despacharlo`;
  return `En camino a ${t.hacia}`;
}

/** Cuántos rollos van en traslado: badge de "Inventario total" para Admin
 * Inventario. Lo llena App.tsx desde useAlmacenGlobal. */
export const TrasladosRollosContexto = createContext(0);
