import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import { formatearFechaColombia } from "../Utils/fechas";
import { exportarHojasAExcel } from "../Utils/exportarExcel";
import Paginacion from "./Paginacion";

const POR_PAGINA = 15;

export type FilaCuadre = {
  id: number; fecha: string; prestador: string; numero_cotizacion: string; bodega_id: number | null; empresa_presta: string;
  codigo: string; referencia_rollo: string; metros: number; kilos_prestados: number | null; devuelto_con: string;
  kilos_devueltos: number | null; fecha_devuelto: string | null; diferencia: number | null; estado: string;
  factura: string; fecha_factura: string | null;
  /** "nos_prestaron": la empresa de afuera nos prestó a nosotros; "prestamos": le prestamos. */
  direccion?: string; empresa_nuestra?: string;
};

export const ESTADO: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: "Sin devolver", color: "#8a5a00" },
  por_recoger: { texto: "Por recoger (falta la Salida)", color: "#8a5a00" },
  cancelada: { texto: "Cotización cancelada", color: "#666" },
  cerrado: { texto: "Cerrado", color: "#666" },
  sin_kilos: { texto: "Devuelto (sin kilos para comparar)", color: "#666" },
  cuadrado: { texto: "Cuadrado", color: "#1b7a3a" },
  por_pagar: { texto: "Les debemos (por pagar)", color: "#b3261e" },
  pagado: { texto: "Pagado", color: "#1b7a3a" },
  por_facturar: { texto: "Por facturar", color: "#b3261e" },
  facturado: { texto: "Facturado", color: "#1b7a3a" },
};
// Pendientes: sin devolver, por recoger o devueltos con kilos de menos sin facturar.
// Lo demás (cuadrado, facturado, de más, cerrado) ya está saldado.
export const CUADRE_PENDIENTE = new Set(["pendiente", "por_recoger", "por_facturar", "por_pagar"]);
const kg = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} kg`);

/** Cada rollo prestado a una empresa externa: kilos que se fueron contra los
 * que volvieron (el mismo rollo u otro). Lo que devolvieron de menos se
 * factura: aquí se anota el número de la factura. */
export default function CuadreRollosPrestados({ nombreBodega, recargar, vista, alCargar, externa = "" }: {
  nombreBodega: (id: number | null) => string; recargar: number; vista: "pendientes" | "saldados";
  alCargar?: (filas: FilaCuadre[]) => void;
  /** Solo los de esta empresa externa (vacío = todas). */
  externa?: string;
}) {
  const [filas, setFilas] = useState<FilaCuadre[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [soloPorFacturar, setSoloPorFacturar] = useState(false);
  const [facturas, setFacturas] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const datos = (await api.get<FilaCuadre[]>("/prestamos/cuadre-terceros")) || [];
      setFilas(datos);
      alCargar?.(datos);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo cargar el cuadre de rollos prestados.");
    } finally {
      setCargando(false);
    }
  }, [alCargar]);
  useEffect(() => { cargar(); }, [cargar, recargar]);

  async function guardarFactura(fila: FilaCuadre) {
    const factura = (facturas[fila.id] ?? fila.factura).trim();
    if (!factura && !window.confirm("¿Quitar el número de factura?")) return;
    setError("");
    try {
      await api.post(`/prestamos/${fila.id}/factura`, { factura });
      setFacturas((actual) => { const nuevo = { ...actual }; delete nuevo[fila.id]; return nuevo; });
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo guardar la factura.");
    }
  }

  const porFacturar = filas.filter((f) => f.estado === "por_facturar" && (!externa || f.prestador === externa));
  const totalPorFacturar = porFacturar.reduce((suma, f) => suma + (f.diferencia || 0), 0);
  const porPagar = filas.filter((f) => f.estado === "por_pagar" && (!externa || f.prestador === externa));
  const totalPorPagar = porPagar.reduce((suma, f) => suma - (f.diferencia || 0), 0);
  const deLaVista = filas.filter((f) => CUADRE_PENDIENTE.has(f.estado) === (vista === "pendientes") && (!externa || f.prestador === externa));
  const visibles = soloPorFacturar && vista === "pendientes" ? [...porFacturar, ...porPagar] : deLaVista;
  const [pagina, setPagina] = useState(1);
  useEffect(() => { setPagina(1); }, [vista, externa]);
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const paginaValida = Math.min(pagina, totalPaginas);
  const deLaPagina = visibles.slice((paginaValida - 1) * POR_PAGINA, paginaValida * POR_PAGINA);

  function exportar() {
    exportarHojasAExcel([{ nombre: "Cuadre rollos prestados", filas: visibles.map((f) => ({
      "Fecha préstamo": formatearFechaColombia(f.fecha), "Empresa": f.prestador, "Cotización": f.numero_cotizacion,
      "Bodega": nombreBodega(f.bodega_id), "Código": f.codigo, "Rollo prestado": f.referencia_rollo, "Metros": f.metros,
      "Kg prestados": f.kilos_prestados ?? "", "Pagaron con": f.devuelto_con, "Kg devueltos": f.kilos_devueltos ?? "",
      "Fecha devolución": f.fecha_devuelto ? formatearFechaColombia(f.fecha_devuelto) : "",
      "Diferencia kg (+ nos deben / - les debemos)": f.diferencia ?? "", "Estado": ESTADO[f.estado]?.texto || f.estado, "Factura": f.factura,
    })) }], `Cuadre rollos prestados ${vista}.xlsx`);
  }

  return (
    <>
      <div className="prestamos-seccion-fila">
        <div className="prestamos-seccion-cabeza" style={{ margin: 0 }}>
          <h2 className="inventario-form-subtitulo">Rollos prestados con empresas de afuera</h2>
          <p>
            {vista === "saldados"
              ? "Los que ya quedaron cuadrados, facturados o pagados."
              : "Los que les prestamos y los que nos prestaron: kilos prestados contra los devueltos. La diferencia se factura o se paga."}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          {vista === "pendientes" && <label className="apartados-check">
            <input type="checkbox" checked={soloPorFacturar} onChange={(e) => { setSoloPorFacturar(e.target.checked); setPagina(1); }} /> Solo por facturar o pagar
          </label>}
          {visibles.length > 0 && <button type="button" className="boton-terciario" onClick={exportar}>Exportar a Excel</button>}
        </div>
      </div>
      {vista === "pendientes" && (porFacturar.length > 0 || porPagar.length > 0) && (
        <div className="prestamos-totales">
          {porFacturar.length > 0 && (
            <div><span>Por facturar (nos deben)</span><strong>{kg(Math.round(totalPorFacturar * 10) / 10)}</strong><small>{porFacturar.length} rollo{porFacturar.length === 1 ? "" : "s"}</small></div>
          )}
          {porPagar.length > 0 && (
            <div><span>Por pagar (les debemos)</span><strong>{kg(Math.round(totalPorPagar * 10) / 10)}</strong><small>{porPagar.length} rollo{porPagar.length === 1 ? "" : "s"}</small></div>
          )}
        </div>
      )}
      {error && <p className="inventario-error">{error}</p>}
      {cargando ? <p className="inventario-cargando">Cargando...</p> : visibles.length === 0 ? (
        <p className="inventario-vacio">{vista === "saldados" ? "Ningún rollo prestado ha quedado saldado todavía."
          : soloPorFacturar ? "✓ No hay nada por facturar ni por pagar." : "✓ No hay rollos prestados pendientes con empresas de afuera."}</p>
      ) : (
        <>
        <div className="inventario-tabla-contenedor">
          <table className="inventario-tabla prestamos-tabla">
            <thead>
              <tr><th>Fecha</th><th>Empresa</th><th>Rollo prestado</th><th>Se devolvió con</th><th>Diferencia</th><th>Estado / factura</th></tr>
            </thead>
            <tbody>
              {deLaPagina.map((f) => {
                const estado = ESTADO[f.estado] || { texto: f.estado, color: "#666" };
                const conFactura = ["por_facturar", "facturado", "por_pagar", "pagado"].includes(f.estado);
                const tono = ["cuadrado", "pagado", "facturado"].includes(f.estado) ? "ok"
                  : ["por_facturar", "por_pagar"].includes(f.estado) ? "alerta"
                  : ["pendiente", "por_recoger"].includes(f.estado) ? "pendiente" : "espera";
                return (
                  <tr key={f.id}>
                    <td className="prestamos-fecha">{formatearFechaColombia(f.fecha, false)}<small>{nombreBodega(f.bodega_id)}</small></td>
                    <td className="prestamos-material">
                      <strong>{f.prestador}</strong>
                      <small>{f.direccion === "nos_prestaron" ? "Nos prestó a nosotros" : "Le prestamos"}{f.numero_cotizacion ? ` · Cot. ${f.numero_cotizacion}` : ""}</small>
                    </td>
                    <td className="prestamos-material">
                      <strong>{f.referencia_rollo}</strong>
                      <small>{f.codigo} · {f.metros.toLocaleString("es-CO")} m · {kg(f.kilos_prestados)}</small>
                    </td>
                    <td className="prestamos-material">
                      {f.devuelto_con ? <><span>{f.devuelto_con}</span><small>{kg(f.kilos_devueltos)}{f.fecha_devuelto ? ` · ${formatearFechaColombia(f.fecha_devuelto, false)}` : ""}</small></> : "—"}
                    </td>
                    <td>
                      {f.diferencia == null ? "—" : (
                        <strong style={{ color: f.diferencia >= 1 ? "#b3261e" : f.diferencia <= -1 ? "#1b5fa8" : undefined, whiteSpace: "nowrap" }}>
                          {f.diferencia >= 1 ? `Nos deben ${kg(f.diferencia)}` : f.diferencia <= -1 ? `Les debemos ${kg(-f.diferencia)}` : "Cuadra"}
                        </strong>
                      )}
                    </td>
                    <td className="prestamos-estado-celda">
                      <span className={`prestamos-estado prestamos-estado-${tono}`}>{estado.texto}</span>
                      {conFactura && (
                        <span style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem" }}>
                          <input style={{ width: "8rem" }} placeholder="N.º factura" aria-label="Número de factura" maxLength={60}
                            value={facturas[f.id] ?? f.factura} onChange={(e) => setFacturas((a) => ({ ...a, [f.id]: e.target.value }))} />
                          {(facturas[f.id] ?? f.factura) !== f.factura && (
                            <button type="button" className="apartados-limpiar" onClick={() => guardarFactura(f)}>Guardar</button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Paginacion paginacion={{ total: visibles.length, pagina: paginaValida, total_paginas: totalPaginas }}
          alCambiarPagina={setPagina} etiqueta="rollos" />
        </>
      )}
    </>
  );
}
