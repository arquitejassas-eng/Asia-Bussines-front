import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import { EMPRESAS } from "../Utils/empresas";

// Planta no produce todas las unidades de una línea porque una (o varias)
// salen de stock (ej. 13 de 14 tejas y 1 que ya estaba hecha): la línea baja
// a lo que se produce y la cotización gana una línea de stock apartada, que
// se descuenta al marcar la producción terminada.
//
// Si el sistema dice que no hay (en 0 o en negativo) pero en la bodega sí
// están, Planta marca "Sí las tengo en la bodega" y escribe solo las que
// saca: salen de una vez y Admin Inventario lo ve en Préstamos entre empresas
// (sección "Sacado sin existencia en el sistema").
type ProductoStock = { id: number; codigo: string; descripcion: string; disponible: number };

function CompletarConStock({ itemId, descripcion, alTerminar, alCerrar }: {
  itemId: number;
  descripcion: string;
  alTerminar: () => void;
  alCerrar: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState<ProductoStock[]>([]);
  const [empresa, setEmpresa] = useState("");
  const [maxUnidades, setMaxUnidades] = useState(0);
  const [elegido, setElegido] = useState<ProductoStock | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [hayFisico, setHayFisico] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async (texto: string) => {
    setCargando(true);
    setError("");
    try {
      const datos = await api.get<{ max_unidades: number; productos: ProductoStock[]; empresa?: string }>(
        `/apartados/items/${itemId}/stock-para-completar?busqueda=${encodeURIComponent(texto)}`);
      setMaxUnidades(datos?.max_unidades ?? 0);
      setProductos(datos?.productos ?? []);
      setEmpresa(datos?.empresa ?? "");
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo consultar el stock.");
    } finally {
      setCargando(false);
    }
  }, [itemId]);

  useEffect(() => { cargar(""); }, [cargar]);

  function elegir(p: ProductoStock) {
    setElegido(p);
    setHayFisico(false);
  }

  const n = Number(cantidad);
  // El sistema no alcanza a cubrir lo que se saca: hay que confirmar que están en la bodega.
  const sinExistencia = elegido != null && Number.isFinite(n) && n > elegido.disponible + 0.005;

  async function completar() {
    if (!elegido || !Number.isInteger(n) || n < 1) {
      setError("Elige el producto de stock y una cantidad entera.");
      return;
    }
    if (n > maxUnidades) {
      setError(`A esta línea solo le faltan ${maxUnidades} por producir.`);
      return;
    }
    // El sistema no las tiene: se pregunta en una ventana (la casilla sola no se veía).
    let confirmado = hayFisico;
    if (sinExistencia && !confirmado) {
      confirmado = window.confirm(
        `El sistema tiene ${Math.max(elegido.disponible, 0)} libres de ${elegido.codigo} y vas a sacar ${n}.\n\n` +
        "¿Sí las tienes en la bodega? Si le das Aceptar, salen de una vez para esta cotización y Admin Inventario lo ve para corregir el inventario.",
      );
      if (!confirmado) return;
      setHayFisico(true);
    }
    setGuardando(true);
    setError("");
    try {
      await api.post(`/apartados/items/${itemId}/completar-con-stock`,
        { producto_id: elegido.id, cantidad: n, hay_fisico: sinExistencia && confirmado });
      alTerminar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo completar con stock.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="produccion-completar-stock">
      <p style={{ margin: "0 0 0.5rem" }}>
        <strong>Completar con stock:</strong> {descripcion}. A esta línea le faltan <strong>{maxUnidades}</strong> por producir.
        Las que salgan de stock se quitan de la línea y quedan apartadas en la cotización; se descuentan del stock al
        marcar la producción terminada.
        {empresa && <> Solo sale stock de <strong>{EMPRESAS[empresa] || empresa}</strong> (la empresa del material de esta línea).</>}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <input placeholder="Buscar otro producto por código o descripción..." value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} style={{ flex: "1 1 220px" }} />
        <button type="button" className="produccion-boton-secundario" onClick={() => cargar(busqueda)}>Buscar</button>
      </div>
      {cargando ? <p className="produccion-vacio">Buscando stock...</p> : productos.length === 0 ? (
        <p className="produccion-vacio">No hay stock de ese código en esta bodega. Busca otro producto por código o descripción.</p>
      ) : (
        <ul className="apartado-lineas">
          {productos.map((p) => (
            <li key={p.id}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
                <input type="radio" name={`completar-${itemId}`} checked={elegido?.id === p.id} onChange={() => elegir(p)} />
                <span>
                  <strong>{p.codigo}</strong> — {p.descripcion} ·{" "}
                  {p.disponible > 0.005
                    ? <em>{p.disponible} libres</em>
                    : <em className="produccion-error" style={{ display: "inline" }}>el sistema dice {p.disponible}</em>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <label>¿Cuántas salen de stock?</label>
        <input type="number" min="1" max={maxUnidades || undefined} step="1" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} style={{ width: "6rem" }} />
      </div>
      {/* Antes de los botones y resaltado: abajo de "Completar" nadie lo veía. */}
      {sinExistencia && elegido && (
        <label style={{
          display: "flex", gap: "0.6rem", alignItems: "flex-start", cursor: "pointer", margin: "0.6rem 0",
          padding: "0.7rem 0.8rem", borderRadius: "8px", border: "2px solid var(--at-terra, #b7451f)",
          background: "color-mix(in srgb, var(--at-terra, #b7451f) 8%, transparent)",
        }}>
          <input type="checkbox" checked={hayFisico} onChange={(e) => setHayFisico(e.target.checked)}
            style={{ width: "1.3rem", height: "1.3rem", marginTop: "0.1rem", flex: "0 0 auto" }} />
          <span>
            El sistema tiene <strong>{Math.max(elegido.disponible, 0)}</strong> libres de {elegido.codigo} y vas a sacar{" "}
            <strong>{n}</strong>. <strong>Marca aquí si sí las tienes en la bodega:</strong> salen de una vez para esta
            cotización y Admin Inventario lo ve para corregir el inventario.
          </span>
        </label>
      )}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.5rem" }}>
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
