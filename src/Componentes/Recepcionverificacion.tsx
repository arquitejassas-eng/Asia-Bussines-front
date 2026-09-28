/* oxlint-disable react/only-export-components */
import { useEffect } from "react";
import { useArchivoRecepcion } from "../Hooks/useArchivoRecepcion";
import { useEquivalenciasRecepcion } from "../Hooks/useEquivalenciasRecepcion";
import { useVerificacionRecepcion } from "../Hooks/useVerificacionRecepcion";
import { CAMPOS_REQUERIDOS_RECEPCION, ETIQUETAS_CAMPOS_RECEPCION, TODOS_LOS_CAMPOS_RECEPCION } from "../Utils/recepcion";

type Sesion = Parameters<typeof useVerificacionRecepcion>[0]["sesion"];

export function useControladorRecepcion(sesion: Sesion) {
  const archivo = useArchivoRecepcion();
  const equivalencias = useEquivalenciasRecepcion();
  const verificacion = useVerificacionRecepcion({ sesion, archivo });
  const { cargarEquivalencias } = equivalencias;
  useEffect(() => { if (archivo.notaImportacionEquivalencias) cargarEquivalencias(); }, [archivo.notaImportacionEquivalencias, cargarEquivalencias]);
  // Devuelve si se guardó: el panel solo limpia su formulario si fue así.
  async function agregarYReverificar(accion: () => Promise<boolean>) { const guardada = await accion(); if (guardada && archivo.paso === "verificacion") await verificacion.verificarEnServidor(); return guardada; }
  function iniciarNuevaRecepcion() { archivo.reiniciarArchivo(); verificacion.reiniciarVerificacion(); }
  return {
    ...archivo, ...verificacion, ...equivalencias,
    CAMPOS_REQUERIDOS: CAMPOS_REQUERIDOS_RECEPCION, ETIQUETAS_CAMPOS: ETIQUETAS_CAMPOS_RECEPCION, TODOS_LOS_CAMPOS: TODOS_LOS_CAMPOS_RECEPCION,
    agregarEquivalenciaColor: (...args: Parameters<typeof equivalencias.agregarEquivalenciaColor>) => agregarYReverificar(() => equivalencias.agregarEquivalenciaColor(...args)),
    agregarEquivalenciaTipo: (...args: Parameters<typeof equivalencias.agregarEquivalenciaTipo>) => agregarYReverificar(() => equivalencias.agregarEquivalenciaTipo(...args)),
    agregarEquivalenciaEspesor: (...args: Parameters<typeof equivalencias.agregarEquivalenciaEspesor>) => agregarYReverificar(() => equivalencias.agregarEquivalenciaEspesor(...args)),
    iniciarNuevaRecepcion,
  };
}
