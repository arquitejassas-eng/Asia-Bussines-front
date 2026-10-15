import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ErrorApi } from "./Api";
import { movimientoDesdeApi, rolloDesdeApi } from "./Mapeo";
import { FILTRO_SIN_EMPRESA, nombreEmpresa } from "../Utils/empresas";
import { formatearFechaColombia } from "../Utils/fechas";
import { coincideKilos, kilosBuscados, kilosDelRollo } from "../Utils/kilos";
import { exportarArregloAExcel } from "../Utils/exportarExcel";
import type { AlmacenGlobal } from "../types/dominio";

export type RolloMerma = ReturnType<typeof rolloDesdeApi>;
export type GrupoMerma = {
  codigoInterno: string; colorMaterial: string; calibre: number;
  rollos: RolloMerma[]; merma: number; sobrante: number;
};

export const redondearMetros = (n: number) => Math.round(n * 100) / 100;

function normalizar(texto: unknown) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Controlador de la página Merma (Admin Inventario): los rollos que ya se
 * acabaron (agotados) de todas las bodegas, con su merma y sus metros de más
 * (ver backend merma_rollo), agrupados por código de clasificación igual que
 * Rollos almacenados (Rollos.ts::gruposPorCodigo). Reutiliza el endpoint de
 * la búsqueda de Inventario total: /admin-inventario/rollos?estado=agotado. */
export function useControladorMerma(almacen: AlmacenGlobal) {
  const [rollos, setRollos] = useState<RolloMerma[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [bodega, setBodega] = useState("");
  // Por defecto solo los que dejaron merma o metros de más: los que se
  // acabaron justo no dicen nada aquí.
  const [soloConMerma, setSoloConMerma] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const datos = await api.get<Record<string, unknown>[]>("/admin-inventario/rollos?estado=agotado");
      setRollos((datos || []).map(rolloDesdeApi));
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron cargar los rollos finalizados.");
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // Hoja de vida de un rollo: misma consulta y misma ventana que Rollos
  // almacenados (Rollos.ts::abrirHistorial, ModalHistorialRollo).
  const [rolloParaHistorial, setRolloParaHistorial] = useState<RolloMerma | null>(null);
  const [historialRollo, setHistorialRollo] = useState<Record<string, unknown>[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState("");

  async function abrirHistorial(rollo: RolloMerma) {
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

  const nombreBodega = useCallback(
    (id: number | null) => almacen.bodegas.find((b) => b.id === id)?.nombre || "—",
    [almacen.bodegas],
  );

  const grupos = useMemo<GrupoMerma[]>(() => {
    const termino = normalizar(busqueda);
    const kilos = kilosBuscados(busqueda);
    const mapa = new Map<string, GrupoMerma>();
    for (const r of rollos) {
      if (soloConMerma && !(r.mermaMetros || r.sobranteMetros)) continue;
      if (bodega && String(r.bodegaId) !== bodega) continue;
      if (empresa && (empresa === FILTRO_SIN_EMPRESA ? r.empresa : r.empresa !== empresa)) continue;
      if (termino && !(normalizar(r.codigoInterno).includes(termino) || normalizar(r.identificadorRollo).includes(termino)
        || normalizar(r.colorMaterial).includes(termino) || coincideKilos(r.pesoNeto, kilos))) continue;
      if (!mapa.has(r.codigoInterno)) {
        mapa.set(r.codigoInterno, { codigoInterno: r.codigoInterno, colorMaterial: r.colorMaterial, calibre: r.calibre, rollos: [], merma: 0, sobrante: 0 });
      }
      const grupo = mapa.get(r.codigoInterno)!;
      grupo.rollos.push(r);
      grupo.merma += r.mermaMetros || 0;
      grupo.sobrante += r.sobranteMetros || 0;
    }
    return [...mapa.values()].sort((a, b) => a.codigoInterno.localeCompare(b.codigoInterno));
  }, [rollos, busqueda, empresa, bodega, soloConMerma]);

  const totales = useMemo(() => ({
    rollos: grupos.reduce((s, g) => s + g.rollos.length, 0),
    merma: redondearMetros(grupos.reduce((s, g) => s + g.merma, 0)),
    sobrante: redondearMetros(grupos.reduce((s, g) => s + g.sobrante, 0)),
  }), [grupos]);

  // Cada filtro solo se muestra si hay algo que separar con él (con 2
  // rollos de la misma bodega y empresa, filtrar no sirve de nada).
  const opcionesFiltro = useMemo(() => ({
    empresas: [...new Set(rollos.map((r) => r.empresa || FILTRO_SIN_EMPRESA))],
    bodegas: almacen.bodegas.filter((b) => rollos.some((r) => r.bodegaId === b.id)),
    haySinMerma: rollos.some((r) => !(r.mermaMetros || r.sobranteMetros)),
    hayVarios: rollos.length > 1,
  }), [rollos, almacen.bodegas]);

  const hayFiltros = Boolean(busqueda.trim() || empresa || bodega || !soloConMerma);
  function limpiarFiltros() {
    setBusqueda(""); setEmpresa(""); setBodega(""); setSoloConMerma(true);
  }

  function exportar() {
    exportarArregloAExcel(grupos.flatMap((g) => g.rollos.map((r) => ({
      "Código": r.codigoInterno, "Referencia": r.identificadorRollo, "Color": r.colorMaterial, "Calibre": r.calibre,
      "Bodega": nombreBodega(r.bodegaId), "Empresa": nombreEmpresa(r.empresa),
      "Kilos": kilosDelRollo(r.pesoNeto) ?? "", "Metros proveedor": r.metrosProveedor ?? "",
      "Metros consumidos": r.metrosConsumidos, "Merma (m)": r.mermaMetros || 0, "Metros de más": r.sobranteMetros || 0,
      "Ingreso": formatearFechaColombia(r.fechaIngreso, false),
    }))), "Merma_rollos.xlsx", "Merma");
  }

  return {
    cargando, error, cargar, grupos, totales, nombreBodega,
    busqueda, setBusqueda, empresa, setEmpresa, bodega, setBodega, soloConMerma, setSoloConMerma,
    opcionesFiltro, hayFiltros, limpiarFiltros, exportar,
    rolloParaHistorial, historialRollo, cargandoHistorial, errorHistorial, abrirHistorial, cerrarHistorial,
  };
}
