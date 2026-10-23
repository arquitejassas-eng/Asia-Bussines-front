import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { productoDesdeApi } from "../Componentes/Mapeo";
import { agruparProductosPorFamilia } from "../Utils/agrupacionProductos";
import { useActualizacionAutomatica } from "./useActualizacionAutomatica";
import { confirmarFamilia, useFamiliasProductos } from "./useFamiliasProductos";

const FORMULARIO_VACIO = {
  codigoImportacion: "",
  codigo: "",
  empresa: "",
  referencia: "",
  descripcion: "",
  familia: "",
  calibre: "",
  entrada: "",
  stock: "",
  stockMinimo: "",
  metrosPorUnidad: "",
};

/** Estado y operaciones del catálogo de productos. */
type Producto = {
  id: number; codigoImportacion: string; codigo: string; empresa?: string; referencia?: string; descripcion: string;
  familia?: string; calibre: string | number; entrada: number; stock: number; stockMinimo?: number | null;
  // Solo poblados para el stock adicional que genera Producción.
  color?: string; ral?: string; calidad?: string | null; motivoSegunda?: string;
  metrosPorUnidad?: number | null; produccionId?: number | null; fechaProduccion?: string;
  codigoRolloOrigen?: string; anchoRollo?: number | null; tipoProducto?: string;
};
// Mismo patrón, para el campo "m² por caja" del formulario de Inventario
// (ver InventarioPage.tsx): a diferencia de `tipoProducto === "conversion"`
// (deliberadamente genérico — cualquier producto con m²/caja configurado
// queda "conversion", sin importar su familia), la VISIBILIDAD del campo en
// el formulario sí debe acotarse a la familia Porcelanato en sí, para que
// reaccione en vivo mientras se escribe (tipoProducto es un dato ya
// guardado del producto, no cambia mientras se edita la familia a mano).
export const FAMILIA_PORCELANATO = "PORCELANATO";
export { FAMILIA_TEJA, normalizarFamilia } from "../Utils/agrupacionProductos";
type FormularioProducto = {
  codigoImportacion: string; codigo: string; empresa?: string; referencia?: string; descripcion: string; familia?: string;
  calibre: string | number; entrada: string | number; stock: string | number; stockMinimo: string | number;
  metrosPorUnidad: string | number;
};

