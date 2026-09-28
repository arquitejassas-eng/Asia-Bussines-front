// Cada pantalla se descarga al abrirla (lazy en App.tsx). Al publicar una
// versión nueva, esos archivos cambian de nombre y los viejos desaparecen: una
// pestaña abierta desde antes pide un archivo que ya no existe y la pantalla
// quedaba en blanco. Recargar trae la versión nueva y lo resuelve.

const CLAVE_ULTIMA_RECARGA = "arquitejas_recarga_por_version";
// Si ya se recargó hace menos de esto y vuelve a fallar, el problema no es
// una versión nueva (ej. sin internet): no se recarga otra vez, para no
// quedar en un ciclo de recargas.
const MS_ENTRE_RECARGAS = 30_000;

export function esErrorDeArchivoDeVersionVieja(error: unknown): boolean {
  const mensaje = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|Unable to preload CSS|ChunkLoadError/i.test(mensaje);
}

/** Recarga la página si no se hizo hace poco. Devuelve false si no recargó. */
export function recargarPorVersionNueva(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE_ULTIMA_RECARGA) || 0);
    if (Date.now() - ultima < MS_ENTRE_RECARGAS) return false;
    sessionStorage.setItem(CLAVE_ULTIMA_RECARGA, String(Date.now()));
  } catch {
    // Sin sessionStorage no hay cómo evitar el ciclo: mejor no recargar.
    return false;
  }
  window.location.reload();
  return true;
}
