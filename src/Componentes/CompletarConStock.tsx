import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";

// Planta no produce todas las unidades de una línea porque una (o varias)
// salen de stock (ej. 13 de 14 tejas y 1 que ya estaba hecha): la línea baja
// a lo que se produce y la cotización gana una línea de stock apartada, que
// se descuenta al marcar la producción terminada.
type ProductoStock = { id: number; codigo: string; descripcion: string; disponible: number };

function CompletarConStock({ itemId, descripcion, alTerminar, alCerrar }: {
  itemId: number;
  descripcion: string;
  alTerminar: () => void;
  alCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState<ProductoStock[]>([]);
  const [maxUnidades, setMaxUnidades] = useState(0);
  const [elegido, setElegido] = useState<ProductoStock | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async (texto: string) => {
    setCargando(true);
    setError("");
    try {
      const datos = await api.get<{ max_unidades: number; productos: ProductoStock[] }>(
        `/apartados/items/${itemId}/stock-para-completar?busqueda=${encodeURIComponent(texto)}`);
      setMaxUnidades(datos?.max_unidades ?? 0);
      setProductos(datos?.productos ?? []);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo consultar el stock.");
    } finally {
      setCargando(false);
    }
  }, [itemId]);

  useEffect(() => { cargar(""); }, [cargar]);

  async function completar() {
    const n = Number(cantidad);
    if (!elegido || !Number.isInteger(n) || n < 1) {
      setError("Elige el producto de stock y una cantidad entera.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      await api.post(`/apartados/items/${itemId}/completar-con-stock`, { producto_id: elegido.id, cantidad: n });
      alTerminar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo completar con stock.");
    } finally {
      setGuardando(false);
    }
  }

  const tope = elegido ? Math.min(maxUnidades, Math.floor(elegido.disponible)) : maxUnidades;
  return (
    <div className="produccion-completar-stock">
      <p style={{ margin: "0 0 0.5rem" }}>
        <strong>Completar con stock:</strong> {descripcion}. A esta línea le faltan <strong>{maxUnidades}</strong> por producir.
        Las que salgan de stock se quitan de la línea y quedan apartadas en la cotización; se descuentan del stock al
        marcar la producción terminada.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <input placeholder="Buscar otro producto por código o descripción..." value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} style={{ flex: "1 1 220px" }} />
        <button type="button" className="produccion-boton-secundario" onClick={() => cargar(busqueda)}>Buscar</button>
      </div>
      {cargando ? <p className="produccion-vacio">Buscando stock...</p> : productos.length === 0 ? (
        <p className="produccion-vacio">No hay stock libre de ese código en esta bodega. Busca otro producto por código o descripción.</p>
      ) : (
        <ul className="apartado-lineas">
          {productos.map((p) => (
            <li key={p.id}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
                <input type="radio" name={`completar-${itemId}`} checked={elegido?.id === p.id} onChange={() => setElegido(p)} />
                <span><strong>{p.codigo}</strong> — {p.descripcion} · <em>{p.disponible} libres</em></span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <label>¿Cuántas salen de stock?</label>
        <input type="number" min="1" max={tope || undefined} step="1" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} style={{ width: "6rem" }} />
        <button type="button" className="produccion-boton-primario" disabled={guardando || !elegido} onClick={completar}>
          {guardando ? "Guardando..." : "Completar"}
        </button>
        <button type="button" className="produccion-boton-secundario" onClick={alCerrar}>Cancelar</button>
      </div>
      {error && <p className="produccion-error">{error}</p>}
    </div>
  );
}

export default CompletarConStock;
