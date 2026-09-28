import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./Api";
import { movimientoDesdeApi, productoDesdeApi } from "./Mapeo";
import { finDelDiaColombia, inicioDelDiaColombia } from "../Utils/fechas";

const FILTROS_VACIOS = {
  tipo: "",
  codigoProducto: "",
  codigoRollo: "",
  cotizacion: "",
  empresaExterna: "",
  fechaDesde: "",
  fechaHasta: "",
};

type Filtros = typeof FILTROS_VACIOS;
type ResumenApi = {
  entradas: number; salidas: number; traslados: number; transferencias: number;
  cantidad_entrada: number; cantidad_salida: number;
};
type PaginaApi = { items: Record<string, unknown>[]; total: number; pagina: number; total_paginas: number; resumen?: ResumenApi };

export function useControladorReportes(_sesion: unknown, _almacen: unknown) {
  const [movimientos, setMovimientos] = useState<ReturnType<typeof movimientoDesdeApi>[]>([]);
  const [cargandoMovimientos, setCargandoMovimientos] = useState(true);
  const [errorMovimientos, setErrorMovimientos] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [paginacion, setPaginacion] = useState<{ total: number; pagina: number; total_paginas: number }>({ total: 0, pagina: 1, total_paginas: 1 });
  const [resumenServidor, setResumenServidor] = useState<ResumenApi | null>(null);

  const [alertasStock, setAlertasStock] = useState<ReturnType<typeof productoDesdeApi>[]>([]);
  const [cargandoAlertasStock, setCargandoAlertasStock] = useState(true);

  function actualizarFiltro(campo: keyof Filtros, valor: string) {
    setFiltros((actual) => ({ ...actual, [campo]: valor }));
    setPagina(1);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    setPagina(1);
  }

  // Solo cuenta la respuesta de la consulta más reciente: al escribir rápido
  // en un filtro, una respuesta vieja podía llegar después y mostrar
  // resultados que no corresponden a lo escrito.
  const ultimaConsulta = useRef(0);
  const cargarMovimientos = useCallback(async () => {
    const consulta = ++ultimaConsulta.current;
    setCargandoMovimientos(true);
    setErrorMovimientos("");
    try {
      const parametros = new URLSearchParams();
      if (filtros.codigoProducto) parametros.set("codigo_producto", filtros.codigoProducto);
      if (filtros.codigoRollo) parametros.set("codigo_rollo", filtros.codigoRollo);
      if (filtros.cotizacion) parametros.set("cotizacion", filtros.cotizacion);
      if (filtros.empresaExterna) parametros.set("empresa_externa", filtros.empresaExterna);
      if (filtros.tipo) parametros.set("tipo", filtros.tipo);
      if (filtros.fechaDesde) parametros.set("fecha_desde", inicioDelDiaColombia(filtros.fechaDesde));
      if (filtros.fechaHasta) parametros.set("fecha_hasta", finDelDiaColombia(filtros.fechaHasta));
      parametros.set("paginado", "true");
      parametros.set("pagina", String(pagina));
      parametros.set("tamano", "30");

      const datos = await api.get<PaginaApi>(`/inventario/historial?${parametros.toString()}`);
      if (!datos) throw new Error("Respuesta vacía del servidor.");
      if (consulta !== ultimaConsulta.current) return;
      setMovimientos(datos.items.map(movimientoDesdeApi));
      setPaginacion(datos);
      setResumenServidor(datos.resumen || null);
    } catch {
      if (consulta === ultimaConsulta.current) setErrorMovimientos("No se pudo cargar el historial de movimientos.");
    } finally {
      if (consulta === ultimaConsulta.current) setCargandoMovimientos(false);
    }
  }, [filtros, pagina]);

  // Espera a que se termine de escribir (0,3 s) antes de consultar: antes
  // salía una consulta por cada tecla.
  useEffect(() => {
    const espera = window.setTimeout(cargarMovimientos, 300);
    return () => window.clearTimeout(espera);
  }, [cargarMovimientos]);

  // Mismo criterio y misma fuente que la campana de Inventario: solo alertan
  // los productos con `stockMinimo` configurado y por debajo de ese umbral —
  // un producto sin configurar no genera alerta en ningún lado.
  const cargarAlertasStock = useCallback(async () => {
    setCargandoAlertasStock(true);
    try {
      const datos = await api.get<Record<string, unknown>[]>("/inventario/productos/alertas");
      setAlertasStock((datos || []).map(productoDesdeApi));
    } catch {
      setAlertasStock([]);
    } finally {
      setCargandoAlertasStock(false);
    }
  }, []);

  useEffect(() => {
    cargarAlertasStock();
  }, [cargarAlertasStock]);

  const movimientosFiltrados = movimientos;

  // Totales de TODO el filtro, calculados por el servidor. Antes se sumaban
  // solo los 30 movimientos de la página visible y cambiaban al paginar.
  const resumen = useMemo(() => ({
    entradas: resumenServidor?.entradas ?? 0,
    salidas: resumenServidor?.salidas ?? 0,
    traslados: resumenServidor?.traslados ?? 0,
    transferencias: resumenServidor?.transferencias ?? 0,
    metrosOCantidadEntrada: resumenServidor?.cantidad_entrada ?? 0,
    metrosOCantidadSalida: resumenServidor?.cantidad_salida ?? 0,
  }), [resumenServidor]);

  return {
    movimientos: movimientosFiltrados,
    cargandoMovimientos,
    errorMovimientos,
    filtros,
    actualizarFiltro,
    limpiarFiltros,
    resumen,
    pagina,
    setPagina,
    paginacion,

    alertasStock,
    cargandoAlertasStock,
  };
}
