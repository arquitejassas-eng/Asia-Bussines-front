import { useState } from "react";
import { api, ErrorApi } from "./Api";

type RolloPrestado = { id: number; codigo: string; referencia_rollo: string; cantidad: number; prestador: string; kilos_rollo: number | null };

const numero = (texto: string) => Number(texto.replace(",", "."));

/** Devolver un rollo prestado a una empresa externa: siempre lo pagan con
 * OTRO rollo (nunca vuelve el mismo). Ese rollo entra a la bodega con sus
 * kilos y queda el cuadre de kilos para facturar la diferencia. */
export default function ModalDevolverRolloPrestado({ prestamo, alCerrar, alGuardar }: {
  prestamo: RolloPrestado; alCerrar: () => void; alGuardar: (mensaje: string) => void;
}) {
  const [codigo, setCodigo] = useState(prestamo.codigo);
  const [referencia, setReferencia] = useState("");
  const [kilos, setKilos] = useState("");
  const [metros, setMetros] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const kilosPrestados = prestamo.kilos_rollo;
  const kilosVuelven = numero(kilos);
  const diferencia = kilosPrestados != null && kilosVuelven > 0 ? Math.round((kilosPrestados - kilosVuelven) * 10) / 10 : null;

  async function guardar(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    setError("");
    try {
      if (!codigo.trim() || !referencia.trim()) { setError("Escribe el código y la referencia del rollo que devolvieron."); return; }
      if (!(kilosVuelven > 0)) { setError("Escribe los kilos del rollo que devolvieron (los de la etiqueta)."); return; }
      if (!(numero(metros) > 0)) { setError("Escribe los metros del rollo que devolvieron."); return; }
      setGuardando(true);
      await api.post(`/prestamos/${prestamo.id}/devolver-otro-rollo`, {
        codigo_interno: codigo.trim(), referencia: referencia.trim(), kilos: kilosVuelven, metros: numero(metros),
      });
      alGuardar(`Listo: entró el rollo ${referencia.trim().toUpperCase()} (${kilosVuelven.toLocaleString("es-CO")} kg)`
        + (diferencia != null && diferencia >= 1 ? `. ${prestamo.prestador} nos debe ${diferencia.toLocaleString("es-CO")} kg (por facturar): míralo en «Cuadre de rollos prestados».`
          : diferencia != null && diferencia <= -1 ? `. Le debemos ${Math.abs(diferencia).toLocaleString("es-CO")} kg a ${prestamo.prestador}: míralo en «Cuadre de rollos prestados».` : "."));
    } catch (e) {
      setError(e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo registrar la devolución.");
      setGuardando(false);
    }
  }

  return (
    <div className="rollos-modal-fondo" onClick={alCerrar}>
      <form className="rollos-modal" role="dialog" aria-modal="true" aria-labelledby="devolver-rollo-titulo"
        onClick={(e) => e.stopPropagation()} onSubmit={guardar} noValidate
        style={{ maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}>
        <h3 id="devolver-rollo-titulo">¿Con qué rollo pagaron el {prestamo.referencia_rollo}?</h3>
        <p className="rollos-texto-ayuda">
          Se le prestó a <strong>{prestamo.prestador}</strong>: {prestamo.cantidad} m de {prestamo.codigo}
          {kilosPrestados != null ? <> · <strong>{kilosPrestados.toLocaleString("es-CO")} kg</strong></> : " (sin kilos en la etiqueta)"}.
        </p>
            <label>
              Código del rollo que devolvieron *
              <input value={codigo} maxLength={60} placeholder="Ej. LR30020,25" onChange={(e) => setCodigo(e.target.value)} />
            </label>
            <label>
              Referencia (la de la etiqueta) *
              <input value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} />
            </label>
            <label>
              Kilos (etiqueta) *
              <input type="number" min="0" step="any" value={kilos} onChange={(e) => setKilos(e.target.value)} />
            </label>
            <label>
              Metros *
              <input type="number" min="0" step="0.01" value={metros} onChange={(e) => setMetros(e.target.value)}
                placeholder="Con la tabla de equivalencias" />
            </label>
            {diferencia != null && (
              <p className="rollos-texto-ayuda" role="status">
                {Math.abs(diferencia) < 1 ? "Kilos completos: queda cuadrado."
                  : diferencia > 0 ? <><strong>Devuelven {diferencia.toLocaleString("es-CO")} kg menos</strong>: nos deben {diferencia.toLocaleString("es-CO")} kg (por facturar).</>
                  : <><strong>Devuelven {Math.abs(diferencia).toLocaleString("es-CO")} kg de más</strong>: les debemos {Math.abs(diferencia).toLocaleString("es-CO")} kg.</>}
              </p>
            )}
            <p className="rollos-texto-ayuda">El rollo entra a la bodega donde estaba el prestado, a nombre de la empresa que prestó.</p>
        {error && <p className="rollos-error" role="alert">{error}</p>}
        <div className="rollos-modal-acciones">
          <button type="button" className="rollos-boton-secundario" onClick={alCerrar}>Cancelar</button>
          <button type="submit" className="rollos-boton-primario" disabled={guardando}>{guardando ? "Guardando..." : "Guardar devolución"}</button>
        </div>
      </form>
    </div>
  );
}
