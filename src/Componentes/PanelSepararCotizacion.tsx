import { useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";

type Item = {
  id: number; modalidad: string; codigoInterno: string | null; descripcion: string; cantidad: number;
  medida: number | null; metrosRequeridos: number | null; metrosConsumidos: number;
  stockDescontado: boolean; tieneProduccionRegistrada: boolean;
};
type Apartado = { id: number; numeroCotizacion: string; cliente: string; bodegaNombre: string; estado: string; items: Item[] };

const conSalida = (it: Item) => it.metrosConsumidos > 0.005 || it.stockDescontado || it.tieneProduccionRegistrada;

/** El cliente no se lleva todo (o el carro solo se lleva una parte): lo que
 * NO sale ahora pasa a una cotización nueva (con el número que se escriba
 * aquí), completo o solo una parte de cada línea; lo demás se queda en la
 * original. Antes de terminar la producción, las líneas con salida no se
 * pueden pasar; ya producida, sí (la nueva queda producida, para darle
 * Salida en otro viaje). Ver backend separar_apartado.
 * Se abre encima de la lista: pantalla completa en celular, ventana en PC. */
export default function PanelSepararCotizacion({ apartado: apartadoActual, alTerminar, alCerrar }: {
  apartado: Apartado; alTerminar: (numeroNueva: string) => void; alCerrar: () => void;
}) {
  // La cotización tal como estaba al abrir el panel (la lista se refresca sola).
  const [apartado] = useState(apartadoActual);
  const producida = apartado.estado === "produccion_terminada";
  // Línea marcada -> cantidad que pasa a la nueva (texto del campo; por defecto, toda).
  const [elegidas, setElegidas] = useState<Map<number, string>>(new Map());
  const [numero, setNumero] = useState("");
  const [cliente, setCliente] = useState(apartado.cliente);
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

  function alternar(it: Item) {
    setError("");
    setElegidas((actual) => {
      const nueva = new Map(actual);
      if (nueva.has(it.id)) nueva.delete(it.id); else nueva.set(it.id, String(it.cantidad));
      return nueva;
    });
  }
  function cambiarCantidad(id: number, valor: string) {
    setError("");
    setElegidas((actual) => new Map(actual).set(id, valor));
  }

  const cantidadDe = (id: number) => Number((elegidas.get(id) || "").replace(",", "."));
  // Se quedan en la original las líneas sin marcar o marcadas solo en parte.
  const quedan = apartado.items.filter((it) => !elegidas.has(it.id) || cantidadDe(it.id) < it.cantidad).length;

  async function guardar() {
    if (elegidas.size === 0) {
      setError(producida ? "Marca lo que NO se lleva en este viaje." : "Marca las líneas que el cliente NO se lleva.");
      return;
    }
    const mala = apartado.items.find((it) => elegidas.has(it.id) && !(cantidadDe(it.id) > 0 && cantidadDe(it.id) <= it.cantidad));
    if (mala) { setError(`La cantidad de "${mala.descripcion}" debe ser mayor que 0 y máximo ${mala.cantidad}.`); return; }
    if (quedan === 0) { setError("Deja algo en la cotización original."); return; }
    if (!numero.trim()) { setError("Escribe el número de la cotización nueva."); return; }
    setGuardando(true); setError("");
    try {
      await api.post(`/apartados/${apartado.id}/separar`, {
        lineas: [...elegidas.keys()].map((id) => ({ item_id: id, cantidad: cantidadDe(id) })),
        numero_cotizacion: numero.trim(), cliente: cliente.trim(),
      });
      alTerminar(numero.trim());
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo separar la cotización.");
    } finally {
      setGuardando(false);
    }
  }

  const titulo = `separar-titulo-${apartado.id}`;
  return (
    <div className="separar-fondo" onClick={alCerrar}>
      <div className="separar-panel" role="dialog" aria-modal="true" aria-labelledby={titulo} onClick={(e) => e.stopPropagation()}>
        <header className="separar-encabezado">
          <div>
            <h3 id={titulo}>Separar cotización {apartado.numeroCotizacion}</h3>
            <p>{apartado.cliente || "Sin cliente"} · {apartado.bodegaNombre}</p>
          </div>
          <button type="button" className="separar-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
        </header>

        <div className="separar-cuerpo">
          <p className="separar-ayuda">
            {producida ? (
              <>Toca lo que <strong>no se lleva en este viaje</strong> y cuánto: pasa a una cotización nueva, ya
              producida, para darle Salida cuando venga el otro carro. Lo demás se queda en la {apartado.numeroCotizacion}.</>
            ) : (
              <>Toca las líneas que el cliente <strong>no se lleva</strong> y cuánto: pasan a una cotización nueva y su
              material sigue apartado. Lo demás se queda en la {apartado.numeroCotizacion}.</>
            )}
          </p>

          <ul className="separar-lineas">
            {apartado.items.map((it) => {
              const bloqueada = !producida && conSalida(it);
              const elegida = elegidas.has(it.id);
              return (
                <li key={it.id} className="separar-item">
                  <label className={`separar-linea ${elegida ? "separar-linea-elegida" : ""} ${bloqueada ? "separar-linea-bloqueada" : ""}`}>
                    <input
                      type="checkbox" disabled={bloqueada} checked={elegida} onChange={() => alternar(it)}
                      aria-label={`Pasar ${it.descripcion || it.codigoInterno}`}
                    />
                    <span className="separar-linea-texto">
                      <span className="separar-linea-codigo">{it.codigoInterno || "Producto de stock"}</span>
                      <span>{it.descripcion}</span>
                      {bloqueada && <span className="separar-linea-nota">Ya tuvo salida: se queda en la {apartado.numeroCotizacion}</span>}
                    </span>
                    <span className="separar-linea-cantidad">
                      {it.modalidad === "por_rollo" ? `${it.metrosRequeridos ?? 0} m` : `${it.cantidad} und`}
                    </span>
                  </label>
                  {elegida && (
                    <div className="separar-cantidad">
                      <label htmlFor={`separar-cant-${it.id}`}>¿Cuántas pasan a la nueva?</label>
                      <span className="separar-cantidad-control">
                        <input
                          id={`separar-cant-${it.id}`} type="number" inputMode="decimal" min="0" max={it.cantidad} step="any"
                          value={elegidas.get(it.id)} onChange={(e) => cambiarCantidad(it.id, e.target.value)}
                        />
                        <span>de {it.cantidad}</span>
                      </span>
                      {cantidadDe(it.id) > 0 && cantidadDe(it.id) < it.cantidad && (
                        <span className="separar-cantidad-nota">
                          Quedan {Math.round((it.cantidad - cantidadDe(it.id)) * 100) / 100} en la {apartado.numeroCotizacion}
                          {it.medida ? ` · pasan ${Math.round(cantidadDe(it.id) * it.medida * 100) / 100} m` : ""}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="separar-campos">
            <label>
              <span>Número de la cotización nueva *</span>
              <input maxLength={32} placeholder="Ej. 3901-AR" value={numero}
                onChange={(e) => { setNumero(e.target.value); setError(""); }} />
            </label>
            <label>
              <span>Cliente de la nueva</span>
              <input maxLength={150} value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </label>
          </div>
        </div>

        <footer className="separar-pie">
          <p className="separar-resumen">
            <strong>{elegidas.size}</strong> pasa{elegidas.size === 1 ? "" : "n"} a la nueva ·{" "}
            <strong>{quedan}</strong> se queda{quedan === 1 ? "" : "n"}
          </p>
          {error && <p className="inventario-error separar-error">{error}</p>}
          <div className="separar-botones">
            <button type="button" className="inventario-boton-cancelar" onClick={alCerrar}>Cancelar</button>
            <button type="button" className="inventario-boton" disabled={guardando} onClick={guardar}>
              {guardando ? "Separando..." : "Separar cotización"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
