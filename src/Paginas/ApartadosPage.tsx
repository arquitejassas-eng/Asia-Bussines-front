import { useCallback, useEffect, useMemo, useState } from "react";
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
// Cotizaciones con muchas líneas (ej. 18 tejas distintas) muestran estas y un "+N más".
const LINEAS_VISIBLES = 4;

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

function cantidadLinea(it: { modalidad: string; cantidad: number; medida: number | null; metrosRequeridos: number | null; tipoProducto?: string }) {
  if (it.modalidad === "por_stock") return `${it.cantidad} und`;
  if (it.tipoProducto && it.medida) return `${it.cantidad} ${it.tipoProducto}${it.cantidad === 1 ? "" : "s"} de ${it.medida} m = ${it.metrosRequeridos} m de lámina`;
  if (it.medida && it.medida !== 1) return `${it.cantidad} × ${it.medida} m = ${it.metrosRequeridos} m`;
  return `${it.metrosRequeridos ?? it.cantidad} m`;
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
    const unidad = item.modalidad === "por_stock" ? "" : " m";
    const textoAqui = libre > 0.005 ? `no alcanza el material de ${empresa} (hay ${libre}${unidad})` : `no hay material de ${empresa}`;
    return (
      <div className="apartado-aviso-otra-bodega">
        {faltaEnEmpresa ? (
          <p>
            En <strong>{empresa}</strong> no hay suficiente: {Math.max(totalEmpresa ?? 0, 0)}{unidad} sin prometer en todas las bodegas.
            {otraEmpresa && otraEmpresa.total > 0.005 ? (
              <> Pero en <strong>{nombreOtra}</strong> sí hay: {otraEmpresa.total}{unidad}
                {otraEmpresa.cantidad > 0.005 && <> ({otraEmpresa.cantidad}{unidad} aquí en {aqui})</>}. Usa material de {nombreOtra}.</>
            ) : " Tampoco alcanza en la otra empresa."}
          </p>
        ) : (
          <>
            {otra && (
              <p>
                Este material se puede despachar en <strong>{otra.bodega}</strong> ({otra.cantidad}{unidad} libres de {empresa}) porque en{" "}
                <strong>{aqui}</strong> {textoAqui}. Solicita el intercambio.
              </p>
            )}
            {otraEmpresa && otraEmpresa.cantidad > 0.005 && (
              <p>
                {otra ? "También: en " : "En "}<strong>{aqui}</strong> {otra ? "" : `${textoAqui}, pero `}hay{" "}
                <strong>{otraEmpresa.cantidad}{unidad} de {nombreOtra}</strong> libres.
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
    // Lo más reciente primero (las cargadas desde Excel conservan el orden en
    // que se escribieron: ver importar_cotizaciones).
    return [...a.apartados].sort((x, y) =>
      y.fechaCreacion.localeCompare(x.fechaCreacion) || y.id - x.id,
    ).filter((ap) =>
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

  // Lo de UNA parte de la cotización (una bodega): sus líneas, su estado y sus
  // botones. Admin Inventario ve la cotización completa en una sola fila, con
  // un bloque así por bodega (ver gruposFiltrados).
  // `parteDe` (solo cotización de varias bodegas): de qué parte es cada
  // línea, para ponerle su bodega al lado.
  function lineasDeParte(ap: ApartadoDeLista, parteDe?: Map<number, ApartadoDeLista>) {
    const itemsRollo = ap.items.filter((it) => it.modalidad === "por_rollo");
    const itemsStock = ap.items.filter((it) => it.modalidad === "por_stock");
    const rolloPendientes = itemsRollo.filter((it) => (it.metrosPendientes ?? 0) > 0).length;
    const activa = ESTADOS_CANCELABLES.includes(ap.estado);
    return (
      <>
      <ul className="apartado-lineas">
        {(lineasExpandidas.has(ap.id) ? ap.items : ap.items.slice(0, LINEAS_VISIBLES)).map((it) => {
          // Stock cargado del Excel: ya descontado, pero mientras la
          // cotización siga activa todavía hay que alistarlo y despacharlo.
          const parte = parteDe?.get(it.id);
          const stockPorAlistar = it.modalidad === "por_stock" && it.stockDescontado && (parte ? ESTADOS_CANCELABLES.includes(parte.estado) : activa);
          const lista = it.modalidad === "por_stock" ? it.stockDescontado && !stockPorAlistar : (it.metrosPendientes ?? 0) <= 0;
          const codigo = it.modalidad === "por_stock" ? "" : it.codigoInterno;
          const texto = it.descripcion || (it.modalidad === "por_stock" ? `producto #${it.productoId}` : "");
          return (
            <li key={it.id} className={lista ? "apartado-linea-lista" : undefined}>
              <div className="apartado-linea-cabeza">
                <strong>{cantidadLinea(it)}</strong>
                {codigo && <span className="apartado-linea-codigo">{codigo}</span>}
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
              </div>
              {texto && <div className="apartado-linea-texto">{texto}</div>}
            </li>
          );
        })}
      </ul>
      {ap.items.length > LINEAS_VISIBLES && (
        <button type="button" className="apartado-ver-mas" onClick={() => alternarLineas(ap.id)}>
          {lineasExpandidas.has(ap.id) ? "Ver menos" : `+${ap.items.length - LINEAS_VISIBLES} más`}
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
      {porDarSalida(ap) && !CERRADAS.includes(ap.estado)
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
      {a.puedeCancelarApartados && ap.estado === "cancelado" && !ap.items.some((it) => it.tieneProduccionRegistrada) && (
        <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
          titulo: `¿Eliminar la cotización anulada ${ap.numeroCotizacion}?`,
          mensaje: "Se borra de la lista para siempre. No afecta el inventario: su material ya quedó libre al anularla.",
          textoConfirmar: "Sí, eliminar",
          ejecutar: () => a.eliminarApartado(ap.id),
        })}>Eliminar</button>
      )}
      {esAdminInventario && ESTADOS_CANCELABLES.includes(ap.estado) && (
        <button onClick={() => { setSepararAbierta(null); setSalidaAbierta(ap.id); }}>Registrar salida</button>
      )}
      {(ap.items.length > 1 || (ap.items[0]?.cantidad ?? 0) > 1)
        && ((esAdminInventario && (ESTADOS_CANCELABLES.includes(ap.estado) || ap.estado === "produccion_terminada"))
          || (a.puedeMarcarEntregado && ap.estado === "produccion_terminada")) && (
        <button onClick={() => { setSalidaAbierta(null); setSepararAbierta(ap.id); }}>Separar</button>
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
      {a.puedeMarcarEntregado && ap.estado === "produccion_terminada" && (
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
    const separables = grupo.filter((parte) => (parte.items.length > 1 || (parte.items[0]?.cantidad ?? 0) > 1)
      && (ESTADOS_CANCELABLES.includes(parte.estado) || parte.estado === "produccion_terminada"));
    const eliminables = grupo.filter((parte) => parte.estado === "cancelado" && !parte.items.some((it) => it.tieneProduccionRegistrada));
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
      {esAdminInventario && activas.length > 0 && (
        <button onClick={() => elegir("salida", activas)}>Registrar salida</button>
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
            {(a.puedeCrearApartados || esAdminInventario) && !a.mostrarFormularioApartado && !mostrarImportar && (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {esAdminInventario && (
                  <button className="inventario-boton-cancelar" onClick={() => setMostrarImportar(true)}>
                    📥 Cargar desde Excel
                  </button>
                )}
                {a.puedeCrearApartados && (
                  <button className="inventario-boton" onClick={a.abrirFormularioApartado}>
                    + Nuevo apartado
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
                su encargada lo envía a producción desde la lista cuando quiera. Aquí ves solo las cotizaciones que tú creaste.</>
              : esAdminInventario
                ? <>Las cotizaciones las crean los vendedores. Aquí las ves todas y puedes editarlas, anularlas, registrar salidas y separarlas.</>
              : a.puedeEnviarAProduccion
                ? <>Aquí llegan las cotizaciones aprobadas por los vendedores con el material ya reservado en tu
                  bodega. Envíalas a producción desde la lista con el botón "Enviar a producción".</>
                : <>Cotizaciones aprobadas con su material reservado.</>}
          </p>

          {a.errorAccionApartado && <p className="inventario-error">{a.errorAccionApartado}</p>}

          {a.mostrarFormularioApartado && (
            <form className="inventario-form" onSubmit={guardarFormulario} noValidate>
              <h2 className="inventario-form-subtitulo">
                {a.editandoId ? `Editar cotización ${a.formulario.numeroCotizacion}` : "Nuevo apartado"}
              </h2>
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

              <div className="inventario-form-grid">
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
                <div>
                  <label>Cliente</label>
                  <input
                    value={a.formulario.cliente}
                    onChange={(e) => a.actualizarCampoApartado("cliente", e.target.value)}
                  />
                </div>
              </div>

              <h3 className="inventario-form-subtitulo">Productos solicitados</h3>
              {a.formulario.items.map((item, indice) => (
                <div key={indice} className="inventario-form-grid" style={{ marginBottom: "0.75rem", borderBottom: "1px solid #eee", paddingBottom: "0.75rem" }}>
                  {item.id && (item.metrosConsumidos || item.stockDescontado) ? (
                    <p className="apartado-linea-con-salida" style={{ gridColumn: "1 / -1" }}>
                      ✓ Esta línea ya tiene salida{item.stockDescontado ? " (stock descontado)" : `: ${item.metrosConsumidos} m`}.
                      {item.stockDescontado ? " No se puede cambiar." : " Puedes subirla, pero no quitarla ni bajarla de lo que ya salió."}
                      {item.bodegaId && ` Sale de ${almacen.bodegas.find((b) => String(b.id) === String(item.bodegaId))?.nombre || "otra bodega"}.`}
                    </p>
                  ) : null}
                  {!(item.metrosConsumidos || item.stockDescontado) && (
                    <div className="apartado-linea-cabecera">
                      <strong>Producto {indice + 1}</strong>
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
                  <div style={{ gridColumn: "1 / -1", display: item.id ? "none" : undefined }}>
                    <label>Tipo de material</label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button"
                        className={`produccion-tipo-boton ${item.modalidad === "por_rollo" ? "produccion-tipo-activo" : ""}`}
                        onClick={() => a.cambiarModalidadItem(indice, "por_rollo")}
                      >
                        Material por rollo
                      </button>
                      <button
                        type="button"
                        className={`produccion-tipo-boton ${item.modalidad === "por_stock" ? "produccion-tipo-activo" : ""}`}
                        onClick={() => a.cambiarModalidadItem(indice, "por_stock")}
                      >
                        Producto de stock
                      </button>
                      <button
                        type="button"
                        className={`produccion-tipo-boton ${item.modalidad === "rollo_completo" ? "produccion-tipo-activo" : ""}`}
                        onClick={() => a.cambiarModalidadItem(indice, "rollo_completo")}
                      >
                        Rollo completo
                      </button>
                    </div>
                  </div>

                  {item.modalidad === "por_rollo" ? (
                    <div>
                      <label>Código de clasificación *</label>
                      <input
                        placeholder="Ej. LA50170,27"
                        readOnly={Boolean(item.id && item.metrosConsumidos)}
                        title={item.id && item.metrosConsumidos ? "Esta línea ya tiene salida: el código no se puede cambiar." : undefined}
                        value={item.codigoInterno}
                        onChange={(e) => a.actualizarItemApartado(indice, "codigoInterno", e.target.value)}
                        onBlur={(e) => a.consultarDisponibilidadItem(indice, e.target.value)}
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
                      {disponibilidadItems[indice]?.datos && (
                        disponibilidadItems[indice].datos.cantidadRollos === 0 && !disponibilidadItems[indice].datos.metrosEnCamino
                          && !disponibilidadItems[indice].datos.metrosPorRepartir ? (
                          <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                            No hay rollos de {EMPRESAS[item.empresa || a.formulario.empresa] || "esa empresa"} con ese código en esa bodega.
                          </p>
                        ) : (
                          <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
                            {disponibilidadItems[indice].datos.familia && `${disponibilidadItems[indice].datos.familia} · `}
                            {disponibilidadItems[indice].datos.cantidadRollos} rollo{disponibilidadItems[indice].datos.cantidadRollos === 1 ? "" : "s"} ·{" "}
                            {(disponibilidadItems[indice].datos.metrosDisponibles ?? 0) >= 0 ? (
                              <strong>{disponibilidadItems[indice].datos.metrosDisponibles} m libres</strong>
                            ) : (
                              <>
                                <strong>0 m libres</strong> (lo ya apartado aquí de {EMPRESAS[item.empresa || a.formulario.empresa] || "esta empresa"} supera
                                lo que hay: esas cotizaciones esperan {-(disponibilidadItems[indice].datos.metrosDisponibles ?? 0)} m más)
                              </>
                            )}
                            {(disponibilidadItems[indice].datos?.metrosReservados ?? 0) > 0 && ` · ${disponibilidadItems[indice].datos?.metrosReservados} m ya reservados`}
                            {((disponibilidadItems[indice].datos?.metrosEnCamino ?? 0) > 0 || (disponibilidadItems[indice].datos?.metrosPorRepartir ?? 0) > 0) && (
                              <>
                                <br />
                                Empresa: {disponibilidadItems[indice].datos?.metrosEnCamino} m en camino
                                {` · ${disponibilidadItems[indice].datos?.metrosPorRepartir} m por repartir en Admin Inventario`}
                                {(disponibilidadItems[indice].datos?.metrosEsperando ?? 0) > 0 && ` · ${disponibilidadItems[indice].datos?.metrosEsperando} m ya apartados de ahí`}
                                <br />
                                <strong>Puedes apartar hasta {disponibilidadItems[indice].datos?.metrosParaApartar} m</strong>
                              </>
                            )}
                          </p>
                        )
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
                    <div>
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
                          Stock físico <strong>{disponibilidadItems[indice].datos.stock}</strong> · reservado{" "}
                          {disponibilidadItems[indice].datos.cantidadReservada} ·{" "}
                          <strong>{disponibilidadItems[indice].datos.cantidadDisponible} disponible</strong> en esta bodega
                          {disponibilidadItems[indice].datos.disponibleEmpresa != null && (
                            <>
                              <br />
                              En toda la empresa: <strong>{disponibilidadItems[indice].datos.disponibleEmpresa}</strong>
                              {disponibilidadItems[indice].datos.enOtrasBodegas && <> (hay en {disponibilidadItems[indice].datos.enOtrasBodegas})</>}
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
                          No hay suficiente stock libre de este producto en esta bodega
                          ({Math.max(disponibilidadItems[indice]?.datos?.cantidadDisponible ?? 0, 0)} libres): no se puede apartar
                          lo que el sistema no tiene. Dale entrada primero o escoge otra bodega.
                        </p>
                      )}
                      {item.modalidad === "por_stock" && !item.hayFisico && avisoOtraBodega(item, indice)}
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
                      </select>
                    </div>
                  )}
                  {item.modalidad === "por_rollo" && item.tipoProducto && Number(item.cantidad) > 0 && Number(item.medida) > 0 && (() => {
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
                  {(a.formulario.items.length > 1 || a.parteEditada.otrasPartes.length > 0) && !(item.metrosConsumidos || item.stockDescontado) && (
                    <div style={{ alignSelf: "end" }}>
                      <button type="button" className="inventario-boton-cancelar" onClick={() => a.quitarItemApartado(indice)}>
                        Quitar
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button type="button" className="inventario-boton-cancelar" onClick={a.agregarItemApartado} style={{ marginBottom: "1rem" }}>
                + Agregar producto
              </button>

              <div>
                <label>Observaciones</label>
                <textarea
                  rows={3}
                  value={a.formulario.observaciones}
                  onChange={(e) => a.actualizarCampoApartado("observaciones", e.target.value)}
                />
              </div>

              {ofrecerMaterialEnCamino && (
                <p className="inventario-carga-ayuda" style={{ margin: "0.75rem 0" }}>
                  <strong>En esta bodega no alcanza.</strong> Si hay en otras bodegas de la empresa (o viene en camino), la cotización
                  se crea y queda "esperando material": la bodega de despacho pide el traslado y la envía a producción cuando llegue.
                  Si no alcanza ni sumando toda la empresa, no se puede crear.
                </p>
              )}

              {quitaEstaParte && (
                <p style={{ color: "#b3261e", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>
                  Quitaste todas las líneas: al guardar se quita la cotización {a.formulario.numeroCotizacion} de{" "}
                  <strong>{a.parteEditada.bodega}</strong>. Sigue activa en <strong>{a.parteEditada.otrasPartes.join(", ")}</strong>.
                </p>
              )}

              {a.errorFormularioApartado && <p className="inventario-error">{a.errorFormularioApartado}</p>}

              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={a.guardandoApartado}>
                  {a.guardandoApartado ? "Guardando..." : quitaEstaParte ? `Quitar de ${a.parteEditada.bodega}` : a.editandoId ? "Guardar cambios" : "Crear apartado"}
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
                        {veTodasLasBodegas && <th>Bodega</th>}
                        <th>Cotización</th>
                        <th>Empresa</th>
                        <th>Cliente</th>
                        <th>Productos</th>
                        <th>Estado</th>
                        <th>Creado</th>
                        <th>Acciones</th>
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
                            items: grupo.flatMap((parte) => parte.items),
                            faltantes: grupo.flatMap((parte) => parte.faltantes.map((f) => `${parte.bodegaNombre}: ${f.replace(/^faltan /, "")}`)),
                            stockSeparadoConfirmado: grupo.every((parte) => parte.stockSeparadoConfirmado || !parte.items.some((it) => it.modalidad === "por_stock")),
                          };
                          const estadosIguales = grupo.every((parte) => parte.estado === ap.estado && porDarSalida(parte) === porDarSalida(ap));
                          const partesActivas = a.apartados
                            .filter((otra) => numeroSinEmpresa(otra.numeroCotizacion) === numeroSinEmpresa(ap.numeroCotizacion) && ESTADOS_CANCELABLES.includes(otra.estado))
                            .sort((x, y) => x.id - y.id);
                          return (
                          <tr key={ap.id} className={variasBodegas ? "apartado-fila-varias" : undefined}>
                            {veTodasLasBodegas && (
                              <td className="ap-col-bodega" data-etiqueta={variasBodegas ? "Bodegas" : "Bodega"}>
                                {grupo.map((parte) => parte.bodegaNombre || "—").join(" + ")}
                              </td>
                            )}
                            <td className="ap-col-cotizacion">
                              {ap.numeroCotizacion}
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
