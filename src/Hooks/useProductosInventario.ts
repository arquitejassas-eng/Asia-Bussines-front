import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { productoDesdeApi } from "../Componentes/Mapeo";
import { calibrePantalla } from "../Utils/teja";
import { useActualizacionAutomatica } from "./useActualizacionAutomatica";

const FORMULARIO_VACIO = {
  codigoImportacion: "",
  codigo: "",
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
  id: number; codigoImportacion: string; codigo: string; referencia?: string; descripcion: string;
  familia?: string; calibre: string | number; entrada: number; stock: number; stockMinimo?: number | null;
  // Solo poblados para el stock adicional que genera Producción.
  color?: string; ral?: string; calidad?: string | null; motivoSegunda?: string;
  metrosPorUnidad?: number | null; produccionId?: number | null; fechaProduccion?: string;
  codigoRolloOrigen?: string; anchoRollo?: number | null; tipoProducto?: string;
};
/** Todo el catálogo agrupado por familia, para mostrarlo como tarjetas
 * plegables (mismo patrón visual que Rollos::gruposPorCodigo, pero sobre el
 * catálogo completo — una familia nunca queda partida entre páginas). El
 * stock adicional que genera Producción usa como familia el código de
 * clasificación del rollo de origen, así queda agrupado ahí.
 *
 * Excepción 1 — productos "seccionados" (caballete/flanche — ver
 * tipoProducto): la familia sola no alcanza para identificar la tarjeta —
 * "CABALLETES" de 6 m y "CABALLETES" de 4 m son existencias distintas y NO
 * deben mezclarse en una sola tarjeta. Ahí se agrupa por familia + longitud
 * (metrosPorUnidad).
 *
 * Excepción 2 — productos vendidos "por conversión" (ej. Porcelanato: la
 * unidad física de stock es la CAJA, pero el cliente pide m² — ver
 * metrosPorUnidad = m² por caja): familia sola tampoco alcanza —
 * "PORCELANATO Gris 60x60" y "PORCELANATO Beige 60x60" comparten familia
 * pero son productos distintos. Se identifican por `tipoProducto ===
 * "conversion"` — el MISMO campo estructural que ya distingue
 * caballete/flanche, poblado por el backend al crear/editar el producto
 * (nunca inferido aquí a partir de metrosPorUnidad + produccionId: eso
 * confundía el stock adicional de tejas, que también usa metrosPorUnidad
 * pero para metros lineales, no m² por caja — ver el bug corregido). Se
 * agrupan por familia + descripción + calibre + metrosPorUnidad —
 * descripcion/calibre son campos que YA existen y ya identifican el tipo.
 *
 * `longitud` queda disponible en los dos casos anteriores para que la
 * tarjeta muestre qué medida guarda. Para todo lo demás (incluyendo TECHO
 * PVC, tejas, productos comprados como Tornillos) sigue agrupando solo por
 * familia, sin importar la referencia, el código, el calibre u otra
 * característica — comportamiento sin cambios. */
