// Excel de los reportes: cada hoja sale ya como TABLA de Excel (encabezado con
// color y filtros, filas intercaladas, anchos de columna y números con
// formato), como si se le hubiera dado "Dar formato como tabla". La librería
// (exceljs) se carga solo al exportar para no hacer más pesada la página.

export type HojaExcel = { nombre: string; filas: Record<string, unknown>[] };

// Excel no deja estos caracteres en el nombre de una hoja (y máximo 31 letras).
const nombreDeHoja = (nombre: string) => nombre.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Hoja";

function valorDeCelda(valor: unknown) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number" || typeof valor === "string" || typeof valor === "boolean" || valor instanceof Date) return valor;
  return String(valor);
}

export async function exportarHojasAExcel(hojas: HojaExcel[], nombreArchivo = "Reporte_Inventario.xlsx") {
  const conDatos = hojas.filter((h) => h.filas && h.filas.length > 0);
  if (conDatos.length === 0) return;
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();

  conDatos.forEach((hoja, indice) => {
    const hojaExcel = libro.addWorksheet(nombreDeHoja(hoja.nombre), { views: [{ state: "frozen", ySplit: 1 }] });
    // Todas las columnas que aparezcan en alguna fila, en el orden en que llegan.
    const columnas = [...new Set(hoja.filas.flatMap((f) => Object.keys(f)))];
    const filas = hoja.filas.map((f) => columnas.map((c) => valorDeCelda(f[c])));
    hojaExcel.addTable({
      name: `Tabla${indice + 1}`, ref: "A1", headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: columnas.map((c) => ({ name: c, filterButton: true })),
      rows: filas,
    });

    // Números con separador de miles; enteros sin decimales.
    filas.forEach((fila, i) => {
      const filaExcel = hojaExcel.getRow(i + 2);
      fila.forEach((valor, j) => {
        if (typeof valor === "number") filaExcel.getCell(j + 1).numFmt = Number.isInteger(valor) ? "#,##0" : "#,##0.00";
      });
      // La fila de totales (primera celda "TOTAL") va en negrita.
      if (String(fila[0]).toUpperCase() === "TOTAL") filaExcel.font = { bold: true };
    });

    // Ancho de cada columna según su texto más largo (entre 8 y 60).
    columnas.forEach((c, j) => {
      const largo = Math.max(c.length, ...filas.map((f) => String(f[j] ?? "").length));
      hojaExcel.getColumn(j + 1).width = Math.min(60, Math.max(8, largo + 2));
    });
  });

  const contenido = await libro.xlsx.writeBuffer();
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([contenido], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}

export function exportarArregloAExcel(datos: Record<string, unknown>[], nombreArchivo = "Reporte_Inventario.xlsx", nombreHoja = "Reporte") {
  return exportarHojasAExcel([{ nombre: nombreHoja, filas: datos }], nombreArchivo);
}
