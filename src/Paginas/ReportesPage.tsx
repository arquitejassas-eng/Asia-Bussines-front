import BarraLateral from "../Componentes/BarraLateral";
import { formatearFechaColombia } from "../Utils/fechas";
import { useControladorReportes } from "../Componentes/Reportes";
import Paginacion from "../Componentes/Paginacion";
import CampanaAlertas from "../Componentes/CampanaAlertas";
import { exportarArregloAExcel } from "../Utils/exportarExcel";
import { contarNotificaciones } from "../Utils/notificaciones";
import "../Style/Reportes.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

const ETIQUETAS_TIPO: Record<string, string> = {
  entrada: "Entrada",
  salida: "Salida",
  traslado: "Traslado",
  transferencia: "Transferencia",
};

function ReportesPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const r = useControladorReportes(sesion, almacen);
  // Superadmin y Admin Inventario ven los reportes de todas las bodegas.
  const todasLasBodegas = sesion?.rol === "superadmin" || sesion?.rol === "admin_inventario";
  const nombreBodega = (id: number | null | undefined) => almacen.bodegas.find((b) => b.id === id)?.nombre || "";
  const bodegaDe = (m: { bodegaOrigenId?: number | null; bodegaDestinoId?: number | null }) => {
    const origen = nombreBodega(m.bodegaOrigenId), destino = nombreBodega(m.bodegaDestinoId);
    return origen && destino ? `${origen} → ${destino}` : origen || destino || "—";
  };
  const traslados = r.filtros.grupo === "traslados";

  const notificaciones = contarNotificaciones(almacen, sesion);

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="reportes-page">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <h1 className="reportes-titulo">Reportes</h1>
              <p className="reportes-subtitulo">
                {todasLasBodegas
                  ? "Todas las entradas, salidas y movimientos de todas las bodegas."
                  : `Todas las entradas, salidas y movimientos de ${sesion?.bodegaNombre}.`}
              </p>
            </div>
            <CampanaAlertas
              alertas={r.alertasStock}
              cargando={r.cargandoAlertasStock}
              unidadPorFamilia={almacen?.unidadPorFamilia || {}}
            />
          </div>

          {/* Dos partes: lo de la bodega (producción, entradas, salidas…) y los traslados. */}
          <div className="reportes-pestanas" role="tablist" aria-label="Parte del reporte">
            <button type="button" role="tab" aria-selected={!traslados}
              className={`reportes-pestana ${!traslados ? "reportes-pestana-activa" : ""}`}
              onClick={() => r.actualizarFiltro("grupo", "movimientos")}>
              Producción y movimientos
            </button>
            <button type="button" role="tab" aria-selected={traslados}
              className={`reportes-pestana ${traslados ? "reportes-pestana-activa" : ""}`}
              onClick={() => r.actualizarFiltro("grupo", "traslados")}>
              Traslados entre bodegas
            </button>
          </div>

          {/* ================== RESUMEN ================== */}
          <section className="reportes-resumen-grid">
            <div className="reportes-resumen-card">
              <span className="reportes-resumen-numero">{r.resumen.entradas}</span>
              <span className="reportes-resumen-etiqueta">Entradas</span>
            </div>
            <div className="reportes-resumen-card">
              <span className="reportes-resumen-numero">{r.resumen.salidas}</span>
              <span className="reportes-resumen-etiqueta">Salidas</span>
            </div>
            <div className="reportes-resumen-card">
              <span className="reportes-resumen-numero">{r.resumen.traslados}</span>
              <span className="reportes-resumen-etiqueta">Traslados</span>
            </div>
            <div className="reportes-resumen-card">
              <span className="reportes-resumen-numero">{r.resumen.transferencias}</span>
              <span className="reportes-resumen-etiqueta">Transferencias</span>
            </div>
          </section>

          {/* ================== FILTROS ================== */}
          <section className="reportes-tarjeta">
            <h2>Filtrar movimientos</h2>
            <div className="reportes-filtros-grid">
              {todasLasBodegas && (
                <div>
                  <label>Bodega</label>
                  <select value={r.filtros.bodegaId} onChange={(e) => r.actualizarFiltro("bodegaId", e.target.value)}>
                    <option value="">Todas las bodegas</option>
                    {almacen.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label>Tipo</label>
                <select value={r.filtros.tipo} onChange={(e) => r.actualizarFiltro("tipo", e.target.value)}>
                  <option value="">Todos</option>
                  {traslados ? (
                    <>
                      <option value="transferencia">Transferencia</option>
                      <option value="traslado">Traslado</option>
                    </>
                  ) : (
                    <>
                      <option value="entrada">Entrada</option>
                      <option value="salida">Salida</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label>Código de producto</label>
                <input
                  type="text"
                  value={r.filtros.codigoProducto}
                  onChange={(e) => r.actualizarFiltro("codigoProducto", e.target.value)}
                  placeholder="Ej. TEL-001"
                />
              </div>
              <div>
                <label>Código de rollo</label>
                <input
                  type="text"
                  value={r.filtros.codigoRollo}
                  onChange={(e) => r.actualizarFiltro("codigoRollo", e.target.value)}
                  placeholder="Ej. R-0042"
                />
              </div>
              <div>
                <label>N° Cotización</label>
                <input
                  type="text"
                  value={r.filtros.cotizacion}
                  onChange={(e) => r.actualizarFiltro("cotizacion", e.target.value)}
                  placeholder="Ej. COT-00125"
                />
              </div>
              <div>
                <label>Empresa (salida externa)</label>
                <input
                  type="text"
                  value={r.filtros.empresaExterna}
                  onChange={(e) => r.actualizarFiltro("empresaExterna", e.target.value)}
                  placeholder="Ej. Tejas del Norte"
                />
              </div>
              <div>
                <label>Desde</label>
                <input
                  type="date"
                  value={r.filtros.fechaDesde}
                  onChange={(e) => r.actualizarFiltro("fechaDesde", e.target.value)}
                />
              </div>
              <div>
                <label>Hasta</label>
                <input
                  type="date"
                  value={r.filtros.fechaHasta}
                  onChange={(e) => r.actualizarFiltro("fechaHasta", e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
              <button className="reportes-boton-secundario" onClick={r.limpiarFiltros}>
                Limpiar filtros
              </button>
              <button
                className="reportes-boton-secundario"
                onClick={() => exportarArregloAExcel(r.movimientos, "Historial_Movimientos.xlsx", "Movimientos")}
              >
                📥 Exportar a Excel
              </button>
            </div>
          </section>

          {/* ================== TABLA DE MOVIMIENTOS ================== */}
          <section className="reportes-tarjeta">
            <h2>Movimientos</h2>
            {r.cargandoMovimientos ? (
              <p className="reportes-vacio">Cargando...</p>
            ) : r.errorMovimientos ? (
              <p className="reportes-error">{r.errorMovimientos}</p>
            ) : r.movimientos.length === 0 ? (
              <p className="reportes-vacio">No hay movimientos que coincidan con la búsqueda.</p>
            ) : (
              <>
              <div className="reportes-tabla-wrap">
                <table className="reportes-tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      {todasLasBodegas && <th>Bodega</th>}
                      <th>Tipo</th>
                      <th>Motivo</th>
                      <th>Producto</th>
                      <th>Referencia</th>
                      <th>Empresa</th>
                      <th>Cantidad</th>
                      <th>Usuario</th>
                      <th>Observaciones</th>
                      <th>Cotización</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.movimientos.map((m) => (
                      <tr key={m.id}>
                        <td>{formatearFechaColombia(m.fecha)}</td>
                        {todasLasBodegas && <td>{bodegaDe(m)}</td>}
                        <td>
                          <span className={`reportes-tipo-badge tipo-${m.tipo}`}>
                            {ETIQUETAS_TIPO[m.tipo] || m.tipo}
                          </span>
                        </td>
                        <td>{m.motivo || "—"}</td>
                        <td>
                          {m.productoCodigo} — {m.productoDescripcion}
                        </td>
                        <td>{m.identificadorRollo || "—"}</td>
                        <td>{m.empresaExterna || "—"}</td>
                        <td>{m.cantidad}</td>
                        <td>{m.usuario}</td>
                        <td>{m.observaciones || "—"}</td>
                        <td>{m.cotizacion || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacion
                paginacion={r.paginacion}
                alCambiarPagina={r.setPagina}
                etiqueta="movimientos"
              />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default ReportesPage;
