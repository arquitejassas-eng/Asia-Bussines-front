import { Fragment, useEffect, useMemo, useState } from "react";
import { api, ErrorApi } from "./Api";
import { EMPRESAS } from "../Utils/empresas";
import { formatearFechaColombia } from "../Utils/fechas";
import { exportarHojasAExcel } from "../Utils/exportarExcel";

// Reportes de existencias para Admin Inventario / Superadmin: cuánto hay de
// cada tipo de producto y qué rollos trajo cada importación (ver
// backend/app/api/routes/reportes_inventario.py). Los datos llegan planos y
// aquí se filtran, se agrupan y se exportan.

type FilaProducto = {
  codigo: string; descripcion: string; familia: string; empresa: string; bodega: string;
  stock: number; apartado: number; libre: number;
};
type FilaRollo = {
  importacion: string; referencia: string; codigo: string; descripcion: string; empresa: string; color: string;
  calibre: number; kilos: number | null; kilos_actuales: number | null; metros_llegada: number; metros_disponibles: number; bodega: string;
  estado: string; fecha_ingreso: string | null; proveedor: string;
  // Vendido completo en una cotización activa ("4118 (CLIENTE)") o yendo en un traslado.
  apartado_completo?: string; en_traslado_a?: string;
};
// Metros que las cotizaciones activas apartan de un código en una bodega (sin rollo fijo).
type MetrosApartados = { codigo: string; empresa: string; bodega: string; metros_apartados: number; cotizaciones: string[] };
// Por qué un rollo no se puede ofrecer para otra venta ("" si está libre).
const apartadoDelRollo = (r: FilaRollo) => r.apartado_completo ? `Rollo completo para la cotización ${r.apartado_completo}`
  : r.en_traslado_a ? `En traslado a ${r.en_traslado_a}` : "";

const ROLLOS = "__rollos__";
const TODO_UPVC = "__upvc__";
const EN_CAMINO = "en_camino";
const SIN_BODEGA = "Admin Inventario (por repartir)";

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const nombreEmpresa = (sigla: string) => EMPRESAS[sigla] || sigla || "Sin empresa";
const ETIQUETAS_ESTADO: Record<string, string> = { cerrado: "Sin usar", abierto: "Empezado", agotado: "Agotado", en_camino: "En camino" };

// Color de una fila: el del rollo, o el que dice la descripción del producto
// ("UPVC TEJA COLONIAL TERRACOTA - 3,72" → TERRACOTA). "" si no dice ninguno.
const COLORES = ["ROJO", "AZUL", "BLANCO", "TERRACOTA", "VERDE", "NEGRO", "GRIS", "PLATEADO", "GALVANIZADO",
  "AMARILLO", "NARANJA", "CAFE", "MADERA", "BEIGE", "CREMA", "TRANSPARENTE", "TRANSLUCIDO", "CRISTAL", "BRONCE"];
const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
function colorDe(f: { descripcion: string; color?: string }) {
  if (f.color?.trim()) return sinTildes(f.color.trim());
  const palabras = sinTildes(f.descripcion).split(/[^A-Z]+/);
  return COLORES.find((c) => palabras.includes(c)) || "";
}
const nombreColor = (color: string) => color.charAt(0) + color.slice(1).toLowerCase();

// Espesor del rollo en mm (el calibre: 0,33). Como número para que Excel lo
// pueda ordenar y filtrar; "" si el rollo no lo tiene.
const espesorDe = (r: { calibre: number }) => (r.calibre > 0 ? r.calibre : "");
const textoEspesor = (calibre: number) => (calibre > 0 ? calibre.toFixed(2).replace(".", ",") : "—");
// Referencias con números en orden natural (…-2 antes de …-10).
const compararTexto = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
// Los rollos van por empresa, bodega, espesor, código y referencia.
const ordenRollos = (a: FilaRollo, b: FilaRollo) => compararTexto(nombreEmpresa(a.empresa), nombreEmpresa(b.empresa))
  || compararTexto(a.bodega, b.bodega) || (a.calibre || 0) - (b.calibre || 0)
  || compararTexto(a.codigo, b.codigo) || compararTexto(a.referencia, b.referencia);

