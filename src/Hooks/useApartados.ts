import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { useActualizacionAutomatica } from "./useActualizacionAutomatica";
import { apartadoDesdeApi, disponibilidadCodigoDesdeApi, disponibilidadProductoDesdeApi, productoDesdeApi } from "../Componentes/Mapeo";

// Cada línea del formulario declara su propia modalidad -- un mismo apartado
// puede mezclar líneas POR_ROLLO y POR_STOCK (ver backend/app/models/apartado.py::ModalidadApartado).
// POR_ROLLO usa codigoInterno/medida (comportamiento original, sin cambios);
// POR_STOCK usa productoId (seleccionado por búsqueda) — nunca los dos a la vez.
const ITEM_VACIO = {
  modalidad: "por_rollo",
  codigoInterno: "", medida: "",
  productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "",
  descripcion: "", cantidad: "",
};
const FORMULARIO_VACIO = { bodegaId: "", empresa: "", materialEnCamino: false, numeroCotizacion: "", cliente: "", observaciones: "", items: [{ ...ITEM_VACIO }] };

type ItemFormulario = {
  modalidad: string;
  codigoInterno: string; medida: string | number;
  productoId: number | null; productoCodigo: string; productoDescripcion: string; busquedaProducto: string;
  descripcion: string; cantidad: string | number;
};
type FormularioApartado = {
  bodegaId: string; empresa: string; materialEnCamino: boolean; numeroCotizacion: string; cliente: string; observaciones: string; items: ItemFormulario[];
};
type ApartadoItem = {
  id: number; modalidad: string; codigoInterno: string | null; descripcion: string; cantidad: number;
  medida: number | null; metrosRequeridos: number | null; metrosConsumidos: number;
  productoId: number | null; stockDescontado: boolean;
  metrosPendientes: number | null; tieneProduccionRegistrada: boolean;
};
type Apartado = {
  id: number; bodegaId: number; bodegaNombre: string; numeroCotizacion: string; empresa: string; cliente: string; creadoPor: string;
  fechaCreacion: string; estado: string; enviadoAProduccionPor: string; fechaEnviadoAProduccion: string | null;
  canceladoPor: string; fechaCancelado: string | null; fechaEntregado: string | null; observaciones: string;
  stockSeparadoConfirmado: boolean; stockSeparadoPor: string; stockSeparadoEn: string | null;
  faltantes: string[]; items: ApartadoItem[];
};

/** Quita la posición `indice` de un objeto indexado por posición y corre
 * una posición hacia arriba todo lo que estaba después. */
function quitarPosicion<T>(porPosicion: Record<number, T>, indice: number): Record<number, T> {
  const resultado: Record<number, T> = {};
  for (const [clave, valor] of Object.entries(porPosicion)) {
    const posicion = Number(clave);
    if (posicion < indice) resultado[posicion] = valor;
    else if (posicion > indice) resultado[posicion - 1] = valor;
  }
  return resultado;
}

/** Estado y operaciones del módulo Apartados (reserva de material por cotización).
 * Cada línea del formulario elige su modalidad (POR_ROLLO/POR_STOCK) de forma
 * independiente -- ver ITEM_VACIO arriba. */
