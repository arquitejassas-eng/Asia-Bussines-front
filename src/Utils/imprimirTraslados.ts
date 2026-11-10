// Hojas de Reportes > Traslados entre bodegas para imprimir: lo que está por
// salir (para alistar el camión, agrupado por origen → destino) y lo que
// quedó en el filtro. Se abren en una ventana aparte, como la cotización
// (ver imprimirCotizacion.abrirVentanaImpresion).

export type FilaTraslado = {
  fecha?: string; origen: string; destino: string; producto: string; rollo: string;
  empresa: string; cantidad: string; cotizacion: string; nota: string;
};

const escapar = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ESTILOS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; font-size: 12px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; }
  h1 { font-size: 18px; margin: 0; }
  .sub { font-size: 12px; color: #333; margin: 8px 0 14px; }
  h2 { font-size: 14px; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #bbb; padding: 6px 5px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 11px; text-transform: uppercase; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.n { width: 28px; text-align: center; }
  .nota { font-size: 11px; color: #444; }
  .firmas { display: flex; gap: 48px; margin-top: 28px; }
  .firmas div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; }
  tr, .firmas { break-inside: avoid; }
  @page { margin: 12mm; }
`;

function abrirYImprimir(ventana: Window, titulo: string, cuerpo: string) {
  ventana.document.open();
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>
<style>${ESTILOS}</style></head><body>${cuerpo}</body></html>`);
  ventana.document.close();
  ventana.focus();
  let impreso = false;
  const imprimir = () => {
    if (impreso || ventana.closed) return;
    impreso = true;
    ventana.print();
  };
  ventana.onload = imprimir;
  setTimeout(imprimir, 400);
}

function tabla(filas: FilaTraslado[], conFecha: boolean, conRuta: boolean) {
  const cabeza = `<tr><th class="n">#</th>${conFecha ? "<th>Fecha</th>" : ""}${conRuta ? "<th>Origen → destino</th>" : ""}
    <th>Producto</th><th>Rollo</th><th>Empresa</th><th class="num">Cantidad</th><th>Cotización</th></tr>`;
  const cuerpo = filas.map((f, i) => `<tr><td class="n">${i + 1}</td>${conFecha ? `<td>${escapar(f.fecha || "")}</td>` : ""}
    ${conRuta ? `<td>${escapar(`${f.origen} → ${f.destino}`)}</td>` : ""}
    <td>${escapar(f.producto)}${f.nota ? `<div class="nota">${escapar(f.nota)}</div>` : ""}</td>
    <td>${escapar(f.rollo || "—")}</td><td>${escapar(f.empresa || "—")}</td>
    <td class="num">${escapar(f.cantidad)}</td><td>${escapar(f.cotizacion || "—")}</td></tr>`).join("");
  return `<table><thead>${cabeza}</thead><tbody>${cuerpo}</tbody></table>`;
}

/** Lo aceptado que todavía no sale: una tabla por cada origen → destino, con
 * espacio para las firmas de quien despacha y quien recibe. */
export function imprimirTrasladosPorSalir(ventana: Window, filas: FilaTraslado[], fechaHoy: string) {
  const grupos = new Map<string, FilaTraslado[]>();
  for (const f of filas) {
    const clave = `${f.origen} → ${f.destino}`;
    grupos.set(clave, [...(grupos.get(clave) || []), f]);
  }
  const secciones = [...grupos.entries()].map(([ruta, lista]) => `
    <h2>${escapar(ruta)} (${lista.length} ${lista.length === 1 ? "línea" : "líneas"})</h2>
    ${tabla(lista, false, false)}
    <div class="firmas"><div>Despachó</div><div>Conductor</div><div>Recibió</div></div>`).join("");
  abrirYImprimir(ventana, "Traslados por despachar", `
    <header><h1>Traslados por despachar</h1><div>${escapar(fechaHoy)}</div></header>
    <p class="sub">Lo que ya se aceptó trasladar y todavía no ha salido.</p>
    ${filas.length ? secciones : "<p>No hay traslados por despachar.</p>"}`);
}

/** Lo que quedó en el filtro de Reportes > Traslados (despachado o recibido). */
export function imprimirTrasladosFiltrados(ventana: Window, filas: FilaTraslado[], descripcionFiltro: string, fechaHoy: string) {
  abrirYImprimir(ventana, "Traslados entre bodegas", `
    <header><h1>Traslados entre bodegas</h1><div>${escapar(fechaHoy)}</div></header>
    <p class="sub">${escapar(descripcionFiltro)} · ${filas.length} ${filas.length === 1 ? "movimiento" : "movimientos"}</p>
    ${filas.length ? tabla(filas, true, true) : "<p>No hay traslados con este filtro.</p>"}`);
}
