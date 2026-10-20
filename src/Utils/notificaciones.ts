import type { Envio, Sesion, Solicitud } from "../types/dominio";

/** Notificaciones de la campanita en la barra lateral: solicitudes de otras
 * bodegas pendientes de responder + envíos por confirmar + traslados por
 * despachar o por recibir. */
export function contarNotificaciones(
  almacen: { solicitudes?: Solicitud[]; envios?: Envio[]; trasladosPendientes?: Solicitud[] } | null | undefined,
  sesion: Sesion | null | undefined
): number {
  return (
    (almacen?.solicitudes || []).filter(
      (s) => s.bodegaPropietariaId === sesion?.bodegaId && s.estado === "pendiente"
    ).length + (almacen?.envios || []).length + (almacen?.trasladosPendientes || []).length
  );
}

/** El badge de BarraLateral es un único número por sesión (un rol solo ve un
 * módulo notificable a la vez -- ver MODULOS en BarraLateral.tsx), así que
 * cada página que puede verla desde más de un rol (hoy, Apartados) debe
 * elegir el conteo correcto según el rol activo: bodegas (transferencias)
 * para administrativo, producción pendiente para jefe_planta. */
export function contarNotificacionesBarraLateral(
  almacen: { solicitudes?: Solicitud[]; envios?: Envio[]; trasladosPendientes?: Solicitud[]; produccionPendienteCount?: number } | null | undefined,
  sesion: Sesion | null | undefined
): number {
  if (sesion?.rol === "jefe_planta") return almacen?.produccionPendienteCount || 0;
  return contarNotificaciones(almacen, sesion);
}
