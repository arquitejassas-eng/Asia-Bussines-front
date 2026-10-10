import { useEffect, useMemo, useState } from "react";
import { api, ErrorApi } from "./Api";
import { rolloDesdeApi } from "./Mapeo";
import { ESTADOS_ROLLO } from "./Rollos";
import { EMPRESAS, FILTRO_SIN_EMPRESA, nombreEmpresa } from "../Utils/empresas";
import { claseColorMaterial } from "../Utils/colorRollo";
import { coincideKilos, kilosBuscados, kilosDelRollo } from "../Utils/kilos";

type Rollo = ReturnType<typeof rolloDesdeApi>;
type Bodega = { id: number; nombre: string };

const POR_PAGINA = 25;
const ESTADOS: [string, string][] = [["", "En bodega (cerrados y abiertos)"], ["cerrado", "Cerrados"], ["abierto", "Abiertos"], ["agotado", "Agotados"]];

function normalizar(texto: unknown) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Inventario total: buscar rollos uno por uno en TODAS las bodegas, por
 * código, referencia o kilos de la etiqueta, y filtrar por estado y bodega.
 * Va en la misma fila que el filtro de Empresa de la tabla por código, que
 * sirve para las dos cosas (ver backend /admin-inventario/rollos). */
export default function PanelBuscarRollos({ bodegas, empresa, setEmpresa }: {
  bodegas: Bodega[]; empresa: string; setEmpresa: (valor: string) => void;
}) {
  const [estado, setEstado] = useState("");
  const [rollos, setRollos] = useState<Rollo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [bodega, setBodega] = useState("");
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    let vigente = true;
    setCargando(true); setError("");
    api.get<Record<string, unknown>[]>(`/admin-inventario/rollos${estado ? `?estado=${estado}` : ""}`)
      .then((datos) => { if (vigente) setRollos((datos || []).map(rolloDesdeApi)); })
      .catch((err) => { if (vigente) setError(err instanceof ErrorApi ? err.message : "No se pudieron cargar los rollos."); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [estado]);

  useEffect(() => { setPagina(1); }, [busqueda, bodega, empresa, estado]);

  const filtrados = useMemo(() => {
    const termino = normalizar(busqueda);
    const kilos = kilosBuscados(busqueda);
    return rollos.filter((r) =>
      (!bodega || String(r.bodegaId) === bodega)
      && (!empresa || (empresa === FILTRO_SIN_EMPRESA ? !r.empresa : r.empresa === empresa))
      && (!termino || normalizar(r.codigoInterno).includes(termino) || normalizar(r.identificadorRollo).includes(termino)
        || coincideKilos(r.pesoNeto, kilos)));
  }, [rollos, busqueda, bodega, empresa]);

  // La empresa sola no abre la lista de rollos (también filtra la tabla de abajo).
  const hayFiltro = Boolean(busqueda.trim() || bodega || estado);
  const totalMetros = Math.round(filtrados.reduce((s, r) => s + (r.metrosDisponibles || 0), 0) * 100) / 100;
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const visibles = filtrados.slice((Math.min(pagina, paginas) - 1) * POR_PAGINA, Math.min(pagina, paginas) * POR_PAGINA);
  const nombreBodega = (id: number | null) => bodegas.find((b) => b.id === id)?.nombre || "—";

  return (
    <section className="buscar-rollos">
      <div className="apartados-filtros">
        <select className={`apartados-select ${empresa ? "apartados-select-activo" : ""}`} aria-label="Empresa"
          value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
          <option value="">Todas las empresas</option>
          {Object.entries(EMPRESAS).map(([sigla, nombre]) => <option key={sigla} value={sigla}>{nombre}</option>)}
          <option value={FILTRO_SIN_EMPRESA}>Sin empresa</option>
        </select>
        <div className="inventario-buscador apartados-buscador">
          <input
            type="text" aria-label="Buscar rollos"
            placeholder="Buscar rollo: código, referencia o kilos (ej. 4248)"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <select className={`apartados-select ${estado ? "apartados-select-activo" : ""}`} aria-label="Estado del rollo"
          value={estado} onChange={(e) => setEstado(e.target.value)}>
          {ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <select className={`apartados-select ${bodega ? "apartados-select-activo" : ""}`} aria-label="Bodega"
          value={bodega} onChange={(e) => setBodega(e.target.value)}>
          <option value="">Todas las bodegas</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </select>
        {hayFiltro && (
          <button type="button" className="apartados-limpiar"
            onClick={() => { setBusqueda(""); setBodega(""); setEstado(""); }}>Cerrar búsqueda de rollos</button>
        )}
      </div>

      {error && <p className="inventario-error">{error}</p>}
      {cargando ? (
        <p className="inventario-cargando">Cargando rollos...</p>
      ) : !hayFiltro ? null : (
        <>
          <p className="inventario-carga-ayuda" style={{ margin: "0 0 0.5rem" }}>
            {filtrados.length} rollo{filtrados.length === 1 ? "" : "s"} · {totalMetros.toLocaleString("es-CO")} m disponibles
          </p>
          {filtrados.length > 0 && (
            <div className="inventario-tabla-contenedor">
              <table className="inventario-tabla buscar-rollos-tabla">
                <thead>
                  <tr>
                    <th>Referencia</th><th>Código</th><th>Bodega</th><th>Empresa</th><th>Color</th>
                    <th>Kilos</th><th>Metros disponibles</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((r) => {
                    const kilos = kilosDelRollo(r.pesoNeto);
                    return (
                      <tr key={r.id}>
                        <td className="buscar-rollos-ref">{r.identificadorRollo}</td>
                        <td data-etiqueta="Código">{r.codigoInterno}</td>
                        <td data-etiqueta="Bodega">{nombreBodega(r.bodegaId)}</td>
                        <td data-etiqueta="Empresa">{nombreEmpresa(r.empresa)}</td>
                        <td data-etiqueta="Color">
                          <span className={`rollos-color-etiqueta color-${claseColorMaterial(r.colorMaterial)}`}>
                            <span className="rollos-color-muestra" aria-hidden="true" />{r.colorMaterial || "Sin color"}
                          </span>
                        </td>
                        <td data-etiqueta="Kilos">{kilos != null ? `${kilos.toLocaleString("es-CO")} kg` : "—"}</td>
                        <td data-etiqueta="Metros disponibles">{r.metrosDisponibles}</td>
                        <td data-etiqueta="Estado">
                          <span className={`rollos-estado-badge estado-${r.estado}`}>
                            {(ESTADOS_ROLLO as Record<string, string>)[r.estado] || r.estado}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {paginas > 1 && (
            <div className="buscar-rollos-paginas">
              <button type="button" className="inventario-boton-cancelar" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <span>Página {Math.min(pagina, paginas)} de {paginas}</span>
              <button type="button" className="inventario-boton-cancelar" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
