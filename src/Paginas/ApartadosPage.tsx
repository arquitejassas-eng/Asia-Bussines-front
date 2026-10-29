import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import ElegirRolloCompleto from "../Componentes/ElegirRolloCompleto";
import { descripcionRolloCompleto } from "../Utils/rolloCompleto";
import { useNavigate } from "react-router-dom";
import BarraLateral from "../Componentes/BarraLateral";
import ModalConfirmacion from "../Componentes/ModalConfirmacion";
import { formatearFechaColombia } from "../Utils/fechas";
import { EMPRESAS, AMBAS_EMPRESAS, nombreMaterial } from "../Utils/empresas";
import PanelImportarCotizaciones from "../Componentes/PanelImportarCotizaciones";
import PanelRegistrarSalida from "../Componentes/PanelRegistrarSalida";
import PanelSepararCotizacion from "../Componentes/PanelSepararCotizacion";
import PanelUnirCotizacion from "../Componentes/PanelUnirCotizacion";
import Paginacion from "../Componentes/Paginacion";
import { numeroSinEmpresa, useApartados } from "../Hooks/useApartados";
import { contarNotificacionesBarraLateral } from "../Utils/notificaciones";
import { calcularSolicitudesPendientes, calcularStockParaAlistar, metrosDeLinea, pideCorte } from "../Utils/produccion";
import "../Style/Inventario.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

// Mismos estados que backend/app/services/apartados.py::ESTADOS_CANCELABLES:
// se puede cancelar mientras la producción no haya terminado.
const ESTADOS_CANCELABLES = ["apartado", "enviado_a_produccion", "en_produccion"];

const APARTADOS_POR_PAGINA = 15;
// En la fila se ven las primeras; con más, "Ver las N líneas" abre debajo de
// la cotización el detalle completo, de lado a lado (ver detalleDeLineas).
const LINEAS_VISIBLES = 3;

type ApartadoDeLista = ReturnType<typeof useApartados>["apartados"][number];

/** Cantidad legible de una línea: metros para rollo (con la cuenta si son
 * piezas de una medida, ej. "18 × 6 m = 108 m"), unidades para producto. */
// "CAL 28 (0.33)" con código LR30020,38: Planta junta por código y mezclaría
// espesores (ver backend exigir_calibre_de_la_descripcion).
function calibreQueNoCuadra(codigo: string, descripcion: string): string | null {
  const final = /,(\d{2})$/.exec((codigo || "").trim());
  const espesores = [...(descripcion || "").matchAll(/\(\s*0\s*[.,]\s*(\d{2})\s*\)/g)].map((m) => m[1]);
  if (!final || !espesores.length || espesores.includes(final[1])) return null;
  return `La descripción dice espesor ${[...new Set(espesores)].map((e) => `0,${e}`).join(" / ")} y el código es ${codigo.trim()} `
    + `(0,${final[1]}). Corrige uno de los dos: si no, Planta mezclaría espesores al producir.`;
}

// Para ordenar la lista por número de cotización: "4002" -> 4002; "3811-AR"
// -> 3811; una orden interna ("OI-0003") va en su propio grupo, después.
function claveDeNumero(numero: string) {
  const texto = (numero || "").trim().toUpperCase();
  const digitos = /^OI-/.test(texto) ? texto.match(/\d+/) : texto.match(/^\d+/) ?? texto.match(/\d+/);
  return { orden: /^OI-/.test(texto) ? 2 : digitos ? 0 : 1, numero: digitos ? Number(digitos[0]) : 0, texto };
}

// Con coma decimal, como se escriben en las cotizaciones: 5,3 m.
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 2 });

function cantidadLinea(it: { modalidad: string; cantidad: number; medida: number | null; metrosRequeridos: number | null; tipoProducto?: string; convertirEn?: string }) {
  if (it.modalidad === "por_stock") return `${num(it.cantidad)} und`;
  if (it.tipoProducto === "lamina_lisa") {
    return `${num(it.cantidad)} lámina${it.cantidad === 1 ? "" : "s"} lisa${it.cantidad === 1 ? "" : "s"} de ${num(it.medida)} m = ${num(it.metrosRequeridos)} m`
      + ` → ${num(it.cantidad * (it.convertirEn === "flanche" ? 5 : 3))} ${it.convertirEn || "caballete"}s`;
  }
  if (it.tipoProducto && it.medida) return `${num(it.cantidad)} ${it.tipoProducto}${it.cantidad === 1 ? "" : "s"} de ${num(it.medida)} m = ${num(it.metrosRequeridos)} m de lámina`;
  if (it.medida && it.medida !== 1) return `${num(it.cantidad)} × ${num(it.medida)} m = ${num(it.metrosRequeridos)} m`;
  return `${num(it.metrosRequeridos ?? it.cantidad)} m`;
}

// Color del material por la letra del código (LR30010,29 -> R = rojo), para
// la franja del código. El código sigue escrito completo: el color solo ayuda.
const COLOR_POR_LETRA: Record<string, string> = {
  A: "azul", B: "blanco", N: "negro", P: "plateado", R: "rojo", T: "terracota", V: "verde",
};
function colorDeCodigo(codigo: string) {
  return COLOR_POR_LETRA[(codigo || "").trim().toUpperCase().charAt(1)] || "otro";
}

// "… CALIBRE 30 (0,27) AZUL 5017 …": esa parte va en el color del material,
// como en el otro aplicativo, para compararla de un vistazo.
const CALIBRE_Y_COLOR = /(CALIBRE|CAL\.?)\s*\d+\s*\(\s*\d+[.,]\d+\s*\)\s*[A-ZÁÉÍÓÚÑ]+(\s+\d{3,4})?/i;
// Sin código de rollo (línea de stock): el color sale de lo que dice ("ROJO").
const COLOR_POR_NOMBRE: Record<string, string> = {
  AZUL: "azul", BLANCO: "blanco", NEGRO: "negro", PLATA: "plateado", PLATEADO: "plateado",
  ROJO: "rojo", TERRACOTA: "terracota", VERDE: "verde",
};
function descripcionResaltada(texto: string, color: string) {
  const encontrado = CALIBRE_Y_COLOR.exec(texto);
  if (encontrado && color === "otro") {
    const palabras = encontrado[0].toUpperCase().match(/[A-ZÁÉÍÓÚÑ]+/g) ?? [];
    color = COLOR_POR_NOMBRE[palabras[palabras.length - 1]] || "otro";
  }
  if (!encontrado || color === "otro") return texto;
  const inicio = encontrado.index, fin = inicio + encontrado[0].length;
  return (
    <>
      {texto.slice(0, inicio)}
      <span className={`apartado-linea-resaltado codigo-${color}`}>{texto.slice(inicio, fin)}</span>
      {texto.slice(fin)}
    </>
  );
}

// Pestañas de la lista: las abiertas, y aparte las entregadas y las canceladas.
// "Pendientes por dar salida": las que Planta ya terminó (la bodega les da
// "Salida") y las que ya salieron pero falta saber de qué rollo (REFERENCIA
// "SI" en el Excel; se cierran con Registrar salida).
type Pestana = "cotizaciones" | "pendientes_salida" | "entregadas" | "canceladas";
const PESTANAS: Record<Pestana, string> = {
  cotizaciones: "Cotizaciones", pendientes_salida: "Pendientes por dar salida", entregadas: "Entregadas", canceladas: "Anuladas",
};
const ESTADO_DE_PESTANA: Partial<Record<Pestana, string>> = { entregadas: "entregado", canceladas: "cancelado" };
const CERRADAS = Object.values(ESTADO_DE_PESTANA);
// Una cotización de rollo completo creada antes de que pasaran por Planta
// quedaba "por dar salida" sin enviarse: mientras esté en "apartado" se
// trata como cualquier otra (se envía a producción).
function porDarSalida(ap: { estado: string; salidaPendiente: boolean }) {
  return ap.salidaPendiente && ap.estado !== "apartado";
}
function vaEnPestana(ap: { estado: string; salidaPendiente: boolean }, pestana: Pestana) {
  const estadoPropio = ESTADO_DE_PESTANA[pestana];
  if (estadoPropio) return ap.estado === estadoPropio;
  if (CERRADAS.includes(ap.estado)) return false;
  const pendienteDeSalida = porDarSalida(ap) || ap.estado === "produccion_terminada";
  return pendienteDeSalida === (pestana === "pendientes_salida");
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  apartado: "Apartado",
  enviado_a_produccion: "Enviado a producción",
  en_produccion: "En producción",
  produccion_terminada: "Producción terminada",
  entregado: "Entregado",
  cancelado: "Anulado",
};

type DatosDisponibilidad = {
  cantidadRollos?: number; familia?: string; metrosDisponibles?: number; metrosReservados?: number;
  metrosEnCamino?: number; metrosPorRepartir?: number; metrosEsperando?: number; metrosParaApartar?: number;
  stock?: number; cantidadReservada?: number; cantidadDisponible?: number;
  disponibleEmpresa?: number | null; enOtrasBodegas?: string;
  otrasBodegas?: { bodegaId: number; bodega: string; cantidad: number }[];
  otrasEmpresas?: { empresa: string; cantidad: number; total: number }[];
  productoId?: number; codigo?: string; descripcion?: string;
};
type ItemDisponibilidad = { cargando?: boolean; error?: boolean; sinBodega?: boolean; datos?: DatosDisponibilidad };

function ApartadosPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const a = useApartados(sesion, almacen.refrescarApartadosPorEnviar);
  const esAdminInventario = sesion.rol === "admin_inventario";
  // Admin Inventario y el vendedor no tienen bodega fija: ven las cotizaciones
  // de todas las bodegas (el vendedor, solo las suyas).
  const veTodasLasBodegas = esAdminInventario || sesion.rol === "vendedor";

  function confirmarEnvioAProduccion(ap: { id: number; numeroCotizacion: string }) {
    setConfirmacion({
      titulo: `¿Enviar ${ap.numeroCotizacion} a producción?`,
      mensaje: "Planta verá esta cotización como pendiente de producir.",
      textoConfirmar: "Sí, enviar a producción",
      ejecutar: () => a.enviarApartadoAProduccion(ap.id),
    });
  }
  const disponibilidadItems = a.disponibilidadItems as Record<number, ItemDisponibilidad>;
  const lineaSinMaterial = a.formulario.items.some((item, indice) => {
    const datos = disponibilidadItems[indice]?.datos;
    if (!datos) return false;
    if (item.modalidad === "por_stock") return Number(item.cantidad) > (datos.cantidadDisponible ?? 0);
    return datos.cantidadRollos === 0
      || metrosDeLinea(Number(item.cantidad), Number(item.medida), item.tipoProducto).metros > (datos.metrosDisponibles ?? 0);
  });
  // Las líneas del mismo código se suman (como al guardar): la línea con la
  // que la cotización pasa de lo libre en toda la compañía (Arquitejas + Asia,
  // todas las bodegas y lo que viene en camino) queda marcada de una vez, sin
  // esperar a guardar. Al editar no: lo que ya estaba apartado es de ella y lo
  // revisa el backend al guardar.
  const excesoPorLinea: Record<number, { codigo: string; pedido: number; hay: number }> = {};
  if (!a.editandoId) {
    const pedidoPorCodigo: Record<string, number> = {};
    a.formulario.items.forEach((item, indice) => {
      const codigo = String(item.codigoInterno || "").trim().toUpperCase();
      if (item.modalidad !== "por_rollo" || !codigo || !(Number(item.cantidad) > 0) || !(Number(item.medida) > 0)) return;
      pedidoPorCodigo[codigo] = (pedidoPorCodigo[codigo] ?? 0) + metrosDeLinea(Number(item.cantidad), Number(item.medida), item.tipoProducto).metros;
      const datos = disponibilidadItems[indice]?.datos;
      if (!datos || datos.disponibleEmpresa == null) return;
      const hay = Math.max(datos.disponibleEmpresa, 0) + (datos.otrasEmpresas ?? []).reduce((suma, o) => suma + Math.max(o.total, 0), 0);
      const pedido = Math.round(pedidoPorCodigo[codigo] * 100) / 100;
      if (pedido > hay + 0.005) excesoPorLinea[indice] = { codigo, pedido, hay: Math.round(hay * 100) / 100 };
    });
  }
  const lineasQueSePasan = Object.keys(excesoPorLinea).map((i) => Number(i) + 1);

  // Pie del formulario: cuántos productos lleva y cuántos metros de cada código.
  function resumenDelFormulario() {
    const metrosPorCodigo: Record<string, number> = {};
    for (const item of a.formulario.items) {
      const codigo = String(item.codigoInterno || "").trim().toUpperCase();
      if (item.modalidad !== "por_rollo" || !codigo || !(Number(item.cantidad) > 0) || !(Number(item.medida) > 0)) continue;
      metrosPorCodigo[codigo] = (metrosPorCodigo[codigo] ?? 0) + metrosDeLinea(Number(item.cantidad), Number(item.medida), item.tipoProducto).metros;
    }
    const n = a.formulario.items.length;
    return (
      <>
        <strong>{n} producto{n === 1 ? "" : "s"}</strong>
        {Object.entries(metrosPorCodigo).map(([codigo, metros]) => (
          <span key={codigo} className="apartado-form-resumen-codigo">{codigo}: <strong>{num(metros)} m</strong></span>
        ))}
      </>
    );
  }
  const ofrecerMaterialEnCamino = lineaSinMaterial || a.formulario.materialEnCamino
    || a.errorFormularioApartado.includes("viene en camino");

  // Si no alcanza lo de la empresa del material en la bodega elegida (o en
  // toda esa empresa), se avisa dónde hay: otra bodega de la misma empresa
  // (-> "Despachar desde ...") u otra empresa (-> "Usar material de ...").
  // La cotización se puede crear si alcanza sumando Arquitejas y Asia; si no
  // se cambia nada, queda esperando material (el traslado lo pide la bodega).
  function avisoOtraBodega(item: (typeof a.formulario.items)[number], indice: number) {
    const datos = disponibilidadItems[indice]?.datos;
    if (!datos || !item.bodegaId) return null;
    const pedido = item.modalidad === "por_stock"
      ? Number(item.cantidad) || 0
      : Number(item.cantidad) > 0 && Number(item.medida) > 0 ? metrosDeLinea(Number(item.cantidad), Number(item.medida), item.tipoProducto).metros : 0;
    const necesita = (hay: number) => (pedido > 0 ? hay + 0.005 < pedido : hay <= 0.005);
    const libre = item.modalidad === "por_stock" ? datos.cantidadDisponible ?? 0 : datos.metrosDisponibles ?? 0;
    const totalEmpresa = datos.disponibleEmpresa ?? null;
    const faltaAqui = necesita(libre);
    const faltaEnEmpresa = totalEmpresa != null && necesita(totalEmpresa);
    if (!faltaAqui && !faltaEnEmpresa) return null;
    const otras = faltaEnEmpresa ? [] : (datos.otrasBodegas ?? []).filter((o) => String(o.bodegaId) !== String(item.bodegaId));
    const otra = otras.find((o) => o.cantidad + 0.005 >= pedido) ?? otras[0];
    const otrasEmpresas = datos.otrasEmpresas ?? [];
    const otraEmpresa = otrasEmpresas.find((o) => o.total + 0.005 >= pedido) ?? otrasEmpresas.find((o) => o.cantidad > 0.005);
    if (!otra && !otraEmpresa && !faltaEnEmpresa) return null;
    const aqui = almacen.bodegas.find((b) => String(b.id) === String(item.bodegaId))?.nombre || "esta bodega";
    const empresa = EMPRESAS[item.empresa || a.formulario.empresa] || "esta empresa";
    const nombreOtra = otraEmpresa ? EMPRESAS[otraEmpresa.empresa] || otraEmpresa.empresa : "";
    const unidad = item.modalidad === "por_stock" ? " und" : " m";
    return (
      <div className="apartado-aviso-otra-bodega">
        {faltaEnEmpresa ? (
          <p>
            Sumando todas las bodegas, <strong>{empresa}</strong> solo tiene {num(Math.max(totalEmpresa ?? 0, 0))}{unidad} disponibles
            de este material: no alcanza.
            {otraEmpresa && otraEmpresa.total > 0.005 ? (
              <> <strong>{nombreOtra}</strong> sí tiene {num(otraEmpresa.total)}{unidad} disponibles
                {otraEmpresa.cantidad > 0.005 && <> ({num(otraEmpresa.cantidad)}{unidad} aquí en {aqui})</>}: puedes usar material
                de {nombreOtra} y quedará como préstamo entre empresas.</>
            ) : " La otra empresa tampoco tiene suficiente."}
          </p>
        ) : (
          <>
            {otra && (
              <p>
                <strong>{otra.bodega}</strong> tiene <strong>{num(otra.cantidad)}{unidad} disponibles de {empresa}</strong>. Puedes
                despachar esta línea desde {otra.bodega} o solicitar un intercambio para traer el material a {aqui}.
              </p>
            )}
            {otraEmpresa && otraEmpresa.cantidad > 0.005 && (
              <p>
                Los {num(otraEmpresa.cantidad)}{unidad} de <strong>{nombreOtra}</strong> que hay en {aqui} son de otra empresa y
                no cuentan para esta cotización. Si quieres usarlos, toca «Usar material de {nombreOtra}» (quedará como préstamo
                entre empresas).
              </p>
            )}
          </>
        )}
        <div className="apartado-aviso-botones">
          {otra && (
            <button type="button" onClick={() => a.cambiarBodegaItem(indice, String(otra.bodegaId), true)}>
              Despachar desde {otra.bodega}
            </button>
          )}
          {otraEmpresa && (
            <button type="button" onClick={() => a.cambiarEmpresaItem(indice, otraEmpresa.empresa)}>
              Usar material de {nombreOtra}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Lo que hay del código en la bodega de la línea, en palabras sencillas:
  // "Ricaurte tiene acero de Asia Business, pero todo está reservado…".
  function disponibilidadDelCodigo(item: (typeof a.formulario.items)[number], datos: DatosDisponibilidad) {
    const bodega = almacen.bodegas.find((b) => String(b.id) === String(item.bodegaId))?.nombre || "Esta bodega";
    const empresa = EMPRESAS[item.empresa || a.formulario.empresa] || "esta empresa";
    const rollos = datos.cantidadRollos ?? 0;
    const libre = datos.metrosDisponibles ?? 0;
    const enCamino = datos.metrosEnCamino ?? 0;
    const porRepartir = datos.metrosPorRepartir ?? 0;
    if (rollos === 0 && !enCamino && !porRepartir) {
      return <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>{bodega} no tiene rollos de {empresa} con este código.</p>;
    }
    return (
      <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
        {rollos === 0
          ? <>{bodega} no tiene rollos de {empresa} con este código.</>
          : libre > 0.005
            ? <>{bodega} tiene <strong>{num(libre)} m disponibles</strong> de {empresa} ({rollos} rollo{rollos === 1 ? "" : "s"}
                {(datos.metrosReservados ?? 0) > 0 && <>; otros {num(datos.metrosReservados)} m ya están reservados para otras cotizaciones</>}).</>
            : libre < -0.005
              ? <>{bodega} tiene acero de {empresa}, pero <strong>todo está reservado</strong>. Faltan {num(-libre)} m para cubrir
                  las cotizaciones que ya están apartadas.</>
              : <>{bodega} tiene acero de {empresa}, pero <strong>todo está reservado</strong> para otras cotizaciones.</>}
        {(enCamino > 0 || porRepartir > 0) && (
          <>
            <br />
            Además, a {empresa} le {enCamino > 0 ? <>vienen {num(enCamino)} m en camino</> : null}
            {enCamino > 0 && porRepartir > 0 ? " y " : ""}
            {porRepartir > 0 && <>Admin Inventario tiene {num(porRepartir)} m por repartir</>}
            {(datos.metrosEsperando ?? 0) > 0 && <> ({num(datos.metrosEsperando)} m de eso ya están apartados)</>}.{" "}
            <strong>Puedes apartar hasta {num(datos.metrosParaApartar)} m.</strong>
          </>
        )}
      </p>
    );
  }

  // Línea de stock en la que se está creando un producto que no existía.

  const navigate = useNavigate();

  const notificaciones = contarNotificacionesBarraLateral(almacen, sesion);
  const [mensajeInformativo, setMensajeInformativo] = useState("");
  // Acciones que cambian el estado de un apartado piden confirmación: antes
  // un clic accidental lo enviaba a producción o cerraba la producción.
  // Carga desde Excel y salida con hoja de vida (solo Admin Inventario).
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [salidaAbierta, setSalidaAbierta] = useState<number | null>(null);
  // "Separar": el cliente no se lleva todo y parte pasa a una cotización nueva.
  const [separarAbierta, setSepararAbierta] = useState<number | null>(null);
  const cerrarSeparar = useCallback(() => setSepararAbierta(null), []);
  // "Unir": lo contrario de Separar; otra cotización pasa sus líneas a esta.
  const [unirAbierta, setUnirAbierta] = useState<number | null>(null);
  const cerrarUnir = useCallback(() => setUnirAbierta(null), []);
  // Las que se pueden unir a esta: misma bodega, empresa y estado (ver backend unir_apartado).
  const candidatasParaUnir = (ap: ApartadoDeLista) => a.apartados.filter((otra) => otra.id !== ap.id && !otra.ordenInterna
    && otra.bodegaId === ap.bodegaId && otra.empresa === ap.empresa && otra.estado === ap.estado);
  const cerrarSalida = useCallback(() => setSalidaAbierta(null), []);
  const [lineasExpandidas, setLineasExpandidas] = useState<Set<number>>(new Set());
  function alternarLineas(id: number) {
    setLineasExpandidas((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
      return nueva;
    });
  }

  // Filtros de la lista (en el navegador: la lista ya viene completa).
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroBodega, setFiltroBodega] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [soloPendientesSalida, setSoloPendientesSalida] = useState(false);
  // Las entregadas (la bodega ya les dio "Salida") y las canceladas no se
  // mezclan con las que siguen abiertas: cada una va en su pestaña.
  const [pestana, setPestana] = useState<Pestana>("cotizaciones");
  function cambiarPestana(nueva: Pestana) {
    setPestana(nueva);
    setSoloPendientesSalida(false);
    a.setFiltroEstado("");
  }
  const apartadosFiltrados = useMemo(() => {
    const texto = filtroTexto.trim().toLowerCase();
    // Por número, de mayor a menor (4002, 4001, 4000…), sin importar cuándo
    // se creó cada una; las órdenes internas (OI-…) van después. Las partes de
    // un mismo número (3811, 3811-AR, 3776-SAL) quedan juntas, la primera arriba.
    return [...a.apartados].sort((x, y) => {
      const kx = claveDeNumero(x.numeroCotizacion), ky = claveDeNumero(y.numeroCotizacion);
      return kx.orden - ky.orden || ky.numero - kx.numero || kx.texto.localeCompare(ky.texto) || x.id - y.id;
    }).filter((ap) =>
      vaEnPestana(ap, pestana)
      && (!texto || ap.numeroCotizacion.toLowerCase().includes(texto) || ap.cliente.toLowerCase().includes(texto))
      && (!filtroBodega || String(ap.bodegaId) === filtroBodega)
      && (!filtroEmpresa || ap.empresa === filtroEmpresa)
      && (!soloPendientesSalida || ESTADOS_CANCELABLES.includes(ap.estado)));
  }, [a.apartados, filtroTexto, filtroBodega, filtroEmpresa, soloPendientesSalida, pestana]);

  // Paginación en el navegador: con cientos de cotizaciones la tabla era eterna.
  const [paginaApartados, setPaginaApartados] = useState(1);
  useEffect(() => { setPaginaApartados(1); }, [filtroTexto, filtroBodega, filtroEmpresa, soloPendientesSalida, a.filtroEstado, pestana]);
  const hayFiltros = Boolean(filtroTexto || filtroBodega || filtroEmpresa || soloPendientesSalida || a.filtroEstado);
  function limpiarFiltros() {
    setFiltroTexto(""); setFiltroBodega(""); setFiltroEmpresa(""); setSoloPendientesSalida(false); a.setFiltroEstado("");
  }
  // Admin Inventario y el vendedor ven cada cotización en UNA fila aunque salga de varias
  // bodegas (en el backend es una parte por bodega, con el mismo número).
  // Las bodegas siguen viendo solo su parte.
  const gruposFiltrados = useMemo(() => {
    if (!veTodasLasBodegas) return apartadosFiltrados.map((ap) => [ap]);
    const porNumero = new Map<string, ApartadoDeLista[]>();
    for (const ap of apartadosFiltrados) {
      const clave = numeroSinEmpresa(ap.numeroCotizacion);
      const grupo = porNumero.get(clave);
      if (grupo) grupo.push(ap); else porNumero.set(clave, [ap]);
    }
    // La parte principal (la que se creó primero) va arriba.
    return [...porNumero.values()].map((grupo) => [...grupo].sort((x, y) => x.id - y.id));
  }, [apartadosFiltrados, veTodasLasBodegas]);
  const totalPaginas = Math.max(1, Math.ceil(gruposFiltrados.length / APARTADOS_POR_PAGINA));
  const paginaSegura = Math.min(paginaApartados, totalPaginas);
  const gruposPagina = gruposFiltrados.slice((paginaSegura - 1) * APARTADOS_POR_PAGINA, paginaSegura * APARTADOS_POR_PAGINA);
  const paginacionApartados = { total: gruposFiltrados.length, pagina: paginaSegura, total_paginas: totalPaginas };
  function cambiarPagina(pagina: number) {
    setPaginaApartados(Math.min(Math.max(1, pagina), totalPaginas));
    setSalidaAbierta(null);
  }

  const [confirmacion, setConfirmacion] = useState<{
    titulo: string; mensaje: string; textoConfirmar: string; ejecutar: () => void;
  } | null>(null);

  // Al editar una cotización que también está en otra bodega (u otra empresa)
  // se le pueden quitar todas las líneas: se borra solo esta parte.
  const quitaEstaParte = Boolean(a.editandoId) && a.formulario.items.length === 0 && a.parteEditada.otrasPartes.length > 0;

  function guardarFormulario(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (lineasQueSePasan.length) return;
    if (!quitaEstaParte) {
      a.crearApartado(evento);
      return;
    }
    setConfirmacion({
      titulo: `¿Quitar la cotización ${a.formulario.numeroCotizacion} de ${a.parteEditada.bodega}?`,
      mensaje: `La cotización ${a.formulario.numeroCotizacion} sigue activa en ${a.parteEditada.otrasPartes.join(", ")}. `
        + `Solo se borra la parte de ${a.parteEditada.bodega}: no queda como anulada y su material reservado queda libre.`,
      textoConfirmar: "Sí, quitar",
      ejecutar: () => a.crearApartado({ preventDefault: () => {} }),
    });
  }

  // "Iniciar Producción" solo puede navegar de verdad si quien hace clic es
  // jefe_planta (el único rol con acceso a /produccion) -- para
  // administrativo (que también ve Apartados) es informativo, ya que
  // RutaProtegida lo rechazaría si navegara ahí.
  function irAIniciarProduccion(numeroCotizacion: string) {
    if (sesion.rol === "jefe_planta") {
      navigate(`/produccion?cotizacion=${encodeURIComponent(numeroCotizacion)}`);
    } else {
      setMensajeInformativo("Esto lo debe iniciar Planta desde \"Registrar Producción\".");
    }
  }

  // Lo de una línea de la cotización: su descripción resaltada y sus avisos
  // (bodega, material de la otra empresa, cortar, con salida, faltan...).
  function datosDeLinea(it: ApartadoDeLista["items"][number], ap: ApartadoDeLista, parteDe?: Map<number, ApartadoDeLista>) {
    const activa = ESTADOS_CANCELABLES.includes(ap.estado);
    // Stock cargado del Excel: ya descontado, pero mientras la
    // cotización siga activa todavía hay que alistarlo y despacharlo.
    const parte = parteDe?.get(it.id);
    const stockPorAlistar = it.modalidad === "por_stock" && it.stockDescontado && (parte ? ESTADOS_CANCELABLES.includes(parte.estado) : activa);
    const lista = it.modalidad === "por_stock" ? it.stockDescontado && !stockPorAlistar : (it.metrosPendientes ?? 0) <= 0;
    const codigo = it.modalidad === "por_stock" ? "" : it.codigoInterno;
    // Solo la descripción (como en el otro aplicativo); sin ella, la cantidad y el código.
    const texto = it.descripcion || (it.modalidad === "por_stock" ? `producto #${it.productoId}` : `${cantidadLinea(it)} ${codigo || ""}`);
    return {
      lista, codigo,
      descripcion: descripcionResaltada(texto, codigo ? colorDeCodigo(codigo) : "otro"),
      marcas: (
        <>
          {parte && (
            <span className="apartado-linea-bodega" title="De dónde sale">
              {parte.bodegaNombre}{parte.empresa !== ap.empresa ? ` · ${EMPRESAS[parte.empresa] || parte.empresa}` : ""}
            </span>
          )}
          {it.empresaMaterial && it.empresaMaterial !== (parte ?? ap).empresa && (
            <span className="etiqueta-otra-empresa" title={it.empresaMaterial === AMBAS_EMPRESAS
              ? "Planta usa rollos de las dos empresas; lo de la otra empresa queda como préstamo"
              : "El material sale de la otra empresa: queda como préstamo"}>
              Material de {nombreMaterial(it.empresaMaterial)}
            </span>
          )}
          {it.modalidad === "por_stock" && it.hayFisico && !it.stockDescontado && (
            <span className="etiqueta-otra-empresa" title="El sistema no lo tenía; se confirmó que está en la bodega">
              Sin existencia en el sistema
            </span>
          )}
          {it.modalidad === "por_stock" && (it.medida || pideCorte(it.descripcion)) && (
            <span className="apartado-linea-cortar">CORTAR{it.medida ? ` a ${it.medida} m` : ""}</span>
          )}
          {stockPorAlistar
            ? <span className="apartado-linea-estado" title="El inventario ya lo descontó; falta alistarlo y despacharlo">stock ya descontado</span>
            : lista
            ? <span className="apartado-linea-estado" title="Ya tiene salida">✓ con salida</span>
            : it.modalidad === "por_rollo" && (it.metrosConsumidos ?? 0) > 0
              ? <span className="apartado-linea-estado">faltan {it.metrosPendientes} m</span>
              : null}
        </>
      ),
    };
  }

  // Todas las líneas de la cotización, de lado a lado debajo de su fila, en el
  // orden en que se escribieron: número, descripción, código, cantidad y avisos.
  function detalleDeLineas(ap: ApartadoDeLista, parteDe?: Map<number, ApartadoDeLista>) {
    return (
      <div className="apartado-detalle">
        <div className="apartado-detalle-titulo">
          <strong>Cotización {ap.numeroCotizacion} · {ap.items.length} líneas</strong>
          <button type="button" className="apartado-ver-mas" onClick={() => alternarLineas(ap.id)}>Ocultar las líneas ▲</button>
        </div>
        <div className="apartado-detalle-contenedor">
          <table className="apartado-detalle-tabla">
            <thead>
              <tr><th>#</th><th>Descripción</th><th>Código</th><th>Cantidad</th><th>Avisos</th></tr>
            </thead>
            <tbody>
              {ap.items.map((it, posicion) => {
                const linea = datosDeLinea(it, ap, parteDe);
                return (
                  <tr key={it.id} className={linea.lista ? "apartado-linea-lista" : undefined}>
                    <td className="apartado-detalle-num">{posicion + 1}</td>
                    <td className="apartado-detalle-desc">{linea.descripcion}</td>
                    <td className="apartado-detalle-codigo">{linea.codigo || "Stock"}</td>
                    <td className="apartado-detalle-cantidad">{cantidadLinea(it)}</td>
                    <td><div className="apartado-linea-cabeza">{linea.marcas}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Lo de UNA parte de la cotización (una bodega): sus líneas, su estado y sus
  // botones. Admin Inventario ve la cotización completa en una sola fila, con
  // un bloque así por bodega (ver gruposFiltrados).
  // `parteDe` (solo cotización de varias bodegas): de qué parte es cada
  // línea, para ponerle su bodega al lado.
  function lineasDeParte(ap: ApartadoDeLista, parteDe?: Map<number, ApartadoDeLista>) {
    const itemsRollo = ap.items.filter((it) => it.modalidad === "por_rollo");
    const itemsStock = ap.items.filter((it) => it.modalidad === "por_stock");
    const rolloPendientes = itemsRollo.filter((it) => (it.metrosPendientes ?? 0) > 0).length;
    return (
      <>
      <ul className="apartado-lineas">
        {ap.items.slice(0, LINEAS_VISIBLES).map((it) => {
          const linea = datosDeLinea(it, ap, parteDe);
          return (
            <li key={it.id} className={linea.lista ? "apartado-linea-lista" : undefined}>
              <div className="apartado-linea-texto">{linea.descripcion}</div>
              <div className="apartado-linea-cabeza">{linea.marcas}</div>
            </li>
          );
        })}
      </ul>
      {ap.items.length > LINEAS_VISIBLES && (
        <button type="button" className="apartado-ver-mas" onClick={() => alternarLineas(ap.id)}>
          {lineasExpandidas.has(ap.id) ? "Ocultar las líneas ▲" : `Ver las ${ap.items.length} líneas ▼`}
        </button>
      )}
      <div className="apartado-chips">
        {itemsRollo.length > 0 && (
          <span className={`apartado-chip ${rolloPendientes ? "" : "apartado-chip-ok"}`}>
            Rollo {itemsRollo.length - rolloPendientes}/{itemsRollo.length}{rolloPendientes ? "" : " ✓"}
          </span>
        )}
        {itemsStock.length > 0 && (
          <span className={`apartado-chip ${ap.stockSeparadoConfirmado ? "apartado-chip-ok" : ""}`}>
            Stock {ap.stockSeparadoConfirmado ? "separado ✓" : "por separar"}
          </span>
        )}
      </div>
      {ap.faltantes.length > 0 && (
        <div className="apartado-faltantes">
          <strong>⏳ Esperando material</strong>
          <ul>
            {ap.faltantes.map((f) => <li key={f}>{f.replace(/^faltan /, "")}</li>)}
          </ul>
        </div>
      )}
      </>
    );
  }

  function estadoDeParte(ap: ApartadoDeLista) {
    return (
      <>
      {ap.ordenInterna && ap.estado === "produccion_terminada"
        ? <span className="apartados-estado estado-produccion_terminada">Por convertir la lámina lisa</span>
        : porDarSalida(ap) && !CERRADAS.includes(ap.estado)
        ? <span className="apartados-estado estado-por_dar_salida">Por dar salida</span>
        : <span className={`apartados-estado estado-${ap.estado}`}>{ETIQUETAS_ESTADO[ap.estado] || ap.estado}</span>}
      </>
    );
  }

  function accionesDeParte(ap: ApartadoDeLista) {
    const itemsRollo = ap.items.filter((it) => it.modalidad === "por_rollo");
    // Lámina por producir o productos de stock por alistar (una
    // cotización solo de stock, ej. UPVC con corte, también va a Planta).
    const tieneProduccionPendiente = (ap.estado === "enviado_a_produccion" || ap.estado === "en_produccion")
      && !ap.salidaPendiente
      && (calcularSolicitudesPendientes([ap]).length > 0 || calcularStockParaAlistar([ap]).length > 0);
    return (
      <>
      {a.puedeEnviarAProduccion && ap.estado === "apartado" && (
        <button
          disabled={ap.faltantes.length > 0}
          title={ap.faltantes.length ? "Esperando material: se habilita cuando le des ingreso" : undefined}
          onClick={() => confirmarEnvioAProduccion(ap)}
        >Enviar a producción</button>
      )}
      {a.puedeCancelarApartados && ESTADOS_CANCELABLES.includes(ap.estado) && (
        <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
          titulo: `¿Anular el apartado ${ap.numeroCotizacion}?`,
          mensaje: ap.estado === "apartado"
            ? "El material que tenía reservado queda libre para otras ventas."
            : "Ya fue enviado a producción. Al anularlo, el material que faltaba por producir queda libre para otras ventas y los productos de stock que ya se descontaron vuelven a la bodega. La lámina que ya se produjo NO vuelve al inventario.",
          textoConfirmar: "Sí, anular apartado",
          ejecutar: () => a.cancelarApartado(ap.id),
        })}>Anular</button>
      )}
      {/* Sin líneas = se unió a otra: no se elimina (así se sabe a dónde fueron). */}
      {a.puedeCancelarApartados && ap.estado === "cancelado" && ap.items.length > 0 && !ap.items.some((it) => it.tieneProduccionRegistrada) && (
        <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
          titulo: `¿Eliminar la cotización anulada ${ap.numeroCotizacion}?`,
          mensaje: "Se borra de la lista para siempre. No afecta el inventario: su material ya quedó libre al anularla.",
          textoConfirmar: "Sí, eliminar",
          ejecutar: () => a.eliminarApartado(ap.id),
        })}>Eliminar</button>
      )}
      {esAdminInventario && ESTADOS_CANCELABLES.includes(ap.estado) && !ap.ordenInterna && (
        <button onClick={() => { setSepararAbierta(null); setSalidaAbierta(ap.id); }}>Registrar salida</button>
      )}
      {!ap.ordenInterna && (ap.items.length > 1 || (ap.items[0]?.cantidad ?? 0) > 1)
        && ((esAdminInventario && (ESTADOS_CANCELABLES.includes(ap.estado) || ap.estado === "produccion_terminada"))
          || (a.puedeMarcarEntregado && ap.estado === "produccion_terminada" && !ap.ordenInterna)) && (
        <button onClick={() => { setSalidaAbierta(null); setSepararAbierta(ap.id); }}>Separar</button>
      )}
      {!ap.ordenInterna && candidatasParaUnir(ap).length > 0
        && ((esAdminInventario && (ESTADOS_CANCELABLES.includes(ap.estado) || ap.estado === "produccion_terminada"))
          || (a.puedeMarcarEntregado && ap.estado === "produccion_terminada")) && (
        <button onClick={() => { setSalidaAbierta(null); setSepararAbierta(null); setUnirAbierta(ap.id); }}>Unir</button>
      )}
      {tieneProduccionPendiente && !veTodasLasBodegas && (
        <button onClick={() => irAIniciarProduccion(ap.numeroCotizacion)}>
          {itemsRollo.some((it) => (it.metrosPendientes ?? 0) > 0) ? "Iniciar Producción" : "Alistar pedido"}
        </button>
      )}
      {a.puedeMarcarTerminado && !ap.salidaPendiente && (ap.estado === "enviado_a_produccion" || ap.estado === "en_produccion") && (
        <button onClick={() => setConfirmacion({
          titulo: `¿Marcar como terminada la producción de ${ap.numeroCotizacion}?`,
          mensaje: "Se cierra la producción de esta cotización y se descuenta el stock de sus productos apartados. No se puede deshacer.",
          textoConfirmar: "Sí, marcar terminada",
          ejecutar: () => a.marcarApartadoProduccionTerminada(ap.id),
        })}>Marcar producción terminada</button>
      )}
      {a.puedeMarcarEntregado && ap.estado === "produccion_terminada" && !ap.ordenInterna && (
        <button onClick={() => setConfirmacion({
          titulo: `¿Dar salida a la cotización ${ap.numeroCotizacion}?`,
          mensaje: `Confirma que el pedido ya salió de la bodega y se entregó a ${ap.cliente || "el cliente"}. Queda como Entregado y no se puede deshacer.`,
          textoConfirmar: "Sí, dar salida",
          ejecutar: () => a.marcarApartadoEntregado(ap.id),
        })}>Salida</button>
      )}
      </>
    );
  }

  // Botones de una cotización de varias bodegas: lo que se hace a toda la
  // cotización va en un solo botón; lo que es de una bodega (Registrar salida,
  // Separar) pregunta de cuál.
  const [eligiendoBodega, setEligiendoBodega] = useState<{ accion: "salida" | "separar"; numero: string } | null>(null);
  function accionesDeCotizacion(grupo: ApartadoDeLista[]) {
    const numero = grupo[0].numeroCotizacion;
    const activas = grupo.filter((parte) => ESTADOS_CANCELABLES.includes(parte.estado));
    const porEnviar = grupo.filter((parte) => parte.estado === "apartado");
    const esperando = porEnviar.some((parte) => parte.faltantes.length > 0);
    const conSalida = activas.filter((parte) => !parte.ordenInterna);
    const separables = grupo.filter((parte) => !parte.ordenInterna && (parte.items.length > 1 || (parte.items[0]?.cantidad ?? 0) > 1)
      && (ESTADOS_CANCELABLES.includes(parte.estado) || parte.estado === "produccion_terminada"));
    const eliminables = grupo.filter((parte) => parte.estado === "cancelado" && parte.items.length > 0
      && !parte.items.some((it) => it.tieneProduccionRegistrada));
    const elegir = (accion: "salida" | "separar", partes: ApartadoDeLista[]) => {
      if (partes.length === 1) {
        if (accion === "salida") { setSepararAbierta(null); setSalidaAbierta(partes[0].id); }
        else { setSalidaAbierta(null); setSepararAbierta(partes[0].id); }
        setEligiendoBodega(null);
      } else {
        setEligiendoBodega(eligiendoBodega?.accion === accion && eligiendoBodega.numero === numero ? null : { accion, numero });
      }
    };
    const opciones = eligiendoBodega?.numero === numero
      ? (eligiendoBodega.accion === "salida" ? activas : separables)
      : [];
    return (
      <>
      {a.puedeEnviarAProduccion && porEnviar.length > 0 && (
        <button
          disabled={esperando}
          title={esperando ? "Esperando material: se habilita cuando le des ingreso" : undefined}
          onClick={() => setConfirmacion({
            titulo: `¿Enviar ${numero} a producción?`,
            mensaje: `Planta verá esta cotización como pendiente de producir (${porEnviar.map((p) => p.bodegaNombre).join(" y ")}).`,
            textoConfirmar: "Sí, enviar a producción",
            ejecutar: () => a.enviarVariosAProduccion(porEnviar.map((p) => p.id)),
          })}
        >Enviar a producción</button>
      )}
      {a.puedeCancelarApartados && activas.length > 0 && (
        <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
          titulo: `¿Anular la cotización ${numero}?`,
          mensaje: `Se anula completa (${activas.map((p) => p.bodegaNombre).join(" y ")}). El material que tenía reservado queda libre para otras ventas. `
            + "Los productos de stock que ya se descontaron vuelven a la bodega; la lámina que ya se produjo NO vuelve al inventario.",
          textoConfirmar: "Sí, anular cotización",
          ejecutar: () => a.cancelarVarios(activas.map((p) => p.id)),
        })}>Anular</button>
      )}
      {a.puedeCancelarApartados && eliminables.length === grupo.length && (
        <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
          titulo: `¿Eliminar la cotización anulada ${numero}?`,
          mensaje: "Se borra de la lista para siempre. No afecta el inventario: su material ya quedó libre al anularla.",
          textoConfirmar: "Sí, eliminar",
          ejecutar: () => a.eliminarVarios(eliminables.map((p) => p.id)),
        })}>Eliminar</button>
      )}
      {esAdminInventario && conSalida.length > 0 && (
        <button onClick={() => elegir("salida", conSalida)}>Registrar salida</button>
      )}
      {esAdminInventario && separables.length > 0 && (
        <button onClick={() => elegir("separar", separables)}>Separar</button>
      )}
      {opciones.length > 0 && (
        <div className="apartado-elegir-bodega">
          <span>¿De qué bodega?</span>
          {opciones.map((parte) => (
            <button key={parte.id} type="button" onClick={() => elegir(eligiendoBodega!.accion, [parte])}>{parte.bodegaNombre}</button>
          ))}
        </div>
      )}
      </>
    );
  }

  function abrirEdicion(partes: ApartadoDeLista[]) {
    setSalidaAbierta(null);
    a.abrirEdicionApartado(partes[0], partes.slice(1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <div className="inventario-header">
            <h1 className="inventario-titulo">Apartados</h1>
            {(a.puedeCrearApartados || a.puedeCrearOrdenInterna) && !a.mostrarFormularioApartado && !mostrarImportar && (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {esAdminInventario && (
                  <button className="inventario-boton-cancelar" onClick={() => setMostrarImportar(true)}>
                    📥 Cargar desde Excel
                  </button>
                )}
                {a.puedeCrearApartados && (
                  <button className="inventario-boton" onClick={() => a.abrirFormularioApartado()}>
                    + Nuevo apartado
                  </button>
                )}
                {a.puedeCrearOrdenInterna && (
                  <button className="inventario-boton" onClick={() => a.abrirFormularioApartado(true)}>
                    + Orden de producción interna
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="inventario-carga-ayuda">
            {a.puedeCrearApartados
              ? <>Cuando se aprueba una cotización, créala aquí y elige de qué bodega sale el material.
                Cada línea puede ser material por rollo (código de clasificación, color y calibre) o un
                producto de stock (Tornillos, Amarres, etc.). El material queda reservado en esa bodega y a
                su encargada lo envía a producción desde la lista cuando quiera.
                {esAdminInventario
                  ? <> Aquí ves todas las cotizaciones (también las de los vendedores). Para producir stock (tejas, caballetes,
                    flanches o lámina lisa) crea una orden de producción interna.</>
                  : <> Aquí ves solo las cotizaciones que tú creaste.</>}</>
              : a.puedeEnviarAProduccion
                ? <>Aquí llegan las cotizaciones aprobadas (de los vendedores o de Admin Inventario) con el material ya reservado en tu
                  bodega. Envíalas a producción desde la lista con el botón "Enviar a producción".</>
                : <>Cotizaciones aprobadas con su material reservado.</>}
          </p>

          {a.errorAccionApartado && <p className="inventario-error">{a.errorAccionApartado}</p>}

          {a.mostrarFormularioApartado && (
            <form className="inventario-form apartado-form" onSubmit={guardarFormulario} noValidate>
              <h2 className="inventario-form-subtitulo">
                {a.formulario.ordenInterna
                  ? (a.editandoId ? `Editar orden ${a.formulario.numeroCotizacion}` : "Nueva orden de producción interna")
                  : a.editandoId ? `Editar cotización ${a.formulario.numeroCotizacion}` : "Nuevo apartado"}
              </h2>
              {a.formulario.ordenInterna && (
                <p className="inventario-carga-ayuda">
                  Orden para producir stock: el material queda apartado, la encargada de la bodega la envía a producción y lo que
                  Planta produzca entra al inventario. Una línea de lámina lisa dice en qué se convierte y qué bodega la convierte
                  (ej. Ricaurte corta y Santander saca los caballetes).
                </p>
              )}
              {a.editandoId && (
                <p className="inventario-carga-ayuda">
                  Puedes cambiar los datos y las líneas. Las líneas que ya tuvieron salida no se pueden quitar ni bajar de
                  lo que ya salió, y la bodega solo se puede cambiar si todavía no ha salido nada.
                </p>
              )}
              {a.editandoId && a.otrasPartesIds.length > 0 && (
                <p className="inventario-carga-ayuda">
                  Esta cotización está repartida y aquí está completa: cada línea dice de qué bodega y de qué empresa sale. Al
                  guardar, cada parte queda con sus líneas (si cambias la bodega o la empresa de una línea, pasa a la otra).
                </p>
              )}

              <h3 className="apartado-form-seccion"><span className="apartado-form-paso">1</span> Datos de la {a.formulario.ordenInterna ? "orden" : "cotización"}</h3>
              <div className="inventario-form-grid apartado-form-datos">
                <div>
                  <label>Esta cotización es de *</label>
                  <select value={a.formulario.empresa} onChange={(e) => a.actualizarCampoApartado("empresa", e.target.value)}>
                    <option value="">Elige la empresa...</option>
                    {Object.entries(EMPRESAS).map(([sigla, nombre]) => (
                      <option key={sigla} value={sigla}>{nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Número de cotización *</label>
                  <input
                    placeholder={a.formulario.empresa ? "Ej. 3953" : "Se pone solo al elegir la empresa"}
                    value={a.formulario.numeroCotizacion}
                    onChange={(e) => a.actualizarCampoApartado("numeroCotizacion", e.target.value)}
                  />
                </div>
                {!a.formulario.ordenInterna && (
                  <div>
                    <label>Cliente</label>
                    <input
                      value={a.formulario.cliente}
                      onChange={(e) => a.actualizarCampoApartado("cliente", e.target.value)}
                    />
                  </div>
                )}
              </div>

              <h3 className="apartado-form-seccion">
                <span className="apartado-form-paso">2</span> Productos
                <span className="apartado-form-contador">{a.formulario.items.length}</span>
              </h3>
              {a.formulario.items.map((item, indice) => (
                <div key={indice} className="apartado-item">
                  <div className="apartado-item-cabecera">
                  <span className="apartado-item-numero">Producto {indice + 1}</span>
                  {item.id && (item.metrosConsumidos || item.stockDescontado) ? (
                    <p className="apartado-linea-con-salida">
                      ✓ Esta línea ya tiene salida{item.stockDescontado ? " (stock descontado)" : `: ${item.metrosConsumidos} m`}.
                      {item.stockDescontado ? " No se puede cambiar." : " Puedes subirla, pero no quitarla ni bajarla de lo que ya salió."}
                      {item.bodegaId && ` Sale de ${almacen.bodegas.find((b) => String(b.id) === String(item.bodegaId))?.nombre || "otra bodega"}.`}
                    </p>
                  ) : null}
                  {!(item.metrosConsumidos || item.stockDescontado) && (
                    <div className="apartado-linea-cabecera">
                      <select
                        aria-label="Empresa de la que sale el material de este producto"
                        className={`apartados-select ${item.empresa ? "apartados-select-activo" : ""}`}
                        value={item.empresa || a.formulario.empresa}
                        disabled={!a.formulario.empresa}
                        onChange={(e) => a.cambiarEmpresaItem(indice, e.target.value)}
                      >
                        {!a.formulario.empresa && <option value="">Material de...</option>}
                        {Object.entries(EMPRESAS).map(([sigla, nombre]) => (
                          <option key={sigla} value={sigla}>Material de {nombre}</option>
                        ))}
                        {/* Solo lámina por producir: un producto o un rollo completo es de una sola empresa. */}
                        {item.modalidad === "por_rollo" && (
                          <option value={AMBAS_EMPRESAS}>Material de las dos empresas</option>
                        )}
                      </select>
                      {item.empresa === AMBAS_EMPRESAS ? (
                        <span className="etiqueta-otra-empresa" title="Planta puede usar rollos de las dos empresas; lo que salga de rollos de la otra empresa queda como préstamo">
                          Material de las dos empresas
                        </span>
                      ) : item.empresa && item.empresa !== a.formulario.empresa && (
                        <span className="etiqueta-otra-empresa" title="Sigue siendo la misma cotización: lo que salga de esta línea queda como préstamo">
                          Préstamo de {EMPRESAS[item.empresa] || item.empresa}
                        </span>
                      )}
                      <select
                        aria-label="Bodega de donde sale este producto"
                        title="Si las líneas salen de varias bodegas, al guardar la cotización queda repartida (mismo número)."
                        className="apartados-select apartados-select-activo"
                        value={item.bodegaId || ""}
                        onChange={(e) => a.cambiarBodegaItem(indice, e.target.value)}
                      >
                        <option value="">Sale de la bodega...</option>
                        {almacen.bodegas.map((b) => (
                          <option key={b.id} value={b.id}>Sale de {b.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {(a.formulario.items.length > 1 || a.parteEditada.otrasPartes.length > 0) && !(item.metrosConsumidos || item.stockDescontado) && (
                    <button type="button" className="apartado-item-quitar" onClick={() => a.quitarItemApartado(indice)}
                      aria-label={`Quitar el producto ${indice + 1}`}>
                      Quitar
                    </button>
                  )}
                  </div>
                  <div className="inventario-form-grid apartado-item-campos">
                  <div style={{ gridColumn: "1 / -1", display: item.id || a.formulario.ordenInterna ? "none" : undefined }}>
                    <label>Tipo de material</label>
                    <div className="apartado-tipos" role="group" aria-label="Tipo de material">
                      <button
                        type="button"
                        className={`apartado-tipo-boton ${item.modalidad === "por_rollo" ? "apartado-tipo-activo" : ""}`}
                        onClick={() => a.cambiarModalidadItem(indice, "por_rollo")}
                      >
                        Material por rollo
                      </button>
                      <button
                        type="button"
                        className={`apartado-tipo-boton ${item.modalidad === "por_stock" ? "apartado-tipo-activo" : ""}`}
                        onClick={() => a.cambiarModalidadItem(indice, "por_stock")}
                      >
                        Producto de stock
                      </button>
                      <button
                        type="button"
                        className={`apartado-tipo-boton ${item.modalidad === "rollo_completo" ? "apartado-tipo-activo" : ""}`}
                        onClick={() => a.cambiarModalidadItem(indice, "rollo_completo")}
                      >
                        Rollo completo
                      </button>
                    </div>
                  </div>

                  {item.modalidad === "por_rollo" ? (
                    <div className="apartado-campo-codigo">
                      <label>Código de clasificación *</label>
                      <input
                        placeholder="Ej. LA50170,27"
                        readOnly={Boolean(item.id && item.metrosConsumidos)}
                        title={item.id && item.metrosConsumidos ? "Esta línea ya tiene salida: el código no se puede cambiar." : undefined}
                        value={item.codigoInterno}
                        onChange={(e) => a.actualizarItemApartado(indice, "codigoInterno", e.target.value.toUpperCase())}
                        onBlur={(e) => a.consultarDisponibilidadItem(indice, e.target.value.toUpperCase())}
                      />
                      {disponibilidadItems[indice]?.sinBodega && (
                        <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                          Elige primero la bodega para ver el material disponible.
                        </p>
                      )}
                      {disponibilidadItems[indice]?.cargando && (
                        <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
                          Consultando material disponible...
                        </p>
                      )}
                      {disponibilidadItems[indice]?.error && (
                        <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                          No se pudo consultar el material disponible.
                        </p>
                      )}
                      {disponibilidadItems[indice]?.datos && disponibilidadDelCodigo(item, disponibilidadItems[indice].datos)}
                      {excesoPorLinea[indice] && (
                        <p className="inventario-error apartado-aviso-texto">
                          Con esta línea, la cotización pide <strong>{num(excesoPorLinea[indice].pedido)} m</strong> de {excesoPorLinea[indice].codigo},
                          pero entre las dos empresas y todas las bodegas solo hay <strong>{num(excesoPorLinea[indice].hay)} m disponibles</strong>.
                          Faltan {num(excesoPorLinea[indice].pedido - excesoPorLinea[indice].hay)} m: baja la cantidad o quita la línea.
                        </p>
                      )}
                      {avisoOtraBodega(item, indice)}
                    </div>
                  ) : item.modalidad === "rollo_completo" ? (
                    <ElegirRolloCompleto
                      rollos={a.rollosParaApartar[item.bodegaId || a.formulario.bodegaId]}
                      rolloId={item.rolloId} rolloResumen={item.rolloResumen}
                      ocupados={a.formulario.items.filter((_, i) => i !== indice).map((it) => it.rolloId).filter((id): id is number => Boolean(id))}
                      fijo={Boolean(item.id)}
                      sinBodega={!(item.bodegaId || a.formulario.bodegaId)}
                      alElegir={(rollo) => a.seleccionarRolloCompleto(indice, rollo, rollo ? descripcionRolloCompleto(rollo) : "")}
                      alReintentar={() => a.cargarRollosParaApartar(item.bodegaId || a.formulario.bodegaId, true)}
                    />
                  ) : (
                    <div className="apartado-campo-ancho">
                      <label>Producto *</label>
                      {item.productoId ? (
                        <div className="inventario-carga-ayuda" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>{item.productoCodigo && <strong>{item.productoCodigo} — </strong>}{item.productoDescripcion}</span>
                          {!(item.id && item.stockDescontado) && (
                            <button type="button" className="inventario-boton-cancelar" onClick={() => a.cambiarModalidadItem(indice, "por_stock")}>
                              Cambiar
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <input
                            placeholder={!(item.bodegaId || a.formulario.bodegaId) ? "Elige primero la bodega de este producto"
                              : !a.formulario.empresa ? "Elige primero la empresa" : "Buscar por código o descripción..."}
                            disabled={!(item.bodegaId || a.formulario.bodegaId) || !a.formulario.empresa}
                            value={item.busquedaProducto}
                            onChange={(e) => a.buscarProductoParaItem(indice, e.target.value)}
                          />
                          {(() => {
                            // El producto no existe: se crea primero en Inventario (no desde la cotización).
                            const texto = item.busquedaProducto.trim();
                            const resultados = a.resultadosBusquedaProducto[indice] as Record<string, unknown>[] | undefined;
                            const yaExiste = resultados?.some((p) => String(p.codigo ?? "").toUpperCase() === texto.toUpperCase());
                            if (texto.length < 2 || !resultados || resultados.length > 0 || yaExiste) return null;
                            return (
                              <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                                Ese producto no está en el inventario. Créalo primero en Inventario y luego vuelve a la cotización.
                              </p>
                            );
                          })()}
                          {a.resultadosBusquedaProducto[indice]?.length > 0 && (
                            <div className="inventario-tabla-contenedor" style={{ maxHeight: "180px", overflowY: "auto" }}>
                              {a.resultadosBusquedaProducto[indice].map((p: Record<string, any>) => {
                                // Sin stock en el sistema: solo se puede escoger el de ESTA bodega
                                // (no se deja guardar: hay que darle entrada primero).
                                const sinStock = (p.disponible_empresa ?? 1) <= 0;
                                const deEstaBodega = p.bodega_id === Number(item.bodegaId || a.formulario.bodegaId);
                                return (
                                <button
                                  type="button"
                                  key={p.id}
                                  className="inventario-resultado-busqueda"
                                  style={{ display: "block", width: "100%", textAlign: "left", padding: "0.4rem", opacity: !sinStock ? 1 : deEstaBodega ? 0.85 : 0.55 }}
                                  disabled={sinStock && !deEstaBodega}
                                  title={sinStock ? (deEstaBodega ? "Sin stock en el sistema: dale entrada primero" : "No hay de este producto sin prometer en toda la empresa") : undefined}
                                  onClick={() => a.seleccionarProductoParaItem(indice, p)}
                                >
                                  <strong>{p.codigo}</strong> — {p.descripcion} · {EMPRESAS[p.empresa] || p.empresa || "sin empresa"} (stock: {p.stock})
                                  {p.disponible_empresa != null && (
                                    <em style={{ display: "block", fontSize: "0.8rem", color: p.disponible_empresa > 0 ? undefined : "#b3261e" }}>
                                      {p.disponible_empresa > 0
                                        ? `Disponible en toda la empresa: ${p.disponible_empresa}`
                                        : deEstaBodega
                                          ? "Sin stock en el sistema: dale entrada primero"
                                          : "Sin stock disponible en la empresa: no se puede apartar"}
                                    </em>
                                  )}
                                  {!deEstaBodega && (
                                    <em style={{ display: "block", fontSize: "0.8rem" }}>
                                      Está en {almacen.bodegas.find((b) => b.id === p.bodega_id)?.nombre || "otra bodega"}: se pide con un traslado.
                                    </em>
                                  )}
                                </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                      {disponibilidadItems[indice]?.cargando && (
                        <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
                          Consultando disponibilidad...
                        </p>
                      )}
                      {disponibilidadItems[indice]?.error && (
                        <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                          No se pudo consultar la disponibilidad de ese producto.
                        </p>
                      )}
                      {disponibilidadItems[indice]?.datos && item.modalidad === "por_stock" && (
                        <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
                          Esta bodega tiene <strong>{num(Math.max(disponibilidadItems[indice].datos.cantidadDisponible ?? 0, 0))} disponibles</strong>
                          {" "}de este producto (hay {num(disponibilidadItems[indice].datos.stock)} y {num(disponibilidadItems[indice].datos.cantidadReservada)} ya
                          están reservados para otras cotizaciones).
                          {disponibilidadItems[indice].datos.disponibleEmpresa != null && (
                            <>
                              <br />
                              Sumando todas las bodegas de la empresa hay <strong>{num(disponibilidadItems[indice].datos.disponibleEmpresa)}</strong> disponibles
                              {disponibilidadItems[indice].datos.enOtrasBodegas && <> (también en {disponibilidadItems[indice].datos.enOtrasBodegas})</>}.
                            </>
                          )}
                        </p>
                      )}
                      {/* Ya no se aparta lo que el sistema no tiene: la casilla solo queda
                          en líneas viejas que la tenían (se puede quitar, no poner). */}
                      {item.modalidad === "por_stock" && item.productoId && !item.stockDescontado && item.id && item.hayFisicoOriginal && (
                        <label className="apartado-aviso-otra-bodega" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", cursor: "pointer" }}>
                          <input type="checkbox" checked={Boolean(item.hayFisico)}
                            onChange={(e) => a.actualizarItemApartado(indice, "hayFisico", e.target.checked)} />
                          <span>
                            <strong>Sí están en la bodega.</strong> Esta línea se apartó antes sin que el sistema tuviera el
                            producto. Si la desmarcas, ya no se puede volver a marcar.
                          </span>
                        </label>
                      )}
                      {item.modalidad === "por_stock" && item.productoId && !item.stockDescontado && !item.hayFisico
                        && (disponibilidadItems[indice]?.datos?.cantidadDisponible ?? Infinity) + 0.005 < (Number(item.cantidad) || 1) && (
                        <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                          Esta bodega solo tiene {num(Math.max(disponibilidadItems[indice]?.datos?.cantidadDisponible ?? 0, 0))} disponibles
                          de este producto: no alcanza. Dale entrada en Inventario o escoge otra bodega.
                        </p>
                      )}
                      {item.modalidad === "por_stock" && !item.hayFisico && avisoOtraBodega(item, indice)}
                    </div>
                  )}

                  {item.modalidad !== "rollo_completo" && (
                    <div>
                      <label>Cantidad *</label>
                      <input
                        type="number" min="0" step="1"
                        value={item.cantidad}
                        onChange={(e) => a.actualizarItemApartado(indice, "cantidad", e.target.value)}
                      />
                    </div>
                  )}
                  {item.modalidad === "por_rollo" && (
                    <div>
                      <label>Medida (m por unidad) *</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={item.medida}
                        onChange={(e) => a.actualizarItemApartado(indice, "medida", e.target.value)}
                      />
                    </div>
                  )}
                  {item.modalidad === "por_rollo" && (
                    <div>
                      <label>Tipo</label>
                      <select
                        aria-label="Tipo de producto de la línea"
                        value={item.tipoProducto}
                        disabled={Boolean(item.metrosConsumidos)}
                        onChange={(e) => a.actualizarItemApartado(indice, "tipoProducto", e.target.value)}
                      >
                        <option value="">Teja / lámina</option>
                        <option value="caballete">Caballete (3 por corte)</option>
                        <option value="flanche">Flanche (5 por corte)</option>
                        {a.formulario.ordenInterna && <option value="lamina_lisa">Lámina lisa (para convertir)</option>}
                      </select>
                    </div>
                  )}
                  {item.modalidad === "por_rollo" && item.tipoProducto === "lamina_lisa" && (
                    <>
                      <div>
                        <label>Se convierte en</label>
                        <select
                          aria-label="En qué se convierte la lámina lisa"
                          value={item.convertirEn || "caballete"}
                          disabled={Boolean(item.id && item.laminasConvertidas)}
                          onChange={(e) => a.actualizarItemApartado(indice, "convertirEn", e.target.value)}
                        >
                          <option value="caballete">Caballetes (3 por lámina)</option>
                          <option value="flanche">Flanches (5 por lámina)</option>
                        </select>
                      </div>
                      <div>
                        <label>Bodega que la convierte</label>
                        <select
                          aria-label="Bodega que convierte la lámina lisa"
                          value={item.bodegaConversionId || ""}
                          onChange={(e) => a.actualizarItemApartado(indice, "bodegaConversionId", e.target.value)}
                        >
                          <option value="">La misma que la produce</option>
                          {almacen.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                        </select>
                      </div>
                      {Number(item.cantidad) > 0 && Number(item.medida) > 0 && (
                        <p className="inventario-carga-ayuda" style={{ gridColumn: "1 / -1", margin: 0 }}>
                          Se apartan <strong>{metrosDeLinea(Number(item.cantidad), Number(item.medida)).metros} m de lámina</strong>: {item.cantidad} láminas
                          de {item.medida} m = {Number(item.cantidad) * ((item.convertirEn || "caballete") === "flanche" ? 5 : 3)}{" "}
                          {(item.convertirEn || "caballete") === "flanche" ? "flanches" : "caballetes"}.
                        </p>
                      )}
                    </>
                  )}
                  {item.modalidad === "por_rollo" && item.tipoProducto && item.tipoProducto !== "lamina_lisa" && Number(item.cantidad) > 0 && Number(item.medida) > 0 && (() => {
                    const { metros, cortes, sobrantes } = metrosDeLinea(Number(item.cantidad), Number(item.medida), item.tipoProducto);
                    return (
                      <p className="inventario-carga-ayuda" style={{ gridColumn: "1 / -1", margin: 0 }}>
                        Se apartan <strong>{metros} m de lámina</strong>: {cortes} corte{cortes === 1 ? "" : "s"} de {item.medida} m
                        {sobrantes > 0 && <> · sobra{sobrantes === 1 ? "" : "n"} {sobrantes} {item.tipoProducto}{sobrantes === 1 ? "" : "s"} que queda{sobrantes === 1 ? "" : "n"} como stock</>}.
                      </p>
                    );
                  })()}
                  {item.modalidad === "por_stock" && (
                    <div>
                      <label>Cortar a (m) — opcional</label>
                      <input
                        type="number" min="0" step="0.01"
                        placeholder="Sin corte"
                        value={item.medida}
                        disabled={Boolean(item.id && item.stockDescontado)}
                        onChange={(e) => a.actualizarItemApartado(indice, "medida", e.target.value)}
                      />
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Descripción</label>
                    {/* Ancha y de dos renglones: las descripciones de las cotizaciones son largas. */}
                    <textarea
                      className="apartado-descripcion-linea"
                      rows={2}
                      placeholder="Ej. Teja de 6 metros"
                      value={item.descripcion}
                      onChange={(e) => a.actualizarItemApartado(indice, "descripcion", e.target.value)}
                    />
                    {item.modalidad === "por_rollo" && calibreQueNoCuadra(item.codigoInterno, item.descripcion) && (
                      <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                        {calibreQueNoCuadra(item.codigoInterno, item.descripcion)}
                      </p>
                    )}
                  </div>
                  </div>
                </div>
              ))}
              <button type="button" className="apartado-agregar" onClick={a.agregarItemApartado}>
                + Agregar producto
              </button>

              <h3 className="apartado-form-seccion"><span className="apartado-form-paso">3</span> Observaciones <span className="apartado-form-opcional">(opcional)</span></h3>
              <div className="inventario-form-grid">
                <div style={{ gridColumn: "1 / -1" }}>
                  <textarea
                    rows={3}
                    aria-label="Observaciones"
                    placeholder="Ej. el cliente recoge el viernes"
                    value={a.formulario.observaciones}
                    onChange={(e) => a.actualizarCampoApartado("observaciones", e.target.value)}
                  />
                </div>
              </div>

              {ofrecerMaterialEnCamino && (
                <p className="inventario-carga-ayuda" style={{ margin: "0.75rem 0" }}>
                  <strong>Alguna línea no tiene suficiente material en su bodega.</strong> Si lo que falta está en otra bodega o
                  viene en camino, la cotización se crea igual y queda «esperando material»: la bodega pide el traslado y la envía
                  a producción cuando llegue. Si no alcanza ni sumando toda la empresa, no se puede crear.
                </p>
              )}

              {quitaEstaParte && (
                <p style={{ color: "#b3261e", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>
                  Quitaste todas las líneas: al guardar se quita la cotización {a.formulario.numeroCotizacion} de{" "}
                  <strong>{a.parteEditada.bodega}</strong>. Sigue activa en <strong>{a.parteEditada.otrasPartes.join(", ")}</strong>.
                </p>
              )}

              {a.errorFormularioApartado && <p className="inventario-error">{a.errorFormularioApartado}</p>}
              {lineasQueSePasan.length > 0 && (
                <p className="inventario-error">
                  No alcanza el material: revisa la línea {lineasQueSePasan.join(", ")} (baja la cantidad o quítala) para poder guardar.
                </p>
              )}

              <div className="inventario-form-botones apartado-form-pie">
                <div className="apartado-form-resumen">{resumenDelFormulario()}</div>
                <button type="submit" className="inventario-boton" disabled={a.guardandoApartado || lineasQueSePasan.length > 0}>
                  {a.guardandoApartado ? "Guardando..." : quitaEstaParte ? `Quitar de ${a.parteEditada.bodega}` : a.editandoId ? "Guardar cambios" : a.formulario.ordenInterna ? "Crear orden" : "Crear apartado"}
                </button>
                <button type="button" className="inventario-boton-cancelar" onClick={a.cerrarFormularioApartado}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {mostrarImportar && (
            <PanelImportarCotizaciones alTerminar={a.cargarApartados} alCerrar={() => setMostrarImportar(false)} />
          )}

          {!a.mostrarFormularioApartado && (
            <>
              <div className="inventario-pestanas apartados-pestanas">
                {(Object.entries(PESTANAS) as [Pestana, string][]).map(([clave, nombre]) => (
                  <button
                    key={clave}
                    type="button"
                    className={`inventario-pestana-boton ${pestana === clave ? "inventario-pestana-activa" : ""}`}
                    onClick={() => cambiarPestana(clave)}
                  >
                    {nombre}
                  </button>
                ))}
              </div>
              <div className="apartados-filtros">
                <div className="inventario-buscador apartados-buscador">
                  <input
                    type="text"
                    placeholder="Buscar cotización o cliente..."
                    value={filtroTexto}
                    onChange={(e) => setFiltroTexto(e.target.value)}
                  />
                </div>
                {pestana === "cotizaciones" && (
                  <select
                    className={`apartados-select ${a.filtroEstado ? `apartados-select-activo estado-${a.filtroEstado}` : ""}`}
                    value={a.filtroEstado} onChange={(e) => a.setFiltroEstado(e.target.value)} aria-label="Estado"
                  >
                    <option value="">Todos los estados</option>
                    {Object.entries(ETIQUETAS_ESTADO).filter(([valor]) => !Object.values(ESTADO_DE_PESTANA).includes(valor) && valor !== "produccion_terminada").map(([valor, etiqueta]) => (
                      <option key={valor} value={valor}>{etiqueta}</option>
                    ))}
                  </select>
                )}
                {veTodasLasBodegas && (
                  <select
                    className={`apartados-select ${filtroBodega ? "apartados-select-activo" : ""}`}
                    value={filtroBodega} onChange={(e) => setFiltroBodega(e.target.value)} aria-label="Bodega"
                  >
                    <option value="">Todas las bodegas</option>
                    {almacen.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </select>
                )}
                <select
                  className={`apartados-select ${filtroEmpresa ? `apartados-select-activo empresa-${filtroEmpresa}` : ""}`}
                  value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} aria-label="Empresa"
                >
                  <option value="">Todas las empresas</option>
                  {Object.entries(EMPRESAS).map(([sigla, nombre]) => <option key={sigla} value={sigla}>{nombre}</option>)}
                </select>
                {pestana === "cotizaciones" && <label className={`apartados-select apartados-check ${soloPendientesSalida ? "apartados-select-activo" : ""}`}>
                  <input type="checkbox" checked={soloPendientesSalida}
                    onChange={(e) => setSoloPendientesSalida(e.target.checked)} />
                  Solo pendientes de salida
                </label>}
                {hayFiltros && (
                  <button type="button" className="apartados-limpiar" onClick={limpiarFiltros}>Limpiar filtros</button>
                )}
              </div>
              {!a.cargandoApartados && (
                <p className="inventario-carga-ayuda" style={{ margin: "0 0 0.5rem" }}>
                  {pestana === "pendientes_salida"
                    ? `${apartadosFiltrados.length} ${apartadosFiltrados.length === 1 ? "cotización" : "cotizaciones"}: las de "Producción terminada" ya las terminó Planta y la bodega les da "Salida" cuando el pedido sale; `
                      + `las de "Por dar salida" ya salieron pero falta saber de qué rollo (cuando revisen la hoja de vida, Admin Inventario usa "Registrar salida" con la referencia del rollo).`
                    : pestana === "entregadas"
                    ? `${apartadosFiltrados.length} ${apartadosFiltrados.length === 1 ? "cotización entregada" : "cotizaciones entregadas"} al cliente.`
                    : pestana === "canceladas"
                    ? `${apartadosFiltrados.length} ${apartadosFiltrados.length === 1 ? "cotización anulada" : "cotizaciones anuladas"}.`
                    : `Mostrando ${apartadosFiltrados.length} cotizaciones sin entregar`
                      + `${a.filtroEstado ? ` en estado "${ETIQUETAS_ESTADO[a.filtroEstado] || a.filtroEstado}"` : ""}.`}
                </p>
              )}

              {a.cargandoApartados ? (
                <p className="inventario-cargando">Cargando apartados...</p>
              ) : (
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla apartados-tabla">
                    <thead>
                      <tr>
                        {veTodasLasBodegas && <th className="ap-col-bodega">Bodega</th>}
                        <th className="ap-col-cotizacion">Cotización</th>
                        <th className="ap-col-empresa">Empresa</th>
                        <th className="ap-col-cliente">Cliente</th>
                        <th className="ap-col-productos">Productos</th>
                        <th className="ap-col-estado">Estado</th>
                        <th className="ap-col-fecha">Creado</th>
                        <th className="ap-col-acciones">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apartadosFiltrados.length === 0 ? (
                        <tr>
                          <td colSpan={veTodasLasBodegas ? 8 : 7} className="inventario-vacio">
                            {pestana !== "cotizaciones" && !hayFiltros
                              ? `Todavía no hay cotizaciones ${pestana}.`
                              : a.apartados.length === 0 ? "No hay apartados registrados." : "Ninguna cotización coincide con los filtros."}
                          </td>
                        </tr>
                      ) : (
                        gruposPagina.map((grupo) => {
                          const ap = grupo[0];
                          const variasBodegas = grupo.length > 1;
                          const nombresGrupo = new Set(grupo.flatMap((parte) => [parte.bodegaNombre, `${parte.numeroCotizacion} (${parte.bodegaNombre})`]));
                          // Otras partes que NO están en esta fila (otra pestaña, o "3811-AR").
                          const otrasFuera = [...new Set(grupo.flatMap((parte) => parte.otrasPartes))].filter((o) => !nombresGrupo.has(o));
                          // Editar abre la cotización completa: todas sus partes activas,
                          // también las que un filtro deja fuera de la lista.
                          // Varias bodegas: todas las líneas juntas, como una sola cotización.
                          const parteDeLinea = new Map(grupo.flatMap((parte) => parte.items.map((it) => [it.id, parte] as const)));
                          const unida: ApartadoDeLista = {
                            ...ap,
                            // En el orden en que se escribieron (id), no parte por parte.
                            items: grupo.flatMap((parte) => parte.items).sort((x, y) => x.id - y.id),
                            faltantes: grupo.flatMap((parte) => parte.faltantes.map((f) => `${parte.bodegaNombre}: ${f.replace(/^faltan /, "")}`)),
                            stockSeparadoConfirmado: grupo.every((parte) => parte.stockSeparadoConfirmado || !parte.items.some((it) => it.modalidad === "por_stock")),
                          };
                          const estadosIguales = grupo.every((parte) => parte.estado === ap.estado && porDarSalida(parte) === porDarSalida(ap));
                          const partesActivas = a.apartados
                            .filter((otra) => numeroSinEmpresa(otra.numeroCotizacion) === numeroSinEmpresa(ap.numeroCotizacion) && ESTADOS_CANCELABLES.includes(otra.estado))
                            .sort((x, y) => x.id - y.id);
                          return (
                          <Fragment key={ap.id}>
                          <tr className={variasBodegas ? "apartado-fila-varias" : undefined}>
                            {veTodasLasBodegas && (
                              <td className="ap-col-bodega" data-etiqueta={variasBodegas ? "Bodegas" : "Bodega"}>
                                {grupo.map((parte) => parte.bodegaNombre || "—").join(" + ")}
                              </td>
                            )}
                            <td className="ap-col-cotizacion">
                              {ap.numeroCotizacion}
                              {ap.ordenInterna && (
                                <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600 }}>Orden interna</span>
                              )}
                              {variasBodegas && (
                                <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.75 }}>Sale de {grupo.length} bodegas</span>
                              )}
                              {otrasFuera.length > 0 && (
                                <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.75 }} title="Otras partes activas de esta misma cotización">
                                  También en: {otrasFuera.join(", ")}
                                </span>
                              )}
                            </td>
                            <td className="ap-col-empresa" data-etiqueta="Empresa">{EMPRESAS[ap.empresa] || ap.empresa || "—"}</td>
                            <td className="ap-col-cliente">{ap.cliente || "—"}</td>
                            <td className="ap-col-productos" style={{ minWidth: 340 }}>
                              {variasBodegas ? lineasDeParte(unida, parteDeLinea) : lineasDeParte(ap)}
                            </td>
                            <td className="ap-col-estado">
                              {!variasBodegas || estadosIguales
                                ? estadoDeParte(ap)
                                : grupo.map((parte) => (
                                  <div key={parte.id} className="apartado-estado-bodega">
                                    <span>{parte.bodegaNombre}</span>
                                    {estadoDeParte(parte)}
                                  </div>
                                ))}
                            </td>
                            <td className="ap-col-fecha" data-etiqueta="Creado" style={{ whiteSpace: "nowrap" }}>{formatearFechaColombia(ap.fechaCreacion, false)}</td>
                            <td className="inventario-acciones ap-col-acciones">
                              {a.puedeEditarApartados && partesActivas.length > 0 && (variasBodegas || ESTADOS_CANCELABLES.includes(ap.estado)) && (
                                <button onClick={() => abrirEdicion(partesActivas)}>Editar</button>
                              )}
                              {variasBodegas ? accionesDeCotizacion(grupo) : accionesDeParte(ap)}
                            </td>
                          </tr>
                          {lineasExpandidas.has(ap.id) && (variasBodegas ? unida : ap).items.length > LINEAS_VISIBLES && (
                            <tr className="apartado-fila-detalle">
                              <td colSpan={veTodasLasBodegas ? 8 : 7}>
                                {variasBodegas ? detalleDeLineas(unida, parteDeLinea) : detalleDeLineas(ap)}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {!a.cargandoApartados && (
                <Paginacion paginacion={paginacionApartados} alCambiarPagina={cambiarPagina} etiqueta="cotizaciones" />
              )}
            </>
          )}
        </div>
      </div>
      {salidaAbierta !== null && a.apartados.some((ap) => ap.id === salidaAbierta) && (
        <PanelRegistrarSalida
          apartado={a.apartados.find((ap) => ap.id === salidaAbierta)!}
          alTerminar={() => { setSalidaAbierta(null); a.cargarApartados(); }}
          alCerrar={cerrarSalida}
        />
      )}
      {separarAbierta !== null && a.apartados.some((ap) => ap.id === separarAbierta) && (
        <PanelSepararCotizacion
          apartado={a.apartados.find((ap) => ap.id === separarAbierta)!}
          alTerminar={(numeroNueva) => {
            setSepararAbierta(null);
            setMensajeInformativo(`Listo: las líneas que el cliente no se lleva quedaron en la cotización ${numeroNueva}.`);
            a.cargarApartados();
          }}
          alCerrar={cerrarSeparar}
        />
      )}
      {unirAbierta !== null && a.apartados.some((ap) => ap.id === unirAbierta) && (() => {
        const destino = a.apartados.find((ap) => ap.id === unirAbierta)!;
        return (
          <PanelUnirCotizacion
            apartado={destino}
            candidatas={candidatasParaUnir(destino)}
            alTerminar={(numeroUnida) => {
              setUnirAbierta(null);
              setMensajeInformativo(`Listo: la cotización ${numeroUnida} quedó unida a la ${destino.numeroCotizacion} (y quedó anulada con una nota).`);
              a.cargarApartados();
            }}
            alCerrar={cerrarUnir}
          />
        );
      })()}
      {mensajeInformativo && (
        <ModalConfirmacion
          mensaje={mensajeInformativo}
          textoConfirmar="Entendido"
          onConfirmar={() => setMensajeInformativo("")}
        />
      )}
      {confirmacion && (
        <ModalConfirmacion
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          textoCancelar="No, volver"
          textoConfirmar={confirmacion.textoConfirmar}
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={() => {
            // Se cierra antes de ejecutar: un segundo clic ya no encuentra el
            // botón, así que la acción no se manda dos veces.
            const { ejecutar } = confirmacion;
            setConfirmacion(null);
            ejecutar();
          }}
        />
      )}
    </div>
  );
}

export default ApartadosPage;
