import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { useActualizacionAutomatica } from "./useActualizacionAutomatica";
import { apartadoDesdeApi, disponibilidadCodigoDesdeApi, disponibilidadProductoDesdeApi, productoDesdeApi } from "../Componentes/Mapeo";
import { AMBAS_EMPRESAS } from "../Utils/empresas";

// Cada línea del formulario declara su propia modalidad -- un mismo apartado
// puede mezclar líneas POR_ROLLO y POR_STOCK (ver backend/app/models/apartado.py::ModalidadApartado).
// POR_ROLLO usa codigoInterno/medida (comportamiento original, sin cambios);
// POR_STOCK usa productoId (seleccionado por búsqueda) — nunca los dos a la vez.
// "rollo_completo" solo existe en el formulario: se guarda como POR_ROLLO con
// rollo_id (el backend pone código, 1 rollo y sus metros).
const ITEM_VACIO = {
  modalidad: "por_rollo",
  codigoInterno: "", medida: "",
  rolloId: null, rolloResumen: "", busquedaRollo: "",
  productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "",
  descripcion: "", cantidad: "",
  // Solo por rollo: "" = teja; "caballete" o "flanche" se cortan a lo ancho
  // del rollo (3 o 5 por corte) y apartan cortes × medida, no cantidad × medida.
  tipoProducto: "",
  // Bodega de donde sale esta línea (cada línea elige la suya).
  bodegaId: "",
  // Empresa de la que sale el material ("" = la de la cotización).
  empresa: "",
  // Solo stock: el sistema no lo tiene (0 o negativo) pero sí está en la bodega.
  hayFisico: false,
  // Orden interna, lámina lisa: en qué se convierte y qué bodega la convierte ("" = la misma).
  convertirEn: "caballete", bodegaConversionId: "",
};
const FORMULARIO_VACIO = { bodegaId: "", empresa: "", materialEnCamino: false, numeroCotizacion: "", cliente: "", observaciones: "", ordenInterna: false, items: [{ ...ITEM_VACIO }] };

type ItemFormulario = {
  modalidad: string;
  codigoInterno: string; medida: string | number;
  rolloId: number | null; rolloResumen: string; busquedaRollo: string;
  productoId: number | null; productoCodigo: string; productoDescripcion: string; busquedaProducto: string;
  descripcion: string; cantidad: string | number;
  tipoProducto: string;
  // Bodega de donde sale esta línea.
  bodegaId?: string;
  // Empresa de la que sale su material ("" = la de la cotización).
  empresa?: string;
  hayFisico?: boolean;
  // La línea ya era "sí está en la bodega" al abrirla para editar (solo esas la conservan).
  hayFisicoOriginal?: boolean;
  convertirEn?: string; bodegaConversionId?: string; laminasConvertidas?: number;
  // Solo al editar: la línea que ya existe y lo que ya tuvo salida.
  id?: number; metrosConsumidos?: number; stockDescontado?: boolean;
};
type FormularioApartado = {
  bodegaId: string; empresa: string; materialEnCamino: boolean; numeroCotizacion: string; cliente: string; observaciones: string;
  // Orden de producción interna (Admin Inventario): solo lámina por producir, todo va al stock.
  ordenInterna: boolean;
  items: ItemFormulario[];
};
type ApartadoItem = {
  id: number; modalidad: string; codigoInterno: string | null; descripcion: string; cantidad: number;
  medida: number | null; metrosRequeridos: number | null; metrosConsumidos: number;
  productoId: number | null; stockDescontado: boolean;
  metrosPendientes: number | null; tieneProduccionRegistrada: boolean;
  rolloId: number | null; rolloReferencia: string; tipoProducto: string;
  empresaMaterial: string; // "" = la de la cotización
  hayFisico: boolean;
  convertirEn: string; bodegaConversionId: number | null; laminasConvertidas: number;
};
export type RolloParaApartar = {
  id: number; identificadorRollo: string; codigoInterno: string; descripcion: string;
  colorMaterial: string; empresa: string; pesoNeto: number | null; metrosDisponibles: number;
};
type Apartado = {
  id: number; bodegaId: number; bodegaNombre: string; numeroCotizacion: string; empresa: string; salidaPendiente: boolean; ordenInterna: boolean;
  cliente: string; creadoPor: string;
  fechaCreacion: string; estado: string; enviadoAProduccionPor: string; fechaEnviadoAProduccion: string | null;
  canceladoPor: string; fechaCancelado: string | null; fechaEntregado: string | null; observaciones: string;
  stockSeparadoConfirmado: boolean; stockSeparadoPor: string; stockSeparadoEn: string | null;
  faltantes: string[]; otrasPartes: string[]; items: ApartadoItem[];
};

