/** Redondea a `decimales` (por defecto 2: centímetros o centésimas). */
export function redondear(numero: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Math.round(numero * factor) / factor;
}
