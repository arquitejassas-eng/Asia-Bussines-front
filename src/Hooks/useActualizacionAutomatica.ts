import { useEffect, useRef } from "react";

/** Cada cuánto se refrescan los datos de una pantalla abierta. Inventario
 * total usa un intervalo más corto (ver AdminInventario.ts). */
export const SEGUNDOS_ACTUALIZACION_PANTALLAS = 10;

/** Refresca los datos de una pantalla en segundo plano, como llegan las
 * notificaciones en una red social: sin que el usuario haga nada y sin
 * interrumpirlo. `actualizar` debe ser una recarga SILENCIOSA (sin
 * "Cargando...", sin volver a la página 1, sin tocar formularios).
 *
 * - Solo consulta con la pestaña a la vista, y de inmediato al volver a ella.
 * - Si una actualización tarda más que el intervalo, se salta ese turno en
 *   vez de lanzar otra encima (no se acumulan consultas contra la base).
 * - `actualizar` puede cambiar en cada render (depende de filtros, página,
 *   etc.): siempre se llama la versión más reciente sin reiniciar el reloj. */
export function useActualizacionAutomatica(
  actualizar: () => unknown,
  { segundos = SEGUNDOS_ACTUALIZACION_PANTALLAS, activa = true }: { segundos?: number; activa?: boolean } = {},
) {
  const actualizarRef = useRef(actualizar);
  actualizarRef.current = actualizar;
  const enCurso = useRef(false);

  useEffect(() => {
    if (!activa) return;
    const actualizarSiVisible = async () => {
      if (document.visibilityState !== "visible" || enCurso.current) return;
      enCurso.current = true;
      try {
        await actualizarRef.current();
      } catch {
        // Una actualización automática fallida no debe molestar: la
        // siguiente lo vuelve a intentar.
      } finally {
        enCurso.current = false;
      }
    };
    const intervalo = window.setInterval(actualizarSiVisible, segundos * 1000);
    document.addEventListener("visibilitychange", actualizarSiVisible);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", actualizarSiVisible);
    };
  }, [segundos, activa]);
}
