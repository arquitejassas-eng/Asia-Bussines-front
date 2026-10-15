// Interpretación de información codificada en `Producto.codigo` para la
// familia TEJA — solo se usa como respaldo cuando el producto no trae ya
// `calidad`/`metros_por_unidad` explícitos (ej. productos cargados por
// Excel masivo, que hoy no traen esos campos, a diferencia del stock que
// genera Producción). Nunca se persiste: es puramente de presentación.

/** Nombre oficial del modelo de teja a partir de lo que se escribe:
 * "arqui" -> ARQUITECTONICA, "super" -> SUPERMIL, "master" -> MASTERMIL; lo
 * demás en mayúsculas. Misma lista que backend/app/services/modelos_teja.py. */
export const MODELOS_TEJA: Record<string, string[]> = {
  ARQUITECTONICA: ["arq"],
  SUPERMIL: ["super"],
  MASTERMIL: ["master"],
};
export function normalizarModeloTeja(texto: string | null | undefined): string {
  const compacto = String(texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!compacto) return "";
  for (const [nombre, comienzos] of Object.entries(MODELOS_TEJA)) {
    if (comienzos.some((c) => compacto.startsWith(c))) return nombre;
  }
  return String(texto ?? "").trim().split(/\s+/).join(" ").toUpperCase();
}

/** El modelo que trae escrito una línea de cotización ("...5.10 MTR
 * ARQUITECTONICA CAL 31" -> ARQUITECTONICA; "MASTER MIL" -> MASTERMIL), o
 * "" si no nombra ninguno conocido. Igual que modelo_en_descripcion del backend. */
export function modeloEnDescripcion(texto: string | null | undefined): string {
  const palabras = String(texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/);
  for (const palabra of palabras) {
    const compacta = palabra.replace(/[^a-z0-9]/g, "");
    for (const [nombre, comienzos] of Object.entries(MODELOS_TEJA)) {
      if (compacta && comienzos.some((c) => compacta.startsWith(c))) return nombre;
    }
  }
  return "";
}

/** "2T..." (sin distinguir mayúsculas/minúsculas ni espacios) = Segunda.
 * No asume "Primera" para lo demás -- eso lo decide quien llama, igual que
 * ya hacía la lógica existente basada en `Producto.calidad`. */
export function esSegundaPorCodigo(codigo: string): boolean {
  return (codigo || "").trim().toUpperCase().startsWith("2T");
}

/** Toma el texto después del ÚLTIMO "-" del código (ignora cualquier otro
 * guion anterior, ej. el de "2T-..." o el de un prefijo "M-..."). Devuelve
 * el texto tal cual si es un número válido (admite coma o punto decimal,
 * sin convertir el separador -- se muestra como está escrito en el
 * código), o null si el código no trae un sufijo de longitud reconocible. */
export function longitudDesdeCodigo(codigo: string): string | null {
  const limpio = (codigo || "").trim();
  const indice = limpio.lastIndexOf("-");
  if (indice === -1) return null;
  const sufijo = limpio.slice(indice + 1).trim();
  return /^\d+([.,]\d+)?$/.test(sufijo) ? sufijo : null;
}

/** Algunos productos TEJA del catálogo importado traen el calibre en formato
 * compuesto "NN - (0,NN)" (ej. "28 - (0,33)") -- NN es un número de gauge,
 * el valor real está entre paréntesis. El dato en BD NUNCA se modifica; esta
 * función es puramente de presentación: solo quita los paréntesis,
 * conservando ambos números tal cual. "28 - (0,33)" -> "28 - 0,33". Un valor
 * ya limpio (sin paréntesis) queda igual. */
export function calibrePantalla(calibre: string | number | null | undefined): string {
  return String(calibre ?? "").trim().replace(/[()]/g, "");
}

/** El calibre VERDADERO (según quien pidió esta regla) es el valor entre
 * paréntesis -- el número de afuera es un dato distinto (gauge), no el
 * calibre real. Se usa solo para comparar identidad/agrupar, nunca para
 * mostrar en pantalla (ver `calibrePantalla`) ni para escribir en BD. */
export function calibreIdentidad(calibre: string | number | null | undefined): string {
  const texto = String(calibre ?? "").trim();
  const m = texto.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : texto;
}