export function useProductosInventario() {
  const ultimaConsulta = useRef(0);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);
  const [errorProductos, setErrorProductos] = useState("");
  const [guardandoProducto, setGuardandoProducto] = useState(false);
  const [formularioProducto, setFormularioProducto] = useState<FormularioProducto>(FORMULARIO_VACIO);
  const [editandoProductoId, setEditandoProductoId] = useState<number | null>(null);
  const [mostrarFormularioProducto, setMostrarFormularioProducto] = useState(false);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [alertasStock, setAlertasStock] = useState<Producto[]>([]);
  const [cargandoAlertasStock, setCargandoAlertasStock] = useState(false);

  // `silenciosa` (actualización automática): sin indicador de carga y, si
  // falla, se conservan los datos que ya estaban en pantalla.
  const cargarAlertasStock = useCallback(async (silenciosa = false) => {
    if (!silenciosa) setCargandoAlertasStock(true);
    try {
      const datos = await api.get<Record<string, unknown>[]>("/inventario/productos/alertas");
      setAlertasStock((datos || []).map(productoDesdeApi));
    } catch {
      if (!silenciosa) setAlertasStock([]);
    } finally {
      if (!silenciosa) setCargandoAlertasStock(false);
    }
  }, []);

  useEffect(() => { cargarAlertasStock(); }, [cargarAlertasStock]);

  // Sin paginar: las tarjetas agrupan por familia (ver gruposPorFamilia más
  // abajo) y una familia no puede quedar partida entre páginas — necesitan
  // el catálogo completo para agrupar bien.
  const cargarProductos = useCallback(async (silenciosa = false) => {
    const consultaActual = ++ultimaConsulta.current;
    if (!silenciosa) {
      setCargandoProductos(true);
      setErrorProductos("");
    }
    try {
      const parametros = new URLSearchParams();
      if (busquedaProducto.trim()) parametros.set("busqueda", busquedaProducto.trim());
      const cadena = parametros.toString();
      const datos = await api.get<Record<string, unknown>[]>(`/inventario/productos${cadena ? `?${cadena}` : ""}`);
      if (consultaActual !== ultimaConsulta.current) return;
      setProductos((datos || []).map(productoDesdeApi));
    } catch {
      if (consultaActual !== ultimaConsulta.current || silenciosa) return;
      setErrorProductos("No se pudieron cargar los productos.");
    } finally {
      // Sin el `!silenciosa`: si una actualización automática reemplazó a
      // una carga normal en curso, es ella la que debe apagar el indicador.
      if (consultaActual === ultimaConsulta.current) setCargandoProductos(false);
    }
  }, [busquedaProducto]);

  useEffect(() => { cargarProductos(); }, [cargarProductos]);

  // Lo que otra persona registra en esta bodega (una venta, una carga de
  // Excel) aparece sin recargar, sin tocar la búsqueda ni el formulario.
  useActualizacionAutomatica(() => Promise.all([cargarProductos(true), cargarAlertasStock(true)]));

  function actualizarCampoProducto(campo: keyof FormularioProducto, valor: string | number) {
    setFormularioProducto((actual) => ({ ...actual, [campo]: valor }));
  }

  function cambiarBusquedaProducto(valor: string) {
    setBusquedaProducto(valor);
  }

  function abrirFormularioNuevoProducto() {
    setFormularioProducto(FORMULARIO_VACIO);
    setEditandoProductoId(null);
    setErrorProductos("");
    setMostrarFormularioProducto(true);
  }

  // Stock y entrada tal como estaban al abrir la edición: el backend los usa
  // para no pisar una venta o carga hecha mientras el formulario seguía
  // abierto (ver aplicar_stock_editado en backend/app/services/movimientos.py).
  const valoresAlAbrirEdicion = useRef<{ stock: number; entrada: number } | null>(null);

  function abrirFormularioEdicionProducto(producto: Producto) {
    valoresAlAbrirEdicion.current = { stock: Number(producto.stock) || 0, entrada: Number(producto.entrada) || 0 };
    setFormularioProducto({
      codigoImportacion: producto.codigoImportacion,
      codigo: producto.codigo,
      empresa: producto.empresa || "",
      referencia: producto.referencia || "",
      descripcion: producto.descripcion,
      familia: producto.familia || "",
      calibre: producto.calibre,
      entrada: producto.entrada,
      stock: producto.stock,
      stockMinimo: producto.stockMinimo ?? "",
      metrosPorUnidad: producto.metrosPorUnidad ?? "",
    });
    setEditandoProductoId(producto.id);
    setErrorProductos("");
    setMostrarFormularioProducto(true);
  }

  function cerrarFormularioProducto() {
    setMostrarFormularioProducto(false);
    setEditandoProductoId(null);
    setErrorProductos("");
  }

  // Las familias que ya existen: el formulario las sugiere y avisa si escriben una nueva.
  const familias = useFamiliasProductos();

  async function guardarProducto(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!formularioProducto.codigo.trim() || !formularioProducto.descripcion.trim()) {
      setErrorProductos("Código y descripción son obligatorios.");
      return;
    }
    if (Number(formularioProducto.stock) < 0 || Number(formularioProducto.entrada) < 0) {
      setErrorProductos("El stock y la entrada no pueden ser negativos.");
      return;
    }
    const familia = confirmarFamilia(formularioProducto.familia || "", familias);
    if (familia === null) return;
    setGuardandoProducto(true);
    setErrorProductos("");
    try {
      const cuerpo = {
        codigo_importacion: formularioProducto.codigoImportacion || "",
        codigo: formularioProducto.codigo,
        empresa: formularioProducto.empresa || "",
        referencia: formularioProducto.referencia || "",
        descripcion: formularioProducto.descripcion,
        familia,
        calibre: String(formularioProducto.calibre ?? ""),
        entrada: Number(formularioProducto.entrada) || 0,
        stock: Number(formularioProducto.stock) || 0,
        stock_minimo: formularioProducto.stockMinimo === "" ? null : Number(formularioProducto.stockMinimo),
        metros_por_unidad: formularioProducto.metrosPorUnidad === "" ? null : Number(formularioProducto.metrosPorUnidad),
      };
      if (editandoProductoId) {
        await api.put(`/inventario/productos/${editandoProductoId}`, {
          ...cuerpo,
          stock_anterior: valoresAlAbrirEdicion.current?.stock ?? null,
          entrada_anterior: valoresAlAbrirEdicion.current?.entrada ?? null,
        });
      }
      else await api.post("/inventario/productos", cuerpo);
      await Promise.all([cargarProductos(), cargarAlertasStock()]);
      setMostrarFormularioProducto(false);
      setEditandoProductoId(null);
    } catch (err) {
      setErrorProductos(err instanceof ErrorApi ? err.message : "No se pudo guardar el producto. Intenta de nuevo.");
    } finally {
      setGuardandoProducto(false);
    }
  }

  async function eliminarProducto(id: number) {
    try {
      await api.delete(`/inventario/productos/${id}`);
      setProductos((actual) => actual.filter((producto) => producto.id !== id));
      await cargarAlertasStock();
    } catch (err) {
      // El motivo real ("tiene stock", "está en la cotización…").
      setErrorProductos(err instanceof ErrorApi ? err.message : "No se pudo eliminar el producto.");
    }
  }

  const gruposPorFamilia = useMemo(() => agruparProductosPorFamilia(productos), [productos]);

  return {
    productos, productosFiltrados: productos, gruposPorFamilia, cargarProductos, cargandoProductos, errorProductos,
    guardandoProducto, formularioProducto, editandoProductoId, mostrarFormularioProducto,
    actualizarCampoProducto, cambiarBusquedaProducto, abrirFormularioNuevoProducto,
    abrirFormularioEdicionProducto, cerrarFormularioProducto, guardarProducto, eliminarProducto,
    busquedaProducto, setBusquedaProducto, familias,
    alertasStock, cargandoAlertasStock, cargarAlertasStock,
  };
}
