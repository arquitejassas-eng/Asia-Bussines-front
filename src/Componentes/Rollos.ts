// @ts-nocheck -- contrato API pendiente de centralizar en src/types.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErrorApi } from "./Api";
import { rolloDesdeApi, reservaCodigoDesdeApi, movimientoDesdeApi } from "./Mapeo";
import { useCargaRollosInventario } from "../Hooks/useCargaRollosInventario";
import { finDelDiaColombia, inicioDelDiaColombia } from "../Utils/fechas";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";

export const ESTADOS_ROLLO = {
  cerrado: "Cerrado",
  abierto: "Abierto",
  agotado: "Agotado",
};

const FILTROS_VACIOS = {
  codigoInterno: "",
  identificadorRollo: "",
  codigoProveedor: "",
  descripcion: "",
  familia: "",
  colorMaterial: "",
  calibre: "",
  estado: "",
  proveedor: "",
  empresa: "",
  fechaDesde: "",
  fechaHasta: "",
};

type Filtros = typeof FILTROS_VACIOS;
type Rollo = { id: number; codigoInterno: string; colorMaterial: string; calibre: number | string; familia: string; metrosDisponibles: number; observaciones?: string };

export function useControladorRollos(_sesion: unknown, _almacen: unknown) {
  const ultimaConsulta = useRef(0);
  const [misRollos, setMisRollos] = useState<Rollo[]>([]);
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [paginacion, setPaginacion] = useState({ total: 0, pagina: 1, total_paginas: 1 });
  // "activos" = inventario normal (el backend ya excluye agotados por
  // defecto); "acabados" = sección independiente, fuerza estado=agotado sin
  // importar lo que tenga el filtro de Estado (queda oculto en ese modo).
  const [vista, setVista] = useState<"activos" | "acabados">("activos");

  function cambiarVista(siguiente: "activos" | "acabados") {
    setVista(siguiente);
    setPagina(1);
  }

  function actualizarFiltro(campo: keyof Filtros, valor: string) {
    setFiltros((actual) => ({ ...actual, [campo]: valor }));
    setPagina(1);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    setPagina(1);
  }

  // `silenciosa` (actualización automática): si falla, conserva los rollos
  // que ya estaban en pantalla en vez de vaciar la lista.
  const cargarRollos = useCallback(async (silenciosa = false) => {
    const consultaActual = ++ultimaConsulta.current;
    try {
      const parametros = new URLSearchParams();
      if (filtros.codigoInterno) parametros.set("codigo_interno", filtros.codigoInterno);
      if (filtros.identificadorRollo) parametros.set("identificador_rollo", filtros.identificadorRollo);
      if (filtros.codigoProveedor) parametros.set("codigo_proveedor", filtros.codigoProveedor);
      if (filtros.descripcion) parametros.set("descripcion", filtros.descripcion);
      if (filtros.familia) parametros.set("familia", filtros.familia);
      if (filtros.colorMaterial) parametros.set("color_material", filtros.colorMaterial);
      if (filtros.calibre) parametros.set("calibre", filtros.calibre);
      if (filtros.proveedor) parametros.set("proveedor", filtros.proveedor);
      if (filtros.empresa) parametros.set("empresa", filtros.empresa);
      // En la vista "Rollos acabados" el estado queda fijo en agotado, sin
      // importar el filtro de Estado (se oculta en esa vista); en "Activos"
      // no se manda nada y el backend ya excluye agotados por defecto.
      if (vista === "acabados") parametros.set("estado", "agotado");
      else if (filtros.estado) parametros.set("estado", filtros.estado);
      if (filtros.fechaDesde) parametros.set("fecha_desde", inicioDelDiaColombia(filtros.fechaDesde));
      if (filtros.fechaHasta) parametros.set("fecha_hasta", finDelDiaColombia(filtros.fechaHasta));
      parametros.set("paginado", "true");
      parametros.set("pagina", String(pagina));
      parametros.set("tamano", "30");

      const datos = await api.get(`/rollos?${parametros.toString()}`);
      if (consultaActual !== ultimaConsulta.current) return;
      setMisRollos(datos.items.map(rolloDesdeApi));
      setPaginacion(datos);
    } catch {
      if (consultaActual !== ultimaConsulta.current || silenciosa) return;
      setMisRollos([]);
    }
  }, [filtros, pagina, vista]);

  useEffect(() => {
    cargarRollos();
  }, [cargarRollos]);

  const [reservasPorCodigo, setReservasPorCodigo] = useState<Record<string, number>>({});

  const cargarReservas = useCallback(async (silenciosa = false) => {
    try {
      const datos = await api.get("/apartados/reservas");
      const mapa = {};
      for (const r of (datos as Record<string, unknown>[]).map(reservaCodigoDesdeApi)) {
        mapa[r.codigoInterno] = r.metrosReservados;
      }
      setReservasPorCodigo(mapa);
    } catch {
      if (!silenciosa) setReservasPorCodigo({});
    }
  }, []);

  useEffect(() => {
    cargarReservas();
  }, [cargarReservas]);

  // Rollos que otra persona carga o consume aparecen sin recargar, sin
  // tocar los filtros, la página ni los grupos abiertos.
  useActualizacionAutomatica(() => Promise.all([cargarRollos(true), cargarReservas(true)]));

  const rollosFiltrados = misRollos;

  const gruposPorCodigo = useMemo(() => {
    const mapa = new Map();
    for (const rollo of rollosFiltrados) {
      if (!mapa.has(rollo.codigoInterno)) {
        mapa.set(rollo.codigoInterno, {
          codigoInterno: rollo.codigoInterno,
          colorMaterial: rollo.colorMaterial,
          calibre: rollo.calibre,
          familia: rollo.familia,
          metrosReservados: reservasPorCodigo[rollo.codigoInterno] || 0,
          rollos: [],
        });
      }
      mapa.get(rollo.codigoInterno).rollos.push(rollo);
    }
    return Array.from(mapa.values()).sort((a, b) => a.codigoInterno.localeCompare(b.codigoInterno));
  }, [rollosFiltrados, reservasPorCodigo]);

  const familiasDisponibles = useMemo(
    () => [...new Set(misRollos.map((r) => r.familia))].filter(Boolean),
    [misRollos]
  );

  const coloresDisponibles = useMemo(
    () => [...new Set(misRollos.map((r) => r.colorMaterial))].filter(Boolean),
    [misRollos]
  );

  const [rolloParaConsumo, setRolloParaConsumo] = useState<Rollo | null>(null);
  const [cantidadConsumo, setCantidadConsumo] = useState("");
  const [observacionesConsumo, setObservacionesConsumo] = useState("");
  const [errorConsumo, setErrorConsumo] = useState("");
  const [guardandoConsumo, setGuardandoConsumo] = useState(false);

  function abrirConsumo(rollo: Rollo) {
    setRolloParaConsumo(rollo);
    setCantidadConsumo("");
    setObservacionesConsumo("");
    setErrorConsumo("");
  }

  function cerrarConsumo() {
    setRolloParaConsumo(null);
    setErrorConsumo("");
  }

  const [rolloParaSalidaExterna, setRolloParaSalidaExterna] = useState<Rollo | null>(null);
  const [empresaSalidaExterna, setEmpresaSalidaExterna] = useState("");
  const [observacionesSalidaExterna, setObservacionesSalidaExterna] = useState("");
  const [errorSalidaExterna, setErrorSalidaExterna] = useState("");
  const [guardandoSalidaExterna, setGuardandoSalidaExterna] = useState(false);

  function abrirSalidaExterna(rollo: Rollo) {
    setRolloParaSalidaExterna(rollo);
    setEmpresaSalidaExterna("");
    setObservacionesSalidaExterna("");
    setErrorSalidaExterna("");
  }

  function cerrarSalidaExterna() {
    setRolloParaSalidaExterna(null);
    setErrorSalidaExterna("");
  }

  const FORMULARIO_ROLLO_VACIO = {
    codigoInterno: "", identificadorRollo: "", codigoProveedor: "", descripcion: "",
    colorMaterial: "", calibre: "", pesoNeto: "", metrosProveedor: "", metrosDisponibles: "",
    metrosConsumidos: "", proveedor: "", lote: "", observaciones: "",
  };

  const [mostrarFormularioRollo, setMostrarFormularioRollo] = useState(false);
  const [formularioRollo, setFormularioRollo] = useState(FORMULARIO_ROLLO_VACIO);
  const [guardandoRollo, setGuardandoRollo] = useState(false);
  const [errorFormularioRollo, setErrorFormularioRollo] = useState("");
  // "" = todavía no se sabe / no se ha revisado; "ok" = reconocido (rollo
  // hermano o equivalencia); "faltante" = ni lo uno ni lo otro, no se deja guardar.
  const [estadoClasificacionRollo, setEstadoClasificacionRollo] = useState("");

  const ultimaReferenciaSugerida = useRef("");
  const ultimaDescripcionSugerida = useRef("");
  const ultimoColorSugerido = useRef("");
  const temporizadorSugerenciaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function abrirFormularioRollo() {
    setFormularioRollo(FORMULARIO_ROLLO_VACIO);
    setErrorFormularioRollo("");
    ultimaReferenciaSugerida.current = "";
    ultimaDescripcionSugerida.current = "";
    ultimoColorSugerido.current = "";
    setEstadoClasificacionRollo("");
    if (temporizadorSugerenciaRef.current) clearTimeout(temporizadorSugerenciaRef.current);
    setMostrarFormularioRollo(true);
  }

  function cerrarFormularioRollo() {
    setMostrarFormularioRollo(false);
    setErrorFormularioRollo("");
    if (temporizadorSugerenciaRef.current) clearTimeout(temporizadorSugerenciaRef.current);
  }

  function actualizarCampoRollo(campo: string, valor: string) {
    setFormularioRollo((actual) => ({ ...actual, [campo]: valor }));
  }

  async function sugerirReferenciaRollo(codigoInterno: string) {
    const codigo = codigoInterno.trim();
    if (!codigo) return;
    try {
      const datos = await api.get(`/rollos/siguiente-referencia?codigo_interno=${encodeURIComponent(codigo)}`);
      const sugerida = (datos as Record<string, unknown>).identificador_rollo as string;
      setFormularioRollo((actual) => {
        // Solo autocompleta si la referencia está vacía o si el usuario no la
        // tocó a mano después de la última sugerencia (para no pisar lo que escribió).
        if (actual.identificadorRollo === "" || actual.identificadorRollo === ultimaReferenciaSugerida.current) {
          ultimaReferenciaSugerida.current = sugerida;
          return { ...actual, identificadorRollo: sugerida };
        }
        return actual;
      });
    } catch {
      // Si falla, el usuario simplemente escribe la referencia a mano.
    }
  }

  async function sugerirClasificacionRollo(codigoInterno: string) {
    const codigo = codigoInterno.trim();
    if (!codigo) {
      setEstadoClasificacionRollo("");
      return;
    }
    try {
      const datos = await api.get(`/rollos/clasificacion-sugerida?codigo_interno=${encodeURIComponent(codigo)}`);
      const respuesta = datos as Record<string, unknown>;
      if (!respuesta.encontrado) {
        setEstadoClasificacionRollo("faltante");
        return;
      }
      setEstadoClasificacionRollo("ok");
      const descripcionSugerida = (respuesta.descripcion as string) || "";
      const colorSugerido = (respuesta.color_material as string) || "";
      setFormularioRollo((actual) => {
        const siguiente = { ...actual };
        // Igual que con la referencia: solo pisa lo que ya hay si está vacío
        // o si sigue siendo la sugerencia anterior (no lo que el usuario escribió).
        if (descripcionSugerida && (actual.descripcion === "" || actual.descripcion === ultimaDescripcionSugerida.current)) {
          ultimaDescripcionSugerida.current = descripcionSugerida;
          siguiente.descripcion = descripcionSugerida;
        }
        if (colorSugerido && (actual.colorMaterial === "" || actual.colorMaterial === ultimoColorSugerido.current)) {
          ultimoColorSugerido.current = colorSugerido;
          siguiente.colorMaterial = colorSugerido;
        }
        return siguiente;
      });
    } catch {
      // Si falla, el usuario simplemente escribe descripción y color a mano.
    }
  }

  function actualizarCodigoInternoRollo(valor: string) {
    setFormularioRollo((actual) => ({ ...actual, codigoInterno: valor }));
    if (temporizadorSugerenciaRef.current) clearTimeout(temporizadorSugerenciaRef.current);
    temporizadorSugerenciaRef.current = setTimeout(() => {
      sugerirReferenciaRollo(valor);
      sugerirClasificacionRollo(valor);
    }, 450);
  }

  async function crearRollo(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    const f = formularioRollo;
    if (!f.codigoInterno.trim() || !f.identificadorRollo.trim() || !(Number(f.metrosDisponibles) >= 0) || f.metrosDisponibles === "") {
      setErrorFormularioRollo("Indica al menos el código interno, la referencia y los metros disponibles.");
      return;
    }
    if (estadoClasificacionRollo === "faltante") {
      setErrorFormularioRollo("Ese código no está en la tabla de equivalencias. Agrégalo antes de guardar el rollo.");
      return;
    }
    setGuardandoRollo(true);
    setErrorFormularioRollo("");
    try {
      await api.post("/rollos", {
        codigo_interno: f.codigoInterno.trim(),
        identificador_rollo: f.identificadorRollo.trim(),
        codigo_proveedor: f.codigoProveedor.trim(),
        descripcion: f.descripcion.trim(),
        color_material: f.colorMaterial.trim(),
        calibre: f.calibre === "" ? 0 : Number(f.calibre),
        peso_neto: f.pesoNeto === "" ? null : Number(f.pesoNeto),
        metros_proveedor: f.metrosProveedor === "" ? 0 : Number(f.metrosProveedor),
        metros_disponibles: Number(f.metrosDisponibles),
        metros_consumidos: f.metrosConsumidos === "" ? 0 : Number(f.metrosConsumidos),
        proveedor: f.proveedor.trim(),
        lote: f.lote.trim(),
        observaciones: f.observaciones.trim(),
      });
      await cargarRollos();
      setMostrarFormularioRollo(false);
    } catch (err) {
      setErrorFormularioRollo(err instanceof ErrorApi ? err.message : "No se pudo registrar el rollo.");
    } finally {
      setGuardandoRollo(false);
    }
  }

  async function registrarConsumo(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!rolloParaConsumo) return;

    const cantidad = Number(cantidadConsumo);
    if (!cantidadConsumo || cantidad <= 0) {
      setErrorConsumo("La cantidad debe ser mayor a cero.");
      return;
    }
    if (cantidad > rolloParaConsumo.metrosDisponibles) {
      setErrorConsumo(`Ese rollo solo tiene ${rolloParaConsumo.metrosDisponibles} m disponibles.`);
      return;
    }

    setGuardandoConsumo(true);
    setErrorConsumo("");
    try {
      await api.post(`/rollos/${rolloParaConsumo.id}/consumo`, {
        cantidad,
        observaciones: observacionesConsumo,
      });

      await cargarRollos();
      setRolloParaConsumo(null);
    } catch (err) {
      setErrorConsumo(
        err instanceof ErrorApi ? err.message : "No se pudo registrar el consumo. Intenta de nuevo."
      );
    } finally {
      setGuardandoConsumo(false);
    }
  }

  async function registrarSalidaExterna(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!rolloParaSalidaExterna) return;

    if (!empresaSalidaExterna.trim()) {
      setErrorSalidaExterna("El nombre de la empresa es obligatorio.");
      return;
    }

    setGuardandoSalidaExterna(true);
    setErrorSalidaExterna("");
    try {
      await api.post(`/rollos/${rolloParaSalidaExterna.id}/salida-externa`, {
        empresa: empresaSalidaExterna.trim(),
        observaciones: observacionesSalidaExterna,
      });

      await cargarRollos();
      setRolloParaSalidaExterna(null);
    } catch (err) {
      setErrorSalidaExterna(
        err instanceof ErrorApi ? err.message : "No se pudo registrar la salida. Intenta de nuevo."
      );
    } finally {
      setGuardandoSalidaExterna(false);
    }
  }

  // Ediciones en línea de un rollo (observaciones, familia, empresa, ancho).
  // Antes, si fallaban no se avisaba nada y el usuario creía que se había
  // guardado: ahora se muestra qué cambio no se guardó y por qué.
  const [errorEdicionRollo, setErrorEdicionRollo] = useState("");

  async function editarRollo(idRollo: number, ruta: string, cuerpo: Record<string, unknown>, cambios: Record<string, unknown>, dato: string) {
    try {
      await api.patch(`/rollos/${idRollo}/${ruta}`, cuerpo);
      setErrorEdicionRollo("");
      setMisRollos((actual) => actual.map((r) => (r.id === idRollo ? { ...r, ...cambios } : r)));
    } catch (err) {
      const referencia = misRollos.find((r) => r.id === idRollo)?.identificadorRollo || `#${idRollo}`;
      setErrorEdicionRollo(
        `No se guardó ${dato} del rollo ${referencia}: ${err instanceof ErrorApi ? err.message : "revisa tu conexión e intenta de nuevo."}`
      );
    }
  }

  function actualizarObservacionesRollo(idRollo: number, texto: string) {
    return editarRollo(idRollo, "observaciones", { observaciones: texto }, { observaciones: texto }, "la observación");
  }

  function actualizarFamiliaRollo(idRollo: number, familia: string) {
    if (!familia.trim()) return;
    return editarRollo(idRollo, "familia", { familia: familia.trim() }, { familia: familia.trim() }, "la familia");
  }

  // La empresa se deduce sola de la referencia al crear el rollo; esto es
  // solo para corregirla cuando la referencia no la traía.
  function actualizarEmpresaRollo(idRollo: number, empresa: string) {
    return editarRollo(idRollo, "empresa", { empresa }, { empresa }, "la empresa");
  }

  // La mayoría de rollos miden 122 m de ancho (default); si uno específico
  // es distinto, se corrige aquí — Producción de Caballetes lo usa para
  // calcular el ancho de cada sección (ancho ÷ 3), sin que nadie tenga que
  // escribirlo ni calcularlo a mano en el formulario de producción.
  function actualizarAnchoRollo(idRollo: number, ancho: number) {
    if (!(ancho > 0)) return;
    return editarRollo(idRollo, "ancho", { ancho_material: ancho }, { anchoMaterial: ancho }, "el ancho");
  }

  const [rolloParaHistorial, setRolloParaHistorial] = useState<Rollo | null>(null);
  const [historialRollo, setHistorialRollo] = useState<Record<string, unknown>[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState("");

  async function abrirHistorial(rollo: Rollo) {
    setRolloParaHistorial(rollo);
    setHistorialRollo([]);
    setErrorHistorial("");
    setCargandoHistorial(true);
    try {
      const datos = await api.get(`/rollos/${rollo.id}/historial`);
      setHistorialRollo((datos as Record<string, unknown>[]).map(movimientoDesdeApi));
    } catch (err) {
      setErrorHistorial(err instanceof ErrorApi ? err.message : "No se pudo cargar el historial de este rollo.");
    } finally {
      setCargandoHistorial(false);
    }
  }

  function cerrarHistorial() {
    setRolloParaHistorial(null);
    setHistorialRollo([]);
    setErrorHistorial("");
  }

  const cargaRollos = useCargaRollosInventario({ cargarRollos });

  return {
    ...cargaRollos,
    rollosFiltrados,
    gruposPorCodigo,
    familiasDisponibles,
    coloresDisponibles,
    ESTADOS_ROLLO,

    filtros,
    actualizarFiltro,
    limpiarFiltros,
    pagina,
    setPagina,
    paginacion,
    vista,
    cambiarVista,

    rolloParaHistorial,
    historialRollo,
    cargandoHistorial,
    errorHistorial,
    abrirHistorial,
    cerrarHistorial,

    rolloParaConsumo,
    cantidadConsumo,
    setCantidadConsumo,
    observacionesConsumo,
    setObservacionesConsumo,
    errorConsumo,
    guardandoConsumo,
    abrirConsumo,
    cerrarConsumo,
    registrarConsumo,

    rolloParaSalidaExterna,
    empresaSalidaExterna,
    setEmpresaSalidaExterna,
    observacionesSalidaExterna,
    setObservacionesSalidaExterna,
    errorSalidaExterna,
    guardandoSalidaExterna,
    abrirSalidaExterna,
    cerrarSalidaExterna,
    registrarSalidaExterna,

    actualizarObservacionesRollo,
    actualizarFamiliaRollo,
    actualizarAnchoRollo,
    actualizarEmpresaRollo,
    errorEdicionRollo,
    limpiarErrorEdicionRollo: () => setErrorEdicionRollo(""),

    mostrarFormularioRollo, formularioRollo, guardandoRollo, errorFormularioRollo,
    abrirFormularioRollo, cerrarFormularioRollo, actualizarCampoRollo, crearRollo,
    sugerirReferenciaRollo, sugerirClasificacionRollo, actualizarCodigoInternoRollo,
    estadoClasificacionRollo,
  };
}
