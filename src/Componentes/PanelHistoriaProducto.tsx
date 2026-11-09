import { useEffect, useState } from "react";
import { api } from "./Api";
import { EMPRESAS } from "../Utils/empresas";
import { formatearFechaColombia } from "../Utils/fechas";
import { exportarHojasAExcel } from "../Utils/exportarExcel";

// Resumen de un código de producto (ej. CPA) en Reportes: con cuánto se
// cargó, en qué cotizaciones salió, en cuáles está reservado y cuánto hay
// hoy, en todas las bodegas (ver backend reportes_inventario.historia_producto).

type FilaBodega = { empresa: string; bodega: string; inicial: number; al_cargar: number | null; salio: number; reservado: number; stock: number };
type FilaCotizacion = { cotizacion: string; cliente: string; empresa: string; bodega: string; cantidad: number; estado: string; fecha: string | null; sin_existencia?: boolean };
type OtroMovimiento = { fecha: string; tipo: string; motivo: string; cantidad: number; bodega_origen: string; bodega_destino: string; cotizacion: string; usuario: string; observaciones: string };
type Historia = {
  codigo: string; descripcion?: string; existe: boolean;
  por_bodega?: FilaBodega[]; bodegas_compartidas?: { bodega: string; al_cargar: number }[];
  salidas?: FilaCotizacion[]; reservas?: FilaCotizacion[]; otros_movimientos?: OtroMovimiento[];
};

const ETIQUETAS_ESTADO: Record<string, string> = {
  apartado: "Apartado", enviado_a_produccion: "Enviado a producción", en_produccion: "En producción",
  produccion_terminada: "Producción terminada", entregado: "Entregado", cancelado: "Anulado",
};

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("es-CO", { maximumFractionDigits: 2 }));
const fecha = (f: string | null | undefined) => (f ? formatearFechaColombia(f) : "—");
const empresa = (sigla: string) => EMPRESAS[sigla] || sigla || "—";

