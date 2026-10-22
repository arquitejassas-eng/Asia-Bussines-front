import { useEffect, useState } from "react";
import { api } from "../Componentes/Api";

/** Las familias que ya existen (GET /inventario/familias), una sola vez cada
 * una. Si no se pueden traer, queda la lista vacía y no se pregunta nada. */
export function useFamiliasProductos() {
  const [familias, setFamilias] = useState<string[]>([]);
  useEffect(() => {
    let vigente = true;
    api.get<string[]>("/inventario/familias")
      .then((datos) => { if (vigente) setFamilias(datos ?? []); })
      .catch(() => {});
    return () => { vigente = false; };
  }, []);
  return familias;
}

/** La familia tal como ya existe, aunque la escriban con otras mayúsculas o
 * en singular/plural ("caballete" -> "CABALLETES"); null si es nueva. Misma
 * regla del backend (productos.familia_existente). */
export function familiaExistente(familia: string, familias: string[]): string | null {
  const clave = familia.trim().replace(/\s+/g, " ").toUpperCase();
  if (!clave) return null;
  const porClave = new Map(familias.map((f) => [f.toUpperCase(), f]));
  const candidatas = [clave, `${clave}S`, `${clave}ES`,
    clave.endsWith("ES") ? clave.slice(0, -2) : "", clave.endsWith("S") ? clave.slice(0, -1) : ""];
  for (const candidata of candidatas) {
    if (candidata && porClave.has(candidata)) return porClave.get(candidata) ?? null;
  }
  return null;
}

/** Antes de guardar: si la familia no existe, pregunta si de verdad es nueva.
 * Devuelve la familia a guardar (la que ya existe si coincide) o null si
 * cancelaron. */
export function confirmarFamilia(familia: string, familias: string[]): string | null {
  const texto = familia.trim();
  if (!texto || familias.length === 0) return texto;
  const existente = familiaExistente(texto, familias);
  if (existente) return existente;
  const ok = window.confirm(
    `La familia "${texto}" no existe. ¿Crear una familia nueva?\n\n` +
    "Si es una que ya existe (ej. CABALLETES, TUMBILOS), dale Cancelar y escógela de la lista.",
  );
  return ok ? texto : null;
}
