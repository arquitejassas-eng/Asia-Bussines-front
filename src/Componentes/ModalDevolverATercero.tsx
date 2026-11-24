import { useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";

type Prestamo = { id: number; codigo: string; referencia_rollo: string; cantidad: number; prestador: string; kilos_rollo: number | null };
type Candidato = { id: number; referencia: string; codigo: string; empresa: string; bodega_id: number | null; metros: number; kilos: number | null; es_el_mismo: boolean };

const kg = (v: number) => `${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} kg`;

/** Le devolvemos a la empresa de afuera el rollo que NOS prestó (el mismo o
 * otro rollo de la empresa que debe). El rollo escogido sale del inventario y
 * queda el cuadre de kilos: si entregamos menos, les debemos la diferencia. */
export default function ModalDevolverATercero({ prestamo, nombreBodega, alCerrar, alGuardar }: {
  prestamo: Prestamo; nombreBodega: (id: number | null) => string;
  alCerrar: () => void; alGuardar: (mensaje: string) => void;
}) {
  const [buscar, setBuscar] = useState("");
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [escogido, setEscogido] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vigente = true;
    const espera = setTimeout(() => {
      api.get<Candidato[]>(`/prestamos/${prestamo.id}/rollos-para-devolver${buscar.trim() ? `?buscar=${encodeURIComponent(buscar.trim())}` : ""}`)
        .then((lista) => {
          if (!vigente) return;
          setCandidatos(lista || []);
          // Si todavía está el mismo rollo que nos prestaron, queda escogido de una vez.
          setEscogido((actual) => actual ?? (lista || []).find((c) => c.es_el_mismo)?.id ?? null);
        })
        .catch((e) => { if (vigente) setError(e instanceof ErrorApi ? e.message : "No se pudieron cargar los rollos."); });
    }, buscar ? 300 : 0);
    return () => { vigente = false; clearTimeout(espera); };
  }, [buscar, prestamo.id]);

  const rollo = candidatos?.find((c) => c.id === escogido) || null;
  const prestados = prestamo.kilos_rollo;
  // > 0: entregamos más kilos (nos deben). < 0: entregamos menos (les debemos).
  const diferencia = rollo?.kilos != null && prestados != null ? Math.round((rollo.kilos - prestados) * 10) / 10 : null;

  async function guardar() {
    if (!rollo) { setError("Escoge el rollo que le entregas."); return; }
    setGuardando(true);
    setError("");
    try {
      await api.post(`/prestamos/${prestamo.id}/devolver-a-tercero`, { rollo_id: rollo.id });
      alGuardar(`Listo: el rollo ${rollo.referencia} salió para ${prestamo.prestador}`
        + (diferencia != null && diferencia <= -1 ? `. Le quedamos debiendo ${kg(-diferencia)}: míralo en «Rollos prestados afuera».`
          : diferencia != null && diferencia >= 1 ? `. ${prestamo.prestador} nos debe ${kg(diferencia)}: míralo en «Rollos prestados afuera».` : "."));
    } catch (e) {
      setError(e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo registrar la devolución.");
      setGuardando(false);
    }
  }

  return (
    <div className="rollos-modal-fondo" onClick={alCerrar}>
      <div className="rollos-modal" role="dialog" aria-modal="true" aria-labelledby="devolver-tercero-titulo"
        onClick={(e) => e.stopPropagation()} style={{ maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}>
        <h3 id="devolver-tercero-titulo">Devolverle a {prestamo.prestador}</h3>
        <p className="rollos-texto-ayuda">
          Nos prestó el rollo <strong>{prestamo.referencia_rollo}</strong> ({prestamo.codigo})
          {prestados != null ? <> de <strong>{kg(prestados)}</strong></> : " (sin kilos en la etiqueta)"}.
          Escoge con qué rollo le pagas: <strong>sale completo</strong> del inventario.
        </p>
        <label>
          Buscar otro rollo
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)}
            placeholder={`Referencia o código (vacío = ${prestamo.codigo})`} />
        </label>
        {candidatos === null ? <p className="rollos-texto-ayuda">Buscando rollos...</p>
          : candidatos.length === 0 ? <p className="rollos-texto-ayuda">Ningún rollo con metros coincide.</p>
          : (
            <div className="devolver-tercero-lista" role="radiogroup" aria-label="Rollo que se entrega">
              {candidatos.map((c) => (
                <label key={c.id} className={escogido === c.id ? "activo" : ""}>
                  <input type="radio" name="rollo-devolver" checked={escogido === c.id} onChange={() => setEscogido(c.id)} />
                  <span>
                    <strong>{c.referencia}</strong>{c.es_el_mismo && <span className="prestamos-etiqueta">El mismo que nos prestó</span>}
                    <small>{c.codigo} · {nombreBodega(c.bodega_id)} · {c.metros.toLocaleString("es-CO")} m{c.kilos != null ? ` · ${kg(c.kilos)}` : ""}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
        {rollo && diferencia != null && (
          <p className={`devolver-tercero-cuadre ${Math.abs(diferencia) < 1 ? "ok" : "alerta"}`} role="status">
            {Math.abs(diferencia) < 1 ? "✓ Cuadra en kilos."
              : diferencia < 0 ? `Le entregas ${kg(-diferencia)} menos: le quedamos debiendo esa diferencia.`
              : `Le entregas ${kg(diferencia)} de más: ${prestamo.prestador} nos queda debiendo esa diferencia.`}
          </p>
        )}
        {error && <p className="rollos-error" role="alert">{error}</p>}
        <div className="rollos-modal-acciones">
          <button type="button" className="rollos-boton-secundario" onClick={alCerrar}>Cancelar</button>
          <button type="button" className="rollos-boton-primario" disabled={!rollo || guardando} onClick={guardar}>
            {guardando ? "Guardando..." : rollo ? `Entregar ${rollo.referencia}` : "Escoge un rollo"}
          </button>
        </div>
      </div>
    </div>
  );
}
