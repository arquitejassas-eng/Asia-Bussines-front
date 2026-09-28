import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import { apartadoDesdeApi, envioDesdeApi, solicitudDesdeApi } from "./Mapeo";
import { useUnidadesFamilia } from "../Hooks/useUnidadesFamilia";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";
import { calcularSolicitudesPendientes } from "../Utils/produccion";
import type { Bodega, Envio, EnvioApi, Sesion, Solicitud, SolicitudApi } from "../types/dominio";

// Notificaciones de solicitudes/envíos entre bodegas: no hay push del
// servidor, así que se refrescan solas (useActualizacionAutomatica) mientras
// haya sesión, para que el badge de BarraLateral se entere sin recargar.

// Mismos estados que usa Produccion.ts para filtrar qué apartados cuentan
// como "pendientes de producción".
const ESTADOS_PRODUCCION_PENDIENTE = ["enviado_a_produccion", "en_produccion"];

export function useAlmacenGlobal(sesion: Sesion | null | undefined) {
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const { unidadesFamilia, unidadPorFamilia, decimalesPorFamilia, cargarUnidadesFamilia, guardarUnidadFamilia } = useUnidadesFamilia();

  const cargarBodegas = useCallback(async () => {
    if (!sesion?.correo) return setBodegas([]);
    // Admin Inventario (bodegaId null) no tiene "su propia bodega" que
    // anteponer — ve la lista real completa, la necesita para elegir
    // destino de un envío.
    if (!sesion.bodegaId) {
      try {
        setBodegas(await api.get<Bodega[]>("/bodegas") || []);
      } catch {
        setBodegas([]);
      }
      return;
    }
    const bodegaActual = { id: sesion.bodegaId, nombre: sesion.bodegaNombre || "Mi bodega" };
    try {
      const otrasBodegas = await api.get<Bodega[]>("/bodegas") || [];
      setBodegas([bodegaActual, ...otrasBodegas.filter((bodega) => bodega.id !== bodegaActual.id)]);
    } catch {
      setBodegas([bodegaActual]);
    }
  }, [sesion?.correo, sesion?.bodegaId, sesion?.bodegaNombre]);

  // ---------- Crear bodega (exclusivo SUPERADMIN, ver UsuariosPage.tsx) ----------
  const [mostrarFormularioBodega, setMostrarFormularioBodega] = useState(false);
  const [nombreBodegaNueva, setNombreBodegaNueva] = useState("");
  const [guardandoBodega, setGuardandoBodega] = useState(false);
  const [errorBodega, setErrorBodega] = useState("");

  async function crearBodega(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!nombreBodegaNueva.trim()) {
      setErrorBodega("El nombre de la bodega es obligatorio.");
      return;
    }
    setGuardandoBodega(true);
    setErrorBodega("");
    try {
      await api.post("/bodegas", { nombre: nombreBodegaNueva.trim() });
      await cargarBodegas();
      setNombreBodegaNueva("");
      setMostrarFormularioBodega(false);
    } catch (err) {
      setErrorBodega(err instanceof ErrorApi ? err.message : "No se pudo crear la bodega.");
    } finally {
      setGuardandoBodega(false);
    }
  }

  const refrescarSolicitudesPendientes = useCallback(async () => {
    if (!sesion?.correo) return setSolicitudes([]);
    try {
      const datos = await api.get<SolicitudApi[]>("/bodegas/solicitudes/recibidas") || [];
      setSolicitudes(
        datos.filter((solicitud) => solicitud.estado === "pendiente").map((solicitud) => solicitudDesdeApi(solicitud))
      );
    } catch {
      setSolicitudes([]);
    }
  }, [sesion?.correo]);

  const refrescarEnviosPendientes = useCallback(async () => {
    if (!sesion?.correo) return setEnvios([]);
    try {
      const datos = await api.get<EnvioApi[]>("/envios/recibidos") || [];
      // El backend ya solo devuelve los pendientes de MI bodega — no hace
      // falta filtrar de nuevo; esto es solo para contar la notificación en
      // cualquier módulo (el detalle completo vive en Bodegas.ts).
      setEnvios(datos.map((e) => envioDesdeApi(e)));
    } catch {
      setEnvios([]);
    }
  }, [sesion?.correo]);

  // Badge global de "Registrar Producción" para jefe_planta -- solo ellos
  // ven ese módulo, así que no hace falta consultar /apartados para nadie
  // más. Sobrevive la navegación entre Apartados y Producción (este hook
  // vive en App.tsx, no en cada página) porque se pidió que Planta se
  // entere sin importar en qué pantalla esté.
  const [produccionPendienteCount, setProduccionPendienteCount] = useState(0);

  const refrescarProduccionPendiente = useCallback(async () => {
    if (sesion?.rol !== "jefe_planta") return setProduccionPendienteCount(0);
    try {
      const datos = await api.get<Record<string, unknown>[]>("/apartados") || [];
      const apartadosPendientes = datos.map(apartadoDesdeApi).filter((ap) => ESTADOS_PRODUCCION_PENDIENTE.includes(ap.estado));
      setProduccionPendienteCount(calcularSolicitudesPendientes(apartadosPendientes).length);
    } catch {
      setProduccionPendienteCount(0);
    }
  }, [sesion?.rol]);

  useEffect(() => {
    cargarBodegas();
    refrescarSolicitudesPendientes();
    refrescarEnviosPendientes();
    refrescarProduccionPendiente();
    if (sesion?.correo) cargarUnidadesFamilia();
  }, [cargarBodegas, refrescarSolicitudesPendientes, refrescarEnviosPendientes, refrescarProduccionPendiente, cargarUnidadesFamilia, sesion?.correo]);

  useActualizacionAutomatica(
    () => Promise.all([refrescarSolicitudesPendientes(), refrescarEnviosPendientes(), refrescarProduccionPendiente()]),
    { activa: Boolean(sesion?.correo) },
  );

  return {
    bodegas, solicitudes, envios, cargarBodegas, refrescarSolicitudesPendientes, refrescarEnviosPendientes,
    produccionPendienteCount, refrescarProduccionPendiente,
    unidadesFamilia, unidadPorFamilia, decimalesPorFamilia, cargarUnidadesFamilia, guardarUnidadFamilia,
    mostrarFormularioBodega, setMostrarFormularioBodega, nombreBodegaNueva, setNombreBodegaNueva,
    guardandoBodega, errorBodega, crearBodega,
  };
}
