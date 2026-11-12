import { useCallback, useEffect, useState } from "react";
import BarraLateral from "../Componentes/BarraLateral";
import { api, ErrorApi } from "../Componentes/Api";
import { EMPRESAS } from "../Utils/empresas";
import { formatearFechaColombia } from "../Utils/fechas";
import { exportarHojasAExcel } from "../Utils/exportarExcel";
import "../Style/Inventario.css";
import "../Style/Merma.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

type Prestamo = {
  id: number; fecha: string; empresa_presta: string; empresa_recibe: string; prestador: string; bodega_id: number | null;
  numero_cotizacion: string; tipo: string; codigo: string; descripcion: string; cantidad: number; unidad: string;
  referencia_rollo: string; kilos_rollo: number | null; origen: string; usuario: string; saldado: boolean; saldado_por: string;
  fecha_saldado: string | null;
};
type Deuda = {
  tipo: string; codigo: string; descripcion: string; unidad: string; presta: string; debe: string; cantidad: number;
  rollos: { referencia: string; kilos: number | null }[];
};
type ProductoBodega = { id: number; codigo: string; descripcion: string; empresa: string; stock: number; rollo_id?: number | null };
type Sacado = {
  fecha: string; bodega_id: number | null; producto_codigo: string; producto_descripcion: string; cantidad: number;
  cotizacion: string; usuario: string; observaciones: string;
};
type Reporte = { resumen: Deuda[]; prestamos: Prestamo[]; sacado_sin_existencia: Sacado[] };

const ORIGEN: Record<string, string> = {
  produccion: "Producción (Planta)", fin_produccion: "Producción terminada", salida: "Salida (Admin Inventario)",
  stock_planta: "Planta sacó de stock", union_cotizacion: "Al unir la cotización", ingreso_rollo: "Ingreso del rollo (prestado)",
  prestamo_a_tercero: "Prestado a empresa externa", devuelto_por_tercero: "Prestado a empresa externa (devuelto)",
};
const EXTERNA = "EXT";
const nombre = (sigla: string) => EMPRESAS[sigla] || sigla || "Sin empresa";
// Un tercero (empresa de afuera) va por su nombre, preste o reciba.
const quienPresta = (p: Prestamo) => (p.empresa_presta === EXTERNA && p.prestador ? p.prestador : nombre(p.empresa_presta));
const quienRecibe = (p: Prestamo) => (p.empresa_recibe === EXTERNA && p.prestador ? p.prestador : nombre(p.empresa_recibe));
const kilosTexto = (kilos: number | null) => (kilos != null ? `${kilos.toLocaleString("es-CO")} kg al llegar` : "sin kilos");
const cantidadTexto = (cantidad: number, unidad: string) =>
  `${cantidad.toLocaleString("es-CO", { maximumFractionDigits: 2 })} ${unidad === "m" ? "m" : "und"}`;

/** Préstamos entre empresas (Admin Inventario): lo que una empresa le prestó
 * a una cotización de la otra. Se anota solo cuando el material sale; aquí
 * se ve cuánto se deben, el detalle y se marca como saldado cuando cuadran. */
function PrestamosPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const [empresa, setEmpresa] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [incluirSaldados, setIncluirSaldados] = useState(false);
  const [reporte, setReporte] = useState<Reporte>({ resumen: [], prestamos: [], sacado_sin_existencia: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [saldando, setSaldando] = useState(false);
  const nombreBodega = (id: number | null) => almacen.bodegas.find((b) => b.id === id)?.nombre || "—";

  // Prestar a una empresa externa (ej. caballetes): sale del stock y queda aquí hasta que lo devuelvan.
  const [mostrarPrestar, setMostrarPrestar] = useState(false);
  const [prestarBodega, setPrestarBodega] = useState("");
  const [productosBodega, setProductosBodega] = useState<ProductoBodega[]>([]);
  const [buscarProducto, setBuscarProducto] = useState("");
  const [prestarProducto, setPrestarProducto] = useState("");
  const [prestarCantidad, setPrestarCantidad] = useState("");
  const [prestarTercero, setPrestarTercero] = useState("");
  const [prestarObservaciones, setPrestarObservaciones] = useState("");
  const [prestando, setPrestando] = useState(false);
  const [errorPrestar, setErrorPrestar] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    setProductosBodega([]);
    setPrestarProducto("");
    if (!prestarBodega) return;
    let vigente = true;
    api.get<ProductoBodega[]>(`/bodegas/${prestarBodega}/inventario`)
      .then((datos) => { if (vigente) setProductosBodega((datos || []).filter((p) => !p.rollo_id && Number(p.stock) > 0)); })
      .catch((err) => { if (vigente) setErrorPrestar(err instanceof ErrorApi ? err.message : "No se pudo cargar el inventario de esa bodega."); });
    return () => { vigente = false; };
  }, [prestarBodega]);

  const terminoProducto = buscarProducto.trim().toLowerCase();
  const productosFiltrados = productosBodega.filter((p) => !terminoProducto
    || p.codigo.toLowerCase().includes(terminoProducto) || p.descripcion.toLowerCase().includes(terminoProducto));
  const productoElegido = productosBodega.find((p) => String(p.id) === prestarProducto);

  async function prestar(e: React.FormEvent) {
    e.preventDefault();
    setErrorPrestar("");
    const cantidad = Number(prestarCantidad);
    if (!productoElegido) { setErrorPrestar("Elige el producto que vas a prestar."); return; }
    if (!(cantidad > 0)) { setErrorPrestar("Escribe cuántos vas a prestar."); return; }
    if (cantidad > Number(productoElegido.stock)) { setErrorPrestar(`Solo hay ${productoElegido.stock} en esa bodega.`); return; }
    if (!prestarTercero.trim()) { setErrorPrestar("Escribe a qué empresa se le presta."); return; }
    setPrestando(true);
    try {
      await api.post("/prestamos/a-tercero", {
        producto_id: productoElegido.id, cantidad, tercero: prestarTercero.trim(), observaciones: prestarObservaciones.trim(),
      });
      setAviso(`Listo: ${cantidad} de ${productoElegido.codigo} quedaron prestados a ${prestarTercero.trim()}.`);
      setMostrarPrestar(false);
      setPrestarBodega(""); setBuscarProducto(""); setPrestarCantidad(""); setPrestarTercero(""); setPrestarObservaciones("");
      await cargar();
    } catch (err) {
      setErrorPrestar(err instanceof ErrorApi ? err.message : "No se pudo registrar el préstamo.");
    } finally {
      setPrestando(false);
    }
  }

  async function devolver(p: Prestamo) {
    const texto = window.prompt(`¿Cuántos ${p.codigo} devolvió ${p.prestador}? (prestados sin devolver: ${p.cantidad})`, String(p.cantidad));
    if (texto == null) return;
    const cantidad = Number(texto.replace(",", "."));
    if (!(cantidad > 0) || cantidad > p.cantidad) { setError(`Escribe una cantidad entre 1 y ${p.cantidad}.`); return; }
    setError("");
    try {
      await api.post(`/prestamos/${p.id}/devolver`, { cantidad });
      setAviso(`Listo: ${cantidad} de ${p.codigo} volvieron a ${nombreBodega(p.bodega_id)}.`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo registrar la devolución.");
    }
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const parametros = new URLSearchParams();
    if (empresa) parametros.set("empresa", empresa);
    if (bodegaId) parametros.set("bodega_id", bodegaId);
    if (desde) parametros.set("desde", desde);
    if (hasta) parametros.set("hasta", hasta);
    if (incluirSaldados) parametros.set("incluir_saldados", "true");
    try {
      const datos = await api.get<Reporte>(`/prestamos?${parametros.toString()}`);
      setReporte(datos ?? { resumen: [], prestamos: [], sacado_sin_existencia: [] });
      setSeleccion(new Set());
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron cargar los préstamos.");
    } finally {
      setCargando(false);
    }
  }, [empresa, bodegaId, desde, hasta, incluirSaldados]);

  useEffect(() => { cargar(); }, [cargar]);

  function alternar(id: number) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
      return nueva;
    });
  }

  const sinSaldar = reporte.prestamos.filter((p) => !p.saldado);
  const todosElegidos = sinSaldar.length > 0 && sinSaldar.every((p) => seleccion.has(p.id));

  // Lo que se ve en pantalla (con los mismos filtros), una hoja por sección.
  function exportar() {
    exportarHojasAExcel([
      { nombre: "Lo que se deben", filas: reporte.resumen.map((d) => ({
        "Quién debe": nombre(d.debe), "A quién": nombre(d.presta), "Material": d.codigo,
        "Tipo": d.tipo === "lamina" ? "lámina" : "producto", "Descripción": d.descripcion,
        "Rollos (kilos al llegar)": d.rollos.map((r) => `${r.referencia} (${kilosTexto(r.kilos)})`).join(", "),
        "Cantidad": d.cantidad, "Unidad": d.unidad === "m" ? "m" : "und",
      })) },
      { nombre: "Detalle", filas: reporte.prestamos.map((p) => ({
        "Fecha": formatearFechaColombia(p.fecha), "Presta": quienPresta(p),
        "Recibe": quienRecibe(p), "Cotización": p.numero_cotizacion, "Bodega": nombreBodega(p.bodega_id),
        "Material": p.codigo, "Descripción": p.descripcion, "Rollo": p.referencia_rollo,
        "Kilos del rollo al llegar": p.kilos_rollo ?? "", "Cantidad": p.cantidad,
        "Unidad": p.unidad === "m" ? "m" : "und", "Dónde se anotó": ORIGEN[p.origen] || p.origen, "Usuario": p.usuario,
        "Estado": p.saldado ? "Saldado" : "Sin saldar", "Saldado el": p.fecha_saldado ? formatearFechaColombia(p.fecha_saldado) : "",
      })) },
      { nombre: "Sacado sin existencia", filas: reporte.sacado_sin_existencia.map((s) => ({
        "Fecha": formatearFechaColombia(s.fecha), "Bodega": nombreBodega(s.bodega_id), "Producto": s.producto_codigo,
        "Descripción": s.producto_descripcion, "Cantidad": s.cantidad, "Cotización": s.cotizacion, "Quién": s.usuario,
      })) },
    ], `Prestamos${desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : ""}.xlsx`);
  }

  async function saldar() {
    if (seleccion.size === 0) return;
    if (!window.confirm(`¿Marcar ${seleccion.size} préstamo(s) como saldado(s)? Dejan de contar en lo que se deben las empresas.`)) return;
    setSaldando(true);
    setError("");
    try {
      await api.post("/prestamos/saldar", { ids: [...seleccion] });
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron saldar los préstamos.");
    } finally {
      setSaldando(false);
    }
  }

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <h1 className="inventario-titulo">Préstamos entre empresas</h1>
          <p className="inventario-carga-ayuda">
            Cuando una línea de una cotización dice <strong>"Material de"</strong> la otra empresa, lo que sale de esa línea
            (al producir, al terminar la producción o al dar salida) queda anotado aquí como préstamo. Cuando las empresas
            cuadren cuentas, marca los préstamos como saldados. Los rollos que nos prestan (otra empresa o una persona)
            se anotan al ingresarlos a mano en Rollos almacenados; márcalos como saldados cuando se devuelvan o se paguen.
            Lo que le prestamos a una <strong>empresa de afuera</strong> (ej. caballetes) se registra con
            «Prestar a una empresa externa» y vuelve al stock con <strong>Devolver</strong>.
          </p>

          {aviso && <p className="inventario-exito" role="status" onClick={() => setAviso("")}>{aviso}</p>}

          <div style={{ margin: "0.75rem 0" }}>
            <button type="button" className="inventario-boton" onClick={() => { setMostrarPrestar((v) => !v); setErrorPrestar(""); }}>
              {mostrarPrestar ? "Cancelar préstamo" : "+ Prestar a una empresa externa"}
            </button>
          </div>

          {mostrarPrestar && (
            <form className="inventario-form" onSubmit={prestar} noValidate>
              <h2 className="inventario-form-subtitulo">Prestar a una empresa externa</h2>
              <p className="inventario-carga-ayuda">
                Las unidades salen del stock de la bodega y quedan abajo como «Sin saldar» hasta que las devuelvan
                (botón <strong>Devolver</strong>) o las paguen (<strong>Saldar</strong>).
              </p>
              <div className="inventario-form-grid">
                <div>
                  <label htmlFor="prestar-tercero">¿A qué empresa se le presta? *</label>
                  <input id="prestar-tercero" maxLength={150} placeholder="Ej. Constructora XYZ" value={prestarTercero}
                    onChange={(e) => setPrestarTercero(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="prestar-bodega">¿De qué bodega sale? *</label>
                  <select id="prestar-bodega" value={prestarBodega} onChange={(e) => setPrestarBodega(e.target.value)}>
                    <option value="">Elige la bodega</option>
                    {almacen.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </select>
                </div>
                {prestarBodega && (
                  <div>
                    <label htmlFor="prestar-buscar">Buscar producto</label>
                    <input id="prestar-buscar" type="search" placeholder="Código o descripción (ej. caballete)" value={buscarProducto}
                      onChange={(e) => setBuscarProducto(e.target.value)} />
                  </div>
                )}
                {prestarBodega && (
                  <div>
                    <label htmlFor="prestar-producto">Producto *</label>
                    <select id="prestar-producto" value={prestarProducto} onChange={(e) => setPrestarProducto(e.target.value)}>
                      <option value="">{productosFiltrados.length ? `Elige (${productosFiltrados.length})` : "Ningún producto con stock coincide"}</option>
                      {productosFiltrados.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo} · {p.descripcion} · {nombre(p.empresa)} · hay {Number(p.stock).toLocaleString("es-CO")}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="prestar-cantidad">Cantidad *</label>
                  <input id="prestar-cantidad" type="number" min="0" step="any" value={prestarCantidad}
                    onChange={(e) => setPrestarCantidad(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="prestar-observaciones">Observaciones</label>
                  <input id="prestar-observaciones" maxLength={500} placeholder="Ej. los recoge Juan, devuelven en 15 días"
                    value={prestarObservaciones} onChange={(e) => setPrestarObservaciones(e.target.value)} />
                </div>
              </div>
              {errorPrestar && <p className="inventario-error">{errorPrestar}</p>}
              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={prestando}>{prestando ? "Guardando..." : "Prestar"}</button>
              </div>
            </form>
          )}

          <div className="apartados-filtros">
            <select className={`apartados-select ${empresa ? "apartados-select-activo" : ""}`} aria-label="Empresa"
              value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              <option value="">Las dos empresas</option>
              {Object.entries(EMPRESAS).map(([sigla, n]) => <option key={sigla} value={sigla}>{n}</option>)}
            </select>
            <select className={`apartados-select ${bodegaId ? "apartados-select-activo" : ""}`} aria-label="Bodega"
              value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
              <option value="">Todas las bodegas</option>
              {almacen.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
            <label className="apartados-check">Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label className="apartados-check">Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
            <label className="apartados-check">
              <input type="checkbox" checked={incluirSaldados} onChange={(e) => setIncluirSaldados(e.target.checked)} /> Ver también los saldados
            </label>
            {!cargando && (reporte.resumen.length > 0 || reporte.prestamos.length > 0 || reporte.sacado_sin_existencia.length > 0) && (
              <button type="button" className="apartados-limpiar" onClick={exportar}>Exportar a Excel</button>
            )}
          </div>

          {error && <p className="inventario-error">{error}</p>}
          {cargando ? <p className="inventario-cargando">Cargando préstamos...</p> : (
            <>
              {/* ================== LO QUE SE DEBEN ================== */}
              <h2 className="inventario-form-subtitulo">Lo que se deben (sin saldar)</h2>
              {reporte.resumen.length === 0 ? (
                <p className="inventario-vacio">No se debe nada{desde || hasta || bodegaId ? " con estos filtros" : ""}.</p>
              ) : (
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla">
                    <thead>
                      <tr><th>Quién debe</th><th>A quién</th><th>Material</th><th>Descripción / rollo</th><th>Cantidad</th></tr>
                    </thead>
                    <tbody>
                      {reporte.resumen.map((d) => (
                        <tr key={`${d.tipo}|${d.codigo}|${d.debe}`}>
                          <td><strong>{nombre(d.debe)}</strong></td>
                          <td>{nombre(d.presta)}</td>
                          <td>{d.codigo} <span className="rollos-texto-ayuda" style={{ margin: 0 }}>({d.tipo === "lamina" ? "lámina" : "producto"})</span></td>
                          <td>
                            {d.descripcion || "—"}
                            {d.rollos.map((r) => (
                              <span key={r.referencia} className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>
                                Rollo {r.referencia} · {kilosTexto(r.kilos)}
                              </span>
                            ))}
                          </td>
                          <td><strong>{cantidadTexto(d.cantidad, d.unidad)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ================== DETALLE ================== */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
                <h2 className="inventario-form-subtitulo" style={{ margin: 0 }}>Detalle de cada préstamo</h2>
                {sinSaldar.length > 0 && (
                  <button type="button" className="inventario-boton" disabled={seleccion.size === 0 || saldando} onClick={saldar}>
                    {saldando ? "Guardando..." : seleccion.size ? `Saldar ${seleccion.size} seleccionado${seleccion.size === 1 ? "" : "s"}` : "Elige cuáles saldar"}
                  </button>
                )}
              </div>
              {reporte.prestamos.length === 0 ? (
                <p className="inventario-vacio">No hay préstamos{incluirSaldados ? "" : " sin saldar"}.</p>
              ) : (
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla">
                    <thead>
                      <tr>
                        <th>
                          <input type="checkbox" aria-label="Elegir todos" checked={todosElegidos} disabled={sinSaldar.length === 0}
                            onChange={() => setSeleccion(todosElegidos ? new Set() : new Set(sinSaldar.map((p) => p.id)))} />
                        </th>
                        <th>Fecha</th><th>Presta</th><th>Recibe</th><th>Cotización</th><th>Bodega</th>
                        <th>Material</th><th>Cantidad</th><th>Dónde se anotó</th><th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reporte.prestamos.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {!p.saldado && <input type="checkbox" aria-label={`Elegir préstamo ${p.id}`} checked={seleccion.has(p.id)} onChange={() => alternar(p.id)} />}
                          </td>
                          <td>{formatearFechaColombia(p.fecha)}</td>
                          <td>{quienPresta(p)}</td>
                          <td>{quienRecibe(p)}</td>
                          <td>{p.numero_cotizacion || "—"}</td>
                          <td>{nombreBodega(p.bodega_id)}</td>
                          <td>
                            <strong>{p.codigo}</strong> {p.descripcion}
                            {p.referencia_rollo && (
                              <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>
                                Rollo {p.referencia_rollo} · {kilosTexto(p.kilos_rollo)}
                              </span>
                            )}
                          </td>
                          <td>{cantidadTexto(p.cantidad, p.unidad)}</td>
                          <td>{ORIGEN[p.origen] || p.origen}{p.usuario && <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>{p.usuario}</span>}</td>
                          <td>
                            {p.saldado
                              ? `${p.origen === "devuelto_por_tercero" ? "Devuelto" : "Saldado"}${p.fecha_saldado ? ` el ${formatearFechaColombia(p.fecha_saldado)}` : ""}`
                              : "Sin saldar"}
                            {!p.saldado && p.origen === "prestamo_a_tercero" && (
                              <button type="button" className="apartados-limpiar" style={{ display: "block", marginTop: "0.35rem" }}
                                onClick={() => devolver(p)}>Devolver</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ================== SACADO SIN EXISTENCIA ================== */}
              <h2 className="inventario-form-subtitulo" style={{ marginTop: "1.5rem" }}>Sacado sin existencia en el sistema</h2>
              <p className="inventario-carga-ayuda">
                Lo que Planta sacó de la bodega para una cotización aunque el sistema decía que no había (en 0 o en negativo).
                El stock del sistema no cambió: si hace falta, cuenta lo que hay y corrígelo en Inventario total.
              </p>
              {reporte.sacado_sin_existencia.length === 0 ? (
                <p className="inventario-vacio">Nada{desde || hasta || bodegaId ? " con estos filtros" : ""}.</p>
              ) : (
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla">
                    <thead>
                      <tr><th>Fecha</th><th>Bodega</th><th>Producto</th><th>Cantidad</th><th>Cotización</th><th>Quién</th></tr>
                    </thead>
                    <tbody>
                      {reporte.sacado_sin_existencia.map((s, i) => (
                        <tr key={`${s.fecha}-${i}`} title={s.observaciones}>
                          <td>{formatearFechaColombia(s.fecha)}</td>
                          <td>{nombreBodega(s.bodega_id)}</td>
                          <td><strong>{s.producto_codigo}</strong> {s.producto_descripcion}</td>
                          <td>{s.cantidad}</td>
                          <td>{s.cotizacion || "—"}</td>
                          <td>{s.usuario || "—"}</td>
                        </tr>
                      ))}
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

export default PrestamosPage;
