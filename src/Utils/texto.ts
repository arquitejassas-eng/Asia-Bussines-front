/** Texto listo para comparar en búsquedas: sin tildes, en minúsculas y sin
 * espacios a los lados ("Lámina Azul " -> "lamina azul"). Acepta cualquier
 * valor (null/undefined/número) sin romperse. */
export function normalizarTexto(texto: unknown): string {
  return (texto ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
