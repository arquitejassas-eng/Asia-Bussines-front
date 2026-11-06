import type { RolloParaApartar } from "../Hooks/useApartados";
import { kilosDelRollo } from "./kilos";

/** Lo que va en la cotización, ej. "1 ROLLO LAMINA ... ROJO 3002 (4386 KG - 1721 MTS) - rollo ABG...-01"
 * (mismo texto que arma el backend si la descripción va vacía). Los kilos son
 * los que pesa HOY (un rollo ya usado pesa menos que su etiqueta). */
export function kilosActualesRollo(r: RolloParaApartar) {
  return r.pesoActualKg ?? kilosDelRollo(r.pesoNeto);
}

export function descripcionRolloCompleto(r: RolloParaApartar) {
  const kilos = kilosActualesRollo(r);
  const detalle = [kilos ? `${kilos} KG` : "", `${r.metrosDisponibles} MTS`].filter(Boolean).join(" - ");
  return `1 ROLLO ${r.descripcion || r.codigoInterno} (${detalle}) - rollo ${r.identificadorRollo}`;
}
