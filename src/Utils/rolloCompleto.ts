import type { RolloParaApartar } from "../Hooks/useApartados";
import { kilosDelRollo } from "./kilos";

/** Lo que va en la cotización, ej. "1 ROLLO LAMINA ... ROJO 3002 (4386 KG - 1721 MTS) - rollo ABG...-01"
 * (mismo texto que arma el backend si la descripción va vacía). */
export function descripcionRolloCompleto(r: RolloParaApartar) {
  const kilos = kilosDelRollo(r.pesoNeto);
  const detalle = [kilos ? `${kilos} KG` : "", `${r.metrosDisponibles} MTS`].filter(Boolean).join(" - ");
  return `1 ROLLO ${r.descripcion || r.codigoInterno} (${detalle}) - rollo ${r.identificadorRollo}`;
}
