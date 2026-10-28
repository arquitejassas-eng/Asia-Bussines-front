import { useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { movimientoDesdeApi } from "../Componentes/Mapeo";

/** Hoja de vida de un rollo (GET /rollos/{id}/historial) para la ventana
 * ModalHistorialRollo: qué rollo está abierto, sus movimientos y si cargan. */
export function useHistorialRollo<R extends { id: number }>() {
  const [rolloParaHistorial, setRolloParaHistorial] = useState<R | null>(null);
  const [historialRollo, setHistorialRollo] = useState<Record<string, unknown>[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState("");

  async function abrirHistorial(rollo: R) {
    setRolloParaHistorial(rollo);
    setHistorialRollo([]);
    setErrorHistorial("");
    setCargandoHistorial(true);
    try {
      const datos = await api.get<Record<string, unknown>[]>(`/rollos/${rollo.id}/historial`);
      setHistorialRollo((datos || []).map(movimientoDesdeApi));
    } catch (err) {
      setErrorHistorial(err instanceof ErrorApi ? err.message : "No se pudo cargar el historial de este rollo.");
    } finally {
      setCargandoHistorial(false);
    }
  }

  function cerrarHistorial() {
    setRolloParaHistorial(null);
    setHistorialRollo([]);
    setErrorHistorial("");
  }

  return { rolloParaHistorial, historialRollo, cargandoHistorial, errorHistorial, abrirHistorial, cerrarHistorial };
}
