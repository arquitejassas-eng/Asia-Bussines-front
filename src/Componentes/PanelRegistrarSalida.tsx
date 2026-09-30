import { useState } from "react";
import { api, ErrorApi } from "./Api";

type Item = {
  id: number; modalidad: string; codigoInterno: string | null; descripcion: string; cantidad: number;
  metrosPendientes: number | null; stockDescontado: boolean;
};
type Apartado = { id: number; numeroCotizacion: string; bodegaNombre: string; items: Item[] };
type RolloUsado = { itemId: number; referencia: string; metros: string };

/** Admin Inventario registra la salida de una cotización con la hoja de vida
 * física: por cada línea de rollo, la referencia del rollo usado y los metros
 * (se puede usar más de un rollo por línea); las líneas de producto se
 * descuentan del stock. Todo se guarda junto o nada. */
export default function PanelRegistrarSalida({ apartado, alTerminar, alCerrar }: {
  apartado: Apartado; alTerminar: () => void; alCerrar: () => void;
}) {
  const lineasRollo = apartado.items.filter((it) => it.modalidad === "por_rollo" && (it.metrosPendientes ?? 0) > 0);
  const lineasStock = apartado.items.filter((it) => it.modalidad === "por_stock" && !it.stockDescontado);
  const [rollos, setRollos] = useState<RolloUsado[]>(
    lineasRollo.map((it) => ({ itemId: it.id, referencia: "", metros: String(it.metrosPendientes ?? "") })),
  );
  const [stock, setStock] = useState<Set<number>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  function cambiar(indice: number, campo: "referencia" | "metros", valor: string) {
    setRollos((actual) => actual.map((r, i) => (i === indice ? { ...r, [campo]: valor } : r)));
  }
  function otroRollo(itemId: number, indice: number) {
    setRollos((actual) => [...actual.slice(0, indice + 1), { itemId, referencia: "", metros: "" }, ...actual.slice(indice + 1)]);
  }
  function quitar(indice: number) {
    setRollos((actual) => actual.filter((_, i) => i !== indice));
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

  return (
    <div className="inventario-form" style={{ margin: "0.5rem 0" }}>
      <h3 className="inventario-form-subtitulo" style={{ marginTop: 0 }}>
        Registrar salida — cotización {apartado.numeroCotizacion} ({apartado.bodegaNombre})
      </h3>
      <p className="inventario-carga-ayuda">
        Con la hoja de vida física: escribe la referencia del rollo que se usó y los metros. Puedes dejar líneas en
        blanco y registrarlas después; la cotización se cierra sola cuando todas sus líneas tienen salida.
      </p>
      {rollos.length > 0 && (
        <table className="inventario-tabla">
          <thead><tr><th>Línea</th><th>Pendiente</th><th>Referencia del rollo usado</th><th>Metros</th><th></th></tr></thead>
          <tbody>
            {rollos.map((r, indice) => {
              const item = lineasRollo.find((it) => it.id === r.itemId)!;
              const primera = rollos.findIndex((x) => x.itemId === r.itemId) === indice;
              return (
                <tr key={indice}>
                  <td>{primera ? <><strong>{item.codigoInterno}</strong> — {item.descripcion}</> : "↳ otro rollo"}</td>
                  <td>{primera ? `${item.metrosPendientes} m` : ""}</td>
                  <td>
                    <input
                      aria-label={`Referencia ${item.codigoInterno} ${indice}`}
                      placeholder={`Ej. ${item.codigoInterno}-05`}
                      value={r.referencia}
                      onChange={(e) => cambiar(indice, "referencia", e.target.value)}
                    />
                  </td>
                  <td>
                    <input type="number" min="0" step="0.01" style={{ maxWidth: 110 }}
                      aria-label={`Metros ${item.codigoInterno} ${indice}`}
                      value={r.metros} onChange={(e) => cambiar(indice, "metros", e.target.value)} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="inventario-boton-cancelar" onClick={() => otroRollo(r.itemId, indice)}>+ otro rollo</button>
                    {!primera && <button type="button" className="inventario-boton-cancelar" onClick={() => quitar(indice)}>Quitar</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {lineasStock.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <strong>Productos de stock</strong>
          {lineasStock.map((it) => (
            <label key={it.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.25rem 0" }}>
              <input type="checkbox" style={{ width: "auto" }} checked={stock.has(it.id)}
                onChange={() => setStock((actual) => {
                  const nueva = new Set(actual);
                  if (nueva.has(it.id)) nueva.delete(it.id); else nueva.add(it.id);
                  return nueva;
                })} />
              Descontar {it.cantidad} × {it.descripcion}
            </label>
          ))}
        </div>
      )}
      {error && <p className="inventario-error">{error}</p>}
      <div className="inventario-form-botones">
        <button type="button" className="inventario-boton" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando..." : "Registrar salida"}
        </button>
        <button type="button" className="inventario-boton-cancelar" onClick={alCerrar}>Cancelar</button>
      </div>
    </div>
  );
}
