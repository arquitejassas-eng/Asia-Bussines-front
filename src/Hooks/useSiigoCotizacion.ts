import { useEffect, useRef, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";

// Lo de Siigo en el formulario de cotización: qué empresas están conectadas,
// vendedores, buscar el cliente por cédula/NIT, buscar el producto de Siigo
// de cada línea y la cantidad sugerida (kilos para Asia Business,
// centímetros para Arquitejas; ver backend services/siigo_cotizacion.py).

export type VendedorSiigo = { id: number; nombre: string; correo: string };
export type CentroCostoSiigo = { id: number; codigo: string; nombre: string };
export type ProductoSiigo = { codigo: string; nombre: string; unidad: string };
export type ClienteSiigo = { estado: "buscando" | "existe" | "no_existe" | "error"; nombre: string; mensaje?: string };

type LineaParaSiigo = {
  modalidad: string; codigoInterno: string; descripcion: string; cantidad: string | number; medida: string | number;
  tipoProducto: string; productoId: number | null;
  siigoCantidad: string; siigoCantidadManual?: boolean; siigoProducto: string; siigoUnidad?: string; siigoAviso?: string;
  siigoKilos?: number | null;
};
type FormularioParaSiigo = {
  empresa: string; ordenInterna: boolean; deSiigo: boolean; cliente: string; clienteIdentificacion: string;
  siigoVendedor: string; siigoCentroCosto: string; siigoIva: boolean; siigoRetefuente: boolean;
  items: LineaParaSiigo[];
};
type Sugerencia = { cantidad: number | null; unidad: string; aviso: string; kilos: number | null; siigo_producto: string };

export const NOMBRE_UNIDAD: Record<string, string> = { kg: "kilo", cm: "centímetro", und: "unidad", m2: "metro cuadrado" };

export function useSiigoCotizacion<F extends FormularioParaSiigo>(
  activo: boolean, formulario: F, setFormulario: (cambio: (actual: F) => F) => void,
) {
  // Empresas con su Siigo conectado ({ AR: true, ABG: false }).
  const [conectadas, setConectadas] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!activo) return;
    api.get<Record<string, boolean>>("/siigo/estado").then((datos) => setConectadas(datos || {})).catch(() => setConectadas({}));
  }, [activo]);
  const empresaConectada = Boolean(conectadas[formulario.empresa]);
  const usaSiigo = activo && empresaConectada && !formulario.ordenInterna;
  // Toda cotización nueva de una empresa conectada va a Siigo; al editar, la que ya es de Siigo.
  const enSiigo = usaSiigo && formulario.deSiigo;

  // Porcentajes del IVA y la retención de la empresa (para el total aproximado).
  const [impuestos, setImpuestos] = useState<Record<string, { iva: number | null; retefuente: number | null }>>({});
  useEffect(() => {
    const empresa = formulario.empresa;
    if (!enSiigo || impuestos[empresa]) return;
    api.get<{ iva: number | null; retefuente: number | null }>(`/siigo/${empresa}/impuestos`)
      .then((datos) => setImpuestos((actual) => ({ ...actual, [empresa]: datos || { iva: null, retefuente: null } })))
      .catch(() => setImpuestos((actual) => ({ ...actual, [empresa]: { iva: null, retefuente: null } })));
  }, [enSiigo, formulario.empresa, impuestos]);

  // Vendedores del Siigo de la empresa (y el que este usuario usó la última
  // vez); y sus centros de costo si su Siigo los pide (Arquitejas).
  const [vendedores, setVendedores] = useState<Record<string, VendedorSiigo[] | "cargando" | "error">>({});
  const [centrosCosto, setCentrosCosto] = useState<Record<string, CentroCostoSiigo[]>>({});
  useEffect(() => {
    const empresa = formulario.empresa;
    if (!enSiigo || vendedores[empresa]) return;
    setVendedores((actual) => ({ ...actual, [empresa]: "cargando" }));
    api.get<{ vendedores: VendedorSiigo[]; recordado: number | null; centros_costo?: CentroCostoSiigo[]; centro_recordado?: number | null }>(
      `/siigo/${empresa}/vendedores`)
      .then((datos) => {
        setVendedores((actual) => ({ ...actual, [empresa]: datos?.vendedores || [] }));
        setCentrosCosto((actual) => ({ ...actual, [empresa]: datos?.centros_costo || [] }));
        if (datos?.recordado) {
          setFormulario((actual) => (actual.siigoVendedor ? actual : { ...actual, siigoVendedor: String(datos.recordado) }));
        }
        if (datos?.centro_recordado) {
          setFormulario((actual) => (actual.siigoCentroCosto ? actual : { ...actual, siigoCentroCosto: String(datos.centro_recordado) }));
        }
      })
      .catch(() => setVendedores((actual) => ({ ...actual, [empresa]: "error" })));
  }, [enSiigo, formulario.empresa, vendedores, setFormulario]);

  // Cliente por cédula/NIT: si existe en Siigo, su nombre y los impuestos que
  // se le pusieron la última vez.
  const [cliente, setCliente] = useState<ClienteSiigo | null>(null);
  const ultimoCliente = useRef("");
  async function consultarCliente(identificacion: string) {
    const nit = identificacion.replace(/[^0-9A-Za-z]/g, "");
    ultimoCliente.current = nit;
    if (!nit || !empresaConectada) {
      setCliente(null);
      return;
    }
    setCliente({ estado: "buscando", nombre: "" });
    try {
      const datos = await api.get<{ existe: boolean; nombre: string; impuestos_recordados: string[] | null }>(
        `/siigo/${formulario.empresa}/clientes/${encodeURIComponent(nit)}`);
      if (ultimoCliente.current !== nit || !datos) return;
      setCliente({ estado: datos.existe ? "existe" : "no_existe", nombre: datos.nombre });
      setFormulario((actual) => ({
        ...actual,
        // El nombre es el de Siigo: así no se escribe dos veces ni distinto.
        cliente: datos.existe && datos.nombre ? datos.nombre : actual.cliente,
        ...(datos.impuestos_recordados ? {
          siigoIva: datos.impuestos_recordados.includes("iva"), siigoRetefuente: datos.impuestos_recordados.includes("retefuente"),
        } : {}),
      }));
    } catch (err) {
      if (ultimoCliente.current === nit) setCliente({ estado: "error", nombre: "", mensaje: err instanceof ErrorApi ? err.message : "" });
    }
  }
  useEffect(() => { setCliente(null); ultimoCliente.current = ""; }, [formulario.empresa]);

  // Productos de Siigo: búsqueda por línea (espera a que dejen de escribir).
  const [productos, setProductos] = useState<Record<number, ProductoSiigo[] | "buscando" | "error">>({});
  const busquedas = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const ultimaBusqueda = useRef<Record<number, string>>({});
  function buscarProducto(indice: number, texto: string) {
    const consulta = texto.trim();
    ultimaBusqueda.current[indice] = consulta;
    clearTimeout(busquedas.current[indice]);
    if (consulta.length < 2) {
      setProductos((actual) => { const { [indice]: _q, ...resto } = actual; return resto; });
      return;
    }
    busquedas.current[indice] = setTimeout(async () => {
      setProductos((actual) => ({ ...actual, [indice]: "buscando" }));
      try {
        const datos = await api.get<ProductoSiigo[]>(`/siigo/${formulario.empresa}/productos?buscar=${encodeURIComponent(consulta)}`);
        if (ultimaBusqueda.current[indice] === consulta) setProductos((actual) => ({ ...actual, [indice]: datos || [] }));
      } catch {
        if (ultimaBusqueda.current[indice] === consulta) setProductos((actual) => ({ ...actual, [indice]: "error" }));
      }
    }, 350);
  }
  function cerrarBusquedaProducto(indice: number) {
    clearTimeout(busquedas.current[indice]);
    ultimaBusqueda.current[indice] = "";
    setProductos((actual) => { const { [indice]: _q, ...resto } = actual; return resto; });
  }

  // Cantidad sugerida y producto recordado de cada línea: se piden de nuevo
  // cuando cambian el código, la cantidad, la medida o el producto. La
  // cantidad que el vendedor escribió a mano no se toca.
  const clave = enSiigo ? JSON.stringify([formulario.empresa, formulario.items.map((i) => [
    i.modalidad, i.codigoInterno, i.cantidad, i.medida, i.tipoProducto, i.productoId, i.descripcion])]) : "";
  useEffect(() => {
    if (!clave) return;
    const items = formulario.items;
    const espera = setTimeout(async () => {
      try {
        const datos = await api.post<Sugerencia[]>("/siigo/sugerencias", {
          empresa: formulario.empresa,
          lineas: items.map((i) => ({
            modalidad: i.modalidad === "rollo_completo" ? "por_rollo" : i.modalidad, codigo_interno: i.codigoInterno || null,
            descripcion: i.descripcion, cantidad: Number(String(i.cantidad).replace(",", ".")) || 0,
            medida: Number(String(i.medida).replace(",", ".")) || null, tipo_producto: i.tipoProducto || "", producto_id: i.productoId,
          })),
        });
        if (!datos) return;
        setFormulario((actual) => ({
          ...actual,
          items: actual.items.map((item, indice) => {
            const sugerida = datos[indice];
            if (!sugerida) return item;
            return {
              ...item, siigoUnidad: sugerida.unidad, siigoAviso: sugerida.aviso, siigoKilos: sugerida.kilos ?? null,
              siigoCantidad: item.siigoCantidadManual ? item.siigoCantidad : (sugerida.cantidad == null ? "" : String(sugerida.cantidad)),
              siigoProducto: item.siigoProducto || sugerida.siigo_producto,
            };
          }),
        }));
      } catch {
        // Sin sugerencia: el vendedor escribe la cantidad.
      }
    }, 600);
    return () => clearTimeout(espera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // "kg", "cm", "und" o "m2": la unidad de Siigo de una línea (la de la lámina de la empresa mientras no hay sugerencia).
  function unidadDe(item: { siigoUnidad?: string }) {
    return item.siigoUnidad || (formulario.empresa === "AR" ? "cm" : "kg");
  }

  return {
    conectadas, empresaConectada, usaSiigo, enSiigo, impuestos: impuestos[formulario.empresa], unidadDe,
    vendedores: vendedores[formulario.empresa], centrosCosto: centrosCosto[formulario.empresa], cliente, consultarCliente,
    productos, buscarProducto, cerrarBusquedaProducto,
  };
}