export function useApartados(sesion: { rol?: string } | null | undefined, alCambiarApartados?: () => void) {
  // Admin Inventario crea (cotización aprobada, eligiendo la bodega) y
  // cancela; la bodega (administrativo) decide cuándo enviarlo a producción.
  const puedeCrearApartados = sesion?.rol === "admin_inventario";
  const puedeCancelarApartados = sesion?.rol === "admin_inventario";
  const puedeEnviarAProduccion = sesion?.rol === "administrativo";
  const puedeMarcarTerminado = sesion?.rol === "jefe_planta";

  const [apartados, setApartados] = useState<Apartado[]>([]);
  const [cargandoApartados, setCargandoApartados] = useState(true);
  const [errorApartados, setErrorApartados] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  // `silenciosa` (actualización automática): sin "Cargando..." ni mensaje de
  // error, y sin tocar el formulario de nuevo apartado. `ultimaConsulta`
  // descarta una respuesta vieja (ej. de otro filtro de estado) que llegue
  // después de una más nueva.
  const ultimaConsulta = useRef(0);
  const consultarApartados = useCallback(async (silenciosa: boolean) => {
    const consulta = ++ultimaConsulta.current;
    if (!silenciosa) {
      setCargandoApartados(true);
      setErrorApartados("");
    }
    try {
      const parametros = new URLSearchParams();
      if (filtroEstado) parametros.set("estado", filtroEstado);
      const cadena = parametros.toString();
      const datos = await api.get(`/apartados${cadena ? `?${cadena}` : ""}`);
      if (consulta !== ultimaConsulta.current) return;
      setApartados((datos as Record<string, unknown>[]).map(apartadoDesdeApi));
    } catch {
      if (!silenciosa && consulta === ultimaConsulta.current) setErrorApartados("No se pudieron cargar los apartados.");
    } finally {
      if (consulta === ultimaConsulta.current) setCargandoApartados(false);
    }
  }, [filtroEstado]);

  // Tras un cambio también se avisa a App (alCambiarApartados) para que el
  // contador de "Apartados" en la barra lateral se actualice de una vez.
  const cargarApartados = useCallback(async () => {
    await consultarApartados(false);
    alCambiarApartados?.();
  }, [consultarApartados, alCambiarApartados]);

  useEffect(() => { cargarApartados(); }, [cargarApartados]);
  useActualizacionAutomatica(() => consultarApartados(true));

  const [formulario, setFormulario] = useState<FormularioApartado>(FORMULARIO_VACIO);
  const [mostrarFormularioApartado, setMostrarFormularioApartado] = useState(false);
  const [guardandoApartado, setGuardandoApartado] = useState(false);
  const [errorFormularioApartado, setErrorFormularioApartado] = useState("");

  function abrirFormularioApartado() {
    setFormulario(FORMULARIO_VACIO);
    setErrorFormularioApartado("");
    setDisponibilidadItems({});
    setResultadosBusquedaProducto({});
    setMostrarFormularioApartado(true);
  }

  function cerrarFormularioApartado() {
    setMostrarFormularioApartado(false);
    setErrorFormularioApartado("");
    setDisponibilidadItems({});
    setResultadosBusquedaProducto({});
  }

  function marcarMaterialEnCamino(valor: boolean) {
    setFormulario((actual) => ({ ...actual, materialEnCamino: valor }));
  }

  function actualizarCampoApartado(campo: keyof FormularioApartado, valor: string) {
    setFormulario((actual) => ({ ...actual, [campo]: valor }));
  }

  // Cambiar de bodega invalida lo ya elegido: la disponibilidad y los
  // productos de stock eran de la bodega anterior.
  function cambiarBodegaApartado(bodegaId: string) {
    setFormulario((actual) => ({
      ...actual, bodegaId,
      items: actual.items.map((item) => ({ ...item, productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "" })),
    }));
    setDisponibilidadItems({});
    setResultadosBusquedaProducto({});
  }

  function agregarItemApartado() {
    setFormulario((actual) => ({ ...actual, items: [...actual.items, { ...ITEM_VACIO }] }));
  }

  function quitarItemApartado(indice: number) {
    setFormulario((actual) => ({ ...actual, items: actual.items.filter((_, i) => i !== indice) }));
    // Disponibilidad y búsquedas se guardan por POSICIÓN de la línea: al quitar
    // una, las siguientes suben un puesto y sus datos tienen que subir con
    // ellas. Antes se quedaban en la posición vieja y la línea de al lado
    // mostraba la disponibilidad de otro código.
    setDisponibilidadItems((actual) => quitarPosicion(actual, indice));
    setResultadosBusquedaProducto((actual) => quitarPosicion(actual, indice));
  }

  function actualizarItemApartado(indice: number, campo: keyof ItemFormulario, valor: string) {
    setFormulario((actual) => ({
      ...actual,
      items: actual.items.map((item, i) => (i === indice ? { ...item, [campo]: valor } : item)),
    }));
  }

  // Cambiar la modalidad de una línea limpia los campos de la otra modalidad
  // (y su disponibilidad/búsqueda ya consultada), para no arrastrar datos de
  // un modo al otro por accidente.
  function cambiarModalidadItem(indice: number, modalidad: string) {
    setFormulario((actual) => ({
      ...actual,
      items: actual.items.map((item, i) => (i === indice ? {
        ...item, modalidad,
        codigoInterno: "", medida: "",
        productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "",
      } : item)),
    }));
    setDisponibilidadItems((actual) => {
      const { [indice]: _quitado, ...resto } = actual;
      return resto;
    });
    setResultadosBusquedaProducto((actual) => {
      const { [indice]: _quitado, ...resto } = actual;
      return resto;
    });
  }

  const [disponibilidadItems, setDisponibilidadItems] = useState<Record<number, Record<string, unknown>>>({});

  // POR_ROLLO: disponibilidad por código de clasificación (comportamiento original).
  async function consultarDisponibilidadItem(indice: number, codigoInterno: string) {
    const codigo = codigoInterno.trim();
    if (!codigo) {
      setDisponibilidadItems((actual) => {
        const { [indice]: _quitado, ...resto } = actual;
        return resto;
      });
      return;
    }
    if (!formulario.bodegaId) {
      setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: false, sinBodega: true } }));
      return;
    }
    setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: true } }));
    try {
      const datos = await api.get(`/apartados/disponibilidad?codigo_interno=${encodeURIComponent(codigo)}&bodega_id=${formulario.bodegaId}`);
      setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: false, datos: disponibilidadCodigoDesdeApi(datos as Record<string, unknown>) } }));
    } catch {
      setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: false, error: true } }));
    }
  }

  // POR_STOCK: disponibilidad de un Producto concreto ya seleccionado.
  async function consultarDisponibilidadProductoItem(indice: number, productoId: number) {
    setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: true } }));
    try {
      const datos = await api.get(`/apartados/disponibilidad-producto?producto_id=${productoId}&bodega_id=${formulario.bodegaId}`);
      setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: false, datos: disponibilidadProductoDesdeApi(datos as Record<string, unknown>) } }));
    } catch {
      setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: false, error: true } }));
    }
  }

  const [resultadosBusquedaProducto, setResultadosBusquedaProducto] = useState<Record<number, Record<string, unknown>[]>>({});

  // Busca productos por texto libre (código o descripción) para elegir uno
  // como línea POR_STOCK -- mismo endpoint que ya usa Inventario.
  async function buscarProductoParaItem(indice: number, texto: string) {
    actualizarItemApartado(indice, "busquedaProducto", texto);
    const consulta = texto.trim();
    if (!consulta || !formulario.bodegaId) {
      setResultadosBusquedaProducto((actual) => {
        const { [indice]: _quitado, ...resto } = actual;
        return resto;
      });
      return;
    }
    try {
      const datos = await api.get(`/apartados/productos?busqueda=${encodeURIComponent(consulta)}&bodega_id=${formulario.bodegaId}`);
      setResultadosBusquedaProducto((actual) => ({ ...actual, [indice]: datos as Record<string, unknown>[] }));
    } catch {
      setResultadosBusquedaProducto((actual) => ({ ...actual, [indice]: [] }));
    }
  }

  function seleccionarProductoParaItem(indice: number, productoApi: Record<string, unknown>) {
    const producto = productoDesdeApi(productoApi);
    setFormulario((actual) => ({
      ...actual,
      items: actual.items.map((item, i) => (i === indice ? {
        ...item, productoId: producto.id, productoCodigo: producto.codigo, productoDescripcion: producto.descripcion,
        busquedaProducto: "",
        // Si no escribió una descripción propia, se autocompleta con el
        // código del producto -- así la lista de apartados (que no vuelve a
        // consultar el Producto) puede seguir mostrando qué es cada línea.
        descripcion: item.descripcion.trim() ? item.descripcion : producto.codigo,
      } : item)),
    }));
    setResultadosBusquedaProducto((actual) => {
      const { [indice]: _quitado, ...resto } = actual;
      return resto;
    });
    consultarDisponibilidadProductoItem(indice, producto.id);
  }

  async function crearApartado(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!formulario.bodegaId) {
      setErrorFormularioApartado("Elige la bodega de donde sale el material.");
      return;
    }
    if (!formulario.empresa) {
      setErrorFormularioApartado("Elige de qué empresa sale el material: Arquitejas o Asia Business.");
      return;
    }
    if (!formulario.numeroCotizacion.trim()) {
      setErrorFormularioApartado("Indica el número de cotización.");
      return;
    }
    if (formulario.items.length === 0) {
      setErrorFormularioApartado("Agrega al menos un producto solicitado.");
      return;
    }
    for (const item of formulario.items) {
      if (!(Number(item.cantidad) > 0)) {
        setErrorFormularioApartado("Cada producto solicitado necesita una cantidad mayor a cero.");
        return;
      }
      if (item.modalidad === "por_stock") {
        if (!item.productoId) {
          setErrorFormularioApartado("Selecciona un producto para cada línea de stock.");
          return;
        }
      } else if (!item.codigoInterno || !(Number(item.medida) > 0)) {
        setErrorFormularioApartado("Cada línea de rollo necesita código de clasificación y medida mayores a cero.");
        return;
      }
    }
    setGuardandoApartado(true);
    setErrorFormularioApartado("");
    try {
      await api.post("/apartados", {
        bodega_id: Number(formulario.bodegaId),
        material_en_camino: formulario.materialEnCamino,
        numero_cotizacion: formulario.numeroCotizacion.trim(),
        empresa: formulario.empresa,
        cliente: formulario.cliente.trim(),
        observaciones: formulario.observaciones,
        items: formulario.items.map((i) => (
          i.modalidad === "por_stock"
            ? { modalidad: "por_stock", producto_id: i.productoId, descripcion: i.descripcion, cantidad: Number(i.cantidad) }
            : { modalidad: "por_rollo", codigo_interno: i.codigoInterno, descripcion: i.descripcion, cantidad: Number(i.cantidad), medida: Number(i.medida) }
        )),
      });
      await cargarApartados();
      setMostrarFormularioApartado(false);
    } catch (err) {
      setErrorFormularioApartado(err instanceof ErrorApi ? err.message : "No se pudo crear el apartado.");
    } finally {
      setGuardandoApartado(false);
    }
  }

  const [errorAccionApartado, setErrorAccionApartado] = useState("");

  async function cancelarApartado(id: number) {
    setErrorAccionApartado("");
    try {
      await api.patch(`/apartados/${id}/cancelar`);
      await cargarApartados();
    } catch (err) {
      setErrorAccionApartado(err instanceof ErrorApi ? err.message : "No se pudo cancelar el apartado.");
    }
  }

  async function eliminarApartado(id: number) {
    setErrorAccionApartado("");
    try {
      await api.delete(`/apartados/${id}`);
      await cargarApartados();
    } catch (err) {
      setErrorAccionApartado(err instanceof ErrorApi ? err.message : "No se pudo eliminar la cotización.");
    }
  }

  async function enviarApartadoAProduccion(id: number) {
    setErrorAccionApartado("");
    try {
      await api.patch(`/apartados/${id}/enviar-a-produccion`);
      await cargarApartados();
    } catch (err) {
      setErrorAccionApartado(err instanceof ErrorApi ? err.message : "No se pudo enviar el apartado a producción.");
    }
  }

  async function marcarApartadoProduccionTerminada(id: number) {
    setErrorAccionApartado("");
    try {
      await api.patch(`/apartados/${id}/marcar-terminado`);
      await cargarApartados();
    } catch (err) {
      setErrorAccionApartado(err instanceof ErrorApi ? err.message : "No se pudo marcar la producción como terminada.");
    }
  }

  async function marcarApartadoEntregado(id: number) {
    setErrorAccionApartado("");
    try {
      await api.patch(`/apartados/${id}/marcar-entregado`);
      await cargarApartados();
    } catch (err) {
      setErrorAccionApartado(err instanceof ErrorApi ? err.message : "No se pudo marcar como entregado.");
    }
  }

  return {
    puedeCrearApartados, puedeCancelarApartados, puedeEnviarAProduccion, puedeMarcarTerminado,
    apartados, cargandoApartados, errorApartados, cargarApartados,
    filtroEstado, setFiltroEstado,

    formulario, mostrarFormularioApartado, abrirFormularioApartado, cerrarFormularioApartado,
    actualizarCampoApartado, cambiarBodegaApartado, marcarMaterialEnCamino, agregarItemApartado, quitarItemApartado, actualizarItemApartado,
    cambiarModalidadItem,
    guardandoApartado, errorFormularioApartado, crearApartado,
    disponibilidadItems, consultarDisponibilidadItem,
    resultadosBusquedaProducto, buscarProductoParaItem, seleccionarProductoParaItem,

    errorAccionApartado, cancelarApartado, eliminarApartado, enviarApartadoAProduccion,
    marcarApartadoProduccionTerminada, marcarApartadoEntregado,
  };
}
