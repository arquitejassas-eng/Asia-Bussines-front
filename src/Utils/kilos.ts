/** Kilos de un rollo a partir de su peso neto. Los rollos cargados desde el
 * Excel traen el peso en kilos (ej. 4248) y los de Recepción en toneladas
 * (ej. 4.4): por debajo de 100 se toma como toneladas. */
export function kilosDelRollo(pesoNeto: number | null | undefined): number | null {
  if (pesoNeto == null || !Number.isFinite(pesoNeto) || pesoNeto <= 0) return null;
  return Math.round(pesoNeto < 100 ? pesoNeto * 1000 : pesoNeto);
}

/** "4.504" (kilos con separador de miles) o "—": peso neto o, con
 * `toneladas`, el peso actual que el backend da en toneladas. */
export function textoKilos(peso: number | null | undefined, toneladas = false): string {
  const kilos = toneladas ? (peso == null ? null : Math.round(peso * 1000)) : kilosDelRollo(peso);
  return kilos == null ? "—" : kilos.toLocaleString("es-CO");
}

/** Si lo escrito en un buscador son kilos ("4248", "4.248", "4248 kg"),
 * devuelve solo los dígitos; si no, cadena vacía. */
export function kilosBuscados(termino: string): string {
  const texto = termino.trim().toLowerCase();
  if (!/^[\d.,\s]+(kg|kgs|kilos)?$/.test(texto)) return "";
  const digitos = texto.replace(/\D/g, "");
  return digitos.length >= 3 ? digitos : "";
}

/** ¿El rollo pesa esos kilos? (por el comienzo: "42" + más dígitos). */
export function coincideKilos(pesoNeto: number | null | undefined, digitos: string): boolean {
  const kilos = kilosDelRollo(pesoNeto);
  return Boolean(digitos) && kilos != null && String(kilos).startsWith(digitos);
}
