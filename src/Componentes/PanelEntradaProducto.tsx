import { useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import { nombreEmpresa } from "../Utils/empresas";
import { FAMILIA_PORCELANATO, normalizarFamilia } from "../Hooks/useProductosInventario";
import { MOTIVOS_ENTRADA } from "../Hooks/useMovimientosInventario";

// Admin Inventario le da entrada a un producto que YA existe en una bodega
// (ej. otra compra del mismo porcelanato), sin depender de la bodega. Usa la
// misma entrada de Inventario → Movimientos: queda en el historial de esa
// bodega. Un producto que todavía no existe allí se crea con "Nuevo producto".
type Producto = { id: number; codigo: string; descripcion: string; empresa: string; familia: string; stock: number; m2PorCaja: number | null };

const numero = (v: unknown) => Number(v ?? 0) || 0;
const formato = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: 2 });

function PanelEntradaProducto({ bodegas, alGuardar }: { bodegas: { id: number; nombre: string }[]; alGuardar?: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [bodegaId, setBodegaId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<Producto | null>(null);
  const [modo, setModo] = useState<"cajas" | "m2">("cajas");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("compra_proveedor");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");

  // Busca en la bodega escogida (código o descripción), con una pausa corta al escribir.
  useEffect(() => {
    if (!abierto || !bodegaId) { setResultados([]); return; }
    let vigente = true;
    const espera = setTimeout(async () => {
      setBuscando(true);
      try {
        const datos = await api.get<Record<string, unknown>[]>(
          `/inventario/productos?bodega_id=${bodegaId}${busqueda.trim() ? `&busqueda=${encodeURIComponent(busqueda.trim())}` : ""}`);
        if (!vigente) return;
        setResultados((datos || []).slice(0, 50).map((p) => ({
          id: numero(p.id), codigo: String(p.codigo ?? ""), descripcion: String(p.descripcion ?? ""), empresa: String(p.empresa ?? ""),
          familia: String(p.familia ?? ""), stock: numero(p.stock),
          m2PorCaja: p.metros_por_unidad == null ? null : numero(p.metros_por_unidad),
        })));
      } catch {
        if (vigente) setResultados([]);
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 300);
    return () => { vigente = false; clearTimeout(espera); };
  }, [abierto, bodegaId, busqueda]);

  const esPorcelanato = Boolean(elegido && normalizarFamilia(elegido.familia) === FAMILIA_PORCELANATO);
  const m2PorCaja = elegido?.m2PorCaja || 0;
  const valor = Number(cantidad.replace(",", "."));
  // En m², se redondea hacia arriba a cajas completas (como en las salidas).
  const cajas = esPorcelanato && modo === "m2" ? (valor > 0 && m2PorCaja > 0 ? Math.ceil(valor / m2PorCaja) : 0) : valor;
  const m2Equivalentes = esPorcelanato && m2PorCaja > 0 && cajas > 0 ? Math.round(cajas * m2PorCaja * 100) / 100 : null;

  function elegir(producto: Producto) {
    setElegido(producto); setCantidad(""); setModo("cajas"); setError(""); setListo("");
  }

  async function guardar(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!elegido) { setError("Escoge el producto."); return; }
    if (!(cajas > 0)) { setError(esPorcelanato ? "Escribe cuántas cajas (o m²) entraron." : "Escribe la cantidad que entró."); return; }
    if (!motivo) { setError("Escoge el motivo."); return; }
    setGuardando(true); setError(""); setListo("");
    try {
      await api.post("/inventario/movimientos", {
        tipo: "entrada", motivo, producto_id: elegido.id, cantidad: cajas, observaciones: observaciones.trim(),
      });
      const bodega = bodegas.find((b) => String(b.id) === bodegaId)?.nombre || "la bodega";
      const unidad = esPorcelanato ? ` caja${cajas === 1 ? "" : "s"}${m2Equivalentes ? ` (${formato(m2Equivalentes)} m²)` : ""}` : "";
      setListo(`Listo: entraron ${formato(cajas)}${unidad} de ${elegido.codigo} en ${bodega}. Ahora tiene ${formato(elegido.stock + cajas)}.`);
      setElegido(null); setCantidad(""); setObservaciones(""); setBusqueda("");
      alGuardar?.();
    } catch (err) {
      setError(err instanceof ErrorApi || err instanceof Error ? err.message : "No se pudo registrar la entrada.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div style={{ margin: "0 0 1rem" }}>
        <button type="button" className="inventario-boton" onClick={() => setAbierto(true)}>Dar entrada a un producto</button>
        <span className="inventario-carga-ayuda" style={{ marginLeft: "0.6rem" }}>
          Mercancía que llegó de un producto que ya existe en la bodega (ej. otra compra de porcelanato).
        </span>
      </div>
    );
  }

  return (
    <form className="inventario-form" onSubmit={guardar} noValidate style={{ margin: "0 0 1rem" }}>
      <h3 style={{ marginTop: 0 }}>Dar entrada a un producto</h3>
      <div className="inventario-form-grid">
        <div>
          <label>Bodega *</label>
          <select value={bodegaId} onChange={(e) => { setBodegaId(e.target.value); setElegido(null); setListo(""); }}>
            <option value="">Escoge la bodega</option>
            {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </div>
        <div>
          <label>Buscar producto</label>
          <input placeholder="Código o descripción (ej. porcelanato)" value={busqueda} disabled={!bodegaId}
            onChange={(e) => setBusqueda(e.target.value)} />
        </div>
      </div>

      {bodegaId && !elegido && (
        <div style={{ margin: "0.5rem 0" }}>
          {buscando ? <p className="inventario-cargando">Buscando...</p>
            : resultados.length === 0 ? <p className="inventario-carga-ayuda">No hay productos con esa búsqueda en esta bodega. Si es nuevo aquí, créalo con «Nuevo producto».</p>
            : (
              <div className="rollo-completo-opciones">
                {resultados.map((p) => (
                  <button type="button" key={p.id} onClick={() => elegir(p)}>
                    <strong>{p.codigo}</strong>
                    <small>{p.descripcion} · {nombreEmpresa(p.empresa)} · hay {formato(p.stock)}{p.m2PorCaja ? ` cajas (${formato(p.m2PorCaja)} m² c/u)` : ""}</small>
                  </button>
                ))}
              </div>
            )}
        </div>
      )}

      {elegido && (
        <>
          <p className="inventario-carga-ayuda">
            <strong>{elegido.codigo}</strong> — {elegido.descripcion} ({nombreEmpresa(elegido.empresa)}). Hoy hay {formato(elegido.stock)}.{" "}
            <button type="button" className="apartados-limpiar" onClick={() => setElegido(null)}>Cambiar producto</button>
          </p>
          {esPorcelanato && !m2PorCaja && (
            <p className="inventario-error">Este porcelanato no tiene m² por caja: la entrada va en cajas. Corrígelo en «Editar o eliminar producto».</p>
          )}
          <div className="inventario-form-grid">
            {esPorcelanato && m2PorCaja > 0 && (
              <div>
                <label>Cantidad en</label>
                <div className="inventario-tipos">
                  {(["cajas", "m2"] as const).map((m) => (
                    <button key={m} type="button" className={`inventario-tipo-boton ${modo === m ? "inventario-tipo-activo" : ""}`}
                      onClick={() => { setModo(m); setCantidad(""); }}>
                      {m === "cajas" ? "Cajas" : "m²"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label>{esPorcelanato ? (modo === "m2" ? "m² que entraron *" : "Cajas que entraron *") : "Cantidad que entró *"}</label>
              <input type="number" min="0" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              {esPorcelanato && m2Equivalentes != null && (
                <small className="inventario-carga-ayuda">= {formato(cajas)} caja{cajas === 1 ? "" : "s"} · {formato(m2Equivalentes)} m²</small>
              )}
            </div>
            <div>
              <label>Motivo *</label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MOTIVOS_ENTRADA.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
              </select>
            </div>
            <div>
              <label>Observaciones</label>
              <input placeholder="Ej. factura del proveedor" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            </div>
          </div>
        </>
      )}

      {error && <p className="inventario-error">{error}</p>}
      {listo && <p className="inventario-carga-ayuda"><strong>{listo}</strong></p>}
      <div className="inventario-form-botones">
        <button type="submit" className="inventario-boton" disabled={guardando || !elegido}>{guardando ? "Guardando..." : "Dar entrada"}</button>
        <button type="button" className="inventario-boton-cancelar" onClick={() => { setAbierto(false); setError(""); setListo(""); }}>Cerrar</button>
      </div>
    </form>
  );
}

export default PanelEntradaProducto;
