import { useState } from "react";
import { api, ErrorApi } from "./Api";
import { nombreEmpresa } from "../Utils/empresas";
import ModalConfirmacion from "./ModalConfirmacion";

// Admin Inventario elimina productos de stock de una bodega (las bodegas ya
// no pueden). Solo se puede si está en 0 y ninguna cotización lo usa: así no
// se pierde stock ni se rompe una cotización.
type ProductoDeBodega = { id: number; codigo: string; descripcion: string; empresa: string; stock: number };

function PanelEliminarProducto({ bodegas, alEliminar }: {
  bodegas: { id: number; nombre: string }[];
  alEliminar?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [bodegaId, setBodegaId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ProductoDeBodega[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [aEliminar, setAEliminar] = useState<ProductoDeBodega | null>(null);

  async function buscar(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!bodegaId || busqueda.trim().length < 2) {
      setError("Elige la bodega y escribe al menos 2 letras del código o la descripción.");
      return;
    }
    setBuscando(true);
    setError("");
    setMensaje("");
    try {
      const datos = await api.get<Record<string, unknown>[]>(
        `/inventario/productos?bodega_id=${bodegaId}&busqueda=${encodeURIComponent(busqueda.trim())}`) || [];
      setResultados(datos.map((p) => ({
        id: Number(p.id), codigo: String(p.codigo ?? ""), descripcion: String(p.descripcion ?? ""),
        empresa: String(p.empresa ?? ""), stock: Number(p.stock ?? 0),
      })));
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron buscar los productos.");
    } finally {
      setBuscando(false);
    }
  }

  async function eliminar(producto: ProductoDeBodega) {
    setError("");
    try {
      await api.delete(`/inventario/productos/${producto.id}`);
      setResultados((actual) => actual.filter((p) => p.id !== producto.id));
      setMensaje(`Listo: se eliminó ${producto.codigo}.`);
      alEliminar?.();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo eliminar el producto.");
    }
  }

  if (!abierto) {
    return (
      <div style={{ margin: "0 0 1rem" }}>
        <button className="inventario-boton-cancelar" onClick={() => setAbierto(true)}>Eliminar un producto</button>
      </div>
    );
  }

  const bodega = bodegas.find((b) => String(b.id) === bodegaId)?.nombre || "";
  return (
    <form className="inventario-form" onSubmit={buscar} noValidate>
      <h2 className="inventario-form-subtitulo">Eliminar un producto</h2>
      <p className="inventario-carga-ayuda">
        Solo se puede eliminar si su stock está en 0 y ninguna cotización lo usa.
      </p>
      <div className="inventario-form-grid">
        <div>
          <label>Bodega *</label>
          <select value={bodegaId} onChange={(e) => { setBodegaId(e.target.value); setResultados([]); }}>
            <option value="">Elige la bodega...</option>
            {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </div>
        <div>
          <label>Código o descripción *</label>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej. AMARRE" />
        </div>
      </div>
      <div className="inventario-form-botones">
        <button type="submit" className="inventario-boton" disabled={buscando}>{buscando ? "Buscando..." : "Buscar"}</button>
        <button type="button" className="inventario-boton-cancelar" onClick={() => { setAbierto(false); setResultados([]); setError(""); setMensaje(""); }}>
          Cerrar
        </button>
      </div>
      {error && <p className="inventario-error">{error}</p>}
      {mensaje && <p className="inventario-carga-ayuda"><strong>{mensaje}</strong></p>}
      {resultados.length > 0 && (
        <div className="inventario-tabla-contenedor">
          <table className="inventario-tabla">
            <thead><tr><th>Código</th><th>Descripción</th><th>Empresa</th><th>Stock</th><th></th></tr></thead>
            <tbody>
              {resultados.map((p) => (
                <tr key={p.id}>
                  <td>{p.codigo}</td>
                  <td>{p.descripcion}</td>
                  <td>{nombreEmpresa(p.empresa) || "—"}</td>
                  <td>{p.stock}</td>
                  <td>
                    <button type="button" className="inventario-boton-eliminar" disabled={p.stock !== 0}
                      title={p.stock !== 0 ? "Tiene stock: primero debe quedar en 0" : undefined}
                      onClick={() => setAEliminar(p)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aEliminar && (
        <ModalConfirmacion
          titulo="Eliminar producto"
          mensaje={`¿Eliminar "${aEliminar.codigo} — ${aEliminar.descripcion}" de ${bodega}? No se puede deshacer.`}
          textoCancelar="No, volver"
          textoConfirmar="Sí, eliminar"
          onCancelar={() => setAEliminar(null)}
          onConfirmar={() => { const p = aEliminar; setAEliminar(null); eliminar(p); }}
        />
      )}
    </form>
  );
}

export default PanelEliminarProducto;
