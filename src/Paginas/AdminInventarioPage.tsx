import { Fragment, useState } from "react";
import BarraLateral from "../Componentes/BarraLateral";
import { formatearFechaColombia } from "../Utils/fechas";
import { useControladorAdminInventario } from "../Componentes/AdminInventario";
import { ESTADOS_ROLLO } from "../Componentes/Rollos";
import { claseColorMaterial } from "../Utils/colorRollo";
import Paginacion from "../Componentes/Paginacion";
import PanelAdminUnidadesFamilia from "../Componentes/PanelAdminUnidadesFamilia";
import { exportarArregloAExcel } from "../Utils/exportarExcel";
import { EMPRESAS, FILTRO_SIN_EMPRESA, nombreEmpresa } from "../Utils/empresas";
import { formatearCalibre } from "../Utils/calibre";
import "../Style/Inventario.css";
import "../Style/Rollos.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

const ETIQUETAS_ESTADO_ENVIO: Record<string, string> = {
  pendiente_confirmacion: "Pendiente de confirmar",
  recibido: "Recibido",
  no_llego: "No llegó",
};

function AdminInventarioPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const c = useControladorAdminInventario(sesion, almacen);
  const bodegas = c.comparativo.bodegas;
  const [mostrarAdminUnidades, setMostrarAdminUnidades] = useState(false);

  function nombreItemEnvio(item: { rolloId: number | null; descripcion: string; cantidad: number | null; productoCodigo: string | null }) {
    if (item.rolloId != null) return `Rollo: ${item.descripcion}`;
    return `${item.cantidad} × ${item.productoCodigo} (${item.descripcion})`;
  }

  function exportarResumenRollos() {
    const filas = c.comparativo.rollos.map((f) => {
      const fila: Record<string, string | number> = {
        Código: f.codigo, Descripción: f.descripcion, Color: f.colorMaterial || "Sin color", Calibre: f.calibre,
      };
      for (const b of bodegas) {
        fila[`${b.nombre} (m)`] = f.porBodega[b.id] ?? 0;
        fila[`${b.nombre} (rollos)`] = f.cantidadPorBodega[b.id] ?? 0;
      }
      fila["Total empresa (m)"] = f.total;
      fila["Total rollos"] = f.cantidadTotal;
      fila["Peso actual (t)"] = f.pesoActualTotal;
      fila["Rollos sin peso actual"] = f.rollosSinPesoActual;
      return fila;
    });
    const sufijoEmpresa = c.empresaResumen ? `_${c.empresaResumen === FILTRO_SIN_EMPRESA ? "Sin_empresa" : c.empresaResumen}` : "";
    exportarArregloAExcel(filas, `Resumen_Rollos_Por_Codigo${sufijoEmpresa}.xlsx`, "Rollos por código");
  }

  function exportarResumenProductos() {
    const filas = c.comparativo.productos.map((f) => {
      const fila: Record<string, string | number> = { Código: f.codigo, Descripción: f.descripcion, Calibre: f.calibre };
      for (const b of bodegas) {
        fila[b.nombre] = f.porBodega[b.id] ?? 0;
      }
      fila["Total empresa"] = f.total;
      return fila;
    });
    exportarArregloAExcel(filas, "Resumen_Productos_Por_Codigo.xlsx", "Productos por código");
  }

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <div className="inventario-header">
            <h1 className="inventario-titulo">Inventario total</h1>
            {!c.soloLectura && !c.mostrarFormularioEnvio && (
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <button
                  className="inventario-boton-cancelar"
                  onClick={() => setMostrarAdminUnidades((actual) => !actual)}
                >
                  {mostrarAdminUnidades ? "Ocultar" : "Administrar"} unidades por familia
                </button>
                <button className="inventario-boton" onClick={c.abrirFormularioEnvio}>
                  + Nuevo envío
                </button>
              </div>
            )}
          </div>
          <p className="inventario-carga-ayuda">
            {c.soloLectura ? (
              "Consulta el inventario real de productos y rollos en cada sede."
            ) : (
              <>
                Consulta el inventario real de cada sede y reparte el material que recibiste entre ellas.
                Al enviar, la sede destino recibe una notificación para confirmar si ya llegó.
              </>
            )}
          </p>

          {mostrarAdminUnidades && !c.mostrarFormularioEnvio && (
            <PanelAdminUnidadesFamilia
              unidadesFamilia={almacen?.unidadesFamilia || []}
              guardarUnidadFamilia={almacen?.guardarUnidadFamilia}
            />
          )}

          {c.mostrarFormularioEnvio && (
            <form className="inventario-form" onSubmit={c.crearEnvio} noValidate>
              <h2 className="inventario-form-subtitulo">Nuevo envío</h2>

              <div className="inventario-form-grid">
                <div>
                  <label>Bodega destino *</label>
                  <select
                    value={c.formularioEnvio.bodegaDestinoId}
                    onChange={(e) => c.actualizarCampoEnvio("bodegaDestinoId", e.target.value)}
                  >
                    <option value="">— Selecciona —</option>
                    {bodegas.map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <h3 className="inventario-form-subtitulo">Rollos disponibles (marca los que envías)</h3>
              {c.cargandoPropio ? (
                <p className="inventario-cargando">Cargando...</p>
              ) : c.misRollos.length === 0 ? (
                <p className="inventario-carga-ayuda">No tienes rollos sin repartir en este momento.</p>
              ) : (
                <>
                  <div className="inventario-buscador">
                    <input
                      type="text"
                      placeholder="Buscar por código..."
                      value={c.busquedaRollosEnvio}
                      onChange={(e) => c.setBusquedaRollosEnvio(e.target.value)}
                    />
                  </div>
                  {c.misRollosFiltrados.length === 0 ? (
                    <p className="inventario-carga-ayuda">No hay rollos que coincidan con tu búsqueda.</p>
                  ) : (
                    <div className="inventario-tabla-contenedor">
                      <table className="inventario-tabla">
                        <thead>
                          <tr>
                            <th></th>
                            <th>Código interno</th>
                            <th>Referencia</th>
                            <th>Color</th>
                            <th>Metros disponibles</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.misRollosFiltrados.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={c.formularioEnvio.rollosSeleccionados.includes(r.id)}
                                  onChange={() => c.alternarRolloEnvio(r.id)}
                                />
                              </td>
                              <td>{r.codigoInterno}</td>
                              <td>{r.identificadorRollo}</td>
                              <td>{r.colorMaterial || "—"}</td>
                              <td>{r.metrosDisponibles}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              <h3 className="inventario-form-subtitulo">Productos disponibles (indica cuánto envías)</h3>
              {c.cargandoPropio ? (
                <p className="inventario-cargando">Cargando...</p>
              ) : c.misProductos.filter((p) => Number(p.stock) > 0).length === 0 ? (
                <p className="inventario-carga-ayuda">No tienes productos sin repartir en este momento.</p>
              ) : (
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descripción</th>
                        <th>Stock disponible</th>
                        <th>Cantidad a enviar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(c.misProductos as { id: number; codigo: string; descripcion: string; stock: number; familia: string }[])
                        .filter((p) => Number(p.stock) > 0).map((p) => (
                        <tr key={p.id}>
                          <td>{p.codigo}</td>
                          <td>{p.descripcion}</td>
                          <td>{p.stock} {almacen?.unidadPorFamilia?.[p.familia] || ""}</td>
                          <td>
                            <input
                              type="number" min="0" max={p.stock}
                              step={almacen?.decimalesPorFamilia?.[p.familia] === false ? "1" : "any"}
                              style={{ width: "6rem" }}
                              value={c.formularioEnvio.itemsProducto.find((it) => it.codigo === p.codigo)?.cantidad || ""}
                              onChange={(e) => c.actualizarCantidadProductoEnvio(p.codigo, e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <label>Observaciones</label>
                <textarea
                  rows={2}
                  value={c.formularioEnvio.observaciones}
                  onChange={(e) => c.actualizarCampoEnvio("observaciones", e.target.value)}
                />
              </div>

              {c.errorFormularioEnvio && <p className="inventario-error">{c.errorFormularioEnvio}</p>}

              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={c.guardandoEnvio}>
                  {c.guardandoEnvio ? "Enviando..." : "Enviar"}
                </button>
                <button type="button" className="inventario-boton-cancelar" onClick={c.cerrarFormularioEnvio}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {!c.mostrarFormularioEnvio && (
            <>
              {/* ================== RESUMEN: TOTAL POR CÓDIGO EN TODA LA EMPRESA ================== */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 className="inventario-form-subtitulo" style={{ margin: 0 }}>Resumen — total por código en toda la empresa</h2>
                {c.comparativo.rollos.length > 0 && (
                  <button className="inventario-boton-cancelar" onClick={exportarResumenRollos}>
                    📥 Exportar a Excel
                  </button>
                )}
              </div>
              <div className="inventario-buscador" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <label htmlFor="resumen-empresa" style={{ margin: 0 }}>Empresa</label>
                <select
                  id="resumen-empresa"
                  value={c.empresaResumen}
                  onChange={(e) => c.setEmpresaResumen(e.target.value)}
                  style={{ maxWidth: 260 }}
                >
                  <option value="">Todas</option>
                  {Object.keys(EMPRESAS).map((sigla) => (
                    <option key={sigla} value={sigla}>{nombreEmpresa(sigla)}</option>
                  ))}
                  <option value={FILTRO_SIN_EMPRESA}>Sin empresa</option>
                </select>
              </div>
              {c.errorComparativo && <p className="inventario-error">{c.errorComparativo}</p>}
              {c.cargandoComparativo ? (
                <p className="inventario-cargando">Cargando...</p>
              ) : (
                <>
                  <div className="inventario-buscador">
                    <input
                      type="text"
                      placeholder="Buscar por código o descripción..."
                      value={c.busquedaResumenRollos}
                      onChange={(e) => c.buscarResumenRollos(e.target.value)}
                    />
                  </div>
                  <div className="inventario-tabla-contenedor">
                    <table className="inventario-tabla">
                      <thead>
                        <tr>
                          <th></th>
                          <th>Código (rollo)</th>
                          <th>Descripción</th>
                          <th>Color</th>
                          <th>Calibre</th>
                          {bodegas.map((b) => <th key={b.id}>{b.nombre}</th>)}
                          <th>Total empresa</th>
                          <th>Peso actual (t)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.rollosResumenPagina.length === 0 ? (
                          <tr><td colSpan={bodegas.length + 7} className="inventario-vacio">
                            {c.busquedaResumenRollos ? "Sin resultados para tu búsqueda." : "Sin datos."}
                          </td></tr>
                        ) : (
                          c.rollosResumenPagina.map((f) => {
                            const colorClase = claseColorMaterial(f.colorMaterial);
                            const expandido = c.codigoRolloExpandido === f.codigo;
                            return (
                              <Fragment key={f.codigo}>
                                <tr className={`rollos-color-${colorClase} rollos-fila-color`}>
                                  <td>
                                    <button
                                      type="button"
                                      className="rollos-boton-secundario"
                                      style={{ padding: "0.3rem 0.6rem" }}
                                      onClick={() => c.alternarExpandirCodigoRollo(f.codigo)}
                                      title="Ver cada rollo individual y su peso"
                                    >
                                      {expandido ? "▲" : "▼"}
                                    </button>
                                  </td>
                                  <td>{f.codigo}</td>
                                  <td>{f.descripcion || "—"}</td>
                                  <td>
                                    <span className={`rollos-color-etiqueta color-${colorClase}`}>
                                      <span className="rollos-color-muestra" aria-hidden="true" />
                                      {f.colorMaterial || "Sin color"}
                                    </span>
                                  </td>
                                  <td>{f.calibre || "—"}</td>
                                  {bodegas.map((b) => {
                                    const cant = f.cantidadPorBodega[b.id] ?? 0;
                                    return (
                                      <td key={b.id}>
                                        {f.porBodega[b.id] ?? 0} m
                                        <br />
                                        <span className="rollos-texto-ayuda" style={{ margin: 0 }}>
                                          {cant} rollo{cant === 1 ? "" : "s"}
                                        </span>
                                      </td>
                                    );
                                  })}
                                  <td>
                                    <strong>{f.total} m</strong>
                                    <br />
                                    <span className="rollos-texto-ayuda" style={{ margin: 0 }}>
                                      {f.cantidadTotal} rollo{f.cantidadTotal === 1 ? "" : "s"}
                                    </span>
                                  </td>
                                  <td>
                                    {f.pesoActualTotal} t
                                    {f.rollosSinPesoActual > 0 && (
                                      <>
                                        <br />
                                        <span
                                          className="rollos-texto-ayuda"
                                          style={{ margin: 0 }}
                                          title="El calibre de estos rollos no está en la tabla de equivalencias de espesor (metros por tonelada), así que no se puede calcular su peso."
                                        >
                                          no incluye {f.rollosSinPesoActual} rollo{f.rollosSinPesoActual === 1 ? "" : "s"}:
                                          {" "}{f.calibre ? `calibre ${formatearCalibre(f.calibre)}` : "calibre vacío"} sin equivalencia
                                        </span>
                                      </>
                                    )}
                                  </td>
                                </tr>
                                {expandido && (
                                  <tr>
                                    <td colSpan={bodegas.length + 7} style={{ padding: 0 }}>
                                      {c.cargandoRollosExpandido ? (
                                        <p className="inventario-cargando">Cargando rollos...</p>
                                      ) : (
                                        <table className="rollos-tabla" style={{ margin: "0.5rem 0" }}>
                                          <thead>
                                            <tr>
                                              <th>Bodega</th>
                                              <th>Referencia</th>
                                              <th>Empresa</th>
                                              <th>Peso neto (t)</th>
                                              <th>Peso actual (t)</th>
                                              <th>Metros disponibles</th>
                                              <th>Metros consumidos</th>
                                              <th>Ingreso</th>
                                              <th>Estado</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {c.rollosDelCodigoExpandido.map((rollo) => (
                                              <tr key={rollo.id}>
                                                <td>{bodegas.find((b) => b.id === rollo.bodegaId)?.nombre || "—"}</td>
                                                <td>{rollo.identificadorRollo}</td>
                                                <td>{nombreEmpresa(rollo.empresa)}</td>
                                                <td><strong>{rollo.pesoNeto ?? "—"}</strong></td>
                                                <td>{rollo.pesoActualToneladas ?? "—"}</td>
                                                <td>{rollo.metrosDisponibles}</td>
                                                <td>{rollo.metrosConsumidos}</td>
                                                <td>{formatearFechaColombia(rollo.fechaIngreso, false)}</td>
                                                <td>
                                                  <span className={`rollos-estado-badge estado-${rollo.estado}`}>
                                                    {(ESTADOS_ROLLO as Record<string, string>)[rollo.estado]}
                                                  </span>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })
                        )}
                      </tbody>
                      {c.comparativo.rollos.length > 0 && (
                        <tfoot>
                          <tr>
                            <td colSpan={5}><strong>Peso actual por bodega (t)</strong></td>
                            {bodegas.map((b) => (
                              <td key={b.id}><strong>{c.comparativo.pesoActualTotalPorBodega[b.id] ?? 0} t</strong></td>
                            ))}
                            <td></td>
                            <td><strong>{c.comparativo.pesoActualTotalGeneral} t</strong></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <Paginacion paginacion={c.paginacionRollos} alCambiarPagina={c.setPaginaRollos} etiqueta="códigos" />
                  <p className="inventario-carga-ayuda" style={{ marginTop: "0.5rem" }}>
                    En cada sede se muestran los metros disponibles y, debajo, cuántos rollos de esa
                    clasificación hay ahí. El peso es el peso ACTUAL de esos rollos (según lo que les
                    queda hoy, no el peso con el que llegaron) — dale clic a ▼ para ver cada rollo
                    individual con su propio peso, bodega y referencia.
                  </p>
                  {c.comparativo.rollosSinPesoActualTotal > 0 && (
                    <p className="inventario-carga-ayuda" style={{ marginTop: "0.25rem" }}>
                      ⚠ {c.comparativo.rollosSinPesoActualTotal} rollo{c.comparativo.rollosSinPesoActualTotal === 1 ? "" : "s"} no
                      {c.comparativo.rollosSinPesoActualTotal === 1 ? " está incluido" : " están incluidos"} en estos totales de peso
                      porque {c.comparativo.calibresSinEquivalencia.length === 1 ? "su calibre no está" : "sus calibres no están"} en
                      la tabla de equivalencias de espesor (metros por tonelada):{" "}
                      <strong>{c.comparativo.calibresSinEquivalencia.map((cal) => (cal ? formatearCalibre(cal) : "vacío")).join(", ")}</strong>.
                      {c.soloLectura ? "" : " Agrégalos en Recepción y Verificación → Administrar tablas de equivalencias."}
                    </p>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <h2 className="inventario-form-subtitulo" style={{ margin: 0 }}>Resumen — productos por código en toda la empresa</h2>
                    {c.comparativo.productos.length > 0 && (
                      <button className="inventario-boton-cancelar" onClick={exportarResumenProductos}>
                        📥 Exportar a Excel
                      </button>
                    )}
                  </div>
                  <p className="inventario-carga-ayuda">
                    Igual que la tabla de arriba, pero para productos (mercancía por unidades, no rollos de
                    materia prima).{c.empresaResumen && " El filtro de empresa no aplica aquí: los productos no llevan empresa."}
                  </p>
                  <div className="inventario-buscador">
                    <input
                      type="text"
                      placeholder="Buscar por código o descripción..."
                      value={c.busquedaResumenProductos}
                      onChange={(e) => c.buscarResumenProductos(e.target.value)}
                    />
                  </div>
                  <div className="inventario-tabla-contenedor">
                    <table className="inventario-tabla">
                      <thead>
                        <tr>
                          <th>Código (producto)</th>
                          <th>Descripción</th>
                          <th>Calibre</th>
                          <th>Unidad</th>
                          {bodegas.map((b) => <th key={b.id}>{b.nombre}</th>)}
                          <th>Total empresa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.productosResumenPagina.length === 0 ? (
                          <tr><td colSpan={bodegas.length + 5} className="inventario-vacio">
                            {c.busquedaResumenProductos ? "Sin resultados para tu búsqueda." : "Sin datos."}
                          </td></tr>
                        ) : (
                          c.productosResumenPagina.map((f) => (
                            <tr key={f.codigo}>
                              <td>{f.codigo}</td>
                              <td>{f.descripcion || "—"}</td>
                              <td>{f.calibre || "—"}</td>
                              <td>{almacen?.unidadPorFamilia?.[f.familia] || "—"}</td>
                              {bodegas.map((b) => <td key={b.id}>{f.porBodega[b.id] ?? 0}</td>)}
                              <td><strong>{f.total}</strong></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Paginacion paginacion={c.paginacionProductos} alCambiarPagina={c.setPaginaProductos} etiqueta="códigos" />
                </>
              )}

              {!c.soloLectura && <h2 className="inventario-form-subtitulo">Envíos enviados</h2>}
              {c.soloLectura ? null : c.cargandoEnvios ? (
                <p className="inventario-cargando">Cargando...</p>
              ) : (
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla">
                    <thead>
                      <tr>
                        <th>Destino</th>
                        <th>Contenido</th>
                        <th>Estado</th>
                        <th>Enviado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.enviosEnviados.length === 0 ? (
                        <tr><td colSpan={4} className="inventario-vacio">No has creado envíos todavía.</td></tr>
                      ) : (
                        c.enviosEnviados.map((e) => (
                          <tr key={e.id}>
                            <td>{e.bodegaDestinoNombre || e.bodegaDestinoId}</td>
                            <td>{e.items.map(nombreItemEnvio).join("; ")}</td>
                            <td>{ETIQUETAS_ESTADO_ENVIO[e.estado] || e.estado}</td>
                            <td>{formatearFechaColombia(e.fechaEnvio)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminInventarioPage;
