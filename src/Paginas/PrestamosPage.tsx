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
  referencia_rollo: string; origen: string; usuario: string; saldado: boolean; saldado_por: string; fecha_saldado: string | null;
};
type Deuda = { tipo: string; codigo: string; descripcion: string; unidad: string; presta: string; debe: string; cantidad: number };
type Sacado = {
  fecha: string; bodega_id: number | null; producto_codigo: string; producto_descripcion: string; cantidad: number;
  cotizacion: string; usuario: string; observaciones: string;
};
type Reporte = { resumen: Deuda[]; prestamos: Prestamo[]; sacado_sin_existencia: Sacado[] };

const ORIGEN: Record<string, string> = {
  produccion: "Producción (Planta)", fin_produccion: "Producción terminada", salida: "Salida (Admin Inventario)",
  stock_planta: "Planta sacó de stock", union_cotizacion: "Al unir la cotización", ingreso_rollo: "Ingreso del rollo (prestado)",
};
const nombre = (sigla: string) => EMPRESAS[sigla] || sigla;
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
        "Tipo": d.tipo === "lamina" ? "lámina" : "producto", "Descripción": d.descripcion, "Cantidad": d.cantidad,
        "Unidad": d.unidad === "m" ? "m" : "und",
      })) },
      { nombre: "Detalle", filas: reporte.prestamos.map((p) => ({
        "Fecha": formatearFechaColombia(p.fecha), "Presta": p.prestador || nombre(p.empresa_presta),
        "Recibe": nombre(p.empresa_recibe), "Cotización": p.numero_cotizacion, "Bodega": nombreBodega(p.bodega_id),
        "Material": p.codigo, "Descripción": p.descripcion, "Rollo": p.referencia_rollo, "Cantidad": p.cantidad,
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
          </p>

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
                      <tr><th>Quién debe</th><th>A quién</th><th>Material</th><th>Descripción</th><th>Cantidad</th></tr>
                    </thead>
                    <tbody>
                      {reporte.resumen.map((d) => (
                        <tr key={`${d.tipo}|${d.codigo}|${d.debe}`}>
                          <td><strong>{nombre(d.debe)}</strong></td>
                          <td>{nombre(d.presta)}</td>
                          <td>{d.codigo} <span className="rollos-texto-ayuda" style={{ margin: 0 }}>({d.tipo === "lamina" ? "lámina" : "producto"})</span></td>
                          <td>{d.descripcion || "—"}</td>
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
                          <td>{p.prestador || nombre(p.empresa_presta)}</td>
                          <td>{nombre(p.empresa_recibe) || "—"}</td>
                          <td>{p.numero_cotizacion || "—"}</td>
                          <td>{nombreBodega(p.bodega_id)}</td>
                          <td>
                            <strong>{p.codigo}</strong> {p.descripcion}
                            {p.referencia_rollo && <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>Rollo {p.referencia_rollo}</span>}
                          </td>
                          <td>{cantidadTexto(p.cantidad, p.unidad)}</td>
                          <td>{ORIGEN[p.origen] || p.origen}{p.usuario && <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>{p.usuario}</span>}</td>
                          <td>{p.saldado ? `Saldado${p.fecha_saldado ? ` el ${formatearFechaColombia(p.fecha_saldado)}` : ""}` : "Sin saldar"}</td>
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
