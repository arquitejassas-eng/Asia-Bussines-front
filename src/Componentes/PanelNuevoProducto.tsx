import { useState } from "react";
import { api, ErrorApi } from "./Api";
import { EMPRESAS } from "../Utils/empresas";
import { FAMILIA_PORCELANATO, normalizarFamilia } from "../Hooks/useProductosInventario";

// Admin Inventario crea los productos de stock (códigos nuevos) de cada
// bodega: así nadie inventa códigos. Se crean con stock 0; la bodega que
// recibe la mercancía le da entrada en Inventario → Movimientos → Entrada.
const VACIO = {
  bodegaId: "", empresa: "", codigo: "", descripcion: "", familia: "", calibre: "", referencia: "",
  stockMinimo: "", metrosPorUnidad: "", cantidad: "",
};

function PanelNuevoProducto({ bodegas, familias, alCrear }: {
  bodegas: { id: number; nombre: string }[];
  familias: string[];
  alCrear?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [formulario, setFormulario] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");
  const esPorcelanato = normalizarFamilia(formulario.familia) === FAMILIA_PORCELANATO;

  function cambiar(campo: keyof typeof VACIO, valor: string) {
    setFormulario((actual) => ({ ...actual, [campo]: valor }));
  }

  async function guardar(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!formulario.bodegaId || !formulario.empresa) {
      setError("Elige la bodega y la empresa del producto.");
      return;
    }
    if (!formulario.codigo.trim() || !formulario.descripcion.trim()) {
      setError("Código y descripción son obligatorios.");
      return;
    }
    if (Number(formulario.cantidad) < 0) {
      setError("La cantidad que entró no puede ser negativa.");
      return;
    }
    setGuardando(true);
    setError("");
    setListo("");
    try {
      const creado = await api.post<{ descripcion?: string }>("/inventario/productos", {
        bodega_id: Number(formulario.bodegaId),
        empresa: formulario.empresa,
        codigo: formulario.codigo.trim(),
        descripcion: formulario.descripcion.trim(),
        familia: formulario.familia.trim(),
        calibre: formulario.calibre.trim(),
        referencia: formulario.referencia.trim(),
        stock: Number(formulario.cantidad) || 0,
        stock_minimo: formulario.stockMinimo === "" ? null : Number(formulario.stockMinimo),
        metros_por_unidad: esPorcelanato && formulario.metrosPorUnidad !== "" ? Number(formulario.metrosPorUnidad) : null,
      });
      const bodega = bodegas.find((b) => String(b.id) === formulario.bodegaId)?.nombre || "la bodega";
      const cantidad = Number(formulario.cantidad) || 0;
      const copiado = creado?.descripcion && creado.descripcion !== formulario.descripcion.trim();
      setListo(`Listo: ${formulario.codigo.trim()} quedó creado en ${bodega} con ${cantidad} en stock`
        + (cantidad ? " (quedó como entrada en su historial)." : ". Lo que llegue después lo registra la bodega en Movimientos.")
        + (copiado ? ` Ese código ya existía en otra bodega: se usaron sus mismos datos ("${creado?.descripcion}").` : ""));
      // Se deja la bodega y la empresa para crear el siguiente más rápido.
      setFormulario((actual) => ({ ...VACIO, bodegaId: actual.bodegaId, empresa: actual.empresa }));
      alCrear?.();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo crear el producto. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div style={{ margin: "0 0 1rem" }}>
        <button className="inventario-boton" onClick={() => { setAbierto(true); setListo(""); }}>+ Nuevo producto de stock</button>
      </div>
    );
  }

  return (
    <form className="inventario-form" onSubmit={guardar} noValidate>
      <h2 className="inventario-form-subtitulo">Nuevo producto de stock</h2>
      <p className="inventario-carga-ayuda">
        Solo Admin Inventario crea productos. Pon cuántos entraron: queda como entrada en la bodega que elijas. Lo que
        llegue después lo registra esa bodega en Inventario → Movimientos → Entrada.
      </p>
      <div className="inventario-form-grid">
        <div>
          <label>Bodega *</label>
          <select value={formulario.bodegaId} onChange={(e) => cambiar("bodegaId", e.target.value)}>
            <option value="">Elige la bodega...</option>
            {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </div>
        <div>
          <label>Empresa *</label>
          <select value={formulario.empresa} onChange={(e) => cambiar("empresa", e.target.value)}>
            <option value="">Elige la empresa...</option>
            {Object.entries(EMPRESAS).map(([sigla, nombre]) => <option key={sigla} value={sigla}>{nombre}</option>)}
          </select>
        </div>
        <div>
          <label>Código *</label>
          <input value={formulario.codigo} onChange={(e) => cambiar("codigo", e.target.value)} />
        </div>
        <div>
          <label>Descripción *</label>
          <input value={formulario.descripcion} onChange={(e) => cambiar("descripcion", e.target.value)} />
        </div>
        <div>
          <label>Familia</label>
          <input list="admin-datalist-familias" placeholder="Ej. Tornillos" value={formulario.familia}
            onChange={(e) => cambiar("familia", e.target.value)} />
          <datalist id="admin-datalist-familias">
            {familias.map((f) => <option key={f} value={f} />)}
          </datalist>
        </div>
        <div>
          <label>Espesor</label>
          <input placeholder="Ej. 0,33" value={formulario.calibre} onChange={(e) => cambiar("calibre", e.target.value)} />
        </div>
        <div>
          <label>{esPorcelanato ? "Cajas que entraron" : "Cantidad que entró"}</label>
          <input type="number" min="0" step="any" placeholder="0" value={formulario.cantidad}
            onChange={(e) => cambiar("cantidad", e.target.value)} />
        </div>
        <div>
          <label>Referencia</label>
          <input placeholder="Otro código de identificación (opcional)" value={formulario.referencia}
            onChange={(e) => cambiar("referencia", e.target.value)} />
        </div>
        <div>
          <label>Stock mínimo (opcional)</label>
          <input type="number" min="0" step="any" placeholder="Sin alerta" value={formulario.stockMinimo}
            onChange={(e) => cambiar("stockMinimo", e.target.value)} />
        </div>
        {esPorcelanato && (
          <div>
            <label>m² por caja (opcional)</label>
            <input type="number" min="0" step="any" placeholder="Ej. 1.44" value={formulario.metrosPorUnidad}
              onChange={(e) => cambiar("metrosPorUnidad", e.target.value)} />
          </div>
        )}
      </div>
      {error && <p className="inventario-error">{error}</p>}
      {listo && <p className="inventario-carga-ayuda"><strong>{listo}</strong></p>}
      <div className="inventario-form-botones">
        <button type="submit" className="inventario-boton" disabled={guardando}>{guardando ? "Creando..." : "Crear producto"}</button>
        <button type="button" className="inventario-boton-cancelar" onClick={() => { setAbierto(false); setError(""); }}>Cerrar</button>
      </div>
    </form>
  );
}

export default PanelNuevoProducto;
