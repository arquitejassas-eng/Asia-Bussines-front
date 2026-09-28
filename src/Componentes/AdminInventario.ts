import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErrorApi } from "./Api";
import { envioDesdeApi, rolloDesdeApi } from "./Mapeo";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

type RolloResumen = {
  codigo: string; descripcion: string; colorMaterial: string; calibre: string;
  porBodega: Record<string, number>; total: number;
  pesoActualPorBodega: Record<string, number>; pesoActualTotal: number; rollosSinPesoActual: number;
  cantidadPorBodega: Record<string, number>; cantidadTotal: number;
};
type ProductoResumen = {
  codigo: string; descripcion: string; calibre: string; familia: string;
  porBodega: Record<string, number>; total: number;
};
type Comparativo = {
  bodegas: { id: number; nombre: string }[]; rollos: RolloResumen[]; productos: ProductoResumen[];
  pesoActualTotalPorBodega: Record<string, number>; pesoActualTotalGeneral: number; rollosSinPesoActualTotal: number;
  calibresSinEquivalencia: number[];
};
type ItemProducto = { codigo: string; cantidad: string };
type FormularioEnvio = { bodegaDestinoId: string; rollosSeleccionados: number[]; itemsProducto: ItemProducto[]; observaciones: string };

const COMPARATIVO_VACIO: Comparativo = {
  bodegas: [], rollos: [], productos: [],
  pesoActualTotalPorBodega: {}, pesoActualTotalGeneral: 0, rollosSinPesoActualTotal: 0, calibresSinEquivalencia: [],
};
const TAMANO_PAGINA_RESUMEN = 10;
const SEGUNDOS_ACTUALIZACION_AUTOMATICA = 30;

function paginar<T>(items: T[], pagina: number) {
  const total = items.length;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_RESUMEN));
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaSegura - 1) * TAMANO_PAGINA_RESUMEN;
  return {
    items: items.slice(inicio, inicio + TAMANO_PAGINA_RESUMEN),
    paginacion: { total, pagina: paginaSegura, total_paginas: totalPaginas },
  };
}

/** Controlador de la página "Inventario total" de Admin Inventario: resumen
 * comparativo entre sedes (con detalle expandible por rollo individual) y
 * despacho de material propio (envíos). El vendedor usa la misma página en
 * solo lectura: únicamente el resumen, sin inventario propio ni envíos. */
