import { useCallback, useEffect, useState } from "react";
import { api } from "./Api";
import { apartadoDesdeApi } from "./Mapeo";
import { cambiarBodegaActiva, type BodegaDeSesion } from "../Utils/bodegaActiva";
import { cotizacionesParaPlanta } from "../Utils/produccion";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";

const ESTADOS_PRODUCCION_PENDIENTE = ["enviado_a_produccion", "en_produccion"];

/** Lo pendiente de una bodega que no es la escogida: lo mismo que cuenta el
 * número rojo del menú (bodega: traslados y envíos por responder; Planta:
 * cotizaciones por producir), pidiendo con el encabezado de esa bodega. */
async function pendientesDe(rol: string, bodegaId: number): Promise<number> {
  const encabezados = { "X-Bodega-Id": String(bodegaId) };
  if (rol === "jefe_planta") {
    const datos = await api.get<Record<string, unknown>[]>(
      `/apartados?${ESTADOS_PRODUCCION_PENDIENTE.map((e) => `estados=${e}`).join("&")}`, encabezados) || [];
    const pendientes = datos.map(apartadoDesdeApi).filter((ap) => ESTADOS_PRODUCCION_PENDIENTE.includes(ap.estado));
    return cotizacionesParaPlanta(pendientes).size;
  }
  const [recibidas, envios, porDespachar, enCamino, produccion] = await Promise.all([
    api.get<{ bodega_propietaria_id: number; estado: string }[]>("/bodegas/solicitudes/recibidas", encabezados),
    api.get<unknown[]>("/envios/recibidos", encabezados),
    api.get<unknown[]>("/bodegas/solicitudes/por-despachar", encabezados),
    api.get<unknown[]>("/bodegas/solicitudes/en-camino", encabezados),
    api.get<unknown[]>("/apartados/envios-en-camino", encabezados).catch(() => []),
  ]);
  return (recibidas || []).filter((s) => s.bodega_propietaria_id === bodegaId && s.estado === "pendiente").length
    + (envios || []).length + (porDespachar || []).length + (enCamino || []).length + (produccion || []).length;
}

/** "Bodega: Santander ▾" para las cuentas que manejan varias bodegas. Al
 * cambiar, la página se recarga con la bodega nueva. Al lado de cada otra
 * bodega sale cuánto tiene pendiente, para que no se le pase nada. */
export default function SelectorBodega({ rol, bodegaId, bodegas }: { rol: string; bodegaId: number | null; bodegas: BodegaDeSesion[] }) {
  const [pendientes, setPendientes] = useState<Record<number, number>>({});
  const otras = bodegas.filter((b) => b.id !== bodegaId);

  const cargar = useCallback(async () => {
    const resultado: Record<number, number> = {};
    await Promise.all(otras.map(async (b) => {
      try {
        resultado[b.id] = await pendientesDe(rol, b.id);
      } catch {
        /* Sin conexión un momento: esa bodega queda sin número. */
      }
    }));
    setPendientes(resultado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rol, bodegaId, otras.map((b) => b.id).join(",")]);
  useEffect(() => { cargar(); }, [cargar]);
  useActualizacionAutomatica(cargar);

  const totalOtras = otras.reduce((suma, b) => suma + (pendientes[b.id] || 0), 0);

  return (
    <label className="barra-selector-bodega">
      <span>Bodega</span>
      <select value={bodegaId ?? ""} onChange={(e) => cambiarBodegaActiva(Number(e.target.value))}
        aria-label={totalOtras ? `Bodega (${totalOtras} pendientes en otras bodegas)` : "Bodega"}>
        {bodegas.map((b) => (
          <option key={b.id} value={b.id}>
            {b.nombre}{b.id !== bodegaId && pendientes[b.id] ? ` (${pendientes[b.id]} pendiente${pendientes[b.id] === 1 ? "" : "s"})` : ""}
          </option>
        ))}
      </select>
      {totalOtras > 0 && (
        <small className="barra-selector-aviso">
          {otras.filter((b) => pendientes[b.id]).map((b) => `${b.nombre}: ${pendientes[b.id]}`).join(" · ")} pendiente{totalOtras === 1 ? "" : "s"}
        </small>
      )}
    </label>
  );
}
