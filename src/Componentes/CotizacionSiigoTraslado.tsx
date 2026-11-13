import { useState } from "react";
import { api, ErrorApi } from "./Api";

type CotizacionSiigo = {
  numero: string; fecha: string; cliente: string; cliente_identificacion: string; total: number | null; enlace: string;
  items: { codigo: string; descripcion: string; cantidad: number | null }[];
};

async function buscar(empresa: string, numero: string): Promise<CotizacionSiigo | null> {
  return api.get<CotizacionSiigo>(`/apartados/cotizacion-siigo?empresa=${encodeURIComponent(empresa)}&numero=${encodeURIComponent(numero)}`);
}

/** Lo que dice la cotización de Siigo: cliente, líneas y total. */
function DetalleCotizacionSiigo({ cotizacion }: { cotizacion: CotizacionSiigo }) {
  return (
    <div className="inventario-tabla-contenedor" style={{ marginTop: "0.5rem" }}>
      <p style={{ margin: "0 0 0.4rem" }}>
        <strong>{cotizacion.numero}</strong> · {cotizacion.fecha} · {cotizacion.cliente || cotizacion.cliente_identificacion || "Sin cliente"}
        {cotizacion.total != null && <> · Total {cotizacion.total.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}</>}
        {cotizacion.enlace && <> · <a href={cotizacion.enlace} target="_blank" rel="noreferrer">Abrir en Siigo</a></>}
      </p>
      <table className="inventario-tabla">
        <thead><tr><th>Código Siigo</th><th>Descripción</th><th>Cantidad</th></tr></thead>
        <tbody>
          {cotizacion.items.map((it, i) => (
            <tr key={`${it.codigo}-${i}`}>
              <td>{it.codigo}</td>
              <td>{it.descripcion}</td>
              <td>{it.cantidad != null ? it.cantidad.toLocaleString("es-CO") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Formulario del traslado a San Gil: el número de la cotización que se hizo
 * directo en Siigo y el botón para verla mientras se arma el traslado. */
export function CampoCotizacionSiigoTraslado({ empresa, numero, alCambiar }: { empresa: string; numero: string; alCambiar: (valor: string) => void }) {
  const [cotizacion, setCotizacion] = useState<CotizacionSiigo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function ver() {
    setError("");
    setCotizacion(null);
    if (!empresa) { setError("Elige primero de qué empresa es el material."); return; }
    if (!numero.trim()) { setError("Escribe el número de la cotización de Siigo."); return; }
    setCargando(true);
    try {
      setCotizacion(await buscar(empresa, numero.trim()));
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo consultar Siigo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <label htmlFor="traslado-siigo">Cotización en Siigo</label>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input id="traslado-siigo" maxLength={30} placeholder="Ej. 4140 o C-1-4140" value={numero} style={{ maxWidth: 220 }}
          onChange={(e) => { alCambiar(e.target.value); setCotizacion(null); setError(""); }} />
        <button type="button" className="apartados-limpiar" onClick={ver} disabled={cargando}>
          {cargando ? "Buscando en Siigo..." : "Ver en Siigo"}
        </button>
      </div>
      <p className="rollos-texto-ayuda" style={{ margin: "0.3rem 0 0" }}>
        La que se hizo directo en Siigo para este material. Queda escrita en el traslado y se puede ver desde la lista.
      </p>
      {error && <p className="inventario-error">{error}</p>}
      {cotizacion && <DetalleCotizacionSiigo cotizacion={cotizacion} />}
    </div>
  );
}

/** En la lista: la etiqueta "Siigo C-1-4140" de un traslado abre lo que dice esa cotización. */
export function VerCotizacionSiigoTraslado({ empresa, numero }: { empresa: string; numero: string }) {
  const [abierta, setAbierta] = useState(false);
  const [cotizacion, setCotizacion] = useState<CotizacionSiigo | null>(null);
  const [error, setError] = useState("");

  async function abrir() {
    setAbierta(true);
    if (cotizacion) return;
    setError("");
    try {
      setCotizacion(await buscar(empresa, numero));
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo consultar Siigo.");
    }
  }

  return (
    <>
      <button type="button" className="siigo-etiqueta" style={{ cursor: "pointer", border: "none" }} onClick={abrir}
        title="Ver la cotización de Siigo de este traslado">
        Siigo {numero}
      </button>
      {abierta && (
        <div className="rollos-modal-fondo" onClick={() => setAbierta(false)}>
          <div className="rollos-modal rollos-modal--ancho" onClick={(e) => e.stopPropagation()}>
            <h3>Cotización {numero} de Siigo</h3>
            {error ? <p className="inventario-error">{error}</p>
              : cotizacion ? <DetalleCotizacionSiigo cotizacion={cotizacion} /> : <p className="inventario-cargando">Buscando en Siigo...</p>}
            <div className="rollos-modal-acciones">
              <button type="button" className="rollos-boton-secundario" onClick={() => setAbierta(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
