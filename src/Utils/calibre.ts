/** Calibre de un rollo como se escribe en el negocio: siempre dos decimales
 * y coma (0.2 -> "0,20", nunca "0,2"). Acepta el número o un texto con
 * punto o coma; si no es un número (ej. el calibre de un producto,
 * "31 - (0,25)"), lo devuelve tal cual. Mismo formato que
 * `formatear_calibre` en backend/app/services/clasificacion.py. */
export function formatearCalibre(calibre: string | number | null | undefined): string {
  if (calibre === null || calibre === undefined || calibre === "") return "";
  const numero = typeof calibre === "number" ? calibre : Number(String(calibre).trim().replace(",", "."));
  if (!Number.isFinite(numero)) return String(calibre);
  return numero.toFixed(2).replace(".", ",");
}
