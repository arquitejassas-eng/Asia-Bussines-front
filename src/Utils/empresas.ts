// Empresas dueñas del material. Comparten bodegas, así que cada rollo lleva
// la sigla de su empresa (se deduce de la referencia en el backend — ver
// backend/app/services/empresas.py).
export const EMPRESAS: Record<string, string> = { AR: "Arquitejas", ABG: "Asia Business" };

// Valor especial del filtro para ver los rollos cuya referencia no traía
// empresa (los que hay que corregir a mano).
export const FILTRO_SIN_EMPRESA = "sin_empresa";

export function nombreEmpresa(sigla: string | null | undefined) {
  if (!sigla) return "Sin empresa";
  return EMPRESAS[sigla] ? `${EMPRESAS[sigla]} (${sigla})` : sigla;
}
