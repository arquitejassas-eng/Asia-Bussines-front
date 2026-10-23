import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { redondearRecepcion } from "../Utils/recepcion";

type EquivalenciasApi = {
  colores: { ral: string; nombre: string; codigo_interno: string }[];
  tipos: { nombre: string; codigo_interno: string }[];
  espesores: { espesor: number; mt_por_ton: number; peso_por_metro: number }[];
};

/** Administración aislada de las tablas que clasifican materiales recibidos. */
export function useEquivalenciasRecepcion() {
  const [tablaColores, setTablaColores] = useState<{ ral: string; nombre: string; codigoInterno: string }[]>([]);
  const [tablaTipos, setTablaTipos] = useState<{ nombre: string; codigoInterno: string }[]>([]);
  const [tablaEspesor, setTablaEspesor] = useState<{ espesor: number; mtPorTon: number; pesoPorMetro: number }[]>([]);
  const cargarEquivalencias = useCallback(async () => {
    try {
      const datos = await api.get<EquivalenciasApi>("/recepcion/equivalencias");
      if (!datos) return;
      setTablaColores(datos.colores.map((item) => ({ ral: item.ral, nombre: item.nombre, codigoInterno: item.codigo_interno })));
      setTablaTipos(datos.tipos.map((item) => ({ nombre: item.nombre, codigoInterno: item.codigo_interno })));
      setTablaEspesor(datos.espesores.map((item) => ({ espesor: item.espesor, mtPorTon: item.mt_por_ton, pesoPorMetro: item.peso_por_metro })));
    } catch { /* El panel puede reintentarse sin interrumpir la recepción. */ }
  }, []);
  useEffect(() => { cargarEquivalencias(); }, [cargarEquivalencias]);
  // Cada "agregar" devuelve true si se guardó, o el mensaje del servidor si
  // no (ej. "ya existe"): antes solo devolvía false y la pantalla decía algo genérico.
  async function guardar(ruta: string, cuerpo: Record<string, string | number>) { await api.post(ruta, cuerpo); await cargarEquivalencias(); }
  async function agregarEquivalenciaColor(ral: string, nombre: string, codigoInterno?: string) {
    const codigo = (codigoInterno ?? "").trim().toUpperCase() || (nombre ?? "").trim().charAt(0).toUpperCase();
    if (!ral || !codigo) return false;
    try { await guardar("/recepcion/equivalencias/colores", { ral, nombre, codigo_interno: codigo }); return true; } catch (err) { return err instanceof ErrorApi ? err.message : "No se pudo guardar el color."; }
  }
  async function agregarEquivalenciaTipo(nombre: string, codigoInterno: string) {
    if (!nombre || !codigoInterno) return false;
    try { await guardar("/recepcion/equivalencias/tipos", { nombre, codigo_interno: codigoInterno }); return true; } catch (err) { return err instanceof ErrorApi ? err.message : "No se pudo guardar el tipo de material."; }
  }
  async function agregarEquivalenciaEspesor(espesorTexto: string, { mtPorTonTexto, pesoPorMetroTexto }: { mtPorTonTexto?: string; pesoPorMetroTexto?: string }) {
    const espesor = Number(espesorTexto); let mtPorTon = mtPorTonTexto ? Number(mtPorTonTexto) : null; let pesoPorMetro = pesoPorMetroTexto ? Number(pesoPorMetroTexto) : null;
    if (!Number.isFinite(espesor)) return false;
    if (!mtPorTon && pesoPorMetro) mtPorTon = redondearRecepcion(1000 / pesoPorMetro);
    if (!pesoPorMetro && mtPorTon) pesoPorMetro = redondearRecepcion(1000 / mtPorTon);
    if (!mtPorTon || !pesoPorMetro) return false;
    try { await guardar("/recepcion/equivalencias/espesor", { espesor, mt_por_ton: mtPorTon, peso_por_metro: pesoPorMetro }); return true; } catch (err) { return err instanceof ErrorApi ? err.message : "No se pudo guardar el espesor."; }
  }
  return { tablaColores, tablaTipos, tablaEspesor, cargarEquivalencias, agregarEquivalenciaColor, agregarEquivalenciaTipo, agregarEquivalenciaEspesor };
}