// "17ABG" → "Importación 17 (Asia Business)"; un Lote escrito a mano se muestra tal cual.
export function nombreImportacion(clave: string) {
  if (!clave) return "Sin número de importación";
  const prefijo = /^(\d+)(ABG|AR)$/.exec(clave);
  return prefijo ? `Importación ${prefijo[1]} (${nombreEmpresa(prefijo[2])})` : clave;
}

function mensajeDeError(error: unknown) {
  return error instanceof ErrorApi || error instanceof Error ? error.message : "No se pudo cargar el reporte.";
}

// Los dos reportes usan los mismos datos: se piden una vez al abrir la pestaña.
function useDatosReporte() {
  const [productos, setProductos] = useState<FilaProducto[]>([]);
  const [rollos, setRollos] = useState<FilaRollo[]>([]);
  const [apartadosRollos, setApartadosRollos] = useState<MetrosApartados[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let vigente = true;
    Promise.all([
      api.get<FilaProducto[]>("/reportes-inventario/productos"),
      api.get<FilaRollo[]>("/reportes-inventario/rollos"),
      api.get<MetrosApartados[]>("/reportes-inventario/rollos-apartados").catch(() => []),
    ])
      .then(([p, r, ap]) => { if (vigente) { setProductos(p || []); setRollos(r || []); setApartadosRollos(ap || []); } })
      .catch((e) => { if (vigente) setError(mensajeDeError(e)); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, []);
  return { productos, rollos, apartadosRollos, cargando, error };
}

// ======================= Inventario por tipo de producto =======================

export function ReporteInventarioPorTipo() {
  const { productos, rollos, apartadosRollos, cargando, error } = useDatosReporte();
  const [tipo, setTipo] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [bodega, setBodega] = useState("");
  const [buscar, setBuscar] = useState("");
  const [color, setColor] = useState("");
  const [codigoAbierto, setCodigoAbierto] = useState<string | null>(null);

  const familias = useMemo(() => [...new Set(productos.map((p) => p.familia))].sort(), [productos]);
  const esRollos = tipo === ROLLOS;
  // Solo lo que está en inventario: ni agotados ni lo que viene en camino.
  const rollosEnInventario = useMemo(() => rollos.filter((r) => r.estado !== EN_CAMINO && r.metros_disponibles > 0), [rollos]);
  const bodegasDisponibles = useMemo(() => {
    const nombres = new Set((esRollos ? rollosEnInventario : productos).map((f) => f.bodega));
    return [...nombres].sort((a, b) => (a === SIN_BODEGA ? 1 : b === SIN_BODEGA ? -1 : a.localeCompare(b)));
  }, [esRollos, rollosEnInventario, productos]);

  // Los colores que hay en el tipo escogido (rollos o productos de ese tipo).
  const coloresDisponibles = useMemo(() => {
    const filas = esRollos ? rollosEnInventario
      : productos.filter((p) => !tipo || (tipo === TODO_UPVC ? p.familia.includes("UPVC") : p.familia === tipo));
    return [...new Set(filas.map(colorDe).filter(Boolean))].sort();
  }, [esRollos, rollosEnInventario, productos, tipo]);

  const termino = buscar.trim().toUpperCase();
  const coincide = useMemo(() => (f: { codigo: string; descripcion: string; empresa: string; bodega: string; color?: string }) =>
    (!empresa || f.empresa === empresa) && (!bodega || f.bodega === bodega) && (!color || colorDe(f) === color)
    && (!termino || f.codigo.toUpperCase().includes(termino) || f.descripcion.toUpperCase().includes(termino)),
  [empresa, bodega, color, termino]);

  const productosFiltrados = useMemo(() => productos.filter((p) =>
    (!tipo || (tipo === TODO_UPVC ? p.familia.includes("UPVC") : p.familia === tipo)) && coincide(p)),
  [productos, tipo, coincide]);
  const rollosFiltrados = useMemo(() => rollosEnInventario.filter(coincide), [rollosEnInventario, coincide]);

  // Una fila por código y empresa, con una columna por bodega.
  const columnasBodega = useMemo(() => {
    const nombres = new Set((esRollos ? rollosFiltrados : productosFiltrados).map((f) => f.bodega));
    return bodegasDisponibles.filter((b) => nombres.has(b));
  }, [esRollos, rollosFiltrados, productosFiltrados, bodegasDisponibles]);

  const filasProductos = useMemo(() => {
    const grupos = new Map<string, { codigo: string; descripcion: string; familia: string; empresa: string; porBodega: Record<string, number>; total: number; apartado: number; libre: number }>();
    for (const p of productosFiltrados) {
      const clave = `${p.codigo}|${p.empresa}`;
      const g = grupos.get(clave) || { codigo: p.codigo, descripcion: p.descripcion, familia: p.familia, empresa: p.empresa, porBodega: {}, total: 0, apartado: 0, libre: 0 };
      g.porBodega[p.bodega] = (g.porBodega[p.bodega] || 0) + p.stock;
      g.total += p.stock; g.apartado += p.apartado; g.libre += p.libre;
      grupos.set(clave, g);
    }
    return [...grupos.values()].sort((a, b) => a.familia.localeCompare(b.familia) || a.codigo.localeCompare(b.codigo));
  }, [productosFiltrados]);

  const filasRollos = useMemo(() => {
    const grupos = new Map<string, { codigo: string; descripcion: string; empresa: string; calibre: number; color: string; porBodega: Record<string, { rollos: number; metros: number; kilos: number }>; rollos: number; metros: number; kilos: number; lista: FilaRollo[] }>();
    for (const r of rollosFiltrados) {
      const clave = `${r.codigo}|${r.empresa}`;
      const g = grupos.get(clave) || { codigo: r.codigo, descripcion: r.descripcion, empresa: r.empresa, calibre: r.calibre, color: colorDe(r), porBodega: {}, rollos: 0, metros: 0, kilos: 0, lista: [] };
      const celda = g.porBodega[r.bodega] || { rollos: 0, metros: 0, kilos: 0 };
      celda.rollos += 1; celda.metros += r.metros_disponibles; celda.kilos += r.kilos_actuales ?? 0;
      g.porBodega[r.bodega] = celda;
      g.rollos += 1; g.metros += r.metros_disponibles; g.kilos += r.kilos_actuales ?? 0;
      g.lista.push(r);
      grupos.set(clave, g);
    }
    for (const g of grupos.values()) g.lista.sort(ordenRollos);
    // Lo apartado: los rollos vendidos completos o en traslado, más los metros
    // que piden las cotizaciones de ese código en esas bodegas. Libre = lo que
    // de verdad se puede ofrecer.
    return [...grupos.values()].map((g) => {
      const bodegasDelGrupo = new Set(g.lista.map((r) => r.bodega));
      const porMetros = apartadosRollos.filter((a) => a.codigo === g.codigo && a.empresa === g.empresa && bodegasDelGrupo.has(a.bodega));
      const enRollos = g.lista.filter((r) => apartadoDelRollo(r));
      const apartado = Math.min(g.metros, porMetros.reduce((s, a) => s + a.metros_apartados, 0) + enRollos.reduce((s, r) => s + r.metros_disponibles, 0));
      const cotizaciones = [...new Set([...porMetros.flatMap((a) => a.cotizaciones),
        ...enRollos.map((r) => r.apartado_completo ? r.apartado_completo.split(" ")[0] : `traslado a ${r.en_traslado_a}`)])];
      return { ...g, apartado, libre: Math.max(0, g.metros - apartado), cotizaciones };
    }).sort((a, b) => compararTexto(nombreEmpresa(a.empresa), nombreEmpresa(b.empresa))
      || (a.calibre || 0) - (b.calibre || 0) || compararTexto(a.codigo, b.codigo));
  }, [rollosFiltrados, apartadosRollos]);

  const nombreTipo = esRollos ? "Rollos de lámina" : tipo === TODO_UPVC ? "Todo UPVC" : tipo || "Todos los productos";

  // La descripción de los rollos casi siempre viene vacía: solo sale si alguno la tiene.
  const conDescripcion = rollosFiltrados.some((r) => r.descripcion?.trim());

  function exportar() {
    const sufijo = [nombreTipo, empresa && nombreEmpresa(empresa), bodega, color && nombreColor(color)].filter(Boolean).join(" - ");
    if (esRollos) {
      exportarHojasAExcel([
        { nombre: "Resumen por código", filas: filasRollos.map((g) => ({
          "Empresa": nombreEmpresa(g.empresa), "Código": g.codigo, "Espesor (mm)": espesorDe(g),
          "Color": g.color ? nombreColor(g.color) : "", ...(conDescripcion ? { "Descripción": g.descripcion } : {}),
          ...Object.fromEntries(columnasBodega.flatMap((b) => [
            [`${b} (metros)`, g.porBodega[b] ? Math.round(g.porBodega[b].metros * 100) / 100 : 0],
            [`${b} (kg)`, g.porBodega[b] ? Math.round(g.porBodega[b].kilos) : 0],
          ])),
          "Rollos": g.rollos, "Metros": Math.round(g.metros * 100) / 100, "Kilos": Math.round(g.kilos),
          "Apartado (m)": Math.round(g.apartado * 100) / 100, "Libre para vender (m)": Math.round(g.libre * 100) / 100,
          "Apartado para": g.cotizaciones.join(", "),
        })) },
        { nombre: "Detalle por rollo", filas: [...rollosFiltrados].sort(ordenRollos).map((r) => ({
          "Empresa": nombreEmpresa(r.empresa), "Bodega": r.bodega, "Código": r.codigo, "Espesor (mm)": espesorDe(r),
          "Color": colorDe(r) ? nombreColor(colorDe(r)) : "", "Referencia": r.referencia,
          ...(conDescripcion ? { "Descripción": r.descripcion } : {}),
          "Metros disponibles": r.metros_disponibles, "Kilos hoy": r.kilos_actuales ?? "", "Kilos al llegar": r.kilos ?? "",
          "Estado": ETIQUETAS_ESTADO[r.estado] || r.estado, "Apartado": apartadoDelRollo(r) || "Libre",
          "Importación": nombreImportacion(r.importacion),
        })) },
      ], `Inventario ${sufijo}.xlsx`);
    } else {
      exportarHojasAExcel([
        { nombre: "Inventario", filas: filasProductos.map((g) => ({
          "Código": g.codigo, "Descripción": g.descripcion, "Tipo": g.familia, "Empresa": nombreEmpresa(g.empresa),
          ...Object.fromEntries(columnasBodega.map((b) => [`En ${b}`, g.porBodega[b] ?? 0])),
          "Total": g.total, "Apartado": g.apartado, "Libre": g.libre,
        })) },
        // Una fila por producto y bodega: dice en qué bodega está cada cosa.
        { nombre: "Por bodega", filas: [...productosFiltrados]
          .sort((a, b) => compararTexto(a.bodega, b.bodega) || a.familia.localeCompare(b.familia) || a.codigo.localeCompare(b.codigo))
          .map((p) => ({
            "Bodega": p.bodega, "Código": p.codigo, "Descripción": p.descripcion, "Tipo": p.familia,
            "Empresa": nombreEmpresa(p.empresa), "Cantidad": p.stock, "Apartado": p.apartado, "Libre": p.libre,
          })) },
      ], `Inventario ${sufijo}.xlsx`);
    }
  }

  const totalUnidades = filasProductos.reduce((s, g) => s + g.total, 0);
  const totalMetros = filasRollos.reduce((s, g) => s + g.metros, 0);
  const totalKilos = filasRollos.reduce((s, g) => s + g.kilos, 0);
  const hayFiltros = Boolean(tipo || empresa || bodega || color || buscar);

  return (
    <>
      <section className="reportes-tarjeta">
        <h2>Inventario por tipo de producto</h2>
        <div className="reportes-filtros-grid">
          <div>
            <label htmlFor="rep-tipo">Tipo de producto</label>
            <select id="rep-tipo" value={tipo} onChange={(e) => { setTipo(e.target.value); setBodega(""); setColor(""); }}>
              <option value="">Todos los productos</option>
              <option value={TODO_UPVC}>Todo UPVC</option>
              <option value={ROLLOS}>Rollos de lámina</option>
              <optgroup label="Un tipo">
                {familias.map((f) => <option key={f} value={f}>{f}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label htmlFor="rep-empresa">Empresa</label>
            <select id="rep-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              <option value="">Las dos</option>
              {Object.entries(EMPRESAS).map(([sigla, nombre]) => <option key={sigla} value={sigla}>{nombre}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rep-bodega">Bodega</label>
            <select id="rep-bodega" value={bodega} onChange={(e) => setBodega(e.target.value)}>
              <option value="">Todas</option>
              {bodegasDisponibles.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rep-color">Color</label>
            <select id="rep-color" value={color} onChange={(e) => setColor(e.target.value)}>
              <option value="">Todos</option>
              {coloresDisponibles.map((c) => <option key={c} value={c}>{nombreColor(c)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rep-buscar">Buscar código o descripción</label>
            <input id="rep-buscar" type="text" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Ej. LR30020 o TORNILLO" />
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", marginTop: "12px", flexWrap: "wrap" }}>
          {hayFiltros && (
            <button type="button" className="reportes-boton-secundario" onClick={() => { setTipo(""); setEmpresa(""); setBodega(""); setColor(""); setBuscar(""); }}>
              Limpiar filtros
            </button>
          )}
          <button type="button" className="reportes-boton-secundario" onClick={exportar}
            disabled={esRollos ? filasRollos.length === 0 : filasProductos.length === 0}>
            📥 Exportar a Excel
          </button>
        </div>
      </section>

      <section className="reportes-tarjeta">
        <h2>{nombreTipo}{empresa ? ` · ${nombreEmpresa(empresa)}` : ""}{bodega ? ` · ${bodega}` : ""}{color ? ` · ${nombreColor(color)}` : ""}</h2>
        {cargando ? <p className="reportes-vacio">Cargando...</p>
          : error ? <p className="reportes-error">{error}</p>
          : (esRollos ? filasRollos.length === 0 : filasProductos.length === 0) ? <p className="reportes-vacio">No hay existencias con estos filtros.</p>
          : (
            <>
              <p className="reportes-texto-ayuda" style={{ marginBottom: "0.75rem" }}>
                {esRollos
                  ? `${filasRollos.length} códigos · ${rollosFiltrados.length} rollos · ${numero.format(totalMetros)} metros · ${numero.format(Math.round(totalKilos))} kg. `
                    + "Solo rollos con material (sin agotados ni lo que viene en camino). Toca un código para ver cada rollo con sus kilos."
                  : `${filasProductos.length} productos · ${numero.format(totalUnidades)} unidades en total.`}
              </p>
              <div className="reportes-tabla-wrap">
                <table className="reportes-tabla">
                  <thead>
                    <tr>
                      <th>Código</th>
                      {esRollos && <th className="reportes-num">Espesor (mm)</th>}
                      <th>Descripción</th>
                      {!esRollos && <th>Tipo</th>}
                      <th>Empresa</th>
                      {columnasBodega.map((b) => <th key={b} className="reportes-num">{b}</th>)}
                      {esRollos ? <><th className="reportes-num">Rollos</th><th className="reportes-num">Metros</th><th className="reportes-num">Kilos</th>
                        <th className="reportes-num">Apartado</th><th className="reportes-num">Libre</th></>
                        : <><th className="reportes-num">Total</th><th className="reportes-num">Apartado</th><th className="reportes-num">Libre</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {esRollos ? filasRollos.map((g) => {
                      const clave = `${g.codigo}|${g.empresa}`;
                      const abierto = codigoAbierto === clave;
                      return (
                        <Fragment key={clave}>
                          <tr className={`reportes-fila-importacion${abierto ? " abierta" : ""}`} onClick={() => setCodigoAbierto(abierto ? null : clave)}>
                            <td className="reportes-codigo">
                              <button type="button" className="reportes-importacion-boton" aria-expanded={abierto}>
                                {abierto ? "▲" : "▼"} {g.codigo}
                              </button>
                            </td>
                            <td className="reportes-num"><strong>{textoEspesor(g.calibre)}</strong></td>
                            <td>{g.descripcion || (g.color ? nombreColor(g.color) : "—")}</td>
                            <td>{nombreEmpresa(g.empresa)}</td>
                            {columnasBodega.map((b) => (
                              <td key={b} className="reportes-num">
                                {g.porBodega[b] ? <>{numero.format(g.porBodega[b].metros)} m
                                  <span className="reportes-sub">{numero.format(Math.round(g.porBodega[b].kilos))} kg · {g.porBodega[b].rollos} rollo{g.porBodega[b].rollos === 1 ? "" : "s"}</span></> : "—"}
                              </td>
                            ))}
                            <td className="reportes-num"><strong>{g.rollos}</strong></td>
                            <td className="reportes-num"><strong>{numero.format(g.metros)}</strong></td>
                            <td className="reportes-num"><strong>{numero.format(Math.round(g.kilos))}</strong></td>
                            <td className="reportes-num" title={g.cotizaciones.length ? `Apartado para: ${g.cotizaciones.join(", ")}` : undefined}>
                              {g.apartado > 0.005 ? <>{numero.format(g.apartado)} m
                                <span className="reportes-sub">{g.cotizaciones.slice(0, 3).join(", ")}{g.cotizaciones.length > 3 ? ` y ${g.cotizaciones.length - 3} más` : ""}</span></> : "—"}
                            </td>
                            <td className="reportes-num"><strong>{numero.format(g.libre)} m</strong></td>
                          </tr>
                          {abierto && (
                            <tr className="reportes-detalle-importacion">
                              <td colSpan={columnasBodega.length + 9}>
                                <table className="reportes-tabla reportes-tabla-interna">
                                  <thead>
                                    <tr>
                                      <th>Referencia</th><th>Bodega</th><th className="reportes-num">Kilos al llegar</th>
                                      <th className="reportes-num">Kilos hoy</th><th className="reportes-num">Metros</th><th>Estado</th><th>Apartado</th><th>Importación</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.lista.map((r) => (
                                      <tr key={r.referencia}>
                                        <td className="reportes-codigo">{r.referencia}</td>
                                        <td>{r.bodega}</td>
                                        <td className="reportes-num">{r.kilos != null ? numero.format(r.kilos) : "—"}</td>
                                        <td className="reportes-num"><strong>{r.kilos_actuales != null ? numero.format(r.kilos_actuales) : "—"}</strong></td>
                                        <td className="reportes-num">{numero.format(r.metros_disponibles)}</td>
                                        <td><span className={`reportes-estado-rollo estado-${r.estado}`}>{ETIQUETAS_ESTADO[r.estado] || r.estado}</span></td>
                                        <td>{apartadoDelRollo(r) ? <strong style={{ color: "var(--at-terra, #B7451F)" }}>{apartadoDelRollo(r)}</strong> : "Libre"}</td>
                                        <td>{nombreImportacion(r.importacion)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    }) : filasProductos.map((g) => (
                      <tr key={`${g.codigo}|${g.empresa}`}>
                        <td className="reportes-codigo">{g.codigo}</td>
                        <td>{g.descripcion}</td>
                        <td>{g.familia}</td>
                        <td>{nombreEmpresa(g.empresa)}</td>
                        {columnasBodega.map((b) => <td key={b} className="reportes-num">{g.porBodega[b] != null ? numero.format(g.porBodega[b]) : "—"}</td>)}
                        <td className="reportes-num"><strong>{numero.format(g.total)}</strong></td>
                        <td className="reportes-num">{g.apartado ? numero.format(g.apartado) : "—"}</td>
                        <td className={`reportes-num${g.libre < 0 ? " reportes-negativo" : ""}`}>{numero.format(g.libre)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </section>
    </>
  );
}

// ======================= Rollos por importación =======================

type ResumenImportacion = {
  clave: string; empresas: string[]; rollos: FilaRollo[]; enCamino: number; conMaterial: number; agotados: number;
  kilos: number; metrosLlegada: number; metrosQuedan: number; primeraFecha: string | null;
};

export function ReporteImportaciones() {
  const { rollos, cargando, error } = useDatosReporte();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [soloConMaterial, setSoloConMaterial] = useState(false);

  const importaciones = useMemo(() => {
    const grupos = new Map<string, ResumenImportacion>();
    for (const r of rollos) {
      const g = grupos.get(r.importacion) || { clave: r.importacion, empresas: [], rollos: [], enCamino: 0, conMaterial: 0, agotados: 0, kilos: 0, metrosLlegada: 0, metrosQuedan: 0, primeraFecha: null };
      g.rollos.push(r);
      if (r.empresa && !g.empresas.includes(r.empresa)) g.empresas.push(r.empresa);
      if (r.estado === EN_CAMINO) g.enCamino += 1;
      else if (r.metros_disponibles > 0) g.conMaterial += 1;
      else g.agotados += 1;
      g.kilos += r.kilos || 0;
      g.metrosLlegada += r.metros_llegada;
      if (r.estado !== EN_CAMINO) g.metrosQuedan += r.metros_disponibles;
      if (r.fecha_ingreso && (!g.primeraFecha || r.fecha_ingreso < g.primeraFecha)) g.primeraFecha = r.fecha_ingreso;
      grupos.set(r.importacion, g);
    }
    // La más reciente arriba; los rollos sin importación, al final.
    return [...grupos.values()].sort((a, b) =>
      (a.clave ? 0 : 1) - (b.clave ? 0 : 1) || (b.primeraFecha || "").localeCompare(a.primeraFecha || ""));
  }, [rollos]);

  const termino = buscar.trim().toUpperCase().replace(",", ".");
  const rollosDe = (g: ResumenImportacion) => g.rollos.filter((r) =>
    (!soloConMaterial || (r.estado !== EN_CAMINO && r.metros_disponibles > 0))
    && (!termino || r.referencia.toUpperCase().includes(buscar.trim().toUpperCase()) || r.codigo.toUpperCase().includes(buscar.trim().toUpperCase())
      || String(r.kilos ?? "").includes(termino)));

  function exportar(lista: ResumenImportacion[], archivo: string) {
    exportarHojasAExcel([
      { nombre: "Importaciones", filas: lista.map((g) => ({
        "Importación": nombreImportacion(g.clave), "Empresa": g.empresas.map(nombreEmpresa).join(" / "),
        "Primer ingreso": g.primeraFecha ? formatearFechaColombia(g.primeraFecha, false) : "",
        "Rollos": g.rollos.length, "En camino": g.enCamino, "Con material": g.conMaterial, "Agotados": g.agotados,
        "Kilos": Math.round(g.kilos * 100) / 100, "Metros que llegaron": Math.round(g.metrosLlegada * 100) / 100,
        "Metros que quedan": Math.round(g.metrosQuedan * 100) / 100,
      })) },
      { nombre: "Rollos", filas: lista.flatMap((g) => rollosDe(g).map((r) => ({
        "Importación": nombreImportacion(g.clave), "Referencia": r.referencia, "Código": r.codigo, "Espesor (mm)": espesorDe(r),
        "Descripción": r.descripcion,
        "Empresa": nombreEmpresa(r.empresa), "Kilos al llegar": r.kilos ?? "", "Kilos hoy": r.estado === EN_CAMINO ? "" : r.kilos_actuales ?? "",
        "Metros que llegaron": r.metros_llegada,
        "Metros que quedan": r.estado === EN_CAMINO ? "" : r.metros_disponibles, "Bodega": r.bodega,
        "Estado": ETIQUETAS_ESTADO[r.estado] || r.estado,
        "Ingreso": r.fecha_ingreso ? formatearFechaColombia(r.fecha_ingreso, false) : "", "Proveedor": r.proveedor,
      }))) },
    ], archivo);
  }

  return (
    <section className="reportes-tarjeta">
      <h2>Rollos por importación</h2>
      <p className="reportes-texto-ayuda" style={{ marginBottom: "0.75rem" }}>
        La importación sale del <strong>Lote</strong> que se escoge al subir el Excel en Recepción (ej. "6 IMPORTACION 2026").
        Si un rollo no tiene Lote, se toma del inicio de su referencia (17ABG… = importación 17 de Asia Business).
        Toca una importación para ver sus rollos.
      </p>
      <div className="reportes-filtros-grid" style={{ marginBottom: "0.75rem" }}>
        <div>
          <label htmlFor="rep-imp-buscar">Buscar rollo (referencia, código o kilos)</label>
          <input id="rep-imp-buscar" type="text" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Ej. 17ABGLR30020 o 4378" />
        </div>
        <label className="reportes-check">
          <input type="checkbox" checked={soloConMaterial} onChange={(e) => setSoloConMaterial(e.target.checked)} />
          Solo rollos que todavía tienen material
        </label>
      </div>
      <div style={{ display: "flex", gap: "12px", marginBottom: "1rem", flexWrap: "wrap" }}>
        <button type="button" className="reportes-boton-secundario" onClick={() => exportar(importaciones, "Importaciones.xlsx")} disabled={importaciones.length === 0}>
          📥 Exportar todas a Excel
        </button>
      </div>
      {cargando ? <p className="reportes-vacio">Cargando...</p>
        : error ? <p className="reportes-error">{error}</p>
        : importaciones.length === 0 ? <p className="reportes-vacio">Todavía no hay rollos registrados.</p>
        : (
          <div className="reportes-tabla-wrap">
            <table className="reportes-tabla">
              <thead>
                <tr>
                  <th>Importación</th>
                  <th>Empresa</th>
                  <th>Primer ingreso</th>
                  <th className="reportes-num">Rollos</th>
                  <th className="reportes-num">En camino</th>
                  <th className="reportes-num">Con material</th>
                  <th className="reportes-num">Agotados</th>
                  <th className="reportes-num">Metros que llegaron</th>
                  <th className="reportes-num">Metros que quedan</th>
                </tr>
              </thead>
              <tbody>
                {importaciones.map((g) => {
                  const estaAbierta = abierta === g.clave;
                  const visibles = estaAbierta ? rollosDe(g) : [];
                  return (
                    <Fragment key={g.clave || "sin"}>
                      <tr className={`reportes-fila-importacion${estaAbierta ? " abierta" : ""}`} onClick={() => setAbierta(estaAbierta ? null : g.clave)}>
                        <td>
                          <button type="button" className="reportes-importacion-boton" aria-expanded={estaAbierta}>
                            {estaAbierta ? "▲" : "▼"} {nombreImportacion(g.clave)}
                          </button>
                        </td>
                        <td>{g.empresas.map(nombreEmpresa).join(" / ") || "—"}</td>
                        <td>{g.primeraFecha ? formatearFechaColombia(g.primeraFecha, false) : "—"}</td>
                        <td className="reportes-num"><strong>{g.rollos.length}</strong></td>
                        <td className="reportes-num">{g.enCamino || "—"}</td>
                        <td className="reportes-num">{g.conMaterial || "—"}</td>
                        <td className="reportes-num">{g.agotados || "—"}</td>
                        <td className="reportes-num">{numero.format(g.metrosLlegada)}</td>
                        <td className="reportes-num"><strong>{numero.format(g.metrosQuedan)}</strong></td>
                      </tr>
                      {estaAbierta && (
                        <tr className="reportes-detalle-importacion">
                          <td colSpan={9}>
                            <div className="reportes-detalle-cabeza">
                              <strong>{visibles.length} de {g.rollos.length} rollos</strong>
                              <button type="button" className="reportes-boton-secundario"
                                onClick={() => exportar([g], `${nombreImportacion(g.clave)}.xlsx`)}>
                                📥 Exportar esta importación
                              </button>
                            </div>
                            {visibles.length === 0 ? <p className="reportes-vacio">Ningún rollo coincide con la búsqueda.</p> : (
                              <table className="reportes-tabla reportes-tabla-interna">
                                <thead>
                                  <tr>
                                    <th>Referencia</th><th>Código</th><th className="reportes-num">Espesor (mm)</th><th className="reportes-num">Kilos al llegar</th><th className="reportes-num">Kilos hoy</th>
                                    <th className="reportes-num">Metros que llegaron</th><th className="reportes-num">Metros que quedan</th>
                                    <th>Bodega</th><th>Estado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibles.map((r) => (
                                    <tr key={`${r.estado}-${r.referencia}`}>
                                      <td className="reportes-codigo">{r.referencia}</td>
                                      <td>{r.codigo}</td>
                                      <td className="reportes-num">{textoEspesor(r.calibre)}</td>
                                      <td className="reportes-num">{r.kilos != null ? numero.format(r.kilos) : "—"}</td>
                                      <td className="reportes-num">{r.estado === EN_CAMINO || r.kilos_actuales == null ? "—" : numero.format(r.kilos_actuales)}</td>
                                      <td className="reportes-num">{numero.format(r.metros_llegada)}</td>
                                      <td className="reportes-num">{r.estado === EN_CAMINO ? "—" : numero.format(r.metros_disponibles)}</td>
                                      <td>{r.bodega}</td>
                                      <td><span className={`reportes-estado-rollo estado-${r.estado}`}>{ETIQUETAS_ESTADO[r.estado] || r.estado}</span></td>
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
                })}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
