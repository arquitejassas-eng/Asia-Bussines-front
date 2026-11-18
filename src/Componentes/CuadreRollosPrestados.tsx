import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import { formatearFechaColombia } from "../Utils/fechas";
import { exportarHojasAExcel } from "../Utils/exportarExcel";

export type FilaCuadre = {
  id: number; fecha: string; prestador: string; numero_cotizacion: string; bodega_id: number | null; empresa_presta: string;
  codigo: string; referencia_rollo: string; metros: number; kilos_prestados: number | null; devuelto_con: string;
  kilos_devueltos: number | null; fecha_devuelto: string | null; diferencia: number | null; estado: string;
  factura: string; fecha_factura: string | null;
};

const ESTADO: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: "Sin devolver", color: "#8a5a00" },
  por_recoger: { texto: "Por recoger (falta la Salida)", color: "#8a5a00" },
  cancelada: { texto: "Cotización cancelada", color: "#666" },
  cerrado: { texto: "Cerrado", color: "#666" },
  sin_kilos: { texto: "Devuelto (sin kilos para comparar)", color: "#666" },
  cuadrado: { texto: "Cuadrado", color: "#1b7a3a" },
  de_mas: { texto: "Devolvieron de más", color: "#1b5fa8" },
  por_facturar: { texto: "Por facturar", color: "#b3261e" },
  facturado: { texto: "Facturado", color: "#1b7a3a" },
};
// Pendientes: sin devolver, por recoger o devueltos con kilos de menos sin facturar.
// Lo demás (cuadrado, facturado, de más, cerrado) ya está saldado.
export const CUADRE_PENDIENTE = new Set(["pendiente", "por_recoger", "por_facturar"]);
const kg = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} kg`);

/** Cada rollo prestado a una empresa externa: kilos que se fueron contra los
 * que volvieron (el mismo rollo u otro). Lo que devolvieron de menos se
 * factura: aquí se anota el número de la factura. */
export default function CuadreRollosPrestados({ nombreBodega, recargar, vista, alCargar }: {
  nombreBodega: (id: number | null) => string; recargar: number; vista: "pendientes" | "saldados";
  alCargar?: (filas: FilaCuadre[]) => void;
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

  const porFacturar = filas.filter((f) => f.estado === "por_facturar");
  const totalPorFacturar = porFacturar.reduce((suma, f) => suma + (f.diferencia || 0), 0);
  const deLaVista = filas.filter((f) => CUADRE_PENDIENTE.has(f.estado) === (vista === "pendientes"));
  const visibles = soloPorFacturar && vista === "pendientes" ? porFacturar : deLaVista;

  function exportar() {
    exportarHojasAExcel([{ nombre: "Cuadre rollos prestados", filas: visibles.map((f) => ({
      "Fecha préstamo": formatearFechaColombia(f.fecha), "Empresa": f.prestador, "Cotización": f.numero_cotizacion,
      "Bodega": nombreBodega(f.bodega_id), "Código": f.codigo, "Rollo prestado": f.referencia_rollo, "Metros": f.metros,
      "Kg prestados": f.kilos_prestados ?? "", "Devolvieron": f.devuelto_con, "Kg devueltos": f.kilos_devueltos ?? "",
      "Fecha devolución": f.fecha_devuelto ? formatearFechaColombia(f.fecha_devuelto) : "",
      "Diferencia kg (+ = por facturar)": f.diferencia ?? "", "Estado": ESTADO[f.estado]?.texto || f.estado, "Factura": f.factura,
    })) }], `Cuadre rollos prestados ${vista}.xlsx`);
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
        <h2 className="inventario-form-subtitulo" style={{ margin: 0 }}>Cuadre de rollos prestados a empresas externas</h2>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          {vista === "pendientes" && <label className="apartados-check">
            <input type="checkbox" checked={soloPorFacturar} onChange={(e) => setSoloPorFacturar(e.target.checked)} /> Solo por facturar
          </label>}
          {visibles.length > 0 && <button type="button" className="apartados-limpiar" onClick={exportar}>Exportar a Excel</button>}
        </div>
      </div>
      <p className="inventario-carga-ayuda">
        Kilos del rollo que se prestó contra los del rollo que devolvieron. Si devolvieron menos, la diferencia se le
        factura a esa empresa: escribe el número de la factura cuando la hagas.
        {vista === "saldados" && " Aquí están los que ya quedaron cuadrados o facturados."}
        {vista === "pendientes" && porFacturar.length > 0 && <> <strong style={{ color: "#b3261e" }}>Por facturar: {kg(Math.round(totalPorFacturar * 10) / 10)} en {porFacturar.length} rollo{porFacturar.length === 1 ? "" : "s"}.</strong></>}
      </p>
      {error && <p className="inventario-error">{error}</p>}
      {cargando ? <p className="inventario-cargando">Cargando...</p> : visibles.length === 0 ? (
        <p className="inventario-vacio">{vista === "saldados" ? "Ningún rollo prestado ha quedado saldado todavía."
          : soloPorFacturar ? "No hay nada por facturar." : "No hay rollos prestados pendientes con empresas externas."}</p>
      ) : (
        <div className="inventario-tabla-contenedor">
          <table className="inventario-tabla">
            <thead>
              <tr><th>Fecha</th><th>Empresa</th><th>Rollo prestado</th><th>Kg prestados</th><th>Devolvieron</th><th>Kg devueltos</th><th>Diferencia</th><th>Estado / factura</th></tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const estado = ESTADO[f.estado] || { texto: f.estado, color: "#666" };
                const conFactura = f.estado === "por_facturar" || f.estado === "facturado";
                return (
                  <tr key={f.id}>
                    <td>{formatearFechaColombia(f.fecha)}</td>
                    <td><strong>{f.prestador}</strong>{f.numero_cotizacion && <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>Cot. {f.numero_cotizacion}</span>}</td>
                    <td>
                      {f.referencia_rollo}
                      <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>{f.codigo} · {f.metros.toLocaleString("es-CO")} m · {nombreBodega(f.bodega_id)}</span>
                    </td>
                    <td>{kg(f.kilos_prestados)}</td>
                    <td>{f.devuelto_con || "—"}{f.fecha_devuelto && f.devuelto_con && <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>{formatearFechaColombia(f.fecha_devuelto)}</span>}</td>
                    <td>{kg(f.kilos_devueltos)}</td>
                    <td>
                      {f.diferencia == null ? "—" : (
                        <strong style={{ color: f.diferencia >= 1 ? "#b3261e" : f.diferencia <= -1 ? "#1b5fa8" : undefined }}>
                          {f.diferencia > 0 ? "Faltan " : f.diferencia < 0 ? "Sobran " : ""}{kg(Math.abs(f.diferencia))}
                        </strong>
                      )}
                    </td>
                    <td>
                      <strong style={{ color: estado.color }}>{estado.texto}</strong>
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
      )}
    </>
  );
}
