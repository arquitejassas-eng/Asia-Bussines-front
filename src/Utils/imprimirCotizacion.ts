// Hoja para imprimir una cotización SIN precios: encabezado (número, empresa,
// cliente, fecha, vendedor, bodega) y la descripción de cada línea. Se abre en
// una ventana aparte y se manda a imprimir.

export type LineaParaImprimir = { descripcion: string; detalle?: string };
export type CotizacionParaImprimir = {
  numero: string; empresa: string; cliente: string; fecha: string; vendedor: string; bodegas: string;
  lineas: LineaParaImprimir[]; kilos: number; lineasSinPeso: number;
  // Traslado a una bodega sin inventario (San Gil): la hoja va con el camión,
  // dice para dónde va y lleva firmas de quien despacha, el conductor y quien recibe.
  trasladoA?: string;
};

const escapar = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Se abre al hacer clic (si se abre después de esperar al servidor, el
 * navegador la bloquea como ventana emergente) y luego se llena. */
export function abrirVentanaImpresion() {
  const ventana = window.open("", "_blank", "width=900,height=700");
  ventana?.document.write("<p style='font-family:Arial;margin:24px'>Preparando la cotización...</p>");
  return ventana;
}

export function imprimirCotizacion(ventana: Window, c: CotizacionParaImprimir) {
  ventana.document.open();
  const kilos = c.kilos > 0
    ? `<p class="kilos">Total kilos: <strong>${c.kilos.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg</strong>`
      + (c.lineasSinPeso ? ` <span>(sin contar ${c.lineasSinPeso} línea${c.lineasSinPeso === 1 ? "" : "s"} de lámina sin peso)</span>` : "") + "</p>"
    : "";
  const filas = c.lineas.map((l, i) => `
    <tr><td class="num">${i + 1}</td><td>${escapar(l.descripcion)}${l.detalle ? `<div class="detalle">${escapar(l.detalle)}</div>` : ""}</td></tr>`).join("");
  const dato = (etiqueta: string, valor: string) => valor ? `<div><span>${etiqueta}:</span> ${escapar(valor)}</div>` : "";
  const tipo = c.trasladoA ? "Traslado" : "Cotización";
  const datos = c.trasladoA
    ? `${dato("Sale de", c.bodegas)}${dato("Va para", c.trasladoA)}${dato("Fecha", c.fecha)}${dato("Creado por", c.vendedor)}`
    : `${dato("Cliente", c.cliente)}${dato("Fecha", c.fecha)}${dato("Vendedor", c.vendedor)}${dato(c.bodegas.includes("+") ? "Bodegas" : "Bodega", c.bodegas)}`;
  const firmas = c.trasladoA
    ? `<div class="firmas"><div>Despachó</div><div>Conductor / placa</div><div>Recibió en ${escapar(c.trasladoA)}</div></div>` : "";
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${tipo} ${escapar(c.numero)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; }
  h1 { font-size: 18px; margin: 0; }
  .numero { font-size: 18px; font-weight: bold; text-align: right; }
  .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 12px 0 16px; }
  .datos span { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #bbb; padding: 7px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 12px; text-transform: uppercase; }
  td.num, th.num { width: 32px; text-align: center; }
  .detalle { font-size: 11px; color: #444; margin-top: 2px; }
  .kilos { margin-top: 14px; font-size: 14px; }
  .kilos span { font-size: 12px; color: #444; }
  .firmas { display: flex; gap: 40px; margin-top: 48px; break-inside: avoid; }
  .firmas div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 12px; }
  @page { margin: 14mm; }
</style></head><body>
<header><h1>${escapar(c.empresa)}</h1><div class="numero">${tipo} ${escapar(c.numero)}</div></header>
<div class="datos">
  ${datos}
</div>
<table><thead><tr><th class="num">#</th><th>Descripción</th></tr></thead><tbody>${filas}</tbody></table>
${kilos}
${firmas}
</body></html>`);
  ventana.document.close();
  ventana.focus();
  // Espera a que se dibuje antes de abrir el cuadro de impresión (una sola vez).
  let impreso = false;
  const imprimir = () => {
    if (impreso || ventana.closed) return;
    impreso = true;
    ventana.print();
  };
  ventana.onload = imprimir;
  setTimeout(imprimir, 400);
}
