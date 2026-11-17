import { useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";

/** "Salida externa" de un rollo (POST /rollos/{id}/salida-externa) para la
 * ventana ModalSalidaExternaRollo: el rollo completo sale a otra empresa y no
 * vuelve. `alGuardar` recarga la lista donde estaba el rollo. */
export function useSalidaExternaRollo<R extends { id: number; identificadorRollo: string }>(alGuardar: () => unknown) {
  const [rolloParaSalidaExterna, setRolloParaSalidaExterna] = useState<R | null>(null);
  const [empresaSalidaExterna, setEmpresaSalidaExterna] = useState("");
  const [observacionesSalidaExterna, setObservacionesSalidaExterna] = useState("");
  const [errorSalidaExterna, setErrorSalidaExterna] = useState("");
  const [guardandoSalidaExterna, setGuardandoSalidaExterna] = useState(false);
  const [avisoSalidaExterna, setAvisoSalidaExterna] = useState("");

  function abrirSalidaExterna(rollo: R) {
    setRolloParaSalidaExterna(rollo);
    setEmpresaSalidaExterna("");
    setObservacionesSalidaExterna("");
    setErrorSalidaExterna("");
    setAvisoSalidaExterna("");
  }

  function cerrarSalidaExterna() {
    setRolloParaSalidaExterna(null);
    setErrorSalidaExterna("");
  }

  async function registrarSalidaExterna(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!rolloParaSalidaExterna) return;
    const empresa = empresaSalidaExterna.trim();
    if (!empresa) { setErrorSalidaExterna("El nombre de la empresa es obligatorio."); return; }
    setGuardandoSalidaExterna(true);
    setErrorSalidaExterna("");
    try {
      await api.post(`/rollos/${rolloParaSalidaExterna.id}/salida-externa`, { empresa, observaciones: observacionesSalidaExterna });
      setAvisoSalidaExterna(`Salida externa registrada: rollo ${rolloParaSalidaExterna.identificadorRollo} a ${empresa}.`);
      setRolloParaSalidaExterna(null);
      await alGuardar();
    } catch (err) {
      setErrorSalidaExterna(err instanceof ErrorApi ? err.message : "No se pudo registrar la salida. Intenta de nuevo.");
    } finally {
      setGuardandoSalidaExterna(false);
    }
  }

  return {
    rolloParaSalidaExterna, empresaSalidaExterna, setEmpresaSalidaExterna,
    observacionesSalidaExterna, setObservacionesSalidaExterna, errorSalidaExterna, guardandoSalidaExterna,
    avisoSalidaExterna, setAvisoSalidaExterna, abrirSalidaExterna, cerrarSalidaExterna, registrarSalidaExterna,
  };
}
