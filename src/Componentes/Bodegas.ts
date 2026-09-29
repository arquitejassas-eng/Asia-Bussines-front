import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ErrorApi } from "./Api";
import { disponibilidadCodigoDesdeApi, envioDesdeApi, productoDesdeApi, rolloDesdeApi, solicitudDesdeApi } from "./Mapeo";
import { redondear } from "../Utils/numeros";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";
import type { AlmacenGlobal, Bodega, Envio, EnvioApi, Producto, Sesion, Solicitud, SolicitudApi } from "../types/dominio";

const TIPOS_OPERACION = [
  { valor: "solicitud", etiqueta: "Solicitud" },
  { valor: "prestamo", etiqueta: "Préstamo" },
  { valor: "intercambio", etiqueta: "Intercambio" },
];

const FORM_SOLICITUD_VACIO = {
  cantidad: "",
  tipoOperacion: "solicitud",
  observaciones: "",
};

type FormularioSolicitud = typeof FORM_SOLICITUD_VACIO;
type ProductoSolicitable = Producto & { bodegaNombre: string };
type RegistroApi = Record<string, unknown>;
type AdvertenciaTransferencia = {
  solicitudId: number; codigoInterno: string; metrosReservados: number; metrosFisicosActuales: number;
  metrosDelRollo: number; metrosFisicosDespues: number; cantidadRollosConMaterial: number;
  alertaCobertura: boolean; alertaUltimoRollo: boolean;
};