/** "3811-AR" / "3811-ABG" -> "3811" (ver backend numero_sin_empresa). */
export function numeroSinEmpresa(numero: string) {
  return numero.trim().replace(/-(AR|ABG)$/i, "");
}

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
  // El vendedor crea y corrige sus cotizaciones (aprobadas, eligiendo la
  // bodega); Admin Inventario también las crea, las corrige y las anula; la
  // bodega (administrativo) decide cuándo enviarlas a producción.
  const puedeCrearApartados = sesion?.rol === "vendedor" || sesion?.rol === "admin_inventario";
  // Las órdenes de producción interna (para stock) solo las crea Admin Inventario.
  const puedeCrearOrdenInterna = sesion?.rol === "admin_inventario";
  const puedeEditarApartados = sesion?.rol === "vendedor" || sesion?.rol === "admin_inventario";
  const puedeCancelarApartados = sesion?.rol === "admin_inventario";
  const puedeEnviarAProduccion = sesion?.rol === "administrativo";
  const puedeMarcarTerminado = sesion?.rol === "jefe_planta";
  // "Salida": la encargada de la bodega entrega al cliente lo ya producido.
  const puedeMarcarEntregado = sesion?.rol === "administrativo";

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

  // Cotización que se está editando (null = se está creando una nueva).
  const [editandoId, setEditandoId] = useState<number | null>(null);
  // Bodega y otras partes activas de la cotización que se está editando: si
  // tiene otras partes, se le pueden quitar todas las líneas (se borra solo
  // esta parte; ver backend quitar_parte).
  const [parteEditada, setParteEditada] = useState<{ bodega: string; otrasPartes: string[] }>({ bodega: "", otrasPartes: [] });
  // Al editar la cotización completa: las otras partes (otras bodegas, mismo
  // número) que se guardan junto con la que se abrió (ver backend
  // _editar_cotizacion_completa). Vacío = se edita solo esta parte.
  const [otrasPartesIds, setOtrasPartesIds] = useState<number[]>([]);

  function abrirFormularioApartado(ordenInterna = false) {
    numeroAutomatico.current = "";
    esOrdenInterna.current = ordenInterna;
    setEditandoId(null);
    setOtrasPartesIds([]);
    setParteEditada({ bodega: "", otrasPartes: [] });
    setFormulario({ ...FORMULARIO_VACIO, ordenInterna });
    setErrorFormularioApartado("");
    setDisponibilidadItems({});
    setResultadosBusquedaProducto({});
    setMostrarFormularioApartado(true);
  }

  /** Abre el mismo formulario con los datos de la cotización para corregirla.
   *  Con varias partes (la misma cotización en varias bodegas) se abre
   *  completa: cada línea con su bodega, y al guardar se reparte sola. */
  function abrirEdicionApartado(ap: Apartado, otras: Apartado[] = []) {
    const partes = [ap, ...otras.filter((o) => o.id !== ap.id)];
    const nombresPartes = new Set(partes.map((p) => p.bodegaNombre));
    setEditandoId(ap.id);
    setOtrasPartesIds(partes.slice(1).map((p) => p.id));
    setParteEditada({
      bodega: ap.bodegaNombre,
      // Las partes que se editan juntas ya no cuentan como "otras".
      otrasPartes: partes.length > 1 ? [] : ap.otrasPartes.filter((o) => !nombresPartes.has(o)),
    });
    // La empresa de la cotización es la de la parte sin "-AR"/"-ABG" (si la hay).
    const empresaCotizacion = (partes.find((p) => p.numeroCotizacion === numeroSinEmpresa(p.numeroCotizacion)) ?? ap).empresa;
    esOrdenInterna.current = ap.ordenInterna;
    setFormulario({
      ordenInterna: ap.ordenInterna,
      bodegaId: String(ap.bodegaId), empresa: empresaCotizacion, materialEnCamino: partes.some((p) => (p.faltantes?.length ?? 0) > 0),
      numeroCotizacion: numeroSinEmpresa(ap.numeroCotizacion), cliente: ap.cliente, observaciones: ap.observaciones,
      // Todas las partes juntas, en el orden en que se escribieron las líneas (su id).
      items: partes.flatMap((parte) => parte.items.map((it) => ({ parte, it })))
        .sort((x, y) => x.it.id - y.it.id)
        .map(({ parte, it }) => {
        // La de la línea; en una parte vieja "-AR"/"-ABG", la de esa parte.
        const empresaMaterial = it.empresaMaterial || parte.empresa;
        return {
        ...ITEM_VACIO,
        id: it.id, modalidad: it.rolloId ? "rollo_completo" : it.modalidad, descripcion: it.descripcion, cantidad: String(it.cantidad),
        rolloId: it.rolloId, rolloResumen: it.rolloReferencia,
        codigoInterno: it.codigoInterno || "", medida: it.medida == null ? "" : String(it.medida), tipoProducto: it.tipoProducto || "",
        productoId: it.productoId, productoDescripcion: it.modalidad === "por_stock" ? it.descripcion : "",
        metrosConsumidos: it.metrosConsumidos, stockDescontado: it.stockDescontado,
        bodegaId: String(parte.bodegaId),
        empresa: empresaMaterial && empresaMaterial !== empresaCotizacion ? empresaMaterial : "",
        hayFisico: it.hayFisico, hayFisicoOriginal: it.hayFisico,
        convertirEn: it.convertirEn || "caballete", bodegaConversionId: it.bodegaConversionId ? String(it.bodegaConversionId) : "",
        laminasConvertidas: it.laminasConvertidas,
        };
      }),
    });
    setErrorFormularioApartado("");
    setDisponibilidadItems({});
    setResultadosBusquedaProducto({});
    setMostrarFormularioApartado(true);
  }

  function cerrarFormularioApartado() {
    setEditandoId(null);
    setOtrasPartesIds([]);
    setMostrarFormularioApartado(false);
    setErrorFormularioApartado("");
    setDisponibilidadItems({});
    setResultadosBusquedaProducto({});
  }

  function marcarMaterialEnCamino(valor: boolean) {
    setFormulario((actual) => ({ ...actual, materialEnCamino: valor }));
  }

  // El número que la pantalla puso sola: si no lo cambiaron a mano, al
  // cambiar la empresa se reemplaza por el consecutivo de la otra.
  const numeroAutomatico = useRef("");
  // Una orden interna lleva su propio consecutivo ("OI-0001").
  const esOrdenInterna = useRef(false);
  async function ponerSiguienteNumero(empresa: string) {
    if (!empresa) return;
    try {
      const numero = (await api.get<{ numero: string }>(
        `/apartados/siguiente-numero?empresa=${encodeURIComponent(empresa)}${esOrdenInterna.current ? "&orden_interna=true" : ""}`,
      ))?.numero ?? "";
      if (!numero) return;
      setFormulario((actual) => {
        if (actual.numeroCotizacion.trim() && actual.numeroCotizacion !== numeroAutomatico.current) return actual;
        numeroAutomatico.current = numero;
        return { ...actual, numeroCotizacion: numero };
      });
    } catch {
      // Sin número sugerido: lo escriben a mano.
    }
  }

  function actualizarCampoApartado(campo: keyof FormularioApartado, valor: string) {
    if (campo !== "empresa") {
      setFormulario((actual) => ({ ...actual, [campo]: valor }));
      return;
    }
    // "Esta cotización es de": las líneas sin empresa propia siguen a la
    // cotización, así que su producto de stock (que es de una empresa) se
    // vuelve a elegir y su disponibilidad se vuelve a consultar.
    setFormulario((actual) => ({
      ...actual, empresa: valor,
      items: actual.items.map((item) => (item.empresa || item.id || item.modalidad !== "por_stock" ? item
        : { ...item, productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "" })),
    }));
    formulario.items.forEach((item, indice) => {
      if (!item.empresa && item.modalidad === "por_rollo" && item.codigoInterno) {
        consultarDisponibilidadItem(indice, item.codigoInterno, undefined, valor);
      }
    });
    if (!editandoId) ponerSiguienteNumero(valor);
  }

  // Empresa de la que sale el material de UNA línea.
  function cambiarEmpresaItem(indice: number, empresa: string) {
    const item = formulario.items[indice];
    setFormulario((actual) => ({
      ...actual,
      items: actual.items.map((it, i) => (i === indice
        ? { ...it, empresa: empresa === actual.empresa ? "" : empresa, productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "" }
        : it)),
    }));
    setResultadosBusquedaProducto((actual) => {
      const { [indice]: _quitado, ...resto } = actual;
      return resto;
    });
    if (item?.modalidad === "por_rollo" && item.codigoInterno) {
      consultarDisponibilidadItem(indice, item.codigoInterno, undefined, empresa || formulario.empresa);
    } else {
      setDisponibilidadItems((actual) => {
        const { [indice]: _quitado, ...resto } = actual;
        return resto;
      });
    }
  }

  function empresaDeItem(indice: number) {
    return formulario.items[indice]?.empresa || formulario.empresa;
  }

  // Bodega de donde sale una línea: la suya o, si no tiene, la de la cotización.
  function bodegaDeItem(indice: number) {
    return formulario.items[indice]?.bodegaId || formulario.bodegaId;
  }

  // Cambiar la bodega de UNA línea: su producto de stock y su disponibilidad
  // eran de la otra bodega; la de rollo se vuelve a consultar en la nueva.
  // `conservar` ("Despachar desde ..."): el mismo producto de stock sale de
  // la otra bodega (el backend usa su fila allá).
  function cambiarBodegaItem(indice: number, bodegaId: string, conservar = false) {
    const item = formulario.items[indice];
    setFormulario((actual) => ({
      ...actual,
      items: actual.items.map((it, i) => (i === indice
        ? (conservar ? { ...it, bodegaId }
          : { ...it, bodegaId, productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "", rolloId: null, rolloResumen: "", busquedaRollo: "" })
        : it)),
    }));
    if (conservar && item?.modalidad === "por_stock" && item.productoId) {
      consultarDisponibilidadProductoItem(indice, item.productoId, bodegaId);
      return;
    }
    setDisponibilidadItems((actual) => {
      const { [indice]: _quitado, ...resto } = actual;
      return resto;
    });
    setResultadosBusquedaProducto((actual) => {
      const { [indice]: _quitado, ...resto } = actual;
      return resto;
    });
    if (item?.modalidad === "por_rollo" && item.codigoInterno) {
      consultarDisponibilidadItem(indice, item.codigoInterno, bodegaId || formulario.bodegaId);
    }
    if (item?.modalidad === "rollo_completo") cargarRollosParaApartar(bodegaId || formulario.bodegaId);
  }

  // La línea nueva arranca con la bodega y la empresa de la anterior.
  function agregarItemApartado() {
    setFormulario((actual) => {
      const anterior = actual.items[actual.items.length - 1];
      return { ...actual, items: [...actual.items, { ...ITEM_VACIO, bodegaId: anterior?.bodegaId || "", empresa: anterior?.empresa || "" }] };
    });
  }

  function quitarItemApartado(indice: number) {
    setFormulario((actual) => ({ ...actual, items: actual.items.filter((_, i) => i !== indice) }));
    // Disponibilidad y búsquedas se guardan por POSICIÓN de la línea: al quitar
    // una, las siguientes suben un puesto y sus datos tienen que subir con
    // ellas. Antes se quedaban en la posición vieja y la línea de al lado
    // mostraba la disponibilidad de otro código.
    setDisponibilidadItems((actual) => quitarPosicion(actual, indice));
    setResultadosBusquedaProducto((actual) => quitarPosicion(actual, indice));
    consultasDisponibilidad.current = quitarPosicion(consultasDisponibilidad.current, indice);
  }

  function actualizarItemApartado(indice: number, campo: keyof ItemFormulario, valor: string | boolean) {
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
        // "Material de las dos empresas" es solo para lámina por producir.
        empresa: modalidad !== "por_rollo" && item.empresa === AMBAS_EMPRESAS ? "" : item.empresa,
        codigoInterno: "", medida: "",
        productoId: null, productoCodigo: "", productoDescripcion: "", busquedaProducto: "",
        rolloId: null, rolloResumen: "", busquedaRollo: "",
        cantidad: modalidad === "rollo_completo" ? "1" : (item.modalidad === "rollo_completo" ? "" : item.cantidad),
      } : item)),
    }));
    if (modalidad === "rollo_completo") cargarRollosParaApartar(formulario.items[indice]?.bodegaId || formulario.bodegaId);
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

  // Rollo completo: rollos de cada bodega que se pueden vender enteros.
  const [rollosParaApartar, setRollosParaApartar] = useState<Record<string, RolloParaApartar[] | "cargando" | "error">>({});
  async function cargarRollosParaApartar(bodegaId: string, forzar = false) {
    if (!bodegaId || (!forzar && rollosParaApartar[bodegaId] && rollosParaApartar[bodegaId] !== "error")) return;
    setRollosParaApartar((actual) => ({ ...actual, [bodegaId]: "cargando" }));
    try {
      const datos = await api.get<Record<string, unknown>[]>(`/apartados/rollos-para-apartar?bodega_id=${bodegaId}`) || [];
      setRollosParaApartar((actual) => ({ ...actual, [bodegaId]: datos.map((r) => ({
        id: Number(r.id), identificadorRollo: String(r.identificador_rollo ?? ""), codigoInterno: String(r.codigo_interno ?? ""),
        descripcion: String(r.descripcion ?? ""), colorMaterial: String(r.color_material ?? ""), empresa: String(r.empresa ?? ""),
        pesoNeto: r.peso_neto == null ? null : Number(r.peso_neto), metrosDisponibles: Number(r.metros_disponibles ?? 0),
      })) }));
    } catch {
      setRollosParaApartar((actual) => ({ ...actual, [bodegaId]: "error" }));
    }
  }
  function seleccionarRolloCompleto(indice: number, rollo: RolloParaApartar | null, descripcion = "") {
    setFormulario((actual) => ({
      ...actual,
      items: actual.items.map((it, i) => (i === indice ? {
        ...it, rolloId: rollo?.id ?? null, rolloResumen: rollo?.identificadorRollo ?? "", busquedaRollo: "",
        codigoInterno: rollo?.codigoInterno ?? "", medida: rollo ? String(rollo.metrosDisponibles) : "", cantidad: "1",
        descripcion: rollo ? (it.descripcion.trim() ? it.descripcion : descripcion) : "",
      } : it)),
    }));
  }

  // La consulta de disponibilidad más reciente de cada línea. Si llega tarde
  // la respuesta de una anterior (ej. se cambió la empresa dos veces seguidas
  // con internet lento), se descarta: antes podía quedar en pantalla la
  // disponibilidad de la otra empresa. Va por posición y sube con la línea al
  // quitar una de arriba (ver quitarItemApartado).
  const consultasDisponibilidad = useRef<Record<number, object>>({});
  function iniciarConsultaDisponibilidad(indice: number) {
    const consulta = {};
    consultasDisponibilidad.current = { ...consultasDisponibilidad.current, [indice]: consulta };
    return consulta;
  }
  function posicionDeConsulta(consulta: object) {
    const encontrada = Object.entries(consultasDisponibilidad.current).find(([, c]) => c === consulta);
    return encontrada ? Number(encontrada[0]) : null;
  }

  // POR_ROLLO: disponibilidad por código de clasificación (comportamiento original).
  async function consultarDisponibilidadItem(indice: number, codigoInterno: string, bodegaElegida?: string, empresaElegida?: string) {
    const bodega = bodegaElegida ?? bodegaDeItem(indice);
    const codigo = codigoInterno.trim();
    const consulta = iniciarConsultaDisponibilidad(indice);
    if (!codigo) {
      setDisponibilidadItems((actual) => {
        const { [indice]: _quitado, ...resto } = actual;
        return resto;
      });
      return;
    }
    if (!bodega) {
      setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: false, sinBodega: true } }));
      return;
    }
    setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: true } }));
    try {
      // Solo lo de la empresa del material: el mismo código existe en Arquitejas y en Asia.
      const empresa = empresaElegida ?? empresaDeItem(indice);
      const datos = await api.get(`/apartados/disponibilidad?codigo_interno=${encodeURIComponent(codigo)}&bodega_id=${bodega}&empresa=${encodeURIComponent(empresa)}`);
      const posicion = posicionDeConsulta(consulta);
      if (posicion === null) return;
      setDisponibilidadItems((actual) => ({ ...actual, [posicion]: { cargando: false, datos: disponibilidadCodigoDesdeApi(datos as Record<string, unknown>) } }));
    } catch {
      const posicion = posicionDeConsulta(consulta);
      if (posicion === null) return;
      setDisponibilidadItems((actual) => ({ ...actual, [posicion]: { cargando: false, error: true } }));
    }
  }

  // POR_STOCK: disponibilidad de un Producto concreto ya seleccionado.
  async function consultarDisponibilidadProductoItem(indice: number, productoId: number, bodegaElegida?: string) {
    const consulta = iniciarConsultaDisponibilidad(indice);
    setDisponibilidadItems((actual) => ({ ...actual, [indice]: { cargando: true } }));
    try {
      const datos = await api.get(`/apartados/disponibilidad-producto?producto_id=${productoId}&bodega_id=${bodegaElegida ?? bodegaDeItem(indice)}`);
      const posicion = posicionDeConsulta(consulta);
      if (posicion === null) return;
      setDisponibilidadItems((actual) => ({ ...actual, [posicion]: { cargando: false, datos: disponibilidadProductoDesdeApi(datos as Record<string, unknown>) } }));
    } catch {
      const posicion = posicionDeConsulta(consulta);
      if (posicion === null) return;
      setDisponibilidadItems((actual) => ({ ...actual, [posicion]: { cargando: false, error: true } }));
    }
  }

  const [resultadosBusquedaProducto, setResultadosBusquedaProducto] = useState<Record<number, Record<string, unknown>[]>>({});

  // Busca productos por texto libre (código o descripción) para elegir uno
  // como línea POR_STOCK -- mismo endpoint que ya usa Inventario.
  // Búsqueda de productos: espera a que se deje de escribir y solo muestra la
  // respuesta de lo ÚLTIMO escrito en esa línea. Antes buscaba con cada letra
  // y la respuesta de "p" (casi todo) llegaba después que la de "perfil" y
  // reemplazaba la lista.
  const busquedaPendiente = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const ultimaBusqueda = useRef<Record<number, string>>({});

  function buscarProductoParaItem(indice: number, texto: string) {
    actualizarItemApartado(indice, "busquedaProducto", texto);
    const consulta = texto.trim();
    ultimaBusqueda.current[indice] = consulta;
    clearTimeout(busquedaPendiente.current[indice]);
    if (consulta.length < 2 || !bodegaDeItem(indice)) {
      setResultadosBusquedaProducto((actual) => {
        const { [indice]: _quitado, ...resto } = actual;
        return resto;
      });
      return;
    }
    busquedaPendiente.current[indice] = setTimeout(async () => {
      try {
        // Solo productos de la empresa del material (el mismo código existe en las dos).
        const datos = await api.get(`/apartados/productos?busqueda=${encodeURIComponent(consulta)}&bodega_id=${bodegaDeItem(indice)}`
          + `&empresa=${encodeURIComponent(empresaDeItem(indice))}`);
        if (ultimaBusqueda.current[indice] !== consulta) return; // ya escribió otra cosa
        setResultadosBusquedaProducto((actual) => ({ ...actual, [indice]: datos as Record<string, unknown>[] }));
      } catch {
        if (ultimaBusqueda.current[indice] === consulta) setResultadosBusquedaProducto((actual) => ({ ...actual, [indice]: [] }));
      }
    }, 300);
  }

  function seleccionarProductoParaItem(indice: number, productoApi: Record<string, unknown>) {
    clearTimeout(busquedaPendiente.current[indice]);
    ultimaBusqueda.current[indice] = "";
    const producto = productoDesdeApi(productoApi);
    setFormulario((actual) => ({
      ...actual,
      items: actual.items.map((item, i) => (i === indice ? {
        ...item, productoId: producto.id, productoCodigo: producto.codigo, productoDescripcion: producto.descripcion,
        busquedaProducto: "", hayFisico: false,
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
    if (!formulario.empresa) {
      setErrorFormularioApartado("Elige de qué empresa es la cotización: Arquitejas o Asia Business.");
      return;
    }
    if (formulario.items.some((_, indice) => !bodegaDeItem(indice))) {
      setErrorFormularioApartado("Elige de qué bodega sale cada producto.");
      return;
    }
    if (!formulario.numeroCotizacion.trim()) {
      setErrorFormularioApartado("Indica el número de cotización.");
      return;
    }
    if (formulario.items.length === 0 && !(editandoId && parteEditada.otrasPartes.length > 0)) {
      setErrorFormularioApartado("Agrega al menos un producto solicitado.");
      return;
    }
    for (const item of formulario.items) {
      if (!(Number(item.cantidad) > 0)) {
        setErrorFormularioApartado("Cada producto solicitado necesita una cantidad mayor a cero.");
        return;
      }
      if (item.modalidad === "rollo_completo") {
        if (!item.rolloId) {
          setErrorFormularioApartado("Elige el rollo de cada línea de rollo completo.");
          return;
        }
        continue;
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
      const enviar = editandoId ? (cuerpo: unknown) => api.put(`/apartados/${editandoId}`, cuerpo) : (cuerpo: unknown) => api.post("/apartados", cuerpo);
      await enviar({
        bodega_id: Number(bodegaDeItem(0) || formulario.bodegaId),
        material_en_camino: formulario.materialEnCamino,
        numero_cotizacion: formulario.numeroCotizacion.trim(),
        empresa: formulario.empresa,
        cliente: formulario.cliente.trim(),
        observaciones: formulario.observaciones,
        orden_interna: formulario.ordenInterna,
        ...(editandoId && otrasPartesIds.length ? { otras_partes_ids: otrasPartesIds } : {}),
        items: formulario.items.map((i) => {
          // Cada línea dice de qué bodega y de qué empresa sale: el backend
          // guarda una parte por (bodega, empresa) con el mismo número.
          const bodega_id = Number(i.bodegaId || formulario.bodegaId);
          const empresa = i.empresa || formulario.empresa;
          if (i.modalidad === "rollo_completo") {
            return { id: i.id, bodega_id, empresa, modalidad: "por_rollo", rollo_id: i.rolloId, descripcion: i.descripcion, cantidad: 1,
              codigo_interno: i.codigoInterno || undefined, medida: Number(i.medida) || undefined };
          }
          return i.modalidad === "por_stock"
            // "Cortar a (m)" es opcional en una línea de stock (ej. teja UPVC de 11,80 cortada a 7).
            ? { id: i.id, bodega_id, empresa, modalidad: "por_stock", producto_id: i.productoId, descripcion: i.descripcion, cantidad: Number(i.cantidad),
                hay_fisico: Boolean(i.hayFisico),
                medida: Number(String(i.medida).replace(",", ".")) > 0 ? Number(String(i.medida).replace(",", ".")) : undefined }
            : { id: i.id, bodega_id, empresa, modalidad: "por_rollo", codigo_interno: i.codigoInterno, descripcion: i.descripcion, cantidad: Number(i.cantidad), medida: Number(i.medida),
                tipo_producto: i.tipoProducto || "",
                ...(i.tipoProducto === "lamina_lisa" ? {
                  convertir_en: i.convertirEn || "caballete",
                  bodega_conversion_id: i.bodegaConversionId ? Number(i.bodegaConversionId) : null,
                } : {}) };
        }),
      });
      await cargarApartados();
      setMostrarFormularioApartado(false);
      setEditandoId(null);
      setOtrasPartesIds([]);
    } catch (err) {
      setErrorFormularioApartado(err instanceof ErrorApi ? err.message : editandoId ? "No se pudieron guardar los cambios." : "No se pudo crear el apartado.");
    } finally {
      setGuardandoApartado(false);
    }
  }

  const [errorAccionApartado, setErrorAccionApartado] = useState("");

  // Línea de stock descontada que no salió (ej. del Excel sin stock): vuelve
  // a la bodega y queda libre para cambiarla en el formulario.
  async function devolverLineaABodega(indice: number) {
    const id = formulario.items[indice]?.id;
    if (!id) return;
    setErrorFormularioApartado("");
    try {
      await api.post(`/apartados/items/${id}/devolver-a-bodega`, {});
      setFormulario((actual) => ({
        ...actual,
        items: actual.items.map((it) => (it.id === id ? { ...it, stockDescontado: false, hayFisico: false, hayFisicoOriginal: false } : it)),
      }));
      await cargarApartados();
    } catch (err) {
      setErrorFormularioApartado(err instanceof ErrorApi ? err.message : "No se pudo devolver la línea a la bodega.");
    }
  }

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

  // Cotización de varias bodegas: la misma acción en todas sus partes.
  async function enVarios(ids: number[], ruta: (id: number) => Promise<unknown>, error: string) {
    setErrorAccionApartado("");
    try {
      for (const id of ids) await ruta(id);
    } catch (err) {
      setErrorAccionApartado(err instanceof ErrorApi ? err.message : error);
    } finally {
      await cargarApartados();
    }
  }
  const cancelarVarios = (ids: number[]) =>
    enVarios(ids, (id) => api.patch(`/apartados/${id}/cancelar`), "No se pudo cancelar la cotización.");
  const enviarVariosAProduccion = (ids: number[]) =>
    enVarios(ids, (id) => api.patch(`/apartados/${id}/enviar-a-produccion`), "No se pudo enviar la cotización a producción.");
  const eliminarVarios = (ids: number[]) =>
    enVarios(ids, (id) => api.delete(`/apartados/${id}`), "No se pudo eliminar la cotización.");

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
      setErrorAccionApartado(err instanceof ErrorApi ? err.message : "No se pudo registrar la salida.");
    }
  }

  return {
    puedeCrearApartados, puedeCrearOrdenInterna, puedeEditarApartados, puedeCancelarApartados, puedeEnviarAProduccion, puedeMarcarTerminado, puedeMarcarEntregado,
    apartados, cargandoApartados, errorApartados, cargarApartados,
    filtroEstado, setFiltroEstado,

    formulario, mostrarFormularioApartado, abrirFormularioApartado, cerrarFormularioApartado,
    editandoId, abrirEdicionApartado, parteEditada, otrasPartesIds,
    actualizarCampoApartado, cambiarBodegaItem, cambiarEmpresaItem, marcarMaterialEnCamino, agregarItemApartado, quitarItemApartado, actualizarItemApartado,
    cambiarModalidadItem, rollosParaApartar, cargarRollosParaApartar, seleccionarRolloCompleto,
    guardandoApartado, errorFormularioApartado, crearApartado,
    disponibilidadItems, consultarDisponibilidadItem,
    resultadosBusquedaProducto, buscarProductoParaItem, seleccionarProductoParaItem,

    errorAccionApartado, cancelarApartado, eliminarApartado, enviarApartadoAProduccion, devolverLineaABodega,
    cancelarVarios, enviarVariosAProduccion, eliminarVarios,
    marcarApartadoProduccionTerminada, marcarApartadoEntregado,
  };
}
