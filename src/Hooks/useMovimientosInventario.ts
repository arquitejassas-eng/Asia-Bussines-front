import { useMemo, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";

export const MOTIVOS_ENTRADA = [
  { valor: "compra_proveedor", etiqueta: "Compra a proveedor" },
  { valor: "devolucion", etiqueta: "Devolución" },
  { valor: "ajuste_inventario", etiqueta: "Ajuste de inventario" },
];
export const MOTIVOS_SALIDA = [
  { valor: "venta", etiqueta: "Venta" },
  { valor: "produccion", etiqueta: "Uso en producción" },
  { valor: "uso_interno", etiqueta: "Uso interno" },
  { valor: "merma", etiqueta: "Merma o daño" },
];
const FORMULARIO_VACIO = {
  tipo: "entrada", motivo: "", productoId: "", bodegaDestinoId: "", cantidad: "", observaciones: "",
  codigoNuevo: "", descripcionNueva: "", familiaNueva: "", calibreNuevo: "", empresaNueva: "",
};

/** Reglas de validación y persistencia de entradas, salidas y traslados. */
type Bodega = { id: number; nombre: string };
type Dependencias = {
  sesion?: { bodegaId?: number; rol?: string } | null;
  almacen?: { bodegas?: Bodega[] };
  cargarProductos: () => Promise<void>;
  cargarHistorial: () => Promise<void>;
  cargarAlertasStock: () => Promise<void>;
};

export function useMovimientosInventario({ sesion, almacen, cargarProductos, cargarHistorial, cargarAlertasStock }: Dependencias) {
  const bodegaId = sesion?.bodegaId;
  // Las entradas de material solo las registra Admin Inventario; el jefe de
  // bodega abre el formulario directo en Salida.
  const puedeDarEntrada = sesion?.rol === "admin_inventario";
  const tipoInicial = puedeDarEntrada ? "entrada" : "salida";
  const bodegas = useMemo(() => almacen?.bodegas || [], [almacen?.bodegas]);
  const [formularioMov, setFormularioMov] = useState({ ...FORMULARIO_VACIO, tipo: tipoInicial });
  const [errorMov, setErrorMov] = useState("");
  const [exitoMov, setExitoMov] = useState("");
  const [guardandoMov, setGuardandoMov] = useState(false);
  const bodegaActual = useMemo(() => bodegas.find((bodega) => bodega.id === bodegaId) || null, [bodegas, bodegaId]);
  const bodegasDestinoDisponibles = useMemo(() => bodegas.filter((bodega) => bodega.id !== bodegaId), [bodegas, bodegaId]);

  function actualizarCampoMov(campo: string, valor: string) { setFormularioMov((actual) => ({ ...actual, [campo]: valor })); }
  function cambiarTipoMov(tipo: string) {
    if (tipo === "entrada" && !puedeDarEntrada) return;
    setFormularioMov({ ...FORMULARIO_VACIO, tipo });
    setErrorMov("");
    setExitoMov("");
  }
  // Atajo desde la fila de un producto en la pestaña "Productos" (botón
  // "Añadir"): precarga tipo=entrada y el producto ya elegido, para que solo
  // falte el motivo y la cantidad -- reutiliza el mismo formulario/validación
  // de Movimientos, no un mecanismo aparte.
  function prepararEntradaProducto(producto: { id: number }) {
    if (!puedeDarEntrada) return;
    setFormularioMov({ ...FORMULARIO_VACIO, tipo: "entrada", productoId: String(producto.id) });
    setErrorMov("");
    setExitoMov("");
  }
  async function registrarMovimiento(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    setErrorMov(""); setExitoMov("");
    const { tipo, productoId, cantidad, bodegaDestinoId } = formularioMov;
    const cantidadNum = Number(cantidad);
    const esProductoNuevo = tipo === "entrada" && productoId === "nuevo";
    if (tipo === "entrada" && !puedeDarEntrada) return setErrorMov("Las entradas de material las registra Admin Inventario.");
    if (!productoId) return setErrorMov("Selecciona un producto o registra uno nuevo.");
    if (esProductoNuevo && (!formularioMov.codigoNuevo.trim() || !formularioMov.descripcionNueva.trim())) {
      return setErrorMov("Para el producto nuevo indica código y descripción.");
    }
    if (!cantidad || cantidadNum <= 0) return setErrorMov("La cantidad debe ser mayor a cero.");
    if (tipo === "traslado" && !bodegaDestinoId) return setErrorMov("Selecciona a qué bodega se traslada el material.");
    setGuardandoMov(true);
    try {
      const movimiento = await api.post<{ cotizacion?: string }>("/inventario/movimientos", {
        tipo, motivo: formularioMov.motivo, producto_id: esProductoNuevo ? null : Number(productoId),
        codigo: esProductoNuevo ? formularioMov.codigoNuevo : "",
        descripcion: esProductoNuevo ? formularioMov.descripcionNueva : "",
        familia: esProductoNuevo ? formularioMov.familiaNueva : "",
        empresa: esProductoNuevo ? formularioMov.empresaNueva : "",
        calibre: esProductoNuevo ? formularioMov.calibreNuevo : "",
        bodega_origen_id: tipo === "salida" || tipo === "traslado" ? bodegaId : null,
        bodega_destino_id: tipo === "traslado" ? Number(bodegaDestinoId) : null,
        cantidad: cantidadNum, observaciones: formularioMov.observaciones,
      });
      await Promise.all([cargarProductos(), cargarHistorial(), cargarAlertasStock()]);
      setExitoMov(`Movimiento registrado correctamente. N° de cotización: ${movimiento?.cotizacion || ""}`);
      setFormularioMov({ ...FORMULARIO_VACIO, tipo });
    } catch (err) {
      setErrorMov(err instanceof ErrorApi ? err.message : "No se pudo registrar el movimiento. Intenta de nuevo.");
    } finally { setGuardandoMov(false); }
  }
  return { puedeDarEntrada, bodegas, bodegaId, bodegaActual, bodegasDestinoDisponibles, cargandoOpcionesMov: false,
    formularioMov, errorMov, exitoMov, guardandoMov, actualizarCampoMov, cambiarTipoMov, prepararEntradaProducto, registrarMovimiento,
    MOTIVOS_ENTRADA, MOTIVOS_SALIDA };
}
