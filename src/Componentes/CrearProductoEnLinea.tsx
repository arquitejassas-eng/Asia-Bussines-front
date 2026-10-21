import { useState } from "react";
import { api, ErrorApi } from "./Api";
import { EMPRESAS } from "../Utils/empresas";

// Desde una línea de stock de la cotización: el producto todavía no existe y
// Admin Inventario lo crea ahí mismo, sin salir de Apartados. Queda con stock
// 0 en la bodega y la empresa de la línea, y elegido en la línea.
function CrearProductoEnLinea({ codigoInicial, bodegaId, bodegaNombre, empresa, familias, alCrear, alCancelar }: {
  codigoInicial: string;
  bodegaId: string;
  bodegaNombre: string;
  empresa: string;
  familias: string[];
  alCrear: (producto: Record<string, unknown>) => void;
  alCancelar: () => void;
}) {
  const [codigo, setCodigo] = useState(codigoInicial.trim().toUpperCase());
  const [descripcion, setDescripcion] = useState("");
  const [familia, setFamilia] = useState("");
  const [calibre, setCalibre] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function crear() {
    if (!codigo.trim() || !descripcion.trim()) {
      setError("Código y descripción son obligatorios.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const producto = await api.post<Record<string, unknown>>("/inventario/productos", {
        bodega_id: Number(bodegaId), empresa, codigo: codigo.trim(), descripcion: descripcion.trim(),
        familia: familia.trim(), calibre: calibre.trim(), stock: Math.max(Number(cantidad) || 0, 0),
      });
      if (producto) alCrear(producto);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo crear el producto.");
    } finally {
      setGuardando(false);
    }
  }

  // No es un <form>: va dentro del formulario de la cotización.
  return (
    <div className="apartado-crear-producto">
      <p>
        <strong>Nuevo producto</strong> en {bodegaNombre} · {EMPRESAS[empresa] || empresa}. Pon cuántos entraron: queda como
        entrada en esa bodega y ya se puede apartar. Si lo dejas en 0, la cotización no se guarda hasta que haya stock.
      </p>
      <div className="inventario-form-grid">
        <div>
          <label>Código *</label>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </div>
        <div>
          <label>Descripción *</label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>
        <div>
          <label>Familia</label>
          <input list="apartado-datalist-familias" placeholder="Ej. Caballetes" value={familia} onChange={(e) => setFamilia(e.target.value)} />
          <datalist id="apartado-datalist-familias">
            {familias.map((f) => <option key={f} value={f} />)}
          </datalist>
        </div>
        <div>
          <label>Espesor</label>
          <input placeholder="Ej. 0,33" value={calibre} onChange={(e) => setCalibre(e.target.value)} />
        </div>
        <div>
          <label>Cantidad que entró</label>
          <input type="number" min="0" step="any" placeholder="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </div>
      </div>
      {error && <p className="inventario-error">{error}</p>}
      <div className="apartado-aviso-botones">
        <button type="button" className="inventario-boton" disabled={guardando} onClick={crear}>
          {guardando ? "Creando..." : "Crear y usar en esta línea"}
        </button>
        <button type="button" className="inventario-boton-cancelar" onClick={alCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

export default CrearProductoEnLinea;
