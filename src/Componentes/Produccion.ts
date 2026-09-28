// @ts-nocheck -- contrato API pendiente de centralizar en src/types.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ErrorApi } from "./Api";
import { apartadoDesdeApi, produccionDesdeApi, rolloDesdeApi } from "./Mapeo";
import { calcularSolicitudesPendientes, NOMBRE_POR_TIPO_PRODUCTO, SECCIONES_POR_TIPO_PRODUCTO } from "../Utils/produccion";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";

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

  function agregarLineaStock() {
    setStockAdicional((actual) => [...actual, { calidad: "primera", cantidad: "1", motivoSegunda: "" }]);
  }
  function quitarLineaStock(indice) {
    setStockAdicional((actual) => actual.filter((_, i) => i !== indice));
  }
  function actualizarLineaStock(indice, campo, valor) {
    setStockAdicional((actual) => actual.map((linea, i) => (i === indice ? { ...linea, [campo]: valor } : linea)));
  }

  const [codigoBusqueda, setCodigoBusqueda] = useState("");
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

  // `silenciosa` (actualización automática): si falla, conserva la lista que
  // ya estaba -- vaciarla hacía desaparecer el panel de solicitudes y movía
  // los metros seleccionados mientras Planta llenaba el formulario.
  const cargarSolicitudesPendientes = useCallback(async (silenciosa = false) => {
    try {
      const datos = await api.get("/apartados");
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

  function seleccionarSolicitud(solicitud) {
    gestionandoStockRef.current = false; // arranca en blanco para esta nueva solicitud.
    setApartadoItemId(solicitud.itemId);
    setProductoFabricado(solicitud.descripcion || solicitud.codigoInterno);
    setMedidaProducto(String(solicitud.medida));
    setCantidadProductos(String(solicitud.cantidad));
    setCodigoBusqueda(solicitud.codigoInterno); // llena la tabla de "rollos disponibles" con este código.

    // El rollo físico lo elige Planta a mano en la tabla de abajo (checkbox +
    // metros por fila) -- ya no se preselecciona por antigüedad (FIFO): en la
    // práctica se usa el rollo que está a la mano, no el más viejo.
    setSeleccion({});
    setAdvertenciaSeleccion("");
  }

  function limpiarSolicitud() {
    gestionandoStockRef.current = false;
    setApartadoItemId(null);
    setCodigoBusqueda("");
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
    return rollosDeMiBodega.filter(
      (r) =>
        r.metrosDisponibles > 0 &&
        (normalizarTexto(r.codigoInterno).includes(termino) ||
          normalizarTexto(r.identificadorRollo).includes(termino))
    );
  }, [rollosDeMiBodega, codigoBusqueda]);

  const [seleccion, setSeleccion] = useState({});

  function alternarSeleccionRollo(rollo: Rollo) {
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
        const solicitud = apartadoItemId ? solicitudesPendientes.find((s) => s.itemId === apartadoItemId) : null;
        if (solicitud) {
          return calcularAsignacionRollos(solicitud.metrosPendientes, [rollo], actual).seleccion;
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

  const pendienteSolicitudElegida = useMemo(() => {
    const solicitud = apartadoItemId ? solicitudesPendientes.find((s) => s.itemId === apartadoItemId) : null;
    return solicitud ? solicitud.metrosPendientes : 0;
  }, [apartadoItemId, solicitudesPendientes]);

  useEffect(() => {
    // Caballetes/Flanches: el rollo lo elige Planta a mano (ver
    // alternarSeleccionRollo) -- el total EXACTO que exige el corte físico lo
    // sigue garantizando validar()/el backend, no este efecto. Igual que Teja,
    // aquí ya no se auto-asigna nada por FIFO.
    if (SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]) return;

    const metrosUnidad = Number(metrosPorUnidad) || 0;
    const metrosNecesariosStock = metrosUnidad > 0
      ? redondear(stockAdicional.reduce((suma, linea) => suma + (Number(linea.cantidad) || 0) * metrosUnidad, 0))
      : 0;

    if (metrosNecesariosStock > 0) {
      gestionandoStockRef.current = true;
    } else if (!gestionandoStockRef.current) {
      return; // nunca hubo stock declarado: no tocar una selección manual.
    } else {
      gestionandoStockRef.current = false; // último ajuste: soltar el control.
    }

    const objetivoTotal = redondear(pendienteSolicitudElegida + metrosNecesariosStock);

    const candidatos = [...rollosDisponibles].sort(
      (a, b) => new Date(a.fechaIngreso).getTime() - new Date(b.fechaIngreso).getTime()
    );
    setSeleccion((actual) => calcularAsignacionRollos(objetivoTotal, candidatos, actual).seleccion);
    // Depende del NÚMERO pendiente de la solicitud elegida, no de la lista de
    // solicitudes: la actualización automática crea una lista nueva en cada
    // recarga aunque nada cambie, y eso recalculaba la asignación y deshacía
    // los metros que Planta había ajustado a mano. Solo si el pendiente cambia
    // de verdad (ej. otro registro para el mismo apartado) se recalcula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoProducto, stockAdicional, metrosPorUnidad, apartadoItemId, rollosDisponibles, pendienteSolicitudElegida]);

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
    if (!SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && !medidaProducto.trim()) return "Indica la medida del producto fabricado.";
    if (!cantidadProductos || Number(cantidadProductos) <= 0) {
      return "Indica cuántas unidades de producto se obtuvieron.";
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

    if (stockAdicional.length > 0) {
      if (!metrosPorUnidad || Number(metrosPorUnidad) <= 0) {
        return "Indica los metros por unidad para registrar el stock adicional.";
      }
      let metrosNecesarios = 0;
      for (const linea of stockAdicional) {
        if (!linea.cantidad || Number(linea.cantidad) <= 0) {
          return "Cada línea de stock adicional necesita una cantidad válida.";
        }
        if (linea.calidad === "segunda" && !linea.motivoSegunda.trim()) {
          return "Indica el motivo/descripción del defecto para cada unidad de Segunda.";
        }
        metrosNecesarios += Number(linea.cantidad) * Number(metrosPorUnidad);
      }
      // El material de las unidades adicionales también tiene que salir del
      // rollo: lo que sobre después de cubrir el apartado (o todo lo
      // consumido, si es producción libre) debe alcanzar para esas unidades.
      const solicitud = apartadoItemId ? solicitudesPendientes.find((s) => s.itemId === apartadoItemId) : null;
      const pendienteApartado = solicitud ? solicitud.metrosPendientes : 0;
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
        medida_producto: medidaProducto.trim(),
        cantidad_productos: Number(cantidadProductos),
        responsable: responsable.trim(),
        observaciones,
        rollos: rollosSeleccionados.map(({ rollo, metrosTexto }) => ({
          rollo_id: rollo.id,
          metros: Number(metrosTexto),
        })),
        apartado_item_id: apartadoItemId,
        color: color.trim(),
        ral: ral.trim(),
        calibre: calibreLote.trim(),
        metros_por_unidad: metrosPorUnidad ? Number(metrosPorUnidad) : null,
        stock_adicional: stockAdicional.map((linea) => ({
          calidad: linea.calidad,
          cantidad: Number(linea.cantidad),
          motivo_segunda: linea.calidad === "segunda" ? linea.motivoSegunda.trim() : "",
        })),
      };

      const respuesta = await api.post("/produccion", cuerpo);
      const registro = produccionDesdeApi(respuesta);

      gestionandoStockRef.current = false;
      setProduccionesRegistradas((actual) => [registro, ...actual]);
      setProduccionConfirmada(registro);
      setSeleccion({});
      setApartadoItemId(null);
      setAdvertenciaSeleccion("");
      setColor(""); setRal(""); setCalibreLote(""); setMetrosPorUnidad(""); setStockAdicional([]);
      setTipoProducto("teja");

      const datosRollos = await api.get("/rollos");
      setRollosDeMiBodega(datosRollos.map(rolloDesdeApi));
      await cargarSolicitudesPendientes();
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
    cotizacionResaltada,
    apartadoItemId,
    seleccionarSolicitud,
    limpiarSolicitud,
    marcarProduccionTerminada,
    errorSolicitudPendiente,
    advertenciaSeleccion,
  };
}