export default function PanelHistoriaProducto({ codigo }: { codigo: string }) {
  const buscado = codigo.trim();
  const [historia, setHistoria] = useState<Historia | null>(null);
  const [estado, setEstado] = useState<"" | "cargando" | "error">("");

  useEffect(() => {
    setHistoria(null);
    if (buscado.length < 2) return;
    let vigente = true;
    // Espera a que se termine de escribir, como la tabla de movimientos.
    const espera = window.setTimeout(async () => {
      setEstado("cargando");
      try {
        const datos = await api.get<Historia>(`/reportes-inventario/producto?codigo=${encodeURIComponent(buscado)}`);
        if (vigente) { setHistoria(datos || null); setEstado(""); }
      } catch {
        if (vigente) setEstado("error");
      }
    }, 400);
    return () => { vigente = false; window.clearTimeout(espera); };
  }, [buscado]);

  if (buscado.length < 2) return null;
  if (estado === "cargando") return <section className="reportes-tarjeta"><p className="reportes-vacio">Buscando el producto {buscado}...</p></section>;
  if (estado === "error") return <section className="reportes-tarjeta"><p className="reportes-error">No se pudo cargar el resumen de {buscado}.</p></section>;
  // Solo con el código exacto: con parte del código queda la tabla de movimientos.
  if (!historia?.existe) return null;

  const codigoEncontrado = historia.codigo;
  const bodegas = historia.por_bodega || [];
  const salidas = historia.salidas || [];
  const reservas = historia.reservas || [];
  const otros = historia.otros_movimientos || [];
  const total = (campo: "inicial" | "salio" | "reservado" | "stock") => bodegas.reduce((s, b) => s + b[campo], 0);

  function exportar() {
    const filaCotizacion = (c: FilaCotizacion) => ({
      Cotización: c.cotizacion, Cliente: c.cliente, Empresa: empresa(c.empresa), Bodega: c.bodega,
      Cantidad: c.cantidad, Estado: ETIQUETAS_ESTADO[c.estado] || c.estado, Fecha: fecha(c.fecha),
    });
    exportarHojasAExcel([
      { nombre: "Por bodega", filas: bodegas.map((b) => ({
        Empresa: empresa(b.empresa), Bodega: b.bodega, "Entrada según Excel": b.inicial, "Al cargarlo al programa": b.al_cargar ?? "",
        "Salió en cotizaciones": b.salio, Reservado: b.reservado, "Hay hoy": b.stock, Libre: b.stock - b.reservado,
      })) },
      { nombre: "Salió", filas: salidas.map(filaCotizacion) },
      { nombre: "Reservado", filas: reservas.map(filaCotizacion) },
      { nombre: "Otros movimientos", filas: otros.map((m) => ({
        Fecha: fecha(m.fecha), Tipo: m.tipo, Motivo: m.motivo, Cantidad: m.cantidad, Desde: m.bodega_origen, Hacia: m.bodega_destino,
        Cotización: m.cotizacion, Usuario: m.usuario, Observaciones: m.observaciones,
      })) },
    ], `Historia_${codigoEncontrado}.xlsx`);
  }

  return (
    <section className="reportes-tarjeta" aria-label={`Resumen del producto ${historia.codigo}`}>
      <div className="historia-producto-cabecera">
        <h2>{historia.codigo} — {historia.descripcion}</h2>
        <button className="reportes-boton-secundario" onClick={exportar}>📥 Exportar a Excel</button>
      </div>

      <h3 className="historia-producto-subtitulo">Por bodega</h3>
      <div className="reportes-tabla-wrap">
        <table className="reportes-tabla">
          <thead>
            <tr>
              <th>Empresa</th><th>Bodega</th>
              <th className="reportes-num" title="La columna ENTRADA del Excel con que se cargó el producto">Entrada según Excel</th>
              <th className="reportes-num" title="El stock de hoy menos todo lo que ha entrado y salido de esa bodega desde que se cargó">Al cargarlo al programa</th>
              <th className="reportes-num">Salió en cotizaciones</th>
              <th className="reportes-num">Reservado</th>
              <th className="reportes-num">Hay hoy</th>
              <th className="reportes-num">Libre</th>
            </tr>
          </thead>
          <tbody>
            {bodegas.map((b) => (
              <tr key={`${b.empresa}-${b.bodega}`}>
                <td>{empresa(b.empresa)}</td><td>{b.bodega}</td>
                <td className="reportes-num">{num(b.inicial)}</td>
                <td className="reportes-num">{num(b.al_cargar)}</td>
                <td className="reportes-num">{num(b.salio)}</td>
                <td className="reportes-num">{num(b.reservado)}</td>
                <td className="reportes-num">{num(b.stock)}</td>
                <td className={`reportes-num ${b.stock - b.reservado < 0 ? "reportes-negativo" : ""}`}>{num(b.stock - b.reservado)}</td>
              </tr>
            ))}
          </tbody>
          {bodegas.length > 1 && (
            <tfoot>
              <tr>
                <th colSpan={2}>Total</th>
                <th className="reportes-num">{num(total("inicial"))}</th>
                <th className="reportes-num">—</th>
                <th className="reportes-num">{num(total("salio"))}</th>
                <th className="reportes-num">{num(total("reservado"))}</th>
                <th className="reportes-num">{num(total("stock"))}</th>
                <th className="reportes-num">{num(total("stock") - total("reservado"))}</th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="reportes-texto-ayuda historia-producto-nota">
        <strong>Entrada según Excel</strong> es la columna ENTRADA del Excel con que se cargó; <strong>Al cargarlo al programa</strong> es
        con cuánto quedó en el sistema ese día (el stock de hoy menos lo que ha entrado y salido desde entonces).
        {(historia.bodegas_compartidas || []).map((c) => (
          <span key={c.bodega}> En {c.bodega} las dos empresas tienen este código: al cargarlo había {num(c.al_cargar)} entre las dos.</span>
        ))}
      </p>

      <h3 className="historia-producto-subtitulo">Salió en estas cotizaciones ({salidas.length})</h3>
      {salidas.length === 0 ? <p className="reportes-vacio">Todavía no ha salido en ninguna cotización.</p> : (
        <div className="reportes-tabla-wrap">
          <table className="reportes-tabla">
            <thead><tr><th>Fecha de salida</th><th>Cotización</th><th>Cliente</th><th>Empresa</th><th>Bodega</th><th className="reportes-num">Cantidad</th><th>Estado</th></tr></thead>
            <tbody>
              {salidas.map((c, i) => (
                <tr key={`${c.cotizacion}-${i}`}>
                  <td>{fecha(c.fecha)}</td><td className="reportes-codigo">{c.cotizacion}</td><td>{c.cliente || "—"}</td>
                  <td>{empresa(c.empresa)}</td><td>{c.bodega}</td>
                  <td className="reportes-num">{num(c.cantidad)}{c.sin_existencia && <span className="reportes-sub">sacado sin existencia en el sistema</span>}</td>
                  <td>{ETIQUETAS_ESTADO[c.estado] || c.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="historia-producto-subtitulo">Reservado en estas cotizaciones ({reservas.length})</h3>
      {reservas.length === 0 ? <p className="reportes-vacio">No está reservado en ninguna cotización activa.</p> : (
        <div className="reportes-tabla-wrap">
          <table className="reportes-tabla">
            <thead><tr><th>Creada</th><th>Cotización</th><th>Cliente</th><th>Empresa</th><th>Bodega</th><th className="reportes-num">Cantidad</th><th>Estado</th></tr></thead>
            <tbody>
              {reservas.map((c, i) => (
                <tr key={`${c.cotizacion}-${i}`}>
                  <td>{fecha(c.fecha)}</td><td className="reportes-codigo">{c.cotizacion}</td><td>{c.cliente || "—"}</td>
                  <td>{empresa(c.empresa)}</td><td>{c.bodega}</td><td className="reportes-num">{num(c.cantidad)}</td>
                  <td>{ETIQUETAS_ESTADO[c.estado] || c.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {otros.length > 0 && (
        <p className="reportes-texto-ayuda historia-producto-nota">
          Además tiene {otros.length} movimiento{otros.length === 1 ? "" : "s"} de entrada, ajuste o traslado: están en la tabla de abajo
          (y en la parte <strong>Traslados</strong>) y en el Excel que exportas aquí.
        </p>
      )}
    </section>
  );
}
