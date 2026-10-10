import { useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";

type Item = {
  id: number; modalidad: string; codigoInterno: string | null; descripcion: string; cantidad: number;
  metrosPendientes: number | null; stockDescontado: boolean;
  rolloId?: number | null; rolloReferencia?: string;
};
type Apartado = { id: number; numeroCotizacion: string; cliente: string; bodegaNombre: string; items: Item[] };
type RolloUsado = { itemId: number; referencia: string; metros: string };

/** Admin Inventario registra la salida de una cotización con la hoja de vida
 * física: por cada línea de rollo, la referencia del rollo usado y los metros
 * (se puede usar más de un rollo por línea); las líneas de producto se
 * descuentan del stock. Todo se guarda junto o nada.
 * Se abre encima de la lista: pantalla completa en celular, ventana en PC
 * (mismos estilos que Separar cotización). */
export default function PanelRegistrarSalida({ apartado: apartadoActual, alTerminar, alCerrar }: {
  apartado: Apartado; alTerminar: () => void; alCerrar: () => void;
}) {
  // La cotización tal como estaba al abrir el panel (la lista de Apartados se
  // refresca sola cada pocos segundos); el backend valida contra lo actual.
  const [apartado] = useState(apartadoActual);
  const lineasRollo = apartado.items.filter((it) => it.modalidad === "por_rollo" && (it.metrosPendientes ?? 0) > 0);
  const lineasStock = apartado.items.filter((it) => it.modalidad === "por_stock" && !it.stockDescontado);
  const [rollos, setRollos] = useState<RolloUsado[]>(
    lineasRollo.map((it) => ({ itemId: it.id, referencia: it.rolloId ? it.rolloReferencia || "" : "", metros: String(it.metrosPendientes ?? "") })),
  );
  const [stock, setStock] = useState<Set<number>>(new Set());
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

  function cambiar(indice: number, campo: "referencia" | "metros", valor: string) {
    setError("");
    setRollos((actual) => actual.map((r, i) => (i === indice ? { ...r, [campo]: valor } : r)));
  }
  function otroRollo(itemId: number) {
    setRollos((actual) => {
      const ultimo = actual.map((r) => r.itemId).lastIndexOf(itemId);
      return [...actual.slice(0, ultimo + 1), { itemId, referencia: "", metros: "" }, ...actual.slice(ultimo + 1)];
    });
  }
  function quitar(indice: number) {
    setRollos((actual) => actual.filter((_, i) => i !== indice));
  }
  function alternarStock(id: number) {
    setError("");
    setStock((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
      return nueva;
    });
  }

  const aEnviar = rollos.filter((r) => r.referencia.trim() && Number(r.metros) > 0);

  async function guardar() {
    if (aEnviar.length === 0 && stock.size === 0) {
      setError("Escribe la referencia del rollo usado en al menos una línea, o marca un producto para descontar.");
      return;
    }
    setGuardando(true); setError("");
    try {
      await api.post(`/apartados/${apartado.id}/registrar-salida`, {
        rollos: aEnviar.map((r) => ({ item_id: r.itemId, referencia: r.referencia.trim(), metros: Number(r.metros) })),
        items_stock: [...stock],
      });
      alTerminar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo registrar la salida.");
    } finally {
      setGuardando(false);
    }
  }

  const titulo = `salida-titulo-${apartado.id}`;
  return (
    <div className="separar-fondo" onClick={alCerrar}>
      <div className="separar-panel" role="dialog" aria-modal="true" aria-labelledby={titulo} onClick={(e) => e.stopPropagation()}>
        <header className="separar-encabezado">
          <div>
            <h3 id={titulo}>Registrar salida {apartado.numeroCotizacion}</h3>
            <p>{apartado.cliente || "Sin cliente"} · {apartado.bodegaNombre}</p>
          </div>
          <button type="button" className="separar-cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
        </header>

        <div className="separar-cuerpo">
          <p className="separar-ayuda">
            Con la hoja de vida física: escribe la <strong>referencia del rollo</strong> que se usó y los metros. Puedes
            dejar líneas en blanco y registrarlas después; la cotización se cierra sola cuando todas tienen salida.
          </p>

          {lineasRollo.length > 0 && (
            <ul className="separar-lineas">
              {lineasRollo.map((it) => {
                const filas = rollos.map((r, indice) => ({ r, indice })).filter(({ r }) => r.itemId === it.id);
                return (
                  <li key={it.id} className="salida-linea">
                    <div className="salida-linea-cabeza">
                      <span className="separar-linea-texto">
                        <span className="separar-linea-codigo">{it.codigoInterno}</span>
                        <span>{it.descripcion}</span>
                      </span>
                      <span className="separar-linea-cantidad">{it.metrosPendientes} m<small>pendientes</small></span>
                    </div>
                    {it.rolloId ? (
                      <p className="salida-rollo-completo">
                        Rollo completo <strong>{it.rolloReferencia}</strong>: sale entero ({it.metrosPendientes} m).
                      </p>
                    ) : filas.map(({ r, indice }, n) => (
                      <div key={indice} className="salida-rollo">
                        <label className="salida-campo salida-campo-referencia">
                          <span>{n === 0 ? "Rollo usado (referencia)" : "Otro rollo"}</span>
                          <input
                            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                            placeholder={`Ej. ${it.codigoInterno}-05`} value={r.referencia}
                            onChange={(e) => cambiar(indice, "referencia", e.target.value)}
                          />
                        </label>
                        <label className="salida-campo salida-campo-metros">
                          <span>Metros</span>
                          <input type="number" inputMode="decimal" min="0" step="0.01" value={r.metros}
                            onChange={(e) => cambiar(indice, "metros", e.target.value)} />
                        </label>
                        {n > 0 && (
                          <button type="button" className="salida-quitar" aria-label="Quitar este rollo" onClick={() => quitar(indice)}>×</button>
                        )}
                      </div>
                    ))}
                    {!it.rolloId && <button type="button" className="salida-otro" onClick={() => otroRollo(it.id)}>+ Se usó otro rollo</button>}
                  </li>
                );
              })}
            </ul>
          )}

          {lineasStock.length > 0 && (
            <>
              <h4 className="salida-subtitulo">Productos de stock</h4>
              <ul className="separar-lineas">
                {lineasStock.map((it) => (
                  <li key={it.id}>
                    <label className={`separar-linea ${stock.has(it.id) ? "separar-linea-elegida" : ""}`}>
                      <input type="checkbox" checked={stock.has(it.id)} onChange={() => alternarStock(it.id)}
                        aria-label={`Descontar ${it.descripcion}`} />
                      <span className="separar-linea-texto">
                        <span className="separar-linea-codigo">Descontar del stock</span>
                        <span>{it.descripcion}</span>
                      </span>
                      <span className="separar-linea-cantidad">{it.cantidad} und</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <footer className="separar-pie">
          <p className="separar-resumen">
            <strong>{aEnviar.length}</strong> rollo{aEnviar.length === 1 ? "" : "s"} y <strong>{stock.size}</strong> producto{stock.size === 1 ? "" : "s"} para registrar
          </p>
          {error && <p className="inventario-error separar-error">{error}</p>}
          <div className="separar-botones">
            <button type="button" className="inventario-boton-cancelar" onClick={alCerrar}>Cancelar</button>
            <button type="button" className="inventario-boton" disabled={guardando} onClick={guardar}>
              {guardando ? "Guardando..." : "Registrar salida"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
