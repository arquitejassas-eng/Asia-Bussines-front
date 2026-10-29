import { useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";

type Produccion = {
  id: number | string; codigoUnico: string; cotizacion?: string; totalMetrosConsumidos: number;
  rollosUtilizados: { rolloId: number; identificadorRollo: string; metrosConsumidos: number }[];
};

/** Admin Inventario corrige los metros mal digitados de una producción (ej.
 * 140 m en vez de 40): la diferencia vuelve a cada rollo como "Corrección de
 * producción" (no es sobrante ni merma). Ver backend corregir_metros_produccion.
 * Se abre encima de la Hoja de Vida: pantalla completa en celular, ventana en PC. */
export default function PanelCorregirProduccion({ produccion, alTerminar, alCerrar }: {
  produccion: Produccion; alTerminar: (mensaje: string) => void; alCerrar: () => void;
}) {
  // Metros reales de cada rollo (texto del campo); por defecto, lo registrado.
  const [metros, setMetros] = useState<Record<number, string>>(() =>
    Object.fromEntries(produccion.rollosUtilizados.map((r) => [r.rolloId, String(r.metrosConsumidos)])));
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // Mientras está abierto, la página de atrás no se desplaza y Esc lo cierra.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const alPresionar = (evento: KeyboardEvent) => { if (evento.key === "Escape") alCerrar(); };
    window.addEventListener("keydown", alPresionar);
    return () => { document.body.style.overflow = anterior; window.removeEventListener("keydown", alPresionar); };
  }, [alCerrar]);

  const real = (rolloId: number) => Number((metros[rolloId] || "").replace(",", "."));
  const vuelven = Math.round(produccion.rollosUtilizados.reduce(
    (suma, r) => suma + Math.max(0, r.metrosConsumidos - (real(r.rolloId) || 0)), 0) * 100) / 100;

  async function guardar() {
    const mal = produccion.rollosUtilizados.find((r) => !(real(r.rolloId) >= 0) || real(r.rolloId) > r.metrosConsumidos);
    if (mal) { setError(`Los metros del rollo ${mal.identificadorRollo} deben ser entre 0 y ${mal.metrosConsumidos}.`); return; }
    if (vuelven <= 0) { setError("Escribe los metros que de verdad salieron: deben ser menos de los registrados."); return; }
    setGuardando(true); setError("");
    try {
      await api.post(`/produccion/${produccion.id}/corregir-metros`, {
        rollos: produccion.rollosUtilizados.map((r) => ({ rollo_id: r.rolloId, metros: real(r.rolloId) })),
        observaciones: observaciones.trim(),
      });
      alTerminar(`Listo: ${vuelven} m volvieron al rollo y la producción ${produccion.codigoUnico} quedó corregida.`);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo corregir la producción.");
    } finally {
      setGuardando(false);
    }
  }

  const titulo = `corregir-titulo-${produccion.id}`;
  return (
    <div className="separar-fondo" onClick={alCerrar}>
      <div className="separar-panel" role="dialog" aria-modal="true" aria-labelledby={titulo} onClick={(e) => e.stopPropagation()}>
        <header className="separar-encabezado">
          <div>
            <h3 id={titulo}>Corregir metros</h3>
            <p>{produccion.codigoUnico} · cotización {produccion.cotizacion || "—"} · {produccion.totalMetrosConsumidos} m registrados</p>
          </div>
          <button type="button" className="separar-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
        </header>

        <div className="separar-cuerpo">
          <p className="separar-ayuda">
            Escribe los metros que <strong>de verdad salieron</strong> de cada rollo. La diferencia vuelve al rollo como
            <strong> corrección de producción</strong> (no cuenta como sobrante ni como merma) y queda en su historial.
          </p>
          <div className="separar-campos">
            {produccion.rollosUtilizados.map((r) => (
              <label key={r.rolloId}>
                <span>Rollo {r.identificadorRollo} · registrados {r.metrosConsumidos} m</span>
                <input type="number" inputMode="decimal" min="0" max={r.metrosConsumidos} step="any"
                  value={metros[r.rolloId] ?? ""}
                  onChange={(e) => { setMetros((actual) => ({ ...actual, [r.rolloId]: e.target.value })); setError(""); }} />
              </label>
            ))}
            <label>
              <span>Motivo (opcional)</span>
              <input maxLength={300} placeholder="Ej. se digitó 140 en vez de 40" value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)} />
            </label>
          </div>
        </div>

        <footer className="separar-pie">
          <p className="separar-resumen">
            {vuelven > 0 ? <>Vuelven <strong>{vuelven} m</strong> al rollo</> : "Escribe los metros reales"}
          </p>
          {error && <p className="inventario-error separar-error">{error}</p>}
          <div className="separar-botones">
            <button type="button" className="inventario-boton-cancelar" onClick={alCerrar}>Cancelar</button>
            <button type="button" className="inventario-boton" disabled={guardando} onClick={guardar}>
              {guardando ? "Corrigiendo..." : "Corregir metros"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
