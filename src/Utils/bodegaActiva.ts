/** Cuentas que manejan varias bodegas (ej. Santander y Maxitejas): la bodega
 * escogida en el menú viaja en cada petición (encabezado X-Bodega-Id) y el
 * servidor la usa como la bodega de la cuenta. Se recuerda la última escogida
 * para la próxima vez que entre. */

export type BodegaDeSesion = { id: number; nombre: string };

const CLAVE_SESION = "arquitejas_sesion";
const CLAVE_ULTIMA = "arquitejas_ultima_bodega";

type SesionGuardada = { correo?: string; bodegaId?: number | null; bodegaNombre?: string; bodegas?: BodegaDeSesion[] };

function leerSesion(): SesionGuardada | null {
  try {
    const texto = sessionStorage.getItem(CLAVE_SESION);
    return texto ? JSON.parse(texto) as SesionGuardada : null;
  } catch {
    return null;
  }
}

/** El valor del encabezado X-Bodega-Id, solo si la cuenta maneja más de una bodega. */
export function encabezadoBodega(): string | null {
  const sesion = leerSesion();
  return sesion && (sesion.bodegas?.length ?? 0) > 1 && sesion.bodegaId ? String(sesion.bodegaId) : null;
}

/** La última bodega que escogió esta cuenta (si sigue siendo suya). */
export function ultimaBodega(correo: string, bodegas: BodegaDeSesion[]): BodegaDeSesion | null {
  try {
    const guardadas = JSON.parse(localStorage.getItem(CLAVE_ULTIMA) || "{}") as Record<string, number>;
    return bodegas.find((b) => b.id === guardadas[correo]) || null;
  } catch {
    return null;
  }
}

function recordar(correo: string, bodegaId: number) {
  try {
    const guardadas = JSON.parse(localStorage.getItem(CLAVE_ULTIMA) || "{}") as Record<string, number>;
    localStorage.setItem(CLAVE_ULTIMA, JSON.stringify({ ...guardadas, [correo]: bodegaId }));
  } catch {
    /* Sin almacenamiento: la próxima vez entra a su bodega principal. */
  }
}

/** Pasa a otra bodega: se guarda en la sesión y la página se recarga para que
 * todo (listas, avisos, formularios) quede de la bodega nueva. */
export function cambiarBodegaActiva(bodegaId: number) {
  const sesion = leerSesion();
  const bodega = sesion?.bodegas?.find((b) => b.id === bodegaId);
  if (!sesion || !bodega) return;
  sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ ...sesion, bodegaId: bodega.id, bodegaNombre: bodega.nombre }));
  if (sesion.correo) recordar(sesion.correo, bodega.id);
  window.location.reload();
}
