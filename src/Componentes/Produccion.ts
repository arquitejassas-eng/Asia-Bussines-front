// @ts-nocheck -- contrato API pendiente de centralizar en src/types.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ErrorApi } from "./Api";
import { apartadoDesdeApi, produccionDesdeApi, rolloDesdeApi } from "./Mapeo";
import {
  calcularSolicitudesPendientes, calcularStockParaAlistar, cotizacionesParaPlanta, NOMBRE_POR_TIPO_PRODUCTO, SECCIONES_POR_TIPO_PRODUCTO,
} from "../Utils/produccion";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";
import { coincideKilos, kilosBuscados } from "../Utils/kilos";
import { modeloEnDescripcion } from "../Utils/teja";

// Refresco automático de solicitudes pendientes / historial de producción.
// Más espaciado que el resto de pantallas (10 s): el historial completo de
// producción es la consulta más pesada de la app.
const SEGUNDOS_POLLING_PRODUCCION = 20;

const ESTADOS_SOLICITUD_PENDIENTE = ["enviado_a_produccion", "en_produccion"];

function normalizarTexto(texto: unknown) {
  return (texto ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function redondear(numero: number, decimales = 2) {
  const factor = 10 ** decimales;
  return Math.round(numero * factor) / factor;
}

// Ajusta metros de los rollos `candidatos` (ya ordenados, normalmente del más
// antiguo al más nuevo) hasta que la selección sume exactamente
// `objetivoMetros` — sube completando la capacidad libre de los rollos ya
// elegidos primero (y solo si no alcanza, toma rollos nuevos), y baja
// quitando primero de los rollos elegidos más recientemente (orden inverso),
// nunca de los que ya estaban ahí desde antes de que este cálculo empezara a
// intervenir. Se reutiliza tanto para el auto-llenado inicial al elegir un
// apartado como para el recálculo cuando cambia el stock adicional — subir O
// bajar, según si el objetivo creció o se corrigió hacia abajo — así el
// aviso de "no alcanza el material" en validar() solo aparece cuando de
// verdad no hay más metros físicos disponibles de ese código.
function calcularAsignacionRollos(objetivoMetros, candidatos, seleccionBase) {
  const nuevaSeleccion = { ...seleccionBase };
  const yaAsignado = candidatos.reduce((suma, rollo) => {
    const actual = nuevaSeleccion[rollo.id];
    return suma + (actual?.seleccionado ? Number(actual.metrosTexto) || 0 : 0);
  }, 0);
  const restante = redondear(objetivoMetros - yaAsignado);

  if (restante > 0) {
    let faltante = restante;
    for (const rollo of candidatos) {
      if (faltante <= 0) break;
      const actual = nuevaSeleccion[rollo.id];
      const metrosYaEnEste = actual?.seleccionado ? Number(actual.metrosTexto) || 0 : 0;
      const capacidadLibre = redondear(rollo.metrosDisponibles - metrosYaEnEste);
      if (capacidadLibre <= 0) continue;
      const aAgregar = redondear(Math.min(faltante, capacidadLibre));
      nuevaSeleccion[rollo.id] = { seleccionado: true, metrosTexto: String(redondear(metrosYaEnEste + aAgregar)) };
      faltante = redondear(faltante - aAgregar);
    }
    return { seleccion: nuevaSeleccion, restanteSinCubrir: Math.max(0, faltante) };
  }

  if (restante < 0) {
    let exceso = -restante;
    for (let i = candidatos.length - 1; i >= 0 && exceso > 0; i--) {
      const rollo = candidatos[i];
      const actual = nuevaSeleccion[rollo.id];
      if (!actual?.seleccionado) continue;
      const metrosActuales = Number(actual.metrosTexto) || 0;
      const aQuitar = redondear(Math.min(exceso, metrosActuales));
      const nuevoValor = redondear(metrosActuales - aQuitar);
      if (nuevoValor <= 0) delete nuevaSeleccion[rollo.id];
      else nuevaSeleccion[rollo.id] = { seleccionado: true, metrosTexto: String(nuevoValor) };
      exceso = redondear(exceso - aQuitar);
    }
  }

  return { seleccion: nuevaSeleccion, restanteSinCubrir: 0 };
}

type Sesion = { bodegaId?: number; rol?: string } | null | undefined;
type Rollo = { id: number; codigoInterno: string; estado: string; identificadorRollo: string; metrosDisponibles: number; fechaIngreso: string };

export function useControladorProduccion(sesion: Sesion, _almacen: unknown) {
  const _bodegaId = sesion?.bodegaId;
  const puedeRegistrarProduccion = sesion?.rol === "jefe_planta";

  const [productoFabricado, setProductoFabricado] = useState("");
  const [modelo, setModelo] = useState("");
  const [medidaProducto, setMedidaProducto] = useState("");
  const [cantidadProductos, setCantidadProductos] = useState("");
  const [responsable, setResponsable] = useState("");

  // "teja" (default, todo el comportamiento de siempre) o un producto
  // "seccionado" ("caballete", "flanche"): se corta distinto — el ancho del
  // rollo se divide siempre en N partes según el tipo (ver
  // SECCIONES_POR_TIPO_PRODUCTO en Utils/produccion.ts), así que cada corte
  // a lo largo del rollo produce SIEMPRE esas N unidades, sin importar
  // cuántas se necesiten. Ver infoCorte más abajo.
  const [tipoProducto, setTipoProducto] = useState("teja");

  // ---------- Stock adicional: unidades que quedan disponibles más allá de
  // lo que el apartado necesitaba (o, en producción libre, unidades que se
  // quieren dejar clasificadas en inventario). No bloquea la producción —
  // el backend nunca deja el reservado del apartado en negativo. ----------
  const [color, setColor] = useState("");
  const [ral, setRal] = useState("");
  const [calibreLote, setCalibreLote] = useState("");
  const [metrosPorUnidad, setMetrosPorUnidad] = useState("");
  const [stockAdicional, setStockAdicional] = useState([]);

  // Producción solo para dejar stock (tejas, sin cotización vinculada).
  function esSoloStock() {
    return !SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && !apartadoItemId && stockAdicional.length > 0;
  }
  function unidadesDelStock() {
    return stockAdicional.reduce((suma, linea) => suma + (Number(linea.cantidad) || 0), 0);
  }
  // Ej. "6 m / 3 m" (sin repetir medidas).
  function medidasDelStock() {
    const medidas = [...new Set(stockAdicional.map((linea) => Number(linea.metros)).filter((m) => m > 0))];
    return medidas.map((m) => `${String(m).replace(".", ",")} m`).join(" / ");
  }

  function agregarLineaStock() {
    // Tejas: cada línea con su medida; la nueva arranca con la de la línea anterior.
    setStockAdicional((actual) => [...actual, {
      calidad: "primera", cantidad: "1", motivoSegunda: "",
      metros: actual.length ? actual[actual.length - 1].metros || "" : (metrosPorUnidad || String(parseFloat(String(medidaProducto).replace(",", ".")) || "")),
      rolloId: actual.length ? actual[actual.length - 1].rolloId || "" : "",
    }]);
  }
  function quitarLineaStock(indice) {
    setStockAdicional((actual) => actual.filter((_, i) => i !== indice));
  }
  function actualizarLineaStock(indice, campo, valor) {
    setStockAdicional((actual) => actual.map((linea, i) => (i === indice ? { ...linea, [campo]: valor } : linea)));
  }

  const [codigoBusqueda, setCodigoBusqueda] = useState("");
  // Empresa de los rollos a mostrar ("" = todas). Al iniciar la producción
  // de una cotización se pone sola en la empresa de esa cotización.
  const [empresaFiltro, setEmpresaFiltro] = useState("");
  const [rollosDeMiBodega, setRollosDeMiBodega] = useState<Rollo[]>([]);

  // Rollos y solicitudes solo los necesita quien registra producción; Hoja
  // de Vida (que comparte este hook) no los usa.
  useEffect(() => {
    if (!puedeRegistrarProduccion) return;
    (async () => {
      try {
        const datos = await api.get("/rollos");
        setRollosDeMiBodega(datos.map(rolloDesdeApi));
      } catch {
        setRollosDeMiBodega([]);
      }
    })();
  }, [puedeRegistrarProduccion]);

  const [apartadosPendientes, setApartadosPendientes] = useState([]);
  const [apartadoItemId, setApartadoItemId] = useState(null);
  // Otras líneas de la misma cotización y el mismo código (color + espesor)
  // que salen en esta misma producción (solo cambia la medida de la teja).
  const [itemsJuntos, setItemsJuntos] = useState<number[]>([]);
  // Con varias líneas: cantidad y medida de CADA una ({itemId: {...}}).
  const [medidasPorLinea, setMedidasPorLinea] = useState<Record<number, { cantidad: string; medida: string }>>({});

  // `silenciosa` (actualización automática): si falla, conserva la lista que
  // ya estaba -- vaciarla hacía desaparecer el panel de solicitudes y movía
  // los metros seleccionados mientras Planta llenaba el formulario.
  const cargarSolicitudesPendientes = useCallback(async (silenciosa = false) => {
    try {
      const datos = await api.get(`/apartados?${ESTADOS_SOLICITUD_PENDIENTE.map((e) => `estados=${e}`).join("&")}`);
      const apartados = datos.map(apartadoDesdeApi).filter((ap) => ESTADOS_SOLICITUD_PENDIENTE.includes(ap.estado));
      setApartadosPendientes(apartados);
    } catch {
      if (!silenciosa) setApartadosPendientes([]);
    }
  }, []);

  useEffect(() => {
    if (puedeRegistrarProduccion) cargarSolicitudesPendientes();
  }, [puedeRegistrarProduccion, cargarSolicitudesPendientes]);

  const solicitudesPendientesSinOrdenar = useMemo(
    () => calcularSolicitudesPendientes(apartadosPendientes),
    [apartadosPendientes]
  );
  // Productos de stock que Planta alista con el pedido (y corta si lo dice).
  const stockParaAlistar = useMemo(() => calcularStockParaAlistar(apartadosPendientes), [apartadosPendientes]);
  const cotizacionesConTrabajo = useMemo(() => cotizacionesParaPlanta(apartadosPendientes).size, [apartadosPendientes]);

  // La cotización que llega por querystring (botón "Iniciar Producción" de
  // Apartados) se muestra primero en la lista, para que quien registra la
  // producción no tenga que buscarla entre las demás solicitudes.
  const [searchParams] = useSearchParams();
  const cotizacionResaltada = searchParams.get("cotizacion") || "";

  const solicitudesPendientes = useMemo(() => {
    if (!cotizacionResaltada) return solicitudesPendientesSinOrdenar;
    return [...solicitudesPendientesSinOrdenar].sort((a, b) => {
      const aCoincide = a.numeroCotizacion === cotizacionResaltada;
      const bCoincide = b.numeroCotizacion === cotizacionResaltada;
      return aCoincide === bCoincide ? 0 : aCoincide ? -1 : 1;
    });
  }, [solicitudesPendientesSinOrdenar, cotizacionResaltada]);

  // Regla física de los productos "seccionados" (caballete, flanche): el
  // ancho del rollo se divide siempre en N partes iguales según el tipo
  // (ver SECCIONES_POR_TIPO_PRODUCTO en Utils/produccion.ts — mismo mapa
  // que usa el backend), así que cada corte a lo largo del rollo (de
  // `longitud` metros) produce SIEMPRE esas N unidades — sin importar
  // cuántas se necesiten. Una necesidad que no es múltiplo de N igual
  // exige el corte completo; lo que sobra nunca se pierde, se declara como
  // stock. Si además está ligada a un apartado y se fabrican más unidades
  // de las que ese apartado todavía necesitaba (sección 11: eso NO se
  // bloquea), esas también se suman al sobrante — igual que valida el
  // backend.
  const infoCorte = useMemo(() => {
    const secciones = SECCIONES_POR_TIPO_PRODUCTO[tipoProducto];
    if (!secciones) return null;
    const necesidad = Number(cantidadProductos) || 0;
    const longitud = Number(metrosPorUnidad) || 0;
    if (necesidad <= 0 || longitud <= 0) return null;
    const cortes = Math.ceil(necesidad / secciones);
    const producidoFisico = cortes * secciones;

    const solicitud = apartadoItemId ? solicitudesPendientes.find((s) => s.itemId === apartadoItemId) : null;
    let unidadesExcedentesApartado = 0;
    if (solicitud) {
      const pendienteUnidades = Math.round(solicitud.metrosPendientes / longitud);
      const unidadesHaciaApartado = Math.min(necesidad, Math.max(0, pendienteUnidades));
      unidadesExcedentesApartado = necesidad - unidadesHaciaApartado;
    }

    return {
      secciones,
      cortes,
      producidoFisico,
      metrosNecesarios: redondear(cortes * longitud),
      sobrante: producidoFisico - necesidad + unidadesExcedentesApartado,
    };
  }, [tipoProducto, cantidadProductos, metrosPorUnidad, apartadoItemId, solicitudesPendientes]);

  // Para caballetes/flanches, "Medida del producto" y "Longitud (m)" son el
  // mismo dato real (ej. "caballete de 6 m") — no tiene sentido que el
  // usuario lo escriba dos veces en dos campos que nada sincroniza. La
  // longitud numérica es la fuente real (alimenta el cálculo de cortes);
  // esto solo mantiene medidaProducto (el texto que ya guardan Hoja de Vida
  // y el historial) al día automáticamente, sin pedirle nada extra.
  useEffect(() => {
    if (!SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]) return;
    setMedidaProducto(metrosPorUnidad ? `${metrosPorUnidad} m` : "");
  }, [tipoProducto, metrosPorUnidad]);

  const [advertenciaSeleccion, setAdvertenciaSeleccion] = useState("");

  // Las líneas elegidas para esta producción: la principal y las que van junto.
  const solicitudesElegidas = useMemo(
    () => [apartadoItemId, ...itemsJuntos].map((id) => solicitudesPendientes.find((s) => s.itemId === id)).filter(Boolean),
    [apartadoItemId, itemsJuntos, solicitudesPendientes],
  );

  // Se puede sumar a esta producción una línea de la misma cotización y del
  // mismo código de clasificación (mismo color y espesor). Solo tejas.
  function puedeProducirJunto(solicitud) {
    const principal = solicitudesElegidas[0];
    return Boolean(principal) && !SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && solicitud.itemId !== principal.itemId
      && solicitud.apartadoId === principal.apartadoId && solicitud.codigoInterno === principal.codigoInterno
      && modeloEnDescripcion(solicitud.descripcion) === modeloEnDescripcion(principal.descripcion);
  }

  // Cantidad y medida que trae una línea de la cotización, si viene en
  // unidades (las importadas vienen en metros: cantidad = metros, medida = 1).
  function cantidadYMedidaDe(solicitud) {
    const enUnidades = solicitud.medida != null && solicitud.medida !== 1 && Number.isInteger(solicitud.cantidad);
    return enUnidades ? { cantidad: String(solicitud.cantidad), medida: String(solicitud.medida) } : { cantidad: "", medida: "" };
  }

  // Varias líneas: cada una con su cantidad y su medida (se pueden corregir).
  function llenarDatosDeLineas(lineas) {
    // Máximo 150 letras (lo que guarda la base): con varias líneas largas se recorta.
    setProductoFabricado(lineas.map((s) => s.descripcion || s.codigoInterno).join(" + ").slice(0, 150));
    setMedidasPorLinea((actual) => Object.fromEntries(lineas.map((s) => [s.itemId, actual[s.itemId] || cantidadYMedidaDe(s)])));
    if (lineas.length === 1) {
      const { cantidad, medida } = cantidadYMedidaDe(lineas[0]);
      setMedidaProducto(medida); setCantidadProductos(cantidad);
    }
  }

  // Las líneas de esta producción con su cantidad, medida y metros (solo si son varias).
  const lineasProduccion = useMemo(() => (solicitudesElegidas.length > 1 ? solicitudesElegidas.map((s) => {
    const { cantidad = "", medida = "" } = medidasPorLinea[s.itemId] || {};
    const metros = redondear((Number(cantidad) || 0) * (Number(String(medida).replace(",", ".")) || 0));
    return { itemId: s.itemId, descripcion: s.descripcion || s.codigoInterno, metrosPendientes: s.metrosPendientes, cantidad, medida, metros };
  }) : []), [solicitudesElegidas, medidasPorLinea]);

  function actualizarLineaProduccion(itemId, campo, valor) {
    setMedidasPorLinea((actual) => ({ ...actual, [itemId]: { ...(actual[itemId] || { cantidad: "", medida: "" }), [campo]: valor } }));
  }

  // Con varias líneas, "Medida" y "Cantidad" de arriba salen de ellas
  // ("5,1 m / 4,9 m" y la suma de unidades): así quedan en el historial.
  useEffect(() => {
    if (lineasProduccion.length < 2) return;
    const medidas = [...new Set(lineasProduccion.map((l) => String(l.medida).replace(".", ",")).filter(Boolean))];
    setMedidaProducto(medidas.map((m) => `${m} m`).join(" / "));
    const unidades = lineasProduccion.reduce((suma, l) => suma + (Number(l.cantidad) || 0), 0);
    setCantidadProductos(unidades ? String(unidades) : "");
  }, [lineasProduccion]);

  function alternarProducirJunto(solicitud) {
    const nuevos = itemsJuntos.includes(solicitud.itemId)
      ? itemsJuntos.filter((id) => id !== solicitud.itemId)
      : [...itemsJuntos, solicitud.itemId];
    setItemsJuntos(nuevos);
    llenarDatosDeLineas([apartadoItemId, ...nuevos].map((id) => solicitudesPendientes.find((s) => s.itemId === id)).filter(Boolean));
    setSeleccion({}); // el total cambió: los metros del rollo se vuelven a elegir.
  }

  function seleccionarSolicitud(solicitud) {
    gestionandoStockRef.current = false; // arranca en blanco para esta nueva solicitud.
    setApartadoItemId(solicitud.itemId);
    setItemsJuntos([]);
    setMedidasPorLinea({});
    setProductoFabricado((solicitud.descripcion || solicitud.codigoInterno).slice(0, 150));
    // El modelo sale solo de la línea ("...ARQUITECTONICA..." -> ARQUITECTONICA).
    const modeloDeLinea = modeloEnDescripcion(solicitud.descripcion);
    if (modeloDeLinea) setModelo(modeloDeLinea);
    // Las cotizaciones importadas guardan la línea en METROS (cantidad =
    // metros de "SALE", medida = 1 -- ver importar_cotizaciones.py): copiar
    // esa cantidad la volvía "83.7 tejas" y el backend la rechazaba. Solo se
    // precarga cuando la solicitud trae unidades enteras con su medida real;
    // si no, Planta escribe medida y unidades (ver ayudaCantidad).
    const enUnidades = solicitud.medida != null && solicitud.medida !== 1 && Number.isInteger(solicitud.cantidad);
    setMedidaProducto(enUnidades ? String(solicitud.medida) : "");
    setCantidadProductos(enUnidades ? String(solicitud.cantidad) : "");
    setCodigoBusqueda(solicitud.codigoInterno); // llena la tabla de "rollos disponibles" con este código.
    setEmpresaFiltro(solicitud.empresa || ""); // y solo los rollos de la empresa de la cotización.

    // El rollo físico lo elige Planta a mano en la tabla de abajo (checkbox +
    // metros por fila) -- ya no se preselecciona por antigüedad (FIFO): en la
    // práctica se usa el rollo que está a la mano, no el más viejo.
    setSeleccion({});
    setAdvertenciaSeleccion("");
  }

  function limpiarSolicitud() {
    gestionandoStockRef.current = false;
    setApartadoItemId(null);
    setItemsJuntos([]);
    setMedidasPorLinea({});
    setCodigoBusqueda("");
    setEmpresaFiltro("");
    setSeleccion({});
    setAdvertenciaSeleccion("");
  }

  const [errorSolicitudPendiente, setErrorSolicitudPendiente] = useState("");

  async function marcarProduccionTerminada(apartadoId) {
    setErrorSolicitudPendiente("");
    try {
      await api.patch(`/apartados/${apartadoId}/marcar-terminado`);
      await cargarSolicitudesPendientes();
    } catch (err) {
      setErrorSolicitudPendiente(
        err instanceof ErrorApi ? err.message : "No se pudo marcar la producción como terminada."
      );
    }
  }

  const rollosDisponibles = useMemo(() => {
    const termino = normalizarTexto(codigoBusqueda);
    if (!termino) return [];
    // También por los kilos de la etiqueta del rollo (peso neto): "4466",
    // "4.466" o "4466 kg" encuentran el rollo de 4466 kg (ver Utils/kilos).
    const kilos = kilosBuscados(termino);
    return rollosDeMiBodega.filter(
      (r) =>
        r.metrosDisponibles > 0 &&
        (!empresaFiltro || r.empresa === empresaFiltro) &&
        (normalizarTexto(r.codigoInterno).includes(termino) ||
          normalizarTexto(r.identificadorRollo).includes(termino) ||
          coincideKilos(r.pesoNeto, kilos))
    );
  }, [rollosDeMiBodega, codigoBusqueda, empresaFiltro]);

  const [seleccion, setSeleccion] = useState({});

  // Orden en que Planta escogió los rollos: la cotización sale del primero
  // (y si no le alcanza, del siguiente).
  const ordenRollosRef = useRef<number[]>([]);

  function alternarSeleccionRollo(rollo: Rollo) {
    ordenRollosRef.current = ordenRollosRef.current.filter((id) => id !== rollo.id);
    if (!seleccion[rollo.id]?.seleccionado) ordenRollosRef.current.push(rollo.id);
    setSeleccion((actual) => {
      const actualDeEste = actual[rollo.id];
      if (actualDeEste?.seleccionado) {
        const { [rollo.id]: _quitado, ...resto } = actual;
        return resto;
      }
      // Planta elige el rollo, pero los metros a sacarle se siguen sugiriendo
      // solos -- lo que falte para cubrir el objetivo, sin pasarse de lo
      // disponible en este rollo. Caballetes/Flanches: el objetivo es el total
      // EXACTO que exige el corte físico (infoCorte.metrosNecesarios) -- esa
      // exigencia no cambia, solo quién elige de cuál rollo sale (la sigue
      // garantizando validar()/el backend, no esta función). Teja: el objetivo
      // es lo pendiente del apartado. Si no aplica ninguno (producción libre de
      // teja, o seccionado sin cantidad/medida aún), queda en 0 para escribirlo
      // a mano, igual que siempre.
      if (SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]) {
        if (infoCorte) {
          return calcularAsignacionRollos(infoCorte.metrosNecesarios, [rollo], actual).seleccion;
        }
      } else {
        if (solicitudesElegidas.length) {
          // Solo lo que todavía falta (cotización + stock) después de los
          // rollos ya escogidos: el segundo rollo no repite la cotización.
          const enOtros = Object.values(actual).reduce(
            (suma, s) => suma + (s?.seleccionado ? Number(s.metrosTexto) || 0 : 0), 0);
          const falta = redondear(Math.max(0, metrosParaCotizacion + metrosDelStock - enOtros));
          if (falta <= 0) return { ...actual, [rollo.id]: { seleccionado: true, metrosTexto: "" } };
          return calcularAsignacionRollos(falta, [rollo], { ...actual, [rollo.id]: undefined }).seleccion;
        }
      }
      return { ...actual, [rollo.id]: { seleccionado: true, metrosTexto: "" } };
    });
  }

  function actualizarMetrosRollo(idRollo: number, valor: string) {
    setSeleccion((actual) => ({
      ...actual,
      [idRollo]: { ...actual[idRollo], metrosTexto: valor },
    }));
  }

  const rollosSeleccionados = useMemo(() => {
    return rollosDisponibles
      .filter((r) => seleccion[r.id]?.seleccionado)
      .map((r) => ({ rollo: r, metrosTexto: seleccion[r.id]?.metrosTexto ?? "" }));
  }, [rollosDisponibles, seleccion]);

  const totalMetrosAConsumir = useMemo(() => {
    return redondear(
      rollosSeleccionados.reduce((suma, item) => suma + (Number(item.metrosTexto) || 0), 0)
    );
  }, [rollosSeleccionados]);

  // Cada vez que cambia el stock adicional (o los metros por unidad), se
  // vuelven a calcular solos los metros que hacen falta del rollo — nunca
  // hay que recalcularlos a mano. Sube O baja según haga falta (si el
  // usuario se equivoca y corrige una cantidad hacia abajo, o borra la
  // última línea, los metros seleccionados del rollo también bajan) — así
  // el aviso de "no alcanza el material" en validar() solo aparece cuando
  // de verdad no hay más metros físicos de ese código disponibles.
  //
  // gestionandoStockRef evita tocar una selección puramente manual (sin
  // stock declarado nunca): solo empieza a intervenir cuando aparece la
  // primera línea de stock con metros por unidad válidos, y suelta el
  // control cuando el stock vuelve a quedar en 0 (línea corregida o
  // borrada), pero antes hace un último ajuste al pendiente del apartado.
  const gestionandoStockRef = useRef(false);

  // Lo que piden todas las líneas elegidas (la principal y las que van junto).
  const pendienteSolicitudElegida = useMemo(
    () => redondear(solicitudesElegidas.reduce((suma, s) => suma + s.metrosPendientes, 0)),
    [solicitudesElegidas],
  );

  // Metros producidos PARA la cotización, por línea: cantidad x medida (con
  // varias líneas, los de cada una). La cotización solo se lleva eso (nunca
  // más de lo que le falta); el resto de los metros de los rollos queda para
  // el stock adicional. Sin medida o cantidad, toda la línea, como antes.
  const metrosParaCotizacionPorLinea = useMemo(() => {
    if (SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] || !apartadoItemId) return {};
    if (lineasProduccion.length > 1) return Object.fromEntries(lineasProduccion.map((l) => [l.itemId, l.metros]));
    const medida = parseFloat(String(medidaProducto).replace(",", "."));
    const unidades = Number(cantidadProductos);
    return medida > 0 && unidades > 0 ? { [apartadoItemId]: redondear(medida * unidades) } : {};
  }, [tipoProducto, apartadoItemId, lineasProduccion, medidaProducto, cantidadProductos]);

  const metrosParaCotizacion = useMemo(() => redondear(solicitudesElegidas.reduce(
    (suma, s) => suma + Math.min(s.metrosPendientes, metrosParaCotizacionPorLinea[s.itemId] ?? s.metrosPendientes), 0)),
  [solicitudesElegidas, metrosParaCotizacionPorLinea]);

  // Teja ligada a una solicitud: la solicitud se mide en metros y la cantidad
  // del formulario en unidades -- muestra la cuenta para que nadie escriba
  // los metros en "Cantidad de productos obtenidos".
  const ayudaCantidad = useMemo(() => {
    if (!apartadoItemId || SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] || !(pendienteSolicitudElegida > 0)) return "";
    const formato = (n) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
    const pide = `${solicitudesElegidas.length > 1 ? `Estas ${solicitudesElegidas.length} líneas piden` : "Esta solicitud pide"} ${formato(pendienteSolicitudElegida)} m`;
    const medida = parseFloat(String(medidaProducto).replace(",", "."));
    if (solicitudesElegidas.length > 1) return `${pide} en total. La cantidad es la suma de las unidades de todas.`;
    if (!(medida > 0)) return `${pide}. Escribe la medida de cada unidad y aquí verás cuántas salen.`;
    const unidades = pendienteSolicitudElegida / medida;
    if (Math.abs(unidades - Math.round(unidades)) < 0.01) {
      return `${pide}: con unidades de ${formato(medida)} m son ${Math.round(unidades)}.`;
    }
    return `${pide}: con unidades de ${formato(medida)} m son ${formato(unidades)} (no da exacto — escribe las unidades que realmente salieron).`;
  }, [apartadoItemId, tipoProducto, pendienteSolicitudElegida, medidaProducto, solicitudesElegidas.length]);

  // Los metros del stock (cantidad x medida de cada línea): solo eso mueve
  // los metros de los rollos; escoger "Salió del rollo" o la calidad no.
  const metrosDelStock = redondear(stockAdicional.reduce(
    (suma, linea) => suma + (Number(linea.cantidad) || 0) * (Number(linea.metros) || 0), 0));
  // Cambia solo con los metros de cada línea y su rollo (no con la calidad).
  const firmaStock = stockAdicional.map((linea) => `${linea.cantidad}x${linea.metros}@${linea.rolloId || ""}`).join("|");

  useEffect(() => {
    // Caballetes/Flanches: el rollo lo elige Planta a mano (ver
    // alternarSeleccionRollo) -- el total EXACTO que exige el corte físico lo
    // sigue garantizando validar()/el backend, no este efecto. Igual que Teja,
    // aquí ya no se auto-asigna nada por FIFO.
    if (SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]) return;

    const metrosNecesariosStock = metrosDelStock;

    if (metrosNecesariosStock > 0) {
      gestionandoStockRef.current = true;
    } else if (!gestionandoStockRef.current) {
      return; // nunca hubo stock declarado: no tocar una selección manual.
    } else {
      gestionandoStockRef.current = false; // último ajuste: soltar el control.
    }

    // Reparte los metros SOLO entre los rollos que Planta escogió (nunca
    // escoge uno por su cuenta ni desmarca uno escogido):
    // - el stock, en el rollo de "Salió del rollo" (o en el único escogido);
    // - la cotización, en el orden en que se escogieron los rollos, sin
    //   pasarse de lo que tiene cada uno.
    // Un rollo al que no le toca nada conserva lo que se escribió a mano.
    setSeleccion((actual) => {
      const ordenados = [
        ...ordenRollosRef.current.filter((id) => actual[id]?.seleccionado),
        ...Object.keys(actual).map(Number).filter((id) => actual[id]?.seleccionado && !ordenRollosRef.current.includes(id)),
      ].map((id) => rollosDisponibles.find((r) => r.id === id)).filter(Boolean);
      if (ordenados.length === 0) return actual;
      const stockPorRollo: Record<number, number> = {};
      for (const linea of stockAdicional) {
        const id = ordenados.length === 1 ? ordenados[0].id : Number(linea.rolloId) || ordenados[0].id;
        stockPorRollo[id] = (stockPorRollo[id] || 0) + (Number(linea.cantidad) || 0) * (Number(linea.metros) || 0);
      }
      const nueva = { ...actual };
      let falta = metrosParaCotizacion;
      for (const rollo of ordenados) {
        const delStock = redondear(stockPorRollo[rollo.id] || 0);
        const parte = redondear(Math.max(0, Math.min(falta, rollo.metrosDisponibles - delStock)));
        falta = redondear(falta - parte);
        const total = redondear(parte + delStock);
        if (total > 0) nueva[rollo.id] = { seleccionado: true, metrosTexto: String(total) };
      }
      return nueva;
    });
    // Depende del NÚMERO pendiente de la solicitud elegida, no de la lista de
    // solicitudes: la actualización automática crea una lista nueva en cada
    // recarga aunque nada cambie, y eso recalculaba la asignación y deshacía
    // los metros que Planta había ajustado a mano. Solo si el pendiente cambia
    // de verdad (ej. otro registro para el mismo apartado) se recalcula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoProducto, firmaStock, metrosPorUnidad, apartadoItemId, rollosDisponibles, metrosParaCotizacion]);

  // Siembra la línea de stock adicional con el sobrante calculado (5
  // unidades pedidas -> corte de 6 -> 1 de sobrante), pero solo si el
  // usuario todavía no tocó nada — nunca pisa una clasificación ya hecha
  // (por ejemplo, si ya la partió en Primera + Segunda con su motivo).
  useEffect(() => {
    if (!SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]) return;
    if (!infoCorte || infoCorte.sobrante <= 0) return;
    if (stockAdicional.length > 0) return;
    setStockAdicional([{ calidad: "primera", cantidad: String(infoCorte.sobrante), motivoSegunda: "" }]);
  }, [tipoProducto, infoCorte, stockAdicional.length]);

  const [errorValidacion, setErrorValidacion] = useState("");
  // Apartado pendiente de que se confirme la separación de stock antes de
  // continuar con enviarProduccion() -- null = sin diálogo abierto. Sustituye
  // al window.confirm() síncrono: el modal de React no puede bloquear la
  // ejecución, así que el flujo se retoma en confirmarSeparacionYRegistrar().
  const [confirmacionStockPendiente, setConfirmacionStockPendiente] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [produccionConfirmada, setProduccionConfirmada] = useState(null);

  function validar() {
    if (!codigoBusqueda.trim()) return "Busca un código de clasificación o de rollo.";
    if (rollosDisponibles.length === 0) return "No hay rollos registrados con ese código en tu bodega.";
    if (rollosSeleccionados.length === 0) return "Selecciona al menos un rollo y sus metros a consumir.";
    for (const { rollo, metrosTexto } of rollosSeleccionados) {
      const metros = Number(metrosTexto);
      if (rollo.estado === "agotado") {
        return `El rollo ${rollo.identificadorRollo} ya está acabado y no puede usarse.`;
      }
      if (!metrosTexto || !(metros > 0)) {
        return `Ingresa una cantidad válida de metros para el rollo ${rollo.identificadorRollo}.`;
      }
      if (metros > rollo.metrosDisponibles) {
        return `El rollo ${rollo.identificadorRollo} solo tiene ${rollo.metrosDisponibles} m disponibles.`;
      }
    }
    if (!modelo.trim()) return "Indica el modelo del producto fabricado.";
    if (tipoProducto === "teja" && !calibreLote.trim()) {
      return "Indica el calibre — es obligatorio para identificar y consolidar correctamente el stock de TEJA.";
    }
    // Para caballetes, medidaProducto se deriva sola de la longitud (ver el
    // useEffect que las sincroniza) — la longitud se valida más abajo, con
    // un mensaje más claro que repetir "indica la medida" aquí.
    // Solo stock (tejas sin cotización): la medida y la cantidad ya están en
    // cada línea del stock adicional, no se vuelven a pedir arriba.
    const soloStock = esSoloStock();
    if (!SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && !soloStock && !medidaProducto.trim()) return "Indica la medida del producto fabricado.";
    for (const linea of lineasProduccion) {
      if (!(Number(linea.cantidad) > 0) || !Number.isInteger(Number(linea.cantidad))) {
        return `Escribe cuántas unidades salieron de "${linea.descripcion}".`;
      }
      if (!(Number(String(linea.medida).replace(",", ".")) > 0)) return `Escribe la medida de "${linea.descripcion}".`;
    }
    if (!soloStock && (!cantidadProductos || Number(cantidadProductos) <= 0)) {
      return "Indica cuántas unidades de producto se obtuvieron.";
    }
    if (cantidadProductos && !Number.isInteger(Number(cantidadProductos))) {
      return "La cantidad son unidades enteras (ej. 18), no metros. La medida de cada unidad va en su propia casilla.";
    }
    if (!responsable.trim()) return "Indica quién es el responsable de esta producción.";

    if (SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]) {
      // Regla física del producto seccionado (ver infoCorte): el material y
      // el stock adicional NO son elección libre, son exactos.
      const nombre = NOMBRE_POR_TIPO_PRODUCTO[tipoProducto];
      if (!metrosPorUnidad || Number(metrosPorUnidad) <= 0) {
        return `Indica la longitud del ${nombre} (metros por unidad) para calcular los cortes.`;
      }
      if (!infoCorte) return "No se pudo calcular el número de cortes.";
      if (Math.abs(totalMetrosAConsumir - infoCorte.metrosNecesarios) > 0.01) {
        return `Para fabricar ${cantidadProductos} ${nombre}(s) de ${metrosPorUnidad} m se necesitan exactamente ${infoCorte.cortes} corte(s) = ${infoCorte.metrosNecesarios} m (cada corte produce ${infoCorte.secciones} ${nombre}s). Ajusta los metros seleccionados de los rollos para que sumen exactamente eso.`;
      }
      let stockDeclarado = 0;
      for (const linea of stockAdicional) {
        if (!linea.cantidad || Number(linea.cantidad) <= 0) {
          return "Cada línea de stock adicional necesita una cantidad válida.";
        }
        if (linea.calidad === "segunda" && !linea.motivoSegunda.trim()) {
          return "Indica el motivo/descripción del defecto para cada unidad de Segunda.";
        }
        stockDeclarado += Number(linea.cantidad);
      }
      if (stockDeclarado !== infoCorte.sobrante) {
        return `Este corte produce físicamente ${infoCorte.producidoFisico} ${nombre}s; ${cantidadProductos} van para la necesidad y ${infoCorte.sobrante} deben quedar declarados como stock adicional (ahora declaraste ${stockDeclarado}). Ningún ${nombre} cortado se pierde.`;
      }
      return "";
    }

    // Con varios rollos, cada línea de stock dice de cuál salió (solo para el historial).
    if (stockAdicional.length > 0 && rollosSeleccionados.length > 1) {
      const usados = rollosSeleccionados.map(({ rollo }) => String(rollo.id));
      if (stockAdicional.some((linea) => !usados.includes(String(linea.rolloId || "")))) {
        return "Usaste varios rollos: escoge de qué rollo salió cada línea del stock adicional.";
      }
    }

    if (stockAdicional.length > 0) {
      let metrosNecesarios = 0;
      for (const linea of stockAdicional) {
        if (!linea.cantidad || Number(linea.cantidad) <= 0) {
          return "Cada línea de stock adicional necesita una cantidad válida.";
        }
        if (!(Number(linea.metros) > 0)) {
          return "Indica la medida (metros por unidad) de cada línea de stock adicional.";
        }
        if (linea.calidad === "segunda" && !linea.motivoSegunda.trim()) {
          return "Indica el motivo/descripción del defecto para cada unidad de Segunda.";
        }
        metrosNecesarios += Number(linea.cantidad) * Number(linea.metros);
      }
      // El material de las unidades adicionales también tiene que salir del
      // rollo: lo que sobre después de cubrir el apartado (o todo lo
      // consumido, si es producción libre) debe alcanzar para esas unidades.
      const pendienteApartado = metrosParaCotizacion;
      const aplicadoApartado = Math.min(totalMetrosAConsumir, pendienteApartado);
      const excedente = redondear(totalMetrosAConsumir - aplicadoApartado);
      if (excedente + 0.01 < metrosNecesarios) {
        return `El stock adicional necesita ${redondear(metrosNecesarios)} m, pero el material que seleccionaste del rollo solo deja ${excedente} m disponibles después del apartado. Aumenta los metros seleccionados o reduce las unidades adicionales.`;
      }
    }
    return "";
  }

  const [observaciones, setObservaciones] = useState("");

  async function registrarProduccion(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!puedeRegistrarProduccion) {
      setErrorValidacion("Tu usuario no tiene permiso para registrar producción.");
      return;
    }
    const mensajeError = validar();
    if (mensajeError) {
      setErrorValidacion(mensajeError);
      return;
    }

    // Si esta cotización también tiene ítems de stock sin separar, abre el
    // modal de confirmación y PAUSA aquí -- el backend igual lo exige
    // (defensa real, ver _apartado_item_para_produccion), esto solo evita el
    // rechazo. El flujo continúa en confirmarSeparacionYRegistrar() (botón
    // "Sí" del modal) o se cancela en cancelarConfirmacionSeparacion() ("No").
    if (apartadoItemId) {
      const apartado = apartadosPendientes.find((ap) => ap.items.some((it) => it.id === apartadoItemId));
      const tieneItemsStock = apartado?.items.some((it) => it.modalidad === "por_stock");
      if (apartado && tieneItemsStock && !apartado.stockSeparadoConfirmado) {
        setConfirmacionStockPendiente(apartado);
        return;
      }
    }

    await enviarProduccion();
  }

  async function confirmarSeparacionYRegistrar() {
    const apartado = confirmacionStockPendiente;
    setConfirmacionStockPendiente(null);
    if (!apartado) return;
    try {
      await api.patch(`/apartados/${apartado.id}/confirmar-separacion-stock`);
    } catch (err) {
      setErrorValidacion(err instanceof ErrorApi ? err.message : "No se pudo confirmar la separación de stock.");
      return;
    }
    await enviarProduccion();
  }

  function cancelarConfirmacionSeparacion() {
    setConfirmacionStockPendiente(null);
    setErrorValidacion("Primero debe separarse el stock de esta cotización antes de registrar la producción.");
  }

  async function enviarProduccion() {
    setGuardando(true);
    setErrorValidacion("");
    try {
      const cuerpo = {
        tipo_producto: tipoProducto,
        producto_fabricado: productoFabricado.trim(),
        modelo: modelo.trim(),
        medida_producto: medidaProducto.trim() || (esSoloStock() ? medidasDelStock() : ""),
        cantidad_productos: Number(cantidadProductos) || (esSoloStock() ? unidadesDelStock() : 0),
        responsable: responsable.trim(),
        observaciones,
        rollos: rollosSeleccionados.map(({ rollo, metrosTexto }) => ({
          rollo_id: rollo.id,
          metros: Number(metrosTexto),
        })),
        apartado_item_id: apartadoItemId,
        apartado_items_extra: SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] ? [] : itemsJuntos,
        metros_por_linea: metrosParaCotizacionPorLinea,
        color: color.trim(),
        ral: ral.trim(),
        calibre: calibreLote.trim(),
        // Tejas: la medida va en cada línea de stock; caballete/flanche usa la de arriba.
        metros_por_unidad: SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]
          ? (metrosPorUnidad ? Number(metrosPorUnidad) : null)
          : (stockAdicional.length ? Number(stockAdicional[0].metros) || null : (metrosPorUnidad ? Number(metrosPorUnidad) : null)),
        stock_adicional: stockAdicional.map((linea) => ({
          calidad: linea.calidad,
          cantidad: Number(linea.cantidad),
          motivo_segunda: linea.calidad === "segunda" ? linea.motivoSegunda.trim() : "",
          metros_por_unidad: SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] ? null : Number(linea.metros) || null,
          rollo_id: rollosSeleccionados.length === 1 ? rollosSeleccionados[0].rollo.id : Number(linea.rolloId) || null,
        })),
      };

      let respuesta;
      try {
        respuesta = await api.post("/produccion", cuerpo);
      } catch (err) {
        // Sin respuesta (se cortó el internet o el servidor se estaba
        // actualizando) no se sabe si alcanzó a guardarse: que lo revisen
        // antes de repetir, para no registrarla doble.
        setErrorValidacion(err instanceof ErrorApi ? err.message
          : "No hubo respuesta del servidor (se cortó la conexión o se estaba actualizando). Antes de volver a intentar, "
            + "mira abajo en el historial de producciones si ya quedó registrada, para no registrarla dos veces.");
        return;
      }
      const registro = produccionDesdeApi(respuesta);

      gestionandoStockRef.current = false;
      setProduccionesRegistradas((actual) => [registro, ...actual]);
      setProduccionConfirmada(registro);
      setSeleccion({});
      setApartadoItemId(null);
      setItemsJuntos([]);
      setAdvertenciaSeleccion("");
      setColor(""); setRal(""); setCalibreLote(""); setMetrosPorUnidad(""); setStockAdicional([]);
      setTipoProducto("teja");

      // La producción YA quedó registrada: si falla recargar las listas, no
      // se dice "no se pudo registrar" (se actualizan solas en unos segundos).
      try {
        const datosRollos = await api.get("/rollos");
        setRollosDeMiBodega(datosRollos.map(rolloDesdeApi));
        await cargarSolicitudesPendientes();
      } catch {
        /* se refresca con la actualización automática */
      }
    } catch (err) {
      setErrorValidacion(
        err instanceof ErrorApi ? err.message : "No se pudo registrar la producción. Intenta de nuevo."
      );
    } finally {
      setGuardando(false);
    }
  }

  function cancelar() {
    gestionandoStockRef.current = false;
    setProductoFabricado("");
    setModelo("");
    setMedidaProducto("");
    setCantidadProductos("");
    setResponsable("");
    setCodigoBusqueda("");
    setSeleccion({});
    setObservaciones("");
    setErrorValidacion("");
    setApartadoItemId(null);
    setItemsJuntos([]);
    setAdvertenciaSeleccion("");
    setColor(""); setRal(""); setCalibreLote(""); setMetrosPorUnidad(""); setStockAdicional([]);
    setTipoProducto("teja");
  }

  function iniciarNuevoRegistro() {
    cancelar();
    setProduccionConfirmada(null);
  }

  const [produccionesRegistradas, setProduccionesRegistradas] = useState([]);

  const cargarProducciones = useCallback(async (silenciosa = false) => {
    try {
      const datos = await api.get("/produccion");
      setProduccionesRegistradas(datos.map(produccionDesdeApi));
    } catch {
      if (!silenciosa) setProduccionesRegistradas([]);
    }
  }, []);

  useEffect(() => {
    cargarProducciones();
  }, [cargarProducciones]);

  // Refresco automático mientras esta pantalla esté abierta (Producción o
  // Hoja de Vida, que comparten este mismo hook): historial de producción
  // siempre; solicitudes pendientes solo si puede registrarlas. Silencioso
  // (si falla, conserva lo que había), solo con la pestaña a la vista y sin
  // encimar consultas -- ver useActualizacionAutomatica.
  useActualizacionAutomatica(
    () => Promise.all([puedeRegistrarProduccion ? cargarSolicitudesPendientes(true) : null, cargarProducciones(true)]),
    { segundos: SEGUNDOS_POLLING_PRODUCCION },
  );

  const misProducciones = produccionesRegistradas;

  return {
    puedeRegistrarProduccion,

    productoFabricado,
    setProductoFabricado,
    modelo,
    setModelo,
    medidaProducto,
    setMedidaProducto,
    cantidadProductos,
    setCantidadProductos,
    ayudaCantidad,
    responsable,
    setResponsable,

    tipoProducto, setTipoProducto,
    infoCorte,

    color, setColor,
    ral, setRal,
    calibreLote, setCalibreLote,
    metrosPorUnidad, setMetrosPorUnidad,
    stockAdicional, agregarLineaStock, quitarLineaStock, actualizarLineaStock,

    codigoBusqueda,
    setCodigoBusqueda,
    empresaFiltro,
    setEmpresaFiltro,
    rollosDisponibles,

    seleccion,
    alternarSeleccionRollo,
    actualizarMetrosRollo,
    rollosSeleccionados,
    totalMetrosAConsumir,

    observaciones,
    setObservaciones,

    errorValidacion,
    guardando,
    registrarProduccion,
    confirmacionStockPendiente,
    confirmarSeparacionYRegistrar,
    cancelarConfirmacionSeparacion,
    cancelar,

    produccionConfirmada,
    iniciarNuevoRegistro,

    misProducciones,

    solicitudesPendientes,
    stockParaAlistar,
    cotizacionesConTrabajo,
    cotizacionResaltada,
    apartadoItemId,
    itemsJuntos,
    lineasProduccion,
    actualizarLineaProduccion,
    puedeProducirJunto,
    alternarProducirJunto,
    seleccionarSolicitud,
    limpiarSolicitud,
    marcarProduccionTerminada,
    errorSolicitudPendiente,
    advertenciaSeleccion,
  };
}
