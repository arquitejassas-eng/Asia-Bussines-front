import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../Componentes/Api";
import { movimientoDesdeApi } from "../Componentes/Mapeo";
import { finDelDiaColombia, inicioDelDiaColombia } from "../Utils/fechas";
import { useActualizacionAutomatica } from "./useActualizacionAutomatica";

const FILTROS_VACIOS = { codigoProducto: "", cotizacion: "", empresaExterna: "", fechaDesde: "", fechaHasta: "" };

/** Consulta, filtros y paginación del historial; no depende de la interfaz. */
type Filtros = { codigoProducto: string; cotizacion: string; empresaExterna: string; fechaDesde: string; fechaHasta: string };
type Paginacion = { total: number; pagina: number; total_paginas: number };

type RespuestaHistorial = { items: Record<string, unknown>[] } & Paginacion;
type Movimiento = ReturnType<typeof movimientoDesdeApi>;
/** `detalle` != null: varios movimientos de la misma cotización (mismo tipo y
 * motivo) mostrados en una sola fila; `movimiento` es el más reciente. */
export type FilaHistorial = { clave: string; movimiento: Movimiento; detalle: Movimiento[] | null; total: number };

const claveGrupo = (m: Movimiento) => `${m.cotizacion}|${m.tipo}|${m.motivo}`;

// El historial se pagina por movimiento, así que una cotización puede quedar
// repartida entre páginas: `movimientosPorCotizacion` trae TODOS los suyos
// (con los mismos filtros) para que el total esté completo, y la fila sale
// solo en la página que tiene su movimiento más reciente.
function agruparPorCotizacion(pagina: Movimiento[], movimientosPorCotizacion: Map<string, Movimiento[]>): FilaHistorial[] {
  const idsPagina = new Set(pagina.map((m) => m.id));
  const emitidos = new Set<string>();
  const filas: FilaHistorial[] = [];
  for (const m of pagina) {
    const sola = { clave: String(m.id), movimiento: m, detalle: null, total: m.cantidad };
    if (!m.cotizacion) { filas.push(sola); continue; }
    const clave = claveGrupo(m);
    const grupo = (movimientosPorCotizacion.get(m.cotizacion) || []).filter((x) => claveGrupo(x) === clave);
    if (grupo.length < 2) { filas.push(sola); continue; }
    if (emitidos.has(clave) || !idsPagina.has(grupo[0].id)) continue;
    emitidos.add(clave);
    const total = Math.round(grupo.reduce((suma, x) => suma + (Number(x.cantidad) || 0), 0) * 100) / 100;
    filas.push({ clave, movimiento: grupo[0], detalle: grupo, total });
  }
  return filas;
}

export function useHistorialInventario(bodegaId: number | undefined) {
  const [historial, setHistorial] = useState<Movimiento[]>([]);
  const [filasHistorial, setFilasHistorial] = useState<FilaHistorial[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(true);
  const [errorHistorial, setErrorHistorial] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [paginaHistorial, setPaginaHistorial] = useState(1);
  const [paginacionHistorial, setPaginacionHistorial] = useState<Paginacion>({ total: 0, pagina: 1, total_paginas: 1 });

  // `silenciosa` (actualización automática): sin indicador de carga ni
  // mensaje de error; conserva la página y los filtros actuales. Es interna:
  // `cargarHistorial` se usa directo como onClick, y el evento del clic no
  // debe confundirse con este parámetro. `ultimaConsulta` descarta una
  // respuesta vieja (ej. de la página anterior) que llegue después de una
  // más nueva.
  const ultimaConsulta = useRef(0);
  const consultar = useCallback(async (silenciosa: boolean) => {
    const consulta = ++ultimaConsulta.current;
    if (!silenciosa) {
      setCargandoHistorial(true);
      setErrorHistorial("");
    }
    try {
      const filtrosApi = new URLSearchParams();
      if (filtros.codigoProducto) filtrosApi.set("codigo_producto", filtros.codigoProducto);
      if (filtros.cotizacion) filtrosApi.set("cotizacion", filtros.cotizacion);
      if (filtros.empresaExterna) filtrosApi.set("empresa_externa", filtros.empresaExterna);
      if (filtros.fechaDesde) filtrosApi.set("fecha_desde", inicioDelDiaColombia(filtros.fechaDesde));
      if (filtros.fechaHasta) filtrosApi.set("fecha_hasta", finDelDiaColombia(filtros.fechaHasta));
      const parametros = new URLSearchParams(filtrosApi);
      parametros.set("paginado", "true"); parametros.set("pagina", String(paginaHistorial)); parametros.set("tamano", "30");
      const datos = await api.get<RespuestaHistorial>(`/inventario/historial?${parametros.toString()}`);
      if (!datos) throw new Error("Respuesta vacía del servidor.");
      // Defensa adicional en UI: aunque la API ya limita por sesión, nunca se
      // muestra un movimiento ajeno si una respuesta inesperada llegara aquí.
      const deMiBodega = (items: Record<string, unknown>[]) => items
        .map(movimientoDesdeApi)
        .filter((movimiento) =>
          movimiento.bodegaOrigenId === bodegaId || movimiento.bodegaDestinoId === bodegaId
        );
      const movimientosDeMiBodega = deMiBodega(datos.items);

      const cotizaciones = [...new Set(movimientosDeMiBodega.map((m) => m.cotizacion).filter(Boolean))];
      const movimientosPorCotizacion = new Map(await Promise.all(cotizaciones.map(async (cotizacion) => {
        const consultaCotizacion = new URLSearchParams(filtrosApi);
        consultaCotizacion.set("cotizacion", cotizacion);
        const todos = await api.get<Record<string, unknown>[]>(`/inventario/historial?${consultaCotizacion.toString()}`);
        // El filtro de la API es "contiene"; aquí solo la cotización exacta.
        return [cotizacion, deMiBodega(todos || []).filter((m) => m.cotizacion === cotizacion)] as const;
      })));
      if (consulta !== ultimaConsulta.current) return;
      setHistorial(movimientosDeMiBodega);
      setFilasHistorial(agruparPorCotizacion(movimientosDeMiBodega, movimientosPorCotizacion));
      setPaginacionHistorial(datos);
    } catch {
      if (!silenciosa && consulta === ultimaConsulta.current) setErrorHistorial("No se pudo cargar el historial.");
    } finally {
      // La consulta más reciente apaga el indicador, sea o no silenciosa.
      if (consulta === ultimaConsulta.current) setCargandoHistorial(false);
    }
  }, [bodegaId, filtros, paginaHistorial]);

  const cargarHistorial = useCallback(() => consultar(false), [consultar]);

  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);
  useActualizacionAutomatica(() => consultar(true));

  function actualizarFiltro(campo: keyof Filtros, valor: string) {
    setFiltros((actual) => ({ ...actual, [campo]: valor }));
    setPaginaHistorial(1);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    setPaginaHistorial(1);
  }

  return {
    historial, filasHistorial, cargandoHistorial, errorHistorial, filtros, actualizarFiltro, limpiarFiltros,
    cargarHistorial, paginaHistorial, setPaginaHistorial, paginacionHistorial,
  };
}
