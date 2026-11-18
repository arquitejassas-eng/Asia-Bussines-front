import { createContext } from "react";

/** Cotización activa de la bodega a la que le falta material que no viene en
 * camino: la encargada tiene que pedirlo (traslado) para poder cumplirla.
 * Sale de /apartados/esperando-material. */
export type LineaPorPedir = {
  codigo: string; empresa: string; unidad: "m" | "und"; falta: number; yaPedido: number; porPedir: number; detalle: string;
};
export type CotizacionPorPedir = {
  id: number; numeroCotizacion: string; cliente: string; estado: string; lineas: LineaPorPedir[]; porPedir: boolean;
};

export function cotizacionPorPedirDesdeApi(c: Record<string, unknown>): CotizacionPorPedir {
  const lineas = Array.isArray(c.lineas) ? (c.lineas as Record<string, unknown>[]) : [];
  return {
    id: Number(c.id), numeroCotizacion: String(c.numero_cotizacion ?? ""), cliente: String(c.cliente ?? ""),
    estado: String(c.estado ?? ""), porPedir: Boolean(c.por_pedir),
    lineas: lineas.map((l) => ({
      codigo: String(l.codigo ?? ""), empresa: String(l.empresa ?? ""), unidad: l.unidad === "m" ? "m" : "und",
      falta: Number(l.falta ?? 0), yaPedido: Number(l.ya_pedido ?? 0), porPedir: Number(l.por_pedir ?? 0),
      detalle: String(l.detalle ?? ""),
    })),
  };
}

/** Lo llena App.tsx desde useAlmacenGlobal; BarraLateral muestra la alerta
 * en cualquier pantalla de la bodega. */
export const PedirMaterialContexto = createContext<CotizacionPorPedir[]>([]);
