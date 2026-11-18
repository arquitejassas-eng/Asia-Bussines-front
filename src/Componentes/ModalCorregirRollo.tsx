import { useState } from "react";
import { api, ErrorApi } from "./Api";

type RolloACorregir = { id: number; identificadorRollo: string; codigoInterno?: string; metrosDisponibles: number };

/** Admin Inventario corrige la referencia y/o los metros reales de un rollo
 * (de cualquier sede). Los dos cambios quedan anotados en el historial; los
 * metros, como movimiento de ajuste con su motivo. */
export default function ModalCorregirRollo({ rollo, alCerrar, alGuardar }: {
  rollo: RolloACorregir; alCerrar: () => void; alGuardar: (mensaje: string) => void;
}) {
  const [referencia, setReferencia] = useState(rollo.identificadorRollo);
  const [metros, setMetros] = useState(String(rollo.metrosDisponibles));
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const nuevaReferencia = referencia.trim().toUpperCase();
  const cambiaReferencia = Boolean(nuevaReferencia) && nuevaReferencia !== rollo.identificadorRollo.toUpperCase();
  const nuevosMetros = Number(metros.replace(",", "."));
  const cambianMetros = metros.trim() !== "" && Number.isFinite(nuevosMetros) && Math.abs(nuevosMetros - rollo.metrosDisponibles) >= 0.005;

  async function guardar(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!referencia.trim()) { setError("La referencia no puede quedar vacía."); return; }
    if (metros.trim() === "" || !Number.isFinite(nuevosMetros) || nuevosMetros < 0) { setError("Escribe los metros reales (0 o más)."); return; }
    if (!cambiaReferencia && !cambianMetros) { setError("No cambiaste nada."); return; }
    if (cambianMetros && motivo.trim().length < 3) { setError("Escribe el motivo del ajuste de metros (ej. conteo físico)."); return; }
    setGuardando(true); setError("");
    const hechos: string[] = [];
    try {
      if (cambiaReferencia) {
        await api.patch(`/rollos/${rollo.id}/referencia`, { identificador_rollo: nuevaReferencia });
        hechos.push(`referencia ${rollo.identificadorRollo} → ${nuevaReferencia}`);
      }
      if (cambianMetros) {
        await api.patch(`/rollos/${rollo.id}/metros`, { metros_disponibles: nuevosMetros, motivo: motivo.trim() });
        hechos.push(`metros ${rollo.metrosDisponibles} → ${nuevosMetros}`);
      }
      alGuardar(`Rollo corregido: ${hechos.join(" y ")}.`);
    } catch (e) {
      const mensaje = e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo corregir el rollo.";
      // Si la referencia ya se guardó y fallaron los metros, se avisa para no repetirla.
      setError(hechos.length ? `Se guardó: ${hechos.join(" y ")}. Pero falló lo demás: ${mensaje}` : mensaje);
      setGuardando(false);
    }
  }

  return (
    <div className="rollos-modal-fondo" onClick={alCerrar}>
      <form className="rollos-modal" role="dialog" aria-modal="true" aria-labelledby="corregir-rollo-titulo"
        onClick={(e) => e.stopPropagation()} onSubmit={guardar} noValidate
        style={{ maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}>
        <h3 id="corregir-rollo-titulo">Corregir rollo {rollo.identificadorRollo}</h3>
        <p className="rollos-texto-ayuda">
          Los cambios quedan anotados en el historial del rollo. Las cotizaciones que lo tienen siguen amarradas a él.
          Si está vendido completo y su cotización está en Siigo, también se actualiza allá.
        </p>
        <label>
          Referencia
          <input value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
        </label>
        <label>
          Metros disponibles reales (hoy: {rollo.metrosDisponibles} m)
          <input type="number" min="0" step="0.01" value={metros} onChange={(e) => setMetros(e.target.value)} />
        </label>
        {cambianMetros && (
          <label>
            Motivo del ajuste *
            <textarea rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. se midió el rollo / conteo físico / los metros eran un estimado por kilos" />
          </label>
        )}
        {error && <p className="rollos-error" role="alert">{error}</p>}
        <div className="rollos-modal-acciones">
          <button type="button" className="rollos-boton-secundario" onClick={alCerrar}>Cancelar</button>
          <button type="submit" className="rollos-boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar corrección"}
          </button>
        </div>
      </form>
    </div>
  );
}
