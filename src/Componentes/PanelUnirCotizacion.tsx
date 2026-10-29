import { useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";

type Item = { id: number; codigoInterno: string | null; descripcion: string };
type Apartado = { id: number; numeroCotizacion: string; cliente: string; bodegaNombre: string; items: Item[] };

/** Lo contrario de Separar: otra cotización de la misma bodega, empresa y
 * estado pasa sus líneas a esta, con lo que ya se produjo y gastó (no se
 * produce ni se descuenta nada de nuevo), y queda anulada con una nota. Ver
 * backend unir_apartado. Las candidatas son las de la lista que cumplen eso;
 * si la otra no está cargada en la lista, se escribe su número.
 * Se abre encima de la lista: pantalla completa en celular, ventana en PC. */
export default function PanelUnirCotizacion({ apartado: apartadoActual, candidatas, alTerminar, alCerrar }: {
  apartado: Apartado; candidatas: Apartado[]; alTerminar: (numeroUnida: string) => void; alCerrar: () => void;
}) {
  // Como estaban al abrir el panel (la lista se refresca sola).
  const [apartado] = useState(apartadoActual);
  const [opciones] = useState(candidatas);
  const [numero, setNumero] = useState(candidatas.length === 1 ? candidatas[0].numeroCotizacion : "");
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

  const elegida = opciones.find((op) => op.numeroCotizacion.trim().toUpperCase() === numero.trim().toUpperCase());

  async function guardar() {
    if (!numero.trim()) { setError("Escoge o escribe la cotización que se une a esta."); return; }
    setGuardando(true); setError("");
    try {
      await api.post(`/apartados/${apartado.id}/unir`, { numero_cotizacion: numero.trim() });
      alTerminar(numero.trim());
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron unir las cotizaciones.");
    } finally {
      setGuardando(false);
    }
  }

  const titulo = `unir-titulo-${apartado.id}`;
  return (
    <div className="separar-fondo" onClick={alCerrar}>
      <div className="separar-panel" role="dialog" aria-modal="true" aria-labelledby={titulo} onClick={(e) => e.stopPropagation()}>
        <header className="separar-encabezado">
          <div>
            <h3 id={titulo}>Unir a la cotización {apartado.numeroCotizacion}</h3>
            <p>{apartado.cliente || "Sin cliente"} · {apartado.bodegaNombre} · {apartado.items.length} línea{apartado.items.length === 1 ? "" : "s"}</p>
          </div>
          <button type="button" className="separar-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
        </header>

        <div className="separar-cuerpo">
          <p className="separar-ayuda">
            Escoge la cotización que se une a la <strong>{apartado.numeroCotizacion}</strong>. Sus líneas pasan aquí con lo
            que ya se produjo y los metros que ya se gastaron: <strong>no se produce ni se descuenta nada de nuevo</strong>.
            La otra queda anulada con una nota que dice a dónde se unió.
          </p>

          {opciones.length > 0 && (
            <ul className="separar-lineas">
              {opciones.map((op) => {
                const marcada = elegida?.id === op.id;
                return (
                  <li key={op.id} className="separar-item">
                    <label className={`separar-linea ${marcada ? "separar-linea-elegida" : ""}`}>
                      <input type="radio" name={`unir-${apartado.id}`} checked={marcada}
                        onChange={() => { setNumero(op.numeroCotizacion); setError(""); }} />
                      <span className="separar-linea-texto">
                        <span className="separar-linea-codigo">Cotización {op.numeroCotizacion}</span>
                        <span>{op.cliente || "Sin cliente"}</span>
                        {marcada && op.items.map((it) => (
                          <span key={it.id} className="separar-linea-nota">{it.codigoInterno ? `${it.codigoInterno} · ` : ""}{it.descripcion}</span>
                        ))}
                      </span>
                      <span className="separar-linea-cantidad">{op.items.length} línea{op.items.length === 1 ? "" : "s"}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="separar-campos">
            <label>
              <span>{opciones.length > 0 ? "O escribe su número" : "Número de la cotización que se une *"}</span>
              <input maxLength={32} placeholder="Ej. 4028" value={numero}
                onChange={(e) => { setNumero(e.target.value); setError(""); }} />
            </label>
          </div>
          <p className="separar-ayuda">
            Las dos deben ser de la misma bodega y empresa y estar en el mismo estado (por ejemplo, las dos con
            producción terminada).
          </p>
        </div>

        <footer className="separar-pie">
          <p className="separar-resumen">
            {numero.trim()
              ? <>La <strong>{numero.trim()}</strong> pasa a la <strong>{apartado.numeroCotizacion}</strong> y queda anulada</>
              : "Escoge la cotización que se une"}
          </p>
          {error && <p className="inventario-error separar-error">{error}</p>}
          <div className="separar-botones">
            <button type="button" className="inventario-boton-cancelar" onClick={alCerrar}>Cancelar</button>
            <button type="button" className="inventario-boton" disabled={guardando} onClick={guardar}>
              {guardando ? "Uniendo..." : "Unir cotizaciones"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