export function useControladorAdminInventario(sesion: Sesion, almacen: AlmacenGlobal) {
  const soloLectura = sesion?.rol === "vendedor";
  const bodegasPorId: Record<string, string> = (almacen?.bodegas || []).reduce((acc, b) => ({ ...acc, [b.id]: b.nombre }), {});

  // ---------- Resumen comparativo entre sedes ----------
  const [comparativo, setComparativo] = useState(COMPARATIVO_VACIO);
  const [cargandoComparativo, setCargandoComparativo] = useState(true);
  // Sigla ("AR", "ABG"), "sin_empresa" o "" (todas). Filtra solo los rollos:
  // los productos no llevan empresa.
  const [empresaResumen, setEmpresaResumen] = useState("");
  const parametroEmpresa = empresaResumen ? `empresa=${encodeURIComponent(empresaResumen)}` : "";

  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null);
  // Si una respuesta vieja llega después de una más nueva (ej. se cambió el
  // filtro de empresa justo durante una actualización automática), se ignora.
  const consultaComparativo = useRef(0);

  // `silenciosa` = actualización automática: no muestra "Cargando...", no
  // vuelve a la página 1, no cierra el detalle abierto y, si falla, conserva
  // los datos que ya estaban en pantalla.
  const cargarComparativo = useCallback(async (silenciosa = false) => {
    const consulta = ++consultaComparativo.current;
    if (!silenciosa) {
      setCargandoComparativo(true);
      setCodigoRolloExpandido(null);
    }
    try {
      const datos = await api.get<{
        bodegas?: { id: number; nombre: string }[];
        rollos?: Record<string, any>[]; productos?: Record<string, any>[];
        peso_actual_total_por_bodega?: Record<string, number>; peso_actual_total_general?: number;
        rollos_sin_peso_actual_total?: number; calibres_sin_equivalencia?: number[];
      }>(`/admin-inventario/comparativo${parametroEmpresa ? `?${parametroEmpresa}` : ""}`);
      if (!datos) throw new Error("Respuesta vacía del servidor.");
      if (consulta !== consultaComparativo.current) return;
      setComparativo({
        bodegas: datos.bodegas || [],
        rollos: (datos.rollos || []).map((f) => ({
          codigo: f.codigo, descripcion: f.descripcion, colorMaterial: f.color_material, calibre: f.calibre,
          porBodega: f.por_bodega, total: f.total,
          pesoActualPorBodega: f.peso_actual_por_bodega || {}, pesoActualTotal: f.peso_actual_total || 0,
          rollosSinPesoActual: f.rollos_sin_peso_actual || 0,
          cantidadPorBodega: f.cantidad_por_bodega || {}, cantidadTotal: f.cantidad_total || 0,
        })),
        productos: (datos.productos || []).map((f) => ({
          codigo: f.codigo, descripcion: f.descripcion, calibre: f.calibre, familia: f.familia || "",
          porBodega: f.por_bodega, total: f.total,
        })),
        pesoActualTotalPorBodega: datos.peso_actual_total_por_bodega || {},
        pesoActualTotalGeneral: datos.peso_actual_total_general || 0,
        rollosSinPesoActualTotal: datos.rollos_sin_peso_actual_total || 0,
        calibresSinEquivalencia: datos.calibres_sin_equivalencia || [],
      });
      setUltimaActualizacion(new Date());
      if (!silenciosa) {
        setPaginaRollos(1);
        setPaginaProductos(1);
      }
    } catch {
      if (!silenciosa && consulta === consultaComparativo.current) setComparativo(COMPARATIVO_VACIO);
    } finally {
      if (!silenciosa && consulta === consultaComparativo.current) setCargandoComparativo(false);
    }
  }, [parametroEmpresa]);

  useEffect(() => { cargarComparativo(); }, [cargarComparativo]);

  // Actualización automática: lo que otra sede carga (ej. un Excel en
  // Ricaurte) aparece sin recargar la página. Solo con la pestaña a la vista
  // -- una pestaña en segundo plano no consulta -- y de inmediato al volver
  // a ella. Cada consulta recorre todo el inventario de todas las sedes, por
  // eso no se hace cada pocos segundos.
  useEffect(() => {
    const actualizarSiVisible = () => {
      if (document.visibilityState === "visible") cargarComparativo(true);
    };
    const intervalo = window.setInterval(actualizarSiVisible, SEGUNDOS_ACTUALIZACION_AUTOMATICA * 1000);
    document.addEventListener("visibilitychange", actualizarSiVisible);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", actualizarSiVisible);
    };
  }, [cargarComparativo]);

  // ---------- Paginación del resumen (10 por página, cada tabla aparte) ----------
  const [paginaRollos, setPaginaRollos] = useState(1);
  const [paginaProductos, setPaginaProductos] = useState(1);

  // ---------- Búsqueda del resumen (por código o descripción, cada tabla aparte) ----------
  const [busquedaResumenRollos, setBusquedaResumenRollos] = useState("");
  const [busquedaResumenProductos, setBusquedaResumenProductos] = useState("");

  const rollosResumenFiltrados = useMemo(() => {
    const termino = normalizarTexto(busquedaResumenRollos);
    if (!termino) return comparativo.rollos;
    return comparativo.rollos.filter((f) =>
      normalizarTexto(f.codigo).includes(termino) || normalizarTexto(f.descripcion).includes(termino)
    );
  }, [comparativo.rollos, busquedaResumenRollos]);

  const productosResumenFiltrados = useMemo(() => {
    const termino = normalizarTexto(busquedaResumenProductos);
    if (!termino) return comparativo.productos;
    return comparativo.productos.filter((f) =>
      normalizarTexto(f.codigo).includes(termino) || normalizarTexto(f.descripcion).includes(termino)
    );
  }, [comparativo.productos, busquedaResumenProductos]);

  function buscarResumenRollos(texto: string) {
    setBusquedaResumenRollos(texto);
    setPaginaRollos(1);
  }

  function buscarResumenProductos(texto: string) {
    setBusquedaResumenProductos(texto);
    setPaginaProductos(1);
  }

  const { items: rollosResumenPagina, paginacion: paginacionRollos } = paginar(rollosResumenFiltrados, paginaRollos);
  const { items: productosResumenPagina, paginacion: paginacionProductos } = paginar(productosResumenFiltrados, paginaProductos);

  // ---------- Expandir una fila del resumen: ver cada rollo individual (con su peso) ----------
  const [codigoRolloExpandido, setCodigoRolloExpandido] = useState<string | null>(null);
  const [rollosDelCodigoExpandido, setRollosDelCodigoExpandido] = useState<ReturnType<typeof rolloDesdeApi>[]>([]);
  const [cargandoRollosExpandido, setCargandoRollosExpandido] = useState(false);

  async function alternarExpandirCodigoRollo(codigo: string) {
    if (codigoRolloExpandido === codigo) {
      setCodigoRolloExpandido(null);
      return;
    }
    setCodigoRolloExpandido(codigo);
    setCargandoRollosExpandido(true);
    try {
      const datos = await api.get<Record<string, unknown>[]>(
        `/admin-inventario/rollos-por-codigo?codigo_interno=${encodeURIComponent(codigo)}${parametroEmpresa ? `&${parametroEmpresa}` : ""}`
      );
      setRollosDelCodigoExpandido((datos || []).map(rolloDesdeApi));
    } catch {
      setRollosDelCodigoExpandido([]);
    } finally {
      setCargandoRollosExpandido(false);
    }
  }

  // ---------- Inventario propio (sin asignar), para elegir qué despachar ----------
  const [misRollos, setMisRollos] = useState<ReturnType<typeof rolloDesdeApi>[]>([]);
  const [misProductos, setMisProductos] = useState<Record<string, unknown>[]>([]);
  const [cargandoPropio, setCargandoPropio] = useState(true);

  const cargarInventarioPropio = useCallback(async () => {
    setCargandoPropio(true);
    try {
      const [rollos, productos] = await Promise.all([
        api.get<Record<string, unknown>[]>("/rollos"),
        api.get<Record<string, unknown>[]>("/inventario/productos"),
      ]);
      setMisRollos((rollos || []).map(rolloDesdeApi));
      setMisProductos(productos || []);
    } catch {
      setMisRollos([]);
      setMisProductos([]);
    } finally {
      setCargandoPropio(false);
    }
  }, []);

  useEffect(() => {
    if (soloLectura) {
      setCargandoPropio(false);
      return;
    }
    cargarInventarioPropio();
  }, [cargarInventarioPropio, soloLectura]);

  // ---------- Formulario de nuevo envío ----------
  const FORMULARIO_VACIO: FormularioEnvio = { bodegaDestinoId: "", rollosSeleccionados: [], itemsProducto: [], observaciones: "" };
  const [mostrarFormularioEnvio, setMostrarFormularioEnvio] = useState(false);
  const [formularioEnvio, setFormularioEnvio] = useState<FormularioEnvio>(FORMULARIO_VACIO);
  const [guardandoEnvio, setGuardandoEnvio] = useState(false);
  const [errorFormularioEnvio, setErrorFormularioEnvio] = useState("");
  const [busquedaRollosEnvio, setBusquedaRollosEnvio] = useState("");

  function abrirFormularioEnvio() {
    setFormularioEnvio(FORMULARIO_VACIO);
    setErrorFormularioEnvio("");
    setBusquedaRollosEnvio("");
    setMostrarFormularioEnvio(true);
  }

  function cerrarFormularioEnvio() {
    setMostrarFormularioEnvio(false);
    setErrorFormularioEnvio("");
    setBusquedaRollosEnvio("");
  }

  function normalizarTexto(texto: string) {
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  const misRollosFiltrados = useMemo(() => {
    const termino = normalizarTexto(busquedaRollosEnvio);
    if (!termino) return misRollos;
    return misRollos.filter((r) =>
      normalizarTexto(r.codigoInterno).includes(termino) || normalizarTexto(r.identificadorRollo).includes(termino)
    );
  }, [misRollos, busquedaRollosEnvio]);

  function actualizarCampoEnvio(campo: keyof FormularioEnvio, valor: string) {
    setFormularioEnvio((actual) => ({ ...actual, [campo]: valor }));
  }

  function alternarRolloEnvio(rolloId: number) {
    setFormularioEnvio((actual) => ({
      ...actual,
      rollosSeleccionados: actual.rollosSeleccionados.includes(rolloId)
        ? actual.rollosSeleccionados.filter((id) => id !== rolloId)
        : [...actual.rollosSeleccionados, rolloId],
    }));
  }

  function actualizarCantidadProductoEnvio(codigo: string, cantidadTexto: string) {
    setFormularioEnvio((actual) => {
      const cantidad = cantidadTexto.trim();
      const resto = actual.itemsProducto.filter((it) => it.codigo !== codigo);
      if (!cantidad) return { ...actual, itemsProducto: resto };
      return { ...actual, itemsProducto: [...resto, { codigo, cantidad }] };
    });
  }

  async function crearEnvio(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    const f = formularioEnvio;
    if (!f.bodegaDestinoId) {
      setErrorFormularioEnvio("Selecciona la bodega destino.");
      return;
    }
    const itemsRollo = f.rollosSeleccionados.map((rolloId) => ({ rollo_id: rolloId }));
    const itemsProducto = f.itemsProducto
      .filter((it) => Number(it.cantidad) > 0)
      .map((it) => ({ producto_codigo: it.codigo, cantidad: Number(it.cantidad) }));
    const items = [...itemsRollo, ...itemsProducto];
    if (items.length === 0) {
      setErrorFormularioEnvio("Selecciona al menos un rollo o una cantidad de producto para enviar.");
      return;
    }
    setGuardandoEnvio(true);
    setErrorFormularioEnvio("");
    try {
      await api.post("/envios", {
        bodega_destino_id: Number(f.bodegaDestinoId),
        items,
        observaciones: f.observaciones,
      });
      await Promise.all([cargarEnviosEnviados(), cargarInventarioPropio(), cargarComparativo()]);
      setMostrarFormularioEnvio(false);
    } catch (err) {
      setErrorFormularioEnvio(err instanceof ErrorApi ? err.message : "No se pudo crear el envío.");
    } finally {
      setGuardandoEnvio(false);
    }
  }

  // ---------- Envíos ya enviados (historial con estado) ----------
  const [enviosEnviados, setEnviosEnviados] = useState<ReturnType<typeof envioDesdeApi>[]>([]);
  const [cargandoEnvios, setCargandoEnvios] = useState(true);

  const cargarEnviosEnviados = useCallback(async () => {
    setCargandoEnvios(true);
    try {
      const datos = await api.get<Record<string, unknown>[]>("/envios/enviados");
      setEnviosEnviados((datos || []).map((e) => envioDesdeApi(e, bodegasPorId)));
    } catch {
      setEnviosEnviados([]);
    } finally {
      setCargandoEnvios(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(bodegasPorId)]);

  useEffect(() => {
    if (soloLectura) {
      setCargandoEnvios(false);
      return;
    }
    cargarEnviosEnviados();
  }, [cargarEnviosEnviados, soloLectura]);

  return {
    soloLectura,
    comparativo, cargandoComparativo, empresaResumen, setEmpresaResumen,
    ultimaActualizacion, actualizarComparativo: () => cargarComparativo(true),

    rollosResumenPagina, paginacionRollos, paginaRollos, setPaginaRollos,
    productosResumenPagina, paginacionProductos, paginaProductos, setPaginaProductos,
    busquedaResumenRollos, buscarResumenRollos, busquedaResumenProductos, buscarResumenProductos,

    codigoRolloExpandido, rollosDelCodigoExpandido, cargandoRollosExpandido, alternarExpandirCodigoRollo,

    misRollos, misProductos, cargandoPropio,

    mostrarFormularioEnvio, formularioEnvio, guardandoEnvio, errorFormularioEnvio,
    abrirFormularioEnvio, cerrarFormularioEnvio, actualizarCampoEnvio,
    busquedaRollosEnvio, setBusquedaRollosEnvio, misRollosFiltrados,
    alternarRolloEnvio, actualizarCantidadProductoEnvio, crearEnvio,

    enviosEnviados, cargandoEnvios,
  };
}
