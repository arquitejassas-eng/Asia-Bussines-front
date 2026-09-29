import { useMemo, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { traducirRolloRecepcion } from "../Utils/recepcion";
import { normalizarTexto } from "../Utils/texto";

/** Verificación, resumen y confirmación de una recepción ya previsualizada. */
type Archivo = {
  mapeoColumnas: Record<string, string>; faltanCamposRequeridos: boolean;
  paso: string; setPaso: (paso: string) => void;
};
import type { Sesion as SesionCompleta } from "../types/dominio";
type Sesion = Partial<SesionCompleta> | null | undefined;
type RolloCompleto = ReturnType<typeof traducirRolloRecepcion>;
type ConfirmarRecepcionApi = { id: number; fecha: string; proveedor: string; archivo_origen: string; rollos_registrados?: number; rollos_omitidos?: string[] };
type HistorialItem = {
  id: number; fecha: string; bodegaId: number | null | undefined; bodega: string; encargado: string;
  proveedor: string; archivoOrigen: string; tolerancia: number;
  resumen: { total: number; correctos: number; faltantes: number; adicionales: number; pendientesDatos: number; materialesNuevos: number };
  rollos: RolloCompleto[]; estado: string;
};

export function useVerificacionRecepcion({ sesion, archivo }: { sesion: Sesion; archivo: Archivo }) {
  const [toleranciaPorcentaje, setToleranciaPorcentaje] = useState(2);
  const [busquedaClasificacion, setBusquedaClasificacion] = useState("");
  const [rollosCrudos, setRollosCrudos] = useState<Record<string, any>[]>([]); const [cargandoVerificacion, setCargandoVerificacion] = useState(false);
  const [confirmando, setConfirmando] = useState(false); const [errorConfirmacion, setErrorConfirmacion] = useState("");
  const [estadoFinal, setEstadoFinal] = useState<string | null>(null); const [historialRecepciones, setHistorialRecepciones] = useState<HistorialItem[]>([]);
  async function verificarEnServidor() {
    setCargandoVerificacion(true); setErrorConfirmacion("");
    try { const respuesta = await api.post<{ rollos: Record<string, any>[] }>("/recepcion/verificar", { mapeo: archivo.mapeoColumnas, tolerancia_porcentaje: toleranciaPorcentaje }); setRollosCrudos(respuesta?.rollos ?? []); }
    catch (err) { setErrorConfirmacion(err instanceof ErrorApi ? err.message : "No se pudo verificar el archivo. Intenta de nuevo."); setRollosCrudos([]); }
    finally { setCargandoVerificacion(false); }
  }
  async function confirmarMapeo() { if (archivo.faltanCamposRequeridos) return; archivo.setPaso("verificacion"); await verificarEnServidor(); }
  const rollosCompletos = useMemo(() => rollosCrudos.map((rollo, indice) => traducirRolloRecepcion(rollo, indice, toleranciaPorcentaje)), [rollosCrudos, toleranciaPorcentaje]);
  const rollos = useMemo(() => {
    if (!busquedaClasificacion.trim()) return rollosCompletos;
    const texto = normalizarTexto(busquedaClasificacion);
    return rollosCompletos.filter((rollo) => normalizarTexto(rollo.codigoClasificacion).includes(texto) || normalizarTexto(rollo.rollo).includes(texto));
  }, [rollosCompletos, busquedaClasificacion]);
  // Sobre TODOS los rollos del archivo, no sobre los que deja ver el
  // buscador: antes, buscar algo que ocultara las filas con "Faltan datos"
  // dejaba pendientesDatos en 0 y habilitaba confirmar (hallazgo #9).
  const resumenVerificacion = useMemo(() => ({
    total: rollosCompletos.length, correctos: rollosCompletos.filter((rollo) => rollo.resultado === "correcto").length,
    faltantes: rollosCompletos.filter((rollo) => rollo.resultado === "faltante").length,
    adicionales: rollosCompletos.filter((rollo) => rollo.resultado === "adicional").length,
    pendientesDatos: rollosCompletos.filter((rollo) => rollo.resultado === "faltan_datos").length,
    materialesNuevos: rollosCompletos.filter((rollo) => rollo.esMaterialNuevo).length,
  }), [rollosCompletos]);
  const estadoRecepcion = useMemo(() => {
    if (archivo.paso !== "verificacion" || !rollosCompletos.length) return "pendiente_verificacion";
    if (estadoFinal) return estadoFinal;
    if (rollosCompletos.some((rollo) => rollo.resultado === "faltan_datos")) return "pendiente_verificacion";
    return rollosCompletos.some((rollo) => rollo.resultado === "faltante" || rollo.resultado === "adicional") ? "verificada_con_diferencias" : "verificada_sin_diferencias";
  }, [archivo.paso, estadoFinal, rollosCompletos]);
  // Referencias: sin referencia o repetidas dentro del Excel bloquean la
  // confirmación; las que ya existen en la bodega solo se omiten. Se cuentan
  // sobre TODOS los rollos, no sobre los que deja ver el buscador.
  const referenciasConProblema = rollosCompletos.filter((rollo) => rollo.problemaReferencia === "sin_referencia" || rollo.problemaReferencia === "repetida_en_archivo").length;
  const referenciasYaRegistradas = rollosCompletos.filter((rollo) => rollo.problemaReferencia === "ya_existe").length;
  const hayRollosNuevos = rollosCompletos.some((rollo) => rollo.problemaReferencia !== "ya_existe");
  const [avisoConfirmacion, setAvisoConfirmacion] = useState("");
  const puedeConfirmar = rollosCompletos.length > 0 && resumenVerificacion.pendientesDatos === 0 && referenciasConProblema === 0 && hayRollosNuevos && !confirmando && estadoFinal !== "registrada_en_inventario";
  function actualizarTolerancia(valorTexto: string) { const valor = Number(valorTexto); if (Number.isFinite(valor) && valor >= 0) setToleranciaPorcentaje(valor); }
  async function confirmarRecepcion() {
    if (!puedeConfirmar) return; setConfirmando(true); setErrorConfirmacion("");
    try {
      const proveedorPrincipal = rollosCompletos.find((rollo) => rollo.proveedor)?.proveedor || "";
      const creada = await api.post<ConfirmarRecepcionApi>("/recepcion/confirmar", { tolerancia_porcentaje: toleranciaPorcentaje, proveedor_principal: proveedorPrincipal });
      if (!creada) throw new Error("Respuesta vacía del servidor.");
      setHistorialRecepciones((actual) => [{ id: creada.id, fecha: creada.fecha, bodegaId: sesion?.bodegaId, bodega: sesion?.bodegaNombre || "—", encargado: sesion?.correo || "—", proveedor: creada.proveedor, archivoOrigen: creada.archivo_origen, tolerancia: toleranciaPorcentaje, resumen: resumenVerificacion, rollos: rollosCompletos, estado: "registrada_en_inventario" }, ...actual]);
      setEstadoFinal("registrada_en_inventario");
      const omitidos = creada.rollos_omitidos ?? [];
      setAvisoConfirmacion(omitidos.length
        ? `Se registraron ${creada.rollos_registrados ?? 0} rollos. ${omitidos.length} ya estaban registrados en esta bodega y se omitieron: ${omitidos.slice(0, 8).join(", ")}${omitidos.length > 8 ? "..." : ""}.`
        : "");
    } catch (err) { setErrorConfirmacion(err instanceof ErrorApi ? err.message : "No se pudo confirmar la recepción. Intenta de nuevo."); }
    finally { setConfirmando(false); }
  }
  function reiniciarVerificacion() { setRollosCrudos([]); setBusquedaClasificacion(""); setEstadoFinal(null); setErrorConfirmacion(""); setAvisoConfirmacion(""); }
  return { toleranciaPorcentaje, actualizarTolerancia, busquedaClasificacion, setBusquedaClasificacion, rollos, resumenVerificacion, estadoRecepcion, cargandoVerificacion, verificarEnServidor, confirmarMapeo, volverAMapeo: () => archivo.setPaso("mapeo"), confirmarRecepcion, confirmando, errorConfirmacion, puedeConfirmar, historialRecepciones, reiniciarVerificacion, referenciasConProblema, referenciasYaRegistradas, hayRollosNuevos, avisoConfirmacion };
}
