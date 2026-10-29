import { useState } from "react";
import { api, ErrorApi } from "./Api";
import { EMPRESAS, nombreEmpresa } from "../Utils/empresas";
import { MODELOS_TEJA } from "../Utils/teja";
import ModalConfirmacion from "./ModalConfirmacion";

// Admin Inventario edita o elimina productos de stock de cualquier bodega.
// Eliminar solo se puede si está en 0 y ninguna cotización lo usa: así no se
// pierde stock ni se rompe una cotización. Editar usa el mismo PUT que la
// bodega (si cambia el stock, el ajuste queda en el historial de esa bodega).
type ProductoDeBodega = { id: number; codigo: string; descripcion: string; empresa: string; stock: number; datos: Record<string, unknown> };
type Edicion = { codigo: string; empresa: string; descripcion: string; familia: string; calibre: string; referencia: string; stockMinimo: string; stock: string };

const esTeja = (familia: string) => familia.trim().toUpperCase() === "TEJA";

function PanelEliminarProducto({ bodegas, alEliminar, familias = [] }: {
  bodegas: { id: number; nombre: string }[];
  alEliminar?: () => void;
  familias?: string[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [bodegaId, setBodegaId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ProductoDeBodega[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [aEliminar, setAEliminar] = useState<ProductoDeBodega | null>(null);
  const [editando, setEditando] = useState<ProductoDeBodega | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [guardando, setGuardando] = useState(false);

  function abrirEdicion(producto: ProductoDeBodega) {
    const d = producto.datos;
    setEditando(producto);
    setMensaje(""); setError("");
    setEdicion({
      codigo: String(d.codigo ?? ""), empresa: String(d.empresa ?? ""), descripcion: String(d.descripcion ?? ""),
      familia: String(d.familia ?? ""), calibre: String(d.calibre ?? ""), referencia: String(d.referencia ?? ""),
      stockMinimo: d.stock_minimo == null ? "" : String(d.stock_minimo), stock: String(d.stock ?? 0),
    });
  }

  async function guardarEdicion() {
    if (!editando || !edicion) return;
    if (!edicion.codigo.trim() || !edicion.descripcion.trim()) {
      setError("Código y descripción son obligatorios.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const d = editando.datos;
      const numero = (v: string) => Number(String(v).replace(",", "."));
      const actualizado = await api.put<Record<string, unknown>>(`/inventario/productos/${editando.id}`, {
        ...d,
        codigo: edicion.codigo.trim(), empresa: edicion.empresa, descripcion: edicion.descripcion.trim(),
        familia: edicion.familia.trim(), calibre: edicion.calibre.trim(), referencia: edicion.referencia.trim(),
        stock_minimo: edicion.stockMinimo.trim() === "" ? null : numero(edicion.stockMinimo),
        stock: numero(edicion.stock),
        // Lo que se vio al abrir: si alguien movió el stock mientras tanto, no se pisa.
        stock_anterior: d.stock, entrada_anterior: d.entrada,
      });
      const nuevo = actualizado ? { ...d, ...actualizado } : d;
      setResultados((actual) => actual.map((p) => (p.id === editando.id ? {
        ...p, codigo: String(nuevo.codigo ?? ""), descripcion: String(nuevo.descripcion ?? ""),
        empresa: String(nuevo.empresa ?? ""), stock: Number(nuevo.stock ?? 0), datos: nuevo,
      } : p)));
      setMensaje(`Listo: se guardó ${edicion.codigo.trim()}.`);
      setEditando(null); setEdicion(null);
      alEliminar?.();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo guardar el producto.");
    } finally {
      setGuardando(false);
    }
  }

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
        empresa: String(p.empresa ?? ""), stock: Number(p.stock ?? 0), datos: p,
      })));
      setEditando(null); setEdicion(null);
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
        <button className="inventario-boton-cancelar" onClick={() => setAbierto(true)}>Editar o eliminar un producto</button>
      </div>
    );
  }

  const bodega = bodegas.find((b) => String(b.id) === bodegaId)?.nombre || "";
  return (
    <form className="inventario-form" onSubmit={buscar} noValidate>
      <h2 className="inventario-form-subtitulo">Editar o eliminar un producto</h2>
      <p className="inventario-carga-ayuda">
        Escoge la bodega y busca el producto. Si le cambias el stock, el ajuste queda en el historial de esa bodega.
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
        <button type="button" className="inventario-boton-cancelar" onClick={() => { setAbierto(false); setResultados([]); setError(""); setMensaje(""); setEditando(null); setEdicion(null); }}>
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
                  <td className="inventario-acciones">
                    <button type="button" onClick={() => abrirEdicion(p)}>Editar</button>
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
      {editando && edicion && (
        <div className="inventario-editar-producto">
          <h3 className="inventario-form-subtitulo">Editar {editando.codigo} — {bodega}</h3>
          <div className="inventario-form-grid">
            <div>
              <label>Código *</label>
              <input value={edicion.codigo} onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value })} />
            </div>
            <div>
              <label>Empresa</label>
              <select value={edicion.empresa} onChange={(e) => setEdicion({ ...edicion, empresa: e.target.value })}>
                <option value="">Sin empresa</option>
                {Object.entries(EMPRESAS).map(([sigla, nombre]) => <option key={sigla} value={sigla}>{nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Descripción *</label>
              <input value={edicion.descripcion} onChange={(e) => setEdicion({ ...edicion, descripcion: e.target.value })} />
            </div>
            <div>
              <label>Familia</label>
              <input list="editar-producto-familias" value={edicion.familia} onChange={(e) => setEdicion({ ...edicion, familia: e.target.value })} />
              <datalist id="editar-producto-familias">{familias.map((f) => <option key={f} value={f} />)}</datalist>
            </div>
            <div>
              <label>Espesor</label>
              <input placeholder="Ej. 0,33" value={edicion.calibre} onChange={(e) => setEdicion({ ...edicion, calibre: e.target.value })} />
            </div>
            <div>
              {/* En una teja la referencia es su modelo: de ahí sale su tarjeta. */}
              <label>{esTeja(edicion.familia) ? "Modelo" : "Referencia"}</label>
              <input list={esTeja(edicion.familia) ? "editar-producto-modelos" : undefined}
                value={edicion.referencia} onChange={(e) => setEdicion({ ...edicion, referencia: e.target.value })} />
              {esTeja(edicion.familia) && (
                <datalist id="editar-producto-modelos">{Object.keys(MODELOS_TEJA).map((m) => <option key={m} value={m} />)}</datalist>
              )}
            </div>
            <div>
              <label>Stock</label>
              <input type="number" step="any" value={edicion.stock} onChange={(e) => setEdicion({ ...edicion, stock: e.target.value })} />
            </div>
            <div>
              <label>Stock mínimo (opcional)</label>
              <input type="number" min="0" step="any" placeholder="Sin alerta" value={edicion.stockMinimo}
                onChange={(e) => setEdicion({ ...edicion, stockMinimo: e.target.value })} />
            </div>
          </div>
          <div className="inventario-form-botones">
            <button type="button" className="inventario-boton" disabled={guardando} onClick={guardarEdicion}>
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
            <button type="button" className="inventario-boton-cancelar" onClick={() => { setEditando(null); setEdicion(null); }}>Cancelar</button>
          </div>
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