export function useControladorBodegas(sesion: Sesion | null | undefined, almacen: AlmacenGlobal | undefined) {
  const _bodegaId = sesion?.bodegaId;
  const bodegasPorId = useMemo(
    () => Object.fromEntries((almacen?.bodegas || []).map((b) => [b.id, b.nombre])),
    [almacen?.bodegas]
  );

  // ---------- Paso 1: buscar y filtrar bodegas por nombre ----------
  const [busquedaBodegaInput, setBusquedaBodegaInput] = useState("");
  const [busquedaBodegaAplicada, setBusquedaBodegaAplicada] = useState("");
  const [bodegasFiltradas, setBodegasFiltradas] = useState<Bodega[]>([]);

  const buscarBodegas = useCallback(async (nombre: string) => {
    try {
      const datos = await api.get<Bodega[]>(`/bodegas?nombre=${encodeURIComponent(nombre || "")}`) || [];
      setBodegasFiltradas(datos);
    } catch {
      setBodegasFiltradas([]);
    }
  }, []);

  useEffect(() => {
    buscarBodegas(busquedaBodegaAplicada);
  }, [busquedaBodegaAplicada, buscarBodegas]);

  function aplicarFiltroBodega() {
    setBusquedaBodegaAplicada(busquedaBodegaInput);
  }

  // ---------- Paso 2: elegir una bodega y ver su inventario completo ----------
  const [bodegaSeleccionadaId, setBodegaSeleccionadaId] = useState<number | null>(null);
  const [busquedaProductoBodega, setBusquedaProductoBodega] = useState("");
  const [inventarioBodegaSeleccionada, setInventarioBodegaSeleccionada] = useState<ProductoSolicitable[]>([]);

  function seleccionarBodega(idBodega: number) {
    setBodegaSeleccionadaId(idBodega);
    setBusquedaProductoBodega("");
  }

  function limpiarSeleccionBodega() {
    setBodegaSeleccionadaId(null);
    setBusquedaProductoBodega("");
    setInventarioBodegaSeleccionada([]);
  }

  const bodegaSeleccionada = useMemo(
    () => bodegasFiltradas.find((b) => b.id === bodegaSeleccionadaId) || null,
    [bodegasFiltradas, bodegaSeleccionadaId]
  );

  useEffect(() => {
    if (!bodegaSeleccionadaId) return;
    (async () => {
      try {
        const parametros = new URLSearchParams();
        if (busquedaProductoBodega) parametros.set("busqueda", busquedaProductoBodega);
        const datos = await api.get<RegistroApi[]>(`/bodegas/${bodegaSeleccionadaId}/inventario?${parametros.toString()}`) || [];
        setInventarioBodegaSeleccionada(
          datos.map((p) => ({ ...productoDesdeApi(p), bodegaNombre: bodegaSeleccionada?.nombre || "—" }))
        );
      } catch {
        setInventarioBodegaSeleccionada([]);
      }
    })();
  }, [bodegaSeleccionadaId, busquedaProductoBodega, bodegaSeleccionada]);

  // ---------- Formulario para solicitar un material ----------
  const [productoSeleccionado, setProductoSeleccionado] = useState<ProductoSolicitable | null>(null);
  const [formularioSolicitud, setFormularioSolicitud] = useState<FormularioSolicitud>(FORM_SOLICITUD_VACIO);
  const [errorSolicitud, setErrorSolicitud] = useState("");
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);
  const [exitoSolicitud, setExitoSolicitud] = useState("");

  function abrirFormularioSolicitud(producto: ProductoSolicitable) {
    setProductoSeleccionado(producto);
    setFormularioSolicitud({
      ...FORM_SOLICITUD_VACIO,
      cantidad: producto.rolloId ? String(producto.stock) : "",
    });
    setErrorSolicitud("");
    setExitoSolicitud("");
  }

  function cerrarFormularioSolicitud() {
    setProductoSeleccionado(null);
    setErrorSolicitud("");
  }

  function actualizarCampoSolicitud(campo: keyof FormularioSolicitud, valor: string) {
    setFormularioSolicitud((actual) => ({ ...actual, [campo]: valor }));
  }

  async function enviarSolicitud(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!productoSeleccionado) return;

    const cantidadNum = Number(formularioSolicitud.cantidad);
    if (!formularioSolicitud.cantidad || cantidadNum <= 0) {
      setErrorSolicitud("La cantidad debe ser mayor a cero.");
      return;
    }
    if (cantidadNum > productoSeleccionado.stock) {
      setErrorSolicitud("La cantidad supera la disponibilidad de esa bodega.");
      return;
    }

    setEnviandoSolicitud(true);
    setErrorSolicitud("");
    try {
      await api.post("/bodegas/solicitudes", {
        producto_id: productoSeleccionado.rolloId ? null : productoSeleccionado.id,
        rollo_id: productoSeleccionado.rolloId,
        cantidad: cantidadNum,
        tipo_operacion: formularioSolicitud.tipoOperacion,
        observaciones: formularioSolicitud.observaciones,
      });

      await cargarMisSolicitudesEnviadas();
      setExitoSolicitud(`Solicitud enviada a ${productoSeleccionado.bodegaNombre}.`);
      setProductoSeleccionado(null);
    } catch (err) {
      setErrorSolicitud(
        err instanceof ErrorApi ? err.message : "No se pudo enviar la solicitud. Intenta de nuevo."
      );
    } finally {
      setEnviandoSolicitud(false);
    }
  }

  // ---------- Notificaciones: solicitudes que me llegan a mí ----------
  const [solicitudesPendientesParaMi, setSolicitudesPendientesParaMi] = useState<Solicitud[]>([]);

  // `silenciosa` en los tres cargadores de esta sección = actualización
  // automática: si falla, conserva lo que ya estaba en pantalla.
  const cargarSolicitudesPendientesParaMi = useCallback(async (silenciosa = false) => {
    try {
      const datos = await api.get<SolicitudApi[]>("/bodegas/solicitudes/recibidas") || [];
      setSolicitudesPendientesParaMi(datos.map((s) => solicitudDesdeApi(s, bodegasPorId)));
    } catch {
      if (!silenciosa) setSolicitudesPendientesParaMi([]);
    }
  }, [bodegasPorId]);

  // ---------- Mis solicitudes enviadas ----------
  const [misSolicitudesEnviadas, setMisSolicitudesEnviadas] = useState<Solicitud[]>([]);

  const cargarMisSolicitudesEnviadas = useCallback(async (silenciosa = false) => {
    try {
      const datos = await api.get<SolicitudApi[]>("/bodegas/solicitudes/enviadas") || [];
      setMisSolicitudesEnviadas(datos.map((s) => solicitudDesdeApi(s, bodegasPorId)));
    } catch {
      if (!silenciosa) setMisSolicitudesEnviadas([]);
    }
  }, [bodegasPorId]);

  useEffect(() => {
    cargarSolicitudesPendientesParaMi();
    cargarMisSolicitudesEnviadas();
  }, [cargarSolicitudesPendientesParaMi, cargarMisSolicitudesEnviadas]);

  const [procesandoSolicitudId, setProcesandoSolicitudId] = useState<number | null>(null);
  const [errorRespuesta, setErrorRespuesta] = useState("");

  async function aceptarSolicitud(idSolicitud: number) {
    setProcesandoSolicitudId(idSolicitud);
    setErrorRespuesta("");
    try {
      await api.patch(`/bodegas/solicitudes/${idSolicitud}/aceptar`);
      await Promise.all([
        cargarSolicitudesPendientesParaMi(),
        almacen?.refrescarSolicitudesPendientes?.(),
      ]);
    } catch (err) {
      setErrorRespuesta(
        err instanceof ErrorApi ? err.message : "No se pudo procesar la solicitud. Intenta de nuevo."
      );
    } finally {
      setProcesandoSolicitudId(null);
    }
  }

  async function rechazarSolicitud(idSolicitud: number) {
    setProcesandoSolicitudId(idSolicitud);
    setErrorRespuesta("");
    try {
      await api.patch(`/bodegas/solicitudes/${idSolicitud}/rechazar`);
      await Promise.all([
        cargarSolicitudesPendientesParaMi(),
        almacen?.refrescarSolicitudesPendientes?.(),
      ]);
    } catch (err) {
      setErrorRespuesta(
        err instanceof ErrorApi ? err.message : "No se pudo procesar la solicitud. Intenta de nuevo."
      );
    } finally {
      setProcesandoSolicitudId(null);
    }
  }

  // ---------- Advertencia (no bloqueante) antes de aceptar una transferencia de
  // rollo que pueda afectar material reservado por Apartados activos. La
  // disponibilidad/reserva real siempre se calcula en el backend (GET /rollos
  // y GET /apartados/disponibilidad, ya existentes) — aquí solo se decide si
  // corresponde mostrar el aviso antes de llamar a aceptarSolicitud. ----------
  const [advertenciaTransferencia, setAdvertenciaTransferencia] = useState<AdvertenciaTransferencia | null>(null);
  const [verificandoTransferencia, setVerificandoTransferencia] = useState(false);

  async function prepararAceptarSolicitud(solicitud: Solicitud) {
    if (solicitud.rolloId == null) {
      await aceptarSolicitud(solicitud.id);
      return;
    }
    setVerificandoTransferencia(true);
    setErrorRespuesta("");
    try {
      const [rollosApi, disponibilidadApi] = await Promise.all([
        api.get<RegistroApi[]>(`/rollos?codigo_interno=${encodeURIComponent(solicitud.productoCodigo)}`),
        api.get<RegistroApi>(`/apartados/disponibilidad?codigo_interno=${encodeURIComponent(solicitud.productoCodigo)}`),
      ]);
      const rollosDelCodigo = (rollosApi || [])
        .map((r) => rolloDesdeApi(r))
        .filter((r) => r.codigoInterno === solicitud.productoCodigo);
      const metrosReservados = disponibilidadCodigoDesdeApi(disponibilidadApi || {}).metrosReservados;
      const metrosFisicosActuales = redondear(
        rollosDelCodigo.reduce((suma, r) => suma + r.metrosDisponibles, 0)
      );
      const metrosDelRollo = rollosDelCodigo.find((r) => r.id === solicitud.rolloId)?.metrosDisponibles ?? 0;
      const cantidadRollosConMaterial = rollosDelCodigo.filter((r) => r.metrosDisponibles > 0).length;
      const metrosFisicosDespues = redondear(metrosFisicosActuales - metrosDelRollo);
      const alertaCobertura = metrosFisicosDespues < metrosReservados;
      const alertaUltimoRollo = cantidadRollosConMaterial === 1 && metrosReservados > 0;

      if (alertaCobertura || alertaUltimoRollo) {
        setAdvertenciaTransferencia({
          solicitudId: solicitud.id, codigoInterno: solicitud.productoCodigo, metrosReservados,
          metrosFisicosActuales, metrosDelRollo, metrosFisicosDespues, cantidadRollosConMaterial,
          alertaCobertura, alertaUltimoRollo,
        });
      } else {
        await aceptarSolicitud(solicitud.id);
      }
    } catch {
      // Verificacion informativa: si falla, no debe impedir la transferencia real.
      await aceptarSolicitud(solicitud.id);
    } finally {
      setVerificandoTransferencia(false);
    }
  }

  function cancelarAdvertenciaTransferencia() {
    setAdvertenciaTransferencia(null);
  }

  async function confirmarTransferenciaConAdvertencia() {
    if (!advertenciaTransferencia) return;
    const idSolicitud = advertenciaTransferencia.solicitudId;
    setAdvertenciaTransferencia(null);
    await aceptarSolicitud(idSolicitud);
  }

  // ---------- Material en camino: envíos de Admin Inventario pendientes de confirmar ----------
  const [enviosPendientes, setEnviosPendientes] = useState<Envio[]>([]);

  const cargarEnviosPendientes = useCallback(async (silenciosa = false) => {
    try {
      const datos = await api.get<EnvioApi[]>("/envios/recibidos") || [];
      setEnviosPendientes(datos.map((e) => envioDesdeApi(e, bodegasPorId)));
    } catch {
      if (!silenciosa) setEnviosPendientes([]);
    }
  }, [bodegasPorId]);

  useEffect(() => { cargarEnviosPendientes(); }, [cargarEnviosPendientes]);

  // Una solicitud o un envío que llega de otra sede aparece sin recargar.
  useActualizacionAutomatica(() => Promise.all([
    cargarSolicitudesPendientesParaMi(true), cargarMisSolicitudesEnviadas(true), cargarEnviosPendientes(true),
  ]));

  const [procesandoEnvioId, setProcesandoEnvioId] = useState<number | null>(null);
  const [errorRespuestaEnvio, setErrorRespuestaEnvio] = useState("");

  async function confirmarEnvioRecibido(idEnvio: number) {
    setProcesandoEnvioId(idEnvio);
    setErrorRespuestaEnvio("");
    try {
      await api.patch(`/envios/${idEnvio}/confirmar`);
      await Promise.all([cargarEnviosPendientes(), almacen?.refrescarEnviosPendientes?.()]);
    } catch (err) {
      setErrorRespuestaEnvio(err instanceof ErrorApi ? err.message : "No se pudo confirmar el envío. Intenta de nuevo.");
    } finally {
      setProcesandoEnvioId(null);
    }
  }

  async function marcarEnvioNoLlego(idEnvio: number) {
    setProcesandoEnvioId(idEnvio);
    setErrorRespuestaEnvio("");
    try {
      await api.patch(`/envios/${idEnvio}/no-llego`);
      await Promise.all([cargarEnviosPendientes(), almacen?.refrescarEnviosPendientes?.()]);
    } catch (err) {
      setErrorRespuestaEnvio(err instanceof ErrorApi ? err.message : "No se pudo registrar la respuesta. Intenta de nuevo.");
    } finally {
      setProcesandoEnvioId(null);
    }
  }

  return {
    busquedaBodegaInput,
    setBusquedaBodegaInput,
    aplicarFiltroBodega,
    bodegasFiltradas,

    bodegaSeleccionadaId,
    bodegaSeleccionada,
    seleccionarBodega,
    limpiarSeleccionBodega,

    inventarioBodegaSeleccionada,
    busquedaProductoBodega,
    setBusquedaProductoBodega,

    TIPOS_OPERACION,

    productoSeleccionado,
    formularioSolicitud,
    errorSolicitud,
    enviandoSolicitud,
    exitoSolicitud,
    abrirFormularioSolicitud,
    cerrarFormularioSolicitud,
    actualizarCampoSolicitud,
    enviarSolicitud,

    solicitudesPendientesParaMi,
    misSolicitudesEnviadas,
    procesandoSolicitudId,
    errorRespuesta,
    aceptarSolicitud,
    rechazarSolicitud,

    advertenciaTransferencia,
    verificandoTransferencia,
    prepararAceptarSolicitud,
    cancelarAdvertenciaTransferencia,
    confirmarTransferenciaConAdvertencia,

    enviosPendientes,
    procesandoEnvioId,
    errorRespuestaEnvio,
    confirmarEnvioRecibido,
    marcarEnvioNoLlego,
  };
}
