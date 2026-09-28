/** Convierte fechas UTC (incluidas las DATETIME antiguas de MySQL) a hora Colombia. */
function comoFechaUtc(valor: string | Date): Date {
  if (valor instanceof Date) return valor;
  // Las fechas antiguas de MySQL no incluyen zona, pero se guardaron en UTC.
  const tieneZona = /(?:Z|[+-]\d{2}:\d{2})$/i.test(valor);
  return new Date(tieneZona ? valor : `${valor}Z`);
}

// Colombia no tiene horario de verano: siempre UTC-5.
const ZONA_COLOMBIA = "-05:00";

/** Filtro "desde" de un <input type="date"> (AAAA-MM-DD): 00:00 de ese día
 * en hora Colombia, en UTC para el servidor. Sin esto el servidor tomaba la
 * fecha en UTC y el día quedaba corrido 5 horas. */
export function inicioDelDiaColombia(fecha: string): string {
  return new Date(`${fecha}T00:00:00${ZONA_COLOMBIA}`).toISOString();
}

/** Filtro "hasta": el ÚLTIMO instante de ese día en hora Colombia. Antes se
 * mandaba solo la fecha (= 00:00) y "hasta hoy" dejaba fuera todo lo de hoy. */
export function finDelDiaColombia(fecha: string): string {
  return new Date(`${fecha}T23:59:59.999${ZONA_COLOMBIA}`).toISOString();
}

export function formatearFechaColombia(valor: string | Date, incluirHora = true): string {
  const fecha = comoFechaUtc(valor);
  if (Number.isNaN(fecha.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    ...(incluirHora ? { timeStyle: "short" } : {}),
    timeZone: "America/Bogota",
  }).format(fecha);
}