type GrupoFamilia = {
  clave: string; familia: string; longitud: number | null;
  tipoGrupo: "seccionado" | "conversion" | "referencia" | "teja" | "simple";
  descripcion: string; calibre: string; referenciaGrupo: string;
  productos: Producto[];
};
const TIPOS_PRODUCTO_SECCIONADO = ["caballete", "flanche"];
// Mismo patrón, para el campo "m² por caja" del formulario de Inventario
// (ver InventarioPage.tsx): a diferencia de `tipoProducto === "conversion"`
// (deliberadamente genérico — cualquier producto con m²/caja configurado
// queda "conversion", sin importar su familia), la VISIBILIDAD del campo en
// el formulario sí debe acotarse a la familia Porcelanato en sí, para que
// reaccione en vivo mientras se escribe (tipoProducto es un dato ya
// guardado del producto, no cambia mientras se edita la familia a mano).
export const FAMILIA_PORCELANATO = "PORCELANATO";
// Los campos Calidad/Longitud/Ancho rollo-sección/Rollo origen solo tienen
// sentido para TEJA (el stock que sale de Producción o del catálogo de
// tejas) — ver el condicional en InventarioPage.tsx que oculta esas 4
// columnas para cualquier otra familia, sin importar si están vacías o no.
export const FAMILIA_TEJA = "TEJA";
export function normalizarFamilia(familia: string) {
  return (familia || "").trim().toUpperCase();
}
type FormularioProducto = {
  codigoImportacion: string; codigo: string; referencia?: string; descripcion: string; familia?: string;
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

  function abrirFormularioEdicionProducto(producto: Producto) {
    setFormularioProducto({
      codigoImportacion: producto.codigoImportacion,
      codigo: producto.codigo,
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

  async function guardarProducto(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!formularioProducto.codigo.trim() || !formularioProducto.descripcion.trim()) {
      setErrorProductos("Código y descripción son obligatorios.");
      return;
    }
    setGuardandoProducto(true);
    setErrorProductos("");
    try {
      const cuerpo = {
        codigo_importacion: formularioProducto.codigoImportacion || "",
        codigo: formularioProducto.codigo,
        referencia: formularioProducto.referencia || "",
        descripcion: formularioProducto.descripcion,
        familia: formularioProducto.familia || "",
        calibre: String(formularioProducto.calibre ?? ""),
        entrada: Number(formularioProducto.entrada) || 0,
        stock: Number(formularioProducto.stock) || 0,
        stock_minimo: formularioProducto.stockMinimo === "" ? null : Number(formularioProducto.stockMinimo),
        metros_por_unidad: formularioProducto.metrosPorUnidad === "" ? null : Number(formularioProducto.metrosPorUnidad),
      };
      if (editandoProductoId) await api.put(`/inventario/productos/${editandoProductoId}`, cuerpo);
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
    } catch {
      setErrorProductos("No se pudo eliminar el producto.");
    }
  }

  const gruposPorFamilia = useMemo<GrupoFamilia[]>(() => {
    const mapa = new Map<string, GrupoFamilia>();
    for (const producto of productos) {
      const familia = producto.familia || "Sin familia";
      const esSeccionado = TIPOS_PRODUCTO_SECCIONADO.includes(producto.tipoProducto || "");
      // `tipoProducto` es la fuente estructural de qué es este stock — la
      // misma que ya distingue caballete/flanche. El backend (no este
      // hook) decide "conversion" al crear/editar el producto: un producto
      // creado a mano con m² por caja configurado queda marcado ahí mismo
      // (ver crear_producto/actualizar_producto). Así el stock adicional de
      // TEJAS (que también usa metrosPorUnidad, para metros lineales, no
      // m² por caja) nunca puede confundirse con Porcelanato: su
      // tipoProducto siempre queda "" o "caballete"/"flanche", nunca
      // "conversion" — no depende de inferir nada aquí a partir de
      // produccionId + metrosPorUnidad.
      const tieneConversion = producto.tipoProducto === "conversion";
      // TEJA: la AGRUPACIÓN VISUAL de las tarjetas es solo Familia + Modelo
      // — todas las TEJA de un mismo modelo (SUPERMIL, MASTERMIL,
      // ARQUITECTONICA...) caen en una sola tarjeta, sin importar que
      // difieran en color/rollo origen/calibre/longitud/calidad; esos datos
      // siguen viéndose fila por fila dentro de la tabla expandida. Esto es
      // un concepto DISTINTO de la identidad que usa Producción para decidir
      // si dos producciones son "el mismo producto" (Familia + Modelo +
      // Color + Rollo origen + Calibre real + Longitud + Calidad — ver
      // `_buscar_producto_existente` en backend/app/services/produccion.py):
      // esa identidad, más estricta, decide qué fila de BD recibe el stock;
      // esta clave, más simple, decide solo cómo se agrupan visualmente las
      // tarjetas. No mezclar los dos.
      const esTeja = !esSeccionado && !tieneConversion && normalizarFamilia(familia) === FAMILIA_TEJA;

      let clave: string, longitud: number | null, tipoGrupo: GrupoFamilia["tipoGrupo"], referenciaGrupo = "";
      if (esSeccionado) {
        longitud = producto.metrosPorUnidad ?? null;
        clave = `${familia}|${longitud}`;
        tipoGrupo = "seccionado";
      } else if (tieneConversion) {
        longitud = producto.metrosPorUnidad ?? null;
        clave = `${familia}|${producto.descripcion}|${producto.calibre}|${longitud}`;
        tipoGrupo = "conversion";
      } else if (esTeja) {
        referenciaGrupo = producto.referencia || "";
        longitud = null;
        clave = `${familia}|${producto.referencia}`;
        tipoGrupo = "teja";
      } else {
        longitud = null;
        clave = familia;
        tipoGrupo = "simple";
      }

      if (!mapa.has(clave)) {
        mapa.set(clave, {
          clave, familia, longitud, tipoGrupo,
          // Para "conversion" (ej. Porcelanato), la familia sola no
          // identifica el tipo — descripcion/calibre son los campos ya
          // existentes que sí lo hacen (ej. "Porcelanato Gris", "60x60").
          // Todos los productos de este grupo comparten el mismo valor (son
          // parte de la clave), así que tomar el del primero es exacto.
          descripcion: tipoGrupo === "conversion" ? producto.descripcion : "",
          calibre: tipoGrupo === "conversion" ? String(producto.calibre) : tipoGrupo === "teja" ? calibrePantalla(producto.calibre) : "",
          referenciaGrupo,
          productos: [],
        });
      }
      mapa.get(clave)!.productos.push(producto);
    }
    return Array.from(mapa.values()).sort((a, b) => {
      const porFamilia = a.familia.localeCompare(b.familia);
      if (porFamilia !== 0) return porFamilia;
      return (a.longitud ?? 0) - (b.longitud ?? 0);
    });
  }, [productos]);

  return {
    productos, productosFiltrados: productos, gruposPorFamilia, cargarProductos, cargandoProductos, errorProductos,
    guardandoProducto, formularioProducto, editandoProductoId, mostrarFormularioProducto,
    actualizarCampoProducto, cambiarBusquedaProducto, abrirFormularioNuevoProducto,
    abrirFormularioEdicionProducto, cerrarFormularioProducto, guardarProducto, eliminarProducto,
    busquedaProducto, setBusquedaProducto,
    alertasStock, cargandoAlertasStock, cargarAlertasStock,
  };
}
