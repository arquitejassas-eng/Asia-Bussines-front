// Empresas dueñas del material. Comparten bodegas, así que cada rollo lleva
// la sigla de su empresa (se deduce de la referencia en el backend — ver
// backend/app/services/empresas.py).
export const EMPRESAS: Record<string, string> = { AR: "Arquitejas", ABG: "Asia Business" };

// Línea de cotización con "Material de las dos empresas" (solo lámina):
// Planta usa rollos de cualquiera y lo de la otra empresa queda como préstamo.
export const AMBAS_EMPRESAS = "AMBAS";

/** "Arquitejas", "Asia Business" o "las dos empresas" (para "Material de ..."). */
export function nombreMaterial(sigla: string | null | undefined) {
  if (sigla === AMBAS_EMPRESAS) return "las dos empresas";
  return EMPRESAS[sigla || ""] || sigla || "";
}

// Valor especial del filtro para ver los rollos cuya referencia no traía
// empresa (los que hay que corregir a mano).
export const FILTRO_SIN_EMPRESA = "sin_empresa";

// Para columnas y tarjetas, donde "Asia Business" no cabe.
export const NOMBRE_CORTO_EMPRESA: Record<string, string> = { AR: "Arquitejas", ABG: "Asia", "": "Sin empresa" };

/** Siglas presentes, en orden: Arquitejas, Asia y después las demás. */
export function siglasEnOrden(siglas: Iterable<string>) {
  const orden = Object.keys(EMPRESAS);
  return [...new Set(siglas)].sort((a, b) => {
    const ia = orden.indexOf(a), ib = orden.indexOf(b);
    return (ia < 0 ? orden.length : ia) - (ib < 0 ? orden.length : ib) || a.localeCompare(b);
  });
}

export function nombreEmpresa(sigla: string | null | undefined) {
  if (!sigla) return "Sin empresa";
  return EMPRESAS[sigla] ? `${EMPRESAS[sigla]} (${sigla})` : sigla;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Suma por empresa de una lista ({sigla, cantidad}). */
export function sumarPorEmpresa(filas: { empresa?: string | null; cantidad: number }[]) {
  const totales: Record<string, number> = {};
  for (const f of filas) {
    const sigla = f.empresa || "";
    totales[sigla] = redondear((totales[sigla] || 0) + (Number(f.cantidad) || 0));
  }
  return totales;
}
