import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import { formatearFechaColombia } from "../Utils/fechas";

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

type RolloPrestado = {
  rollo_id: number; identificador_rollo: string; codigo_interno: string; descripcion: string;
  metros_disponibles: number; metros_al_salir: number; esta_en: string; vuelve_a: string;
  cotizacion: string; fecha_recibido: string | null; en_traslado: boolean;
};

/** Rollos que una bodega le prestó a otra (traslado tipo "Préstamo"): no
 * vuelven ni se pueden pedir hasta que Admin Inventario los devuelve aquí.
 * Solo aparece si hay alguno. */
export default function PanelRollosPrestados({ alCambiar }: { alCambiar?: () => Promise<void> | void }) {
  const [rollos, setRollos] = useState<RolloPrestado[]>([]);
  const [devolviendo, setDevolviendo] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    try { setRollos((await api.get<RolloPrestado[]>("/admin-inventario/rollos-prestados")) ?? []); } catch { /* se reintenta al recargar */ }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function devolver(r: RolloPrestado) {
    if (!window.confirm(`¿Devolver el rollo ${r.identificador_rollo} a ${r.vuelve_a}? Le quedan ${numero.format(r.metros_disponibles)} m.`)) return;
    setDevolviendo(r.rollo_id); setError(""); setAviso("");
    try {
      await api.post(`/admin-inventario/rollos-prestados/${r.rollo_id}/devolver`, {});
      setAviso(`Listo: el rollo ${r.identificador_rollo} volvió a ${r.vuelve_a}.`);
      await cargar();
      await alCambiar?.();
    } catch (e) {
      setError(e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo devolver el rollo.");
    } finally {
      setDevolviendo(null);
    }
  }

  if (rollos.length === 0 && !aviso) return null;
  return (
    <section className="sincodigo" aria-labelledby="prestados-titulo">
      <header className="sincodigo-cabeza">
        <h2 id="prestados-titulo" className="sincodigo-titulo">
          {rollos.length === 1 ? "1 rollo prestado" : `${rollos.length} rollos prestados`}
        </h2>
        <p className="sincodigo-explica">
          Se prestaron a otra bodega y no vuelven hasta que tú digas. Cuando deba regresar, dale <strong>Devolver</strong>.
        </p>
      </header>
      {aviso && <p className="sincodigo-listo" role="status">{aviso}</p>}
      {error && <p className="sincodigo-error" role="alert" style={{ margin: "0 1.1rem 0.75rem" }}>{error}</p>}
      {rollos.length > 0 && (
        <ul className="sincodigo-lista">
          {rollos.map((r) => (
            <li key={r.rollo_id} className="sincodigo-item">
              <div className="sincodigo-que">
                <p className="sincodigo-descripcion">{r.identificador_rollo} · {r.descripcion}</p>
                <p className="sincodigo-datos">
                  <span>Está en <strong>{r.esta_en}</strong>, es de <strong>{r.vuelve_a}</strong></span>
                  <span><strong>{numero.format(r.metros_disponibles)} m</strong> (salió con {numero.format(r.metros_al_salir)} m)</span>
                  {r.cotizacion && <span>Para la cotización {r.cotizacion}</span>}
                  {r.fecha_recibido && <span>Llegó el {formatearFechaColombia(r.fecha_recibido, false)}</span>}
                </p>
              </div>
              <div className="sincodigo-form">
                <button type="button" className="inventario-boton" disabled={devolviendo !== null || r.en_traslado}
                  title={r.en_traslado ? "Tiene un traslado en curso" : undefined} onClick={() => devolver(r)}>
                  {devolviendo === r.rollo_id ? "Devolviendo..." : `Devolver a ${r.vuelve_a}`}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
