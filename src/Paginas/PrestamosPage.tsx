import { useCallback, useEffect, useState } from "react";
import BarraLateral from "../Componentes/BarraLateral";
import { api, ErrorApi } from "../Componentes/Api";
import { EMPRESAS } from "../Utils/empresas";
import { formatearFechaColombia } from "../Utils/fechas";
import { exportarHojasAExcel, type HojaExcel } from "../Utils/exportarExcel";
import ModalDevolverRolloPrestado from "../Componentes/ModalDevolverRolloPrestado";
import CuadreRollosPrestados, { CUADRE_PENDIENTE, ESTADO as ESTADO_CUADRE, type FilaCuadre } from "../Componentes/CuadreRollosPrestados";
import Paginacion from "../Componentes/Paginacion";
import "../Style/Inventario.css";
import "../Style/Merma.css";
import "../Style/Rollos.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

type VistaCotizacion = {
  numero_cotizacion: string; cliente: string; salio: boolean;
  lineas: { codigo: string; descripcion: string; cantidad: number; unidad?: string; bodega: string; salio: boolean }[];
};
type Prestamo = {
  id: number; fecha: string; empresa_presta: string; empresa_recibe: string; prestador: string; bodega_id: number | null;
  numero_cotizacion: string; tipo: string; codigo: string; descripcion: string; cantidad: number; unidad: string;
  referencia_rollo: string; kilos_rollo: number | null; kilos?: number | null; origen: string; usuario: string; saldado: boolean; saldado_por: string;
  fecha_saldado: string | null; estado_cotizacion?: string;
  devuelto_con?: string; kilos_devueltos?: number | null; factura?: string;
};
type Deuda = {
  tipo: string; codigo: string; descripcion: string; unidad: string; presta: string; debe: string; cantidad: number;
  kilos?: number | null; cotizaciones?: string[];
  rollos: { referencia: string; kilos: number | null }[];
};
type ProductoBodega = {
  id: number; codigo: string; descripcion: string; empresa: string; stock: number; rollo_id?: number | null;
  identificador_rollo?: string; peso_neto?: number | null; peso_actual_kg?: number | null;
};
// Kilos con que llegó un rollo: por debajo de 100 viene en toneladas.
const kilosDeLlegada = (peso: number | null | undefined) => (peso && peso > 0 ? Math.round(peso < 100 ? peso * 1000 : peso) : null);
type Sacado = {
  fecha: string; bodega_id: number | null; producto_codigo: string; producto_descripcion: string; cantidad: number;
  cotizacion: string; usuario: string; observaciones: string;
};
type Reporte = { resumen: Deuda[]; prestamos: Prestamo[]; sacado_sin_existencia: Sacado[] };

const ORIGEN: Record<string, string> = {
  produccion: "Producción (Planta)", fin_produccion: "Producción terminada", salida: "Salida (Admin Inventario)",
  stock_planta: "Planta sacó de stock", union_cotizacion: "Al unir la cotización", ingreso_rollo: "Ingreso del rollo (prestado)",
  prestamo_a_tercero: "Prestado a empresa externa", devuelto_por_tercero: "Prestado a empresa externa (devuelto)",
};
const EXTERNA = "EXT";
const POR_PAGINA = 15;
const nombre = (sigla: string) => EMPRESAS[sigla] || sigla || "Sin empresa";
// Un tercero (empresa de afuera) va por su nombre, preste o reciba.
const quienPresta = (p: Prestamo) => (p.empresa_presta === EXTERNA && p.prestador ? p.prestador : nombre(p.empresa_presta));
const quienRecibe = (p: Prestamo) => (p.empresa_recibe === EXTERNA && p.prestador ? p.prestador : nombre(p.empresa_recibe));
const kilosTexto = (kilos: number | null) => (kilos != null ? `${kilos.toLocaleString("es-CO")} kg al llegar` : "sin kilos");
const cantidadTexto = (cantidad: number, unidad: string, kilos?: number | null) =>
  `${cantidad.toLocaleString("es-CO", { maximumFractionDigits: 2 })} ${unidad === "m" ? "m" : "und"}`
  + (unidad === "m" && kilos != null ? ` · ${kilos.toLocaleString("es-CO", { maximumFractionDigits: 0 })} kg` : "");

/** Préstamos entre empresas (Admin Inventario): lo que una empresa le prestó
 * a una cotización de la otra. Se anota solo cuando el material sale; aquí
 * se ve cuánto se deben, el detalle y se marca como saldado cuando cuadran. */
function PrestamosPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const [empresa, setEmpresa] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // Dos hojas: lo que está pendiente y lo que ya quedó saldado (devuelto, cuadrado o facturado).
  const [vista, setVista] = useState<"pendientes" | "saldados">("pendientes");
  const incluirSaldados = vista === "saldados";
  // Empresas externas que devolvieron un rollo con kilos de menos: nos deben esa diferencia.
  const [cuadre, setCuadre] = useState<FilaCuadre[]>([]);
  const alCargarCuadre = useCallback((filas: FilaCuadre[]) => setCuadre(filas), []);
  // Filtro por empresa externa (a quién se le prestó): vacío = todas.
  const [externa, setExterna] = useState("");
  const externosDeben = cuadre.filter((f) => (f.estado === "por_facturar" || f.estado === "por_pagar") && (!externa || f.prestador === externa));
  const [reporte, setReporte] = useState<Reporte>({ resumen: [], prestamos: [], sacado_sin_existencia: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [saldando, setSaldando] = useState(false);
  const nombreBodega = (id: number | null) => almacen.bodegas.find((b) => b.id === id)?.nombre || "—";

  // Prestar a una empresa externa (ej. caballetes): sale del stock y queda aquí hasta que lo devuelvan.
  const [mostrarPrestar, setMostrarPrestar] = useState(false);
  const [prestarQue, setPrestarQue] = useState<"cotizacion" | "producto" | "rollo">("cotizacion");
  // Lo que se va a anotar como préstamo con la cotización escrita (antes de guardar).
  const [vistaCotizacion, setVistaCotizacion] = useState<VistaCotizacion | "buscando" | string | null>(null);
  const [prestarCotizacion, setPrestarCotizacion] = useState("");
  const [prestarBodega, setPrestarBodega] = useState("");
  const [productosBodega, setProductosBodega] = useState<ProductoBodega[]>([]);
  const [buscarProducto, setBuscarProducto] = useState("");
  const [prestarProducto, setPrestarProducto] = useState("");
  const [prestarCantidad, setPrestarCantidad] = useState("");
  const [prestarTercero, setPrestarTercero] = useState("");
  const [prestarObservaciones, setPrestarObservaciones] = useState("");
  const [prestando, setPrestando] = useState(false);
  const [errorPrestar, setErrorPrestar] = useState("");
  const [aviso, setAviso] = useState("");
  // Rollo prestado a una empresa externa que están devolviendo (el mismo u otro rollo).
  const [rolloADevolver, setRolloADevolver] = useState<Prestamo | null>(null);
  const [recargarCuadre, setRecargarCuadre] = useState(0);

  useEffect(() => {
    setProductosBodega([]);
    setPrestarProducto("");
    if (!prestarBodega) return;
    let vigente = true;
    api.get<ProductoBodega[]>(`/bodegas/${prestarBodega}/inventario`)
      .then((datos) => { if (vigente) setProductosBodega((datos || []).filter((p) => Number(p.stock) > 0)); })
      .catch((err) => { if (vigente) setErrorPrestar(err instanceof ErrorApi ? err.message : "No se pudo cargar el inventario de esa bodega."); });
    return () => { vigente = false; };
  }, [prestarBodega]);

  const terminoProducto = buscarProducto.trim().toLowerCase();
  // Por kilos: "4458" o "4.458" encuentra el rollo de 4458 kg.
  const kilosBuscados = terminoProducto.replace(/[.,\s]/g, "");
  const productosFiltrados = productosBodega
    .filter((p) => (prestarQue === "rollo" ? !!p.rollo_id : !p.rollo_id))
    .filter((p) => !terminoProducto
      || p.codigo.toLowerCase().includes(terminoProducto) || p.descripcion.toLowerCase().includes(terminoProducto)
      || (p.identificador_rollo || "").toLowerCase().includes(terminoProducto)
      || (/^\d+$/.test(kilosBuscados) && String(kilosDeLlegada(p.peso_neto) ?? "").includes(kilosBuscados)));
  const productoElegido = productosBodega.find((p) => String(p.id) === prestarProducto);

  useEffect(() => {
    const numero = prestarCotizacion.trim();
    if (prestarQue !== "cotizacion" || !numero) { setVistaCotizacion(null); return; }
    setVistaCotizacion("buscando");
    let vigente = true;
    const espera = setTimeout(async () => {
      try {
        const vista = await api.get<VistaCotizacion>(`/prestamos/desde-cotizacion/vista?numero=${encodeURIComponent(numero)}`);
        if (vigente) setVistaCotizacion(vista);
      } catch (err) {
        if (vigente) setVistaCotizacion(err instanceof ErrorApi ? err.message : "No se pudo consultar la cotización.");
      }
    }, 500);
    return () => { vigente = false; clearTimeout(espera); };
  }, [prestarCotizacion, prestarQue]);

  async function prestar(e: React.FormEvent) {
    e.preventDefault();
    setErrorPrestar("");
    if (prestarQue === "cotizacion") {
      if (!prestarCotizacion.trim()) { setErrorPrestar("Escribe el número de la cotización del préstamo."); return; }
      if (!prestarTercero.trim()) { setErrorPrestar("Escribe a qué empresa se le presta."); return; }
      setPrestando(true);
      try {
        const anotados = await api.post<Prestamo[]>("/prestamos/desde-cotizacion", {
          numero_cotizacion: prestarCotizacion.trim(), tercero: prestarTercero.trim(),
        }) || [];
        const porRecoger = anotados.some((p) => p.estado_cotizacion === "por_recoger");
        setAviso(`Listo: la cotización ${prestarCotizacion.trim()} quedó como préstamo a ${prestarTercero.trim()}: `
          + anotados.map((p) => p.unidad === "m" ? `${p.cantidad} m de ${p.codigo}` : `${p.cantidad} ${p.codigo}`).join(", ") + "."
          + (porRecoger ? " Queda «por recoger»: cuando vengan por él, dale Salida a la cotización." : ""));
        setMostrarPrestar(false);
        setPrestarCotizacion(""); setPrestarTercero("");
        await cargar();
      } catch (err) {
        setErrorPrestar(err instanceof ErrorApi ? err.message : "No se pudo anotar el préstamo.");
      } finally {
        setPrestando(false);
      }
      return;
    }
    const esRollo = prestarQue === "rollo";
    const cantidad = esRollo ? Number(productoElegido?.stock) : Number(prestarCantidad);
    if (!productoElegido) { setErrorPrestar(esRollo ? "Elige el rollo que vas a prestar." : "Elige el producto que vas a prestar."); return; }
    if (!(cantidad > 0)) { setErrorPrestar("Escribe cuántos vas a prestar."); return; }
    if (cantidad > Number(productoElegido.stock)) { setErrorPrestar(`Solo hay ${productoElegido.stock} en esa bodega.`); return; }
    if (!prestarTercero.trim()) { setErrorPrestar("Escribe a qué empresa se le presta."); return; }
    if (esRollo && !window.confirm(`¿Prestar el rollo completo ${productoElegido.identificador_rollo} (${cantidad} m) a ${prestarTercero.trim()}? Sale de la bodega hasta que lo devuelvan.`)) return;
    setPrestando(true);
    try {
      await api.post("/prestamos/a-tercero", {
        ...(esRollo ? { rollo_id: productoElegido.rollo_id } : { producto_id: productoElegido.id, cantidad }),
        tercero: prestarTercero.trim(), observaciones: prestarObservaciones.trim(),
      });
      setAviso(esRollo
        ? `Listo: el rollo ${productoElegido.identificador_rollo} (${cantidad} m) quedó prestado a ${prestarTercero.trim()}.`
        : `Listo: ${cantidad} de ${productoElegido.codigo} quedaron prestados a ${prestarTercero.trim()}.`);
      setMostrarPrestar(false);
      setPrestarBodega(""); setBuscarProducto(""); setPrestarCantidad(""); setPrestarTercero(""); setPrestarObservaciones("");
      await cargar();
    } catch (err) {
      setErrorPrestar(err instanceof ErrorApi ? err.message : "No se pudo registrar el préstamo.");
    } finally {
      setPrestando(false);
    }
  }

  async function cerrarCancelado(p: Prestamo) {
    if (!window.confirm(`La cotización ${p.numero_cotizacion} se canceló y el material nunca salió. ¿Cerrar este préstamo? (no mueve inventario)`)) return;
    setError("");
    try {
      await api.post(`/prestamos/${p.id}/devolver`, { cantidad: p.cantidad });
      setAviso(`Listo: se cerró el préstamo de la cotización ${p.numero_cotizacion}.`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo cerrar el préstamo.");
    }
  }

  async function devolver(p: Prestamo) {
    if (p.unidad === "m") { setRolloADevolver(p); return; }
    const texto = window.prompt(p.unidad === "m"
      ? `¿Con cuántos metros volvió el rollo ${p.referencia_rollo}? (se prestaron ${p.cantidad} m; si volvió entero, déjalo así)`
      : `¿Cuántos ${p.codigo} devolvió ${p.prestador}? (prestados sin devolver: ${p.cantidad})`, String(p.cantidad));
    if (texto == null) return;
    const cantidad = Number(texto.replace(",", "."));
    if (!(cantidad > 0) || cantidad > p.cantidad) { setError(`Escribe una cantidad entre 1 y ${p.cantidad}.`); return; }
    setError("");
    try {
      await api.post(`/prestamos/${p.id}/devolver`, { cantidad });
      setAviso(p.unidad === "m"
        ? `Listo: el rollo ${p.referencia_rollo} volvió a ${nombreBodega(p.bodega_id)} con ${cantidad} m.`
        : `Listo: ${cantidad} de ${p.codigo} volvieron a ${nombreBodega(p.bodega_id)}.`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo registrar la devolución.");
    }
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const parametros = new URLSearchParams();
    if (empresa) parametros.set("empresa", empresa);
    if (bodegaId) parametros.set("bodega_id", bodegaId);
    if (desde) parametros.set("desde", desde);
    if (hasta) parametros.set("hasta", hasta);
    if (incluirSaldados) parametros.set("incluir_saldados", "true");
    try {
      const datos = await api.get<Reporte>(`/prestamos?${parametros.toString()}`);
      setReporte(datos ?? { resumen: [], prestamos: [], sacado_sin_existencia: [] });
      setSeleccion(new Set());
      setRecargarCuadre((n) => n + 1);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron cargar los préstamos.");
    } finally {
      setCargando(false);
    }
  }, [empresa, bodegaId, desde, hasta, incluirSaldados]);

  useEffect(() => { cargar(); }, [cargar]);

  function alternar(id: number) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
      return nueva;
    });
  }

  const empresasExternas = [...new Set([
    ...cuadre.map((f) => f.prestador),
    ...reporte.prestamos.filter((p) => p.empresa_presta === EXTERNA || p.empresa_recibe === EXTERNA).map((p) => p.prestador),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const prestamosVisibles = (vista === "saldados" ? reporte.prestamos.filter((p) => p.saldado) : reporte.prestamos)
    .filter((p) => !externa || p.prestador === externa);
  const resumenVisible = externa ? reporte.resumen.filter((d) => d.presta === externa || d.debe === externa) : reporte.resumen;
  const sinSaldar = prestamosVisibles.filter((p) => !p.saldado);

  // Una sección a la vez (antes todo iba en una sola página larguísima) y
  // tablas por páginas de POR_PAGINA filas.
  const [seccion, setSeccion] = useState<"resumen" | "prestamos" | "cuadre" | "sacado">("resumen");
  const [paginaPrestamos, setPaginaPrestamos] = useState(1);
  const [paginaSacado, setPaginaSacado] = useState(1);
  const hayFiltros = Boolean(empresa || externa || bodegaId || desde || hasta);
  useEffect(() => { setPaginaPrestamos(1); setPaginaSacado(1); }, [empresa, externa, bodegaId, desde, hasta, vista]);
  const totalPaginasPrestamos = Math.max(1, Math.ceil(prestamosVisibles.length / POR_PAGINA));
  const paginaPrestamosValida = Math.min(paginaPrestamos, totalPaginasPrestamos);
  const prestamosPagina = prestamosVisibles.slice((paginaPrestamosValida - 1) * POR_PAGINA, paginaPrestamosValida * POR_PAGINA);
  const sinSaldarPagina = prestamosPagina.filter((p) => !p.saldado);
  const todosElegidos = sinSaldarPagina.length > 0 && sinSaldarPagina.every((p) => seleccion.has(p.id));
  const totalPaginasSacado = Math.max(1, Math.ceil(reporte.sacado_sin_existencia.length / POR_PAGINA));
  const sacadoPagina = reporte.sacado_sin_existencia.slice((Math.min(paginaSacado, totalPaginasSacado) - 1) * POR_PAGINA, Math.min(paginaSacado, totalPaginasSacado) * POR_PAGINA);
  const cuadreDeLaVista = cuadre.filter((f) => CUADRE_PENDIENTE.has(f.estado) === (vista === "pendientes") && (!externa || f.prestador === externa));
  const secciones: ["resumen" | "prestamos" | "cuadre" | "sacado", string, number][] = vista === "pendientes"
    ? [["resumen", "Lo que se deben", resumenVisible.length + externosDeben.length], ["prestamos", "Cada préstamo", prestamosVisibles.length],
      ["cuadre", "Rollos prestados afuera", cuadreDeLaVista.length], ["sacado", "Sacado sin existencia", reporte.sacado_sin_existencia.length]]
    : [["prestamos", "Préstamos saldados", prestamosVisibles.length], ["cuadre", "Rollos prestados afuera", cuadreDeLaVista.length]];

  // Con los mismos filtros, una hoja por sección. Siempre lleva el historial
  // completo de los saldados (no solo lo de la pestaña que se está viendo).
  const [exportando, setExportando] = useState(false);
  async function exportar() {
    setExportando(true);
    try {
      const parametros = new URLSearchParams();
      if (empresa) parametros.set("empresa", empresa);
      if (bodegaId) parametros.set("bodega_id", bodegaId);
      if (desde) parametros.set("desde", desde);
      if (hasta) parametros.set("hasta", hasta);
      parametros.set("incluir_saldados", "true");
      const todo = await api.get<Reporte>(`/prestamos?${parametros.toString()}`);
      const todos = (todo?.prestamos ?? reporte.prestamos).filter((p) => !externa || p.prestador === externa);
      // UNA hoja con todo (pendientes y saldados): en cada fila, cuántos kilos
      // se prestaron, cuántos volvieron, la diferencia y quién le debe a quién.
      const cuadrePorId = new Map(cuadre.map((f) => [f.id, f]));
      const kg = (n: number) => `${Math.abs(n).toLocaleString("es-CO", { maximumFractionDigits: 1 })} kg`;
      const filaPrestamo = (p: Prestamo) => {
        const c = cuadrePorId.get(p.id);
        const prestados = c?.kilos_prestados ?? (p.unidad === "m" ? p.kilos ?? null : null);
        const devueltos = c?.kilos_devueltos ?? p.kilos_devueltos ?? null;
        const diferencia = prestados != null && devueltos != null ? Math.round((prestados - devueltos) * 10) / 10 : null;
        const quien = diferencia == null ? (devueltos == null && !p.saldado ? "Sin devolver" : "")
          : Math.abs(diferencia) < 0.5 ? "Cuadrado"
          : diferencia > 0 ? `${quienRecibe(p)} le debe ${kg(diferencia)} a ${quienPresta(p)}`
          : `${quienPresta(p)} le debe ${kg(diferencia)} a ${quienRecibe(p)}`;
        return {
          "Estado": p.saldado ? "Saldado" : "Pendiente",
          "Fecha": formatearFechaColombia(p.fecha), "Presta": quienPresta(p), "Recibe": quienRecibe(p),
          "Cotización": p.numero_cotizacion, "Bodega": nombreBodega(p.bodega_id), "Material": p.codigo, "Rollo": p.referencia_rollo,
          "Cantidad": p.cantidad, "Unidad": p.unidad === "m" ? "m" : "und",
          "Kilos prestados": prestados ?? "",
          "Pagaron con": p.devuelto_con || c?.devuelto_con || "", "Kilos devueltos": devueltos ?? "",
          "Diferencia (kg)": diferencia ?? "", "Quién debe": quien,
          "Cuadre": c ? (ESTADO_CUADRE[c.estado]?.texto || c.estado) : "", "Factura": p.factura || c?.factura || "",
          "Saldado el": p.fecha_saldado ? formatearFechaColombia(p.fecha_saldado) : "",
          "Descripción": p.descripcion, "Dónde se anotó": ORIGEN[p.origen] || p.origen, "Usuario": p.usuario,
        };
      };
      const hojas: HojaExcel[] = [
        { nombre: "Préstamos", filas: [...todos.filter((p) => !p.saldado), ...todos.filter((p) => p.saldado)].map(filaPrestamo) },
        // Solo lo saldado, con las mismas columnas (para revisar el historial aparte).
        { nombre: "Saldados", filas: todos.filter((p) => p.saldado).map(filaPrestamo) },
        { nombre: "Resumen: lo que se deben", filas: resumenVisible.map((d) => ({
          "Quién debe": nombre(d.debe), "A quién": nombre(d.presta), "Cotización": (d.cotizaciones ?? []).join(", "), "Material": d.codigo,
          "Cantidad": d.cantidad, "Unidad": d.unidad === "m" ? "m" : "und", "Kilos (aprox.)": d.unidad === "m" ? (d.kilos ?? "") : "",
          "Rollos": d.rollos.map((r) => r.referencia).join(", "), "Descripción": d.descripcion,
        })) },
      ];
      if (reporte.sacado_sin_existencia.length > 0) {
        hojas.push({ nombre: "Sacado sin existencia", filas: reporte.sacado_sin_existencia.map((s) => ({
          "Fecha": formatearFechaColombia(s.fecha), "Bodega": nombreBodega(s.bodega_id), "Producto": s.producto_codigo,
          "Descripción": s.producto_descripcion, "Cantidad": s.cantidad, "Cotización": s.cotizacion, "Quién": s.usuario,
        })) });
      }
      exportarHojasAExcel(hojas, `Prestamos${desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : ""}.xlsx`);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo descargar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  async function saldar() {
    if (seleccion.size === 0) return;
    if (!window.confirm(`¿Marcar ${seleccion.size} préstamo(s) como saldado(s)? Dejan de contar en lo que se deben las empresas.`)) return;
    setSaldando(true);
    setError("");
    try {
      await api.post("/prestamos/saldar", { ids: [...seleccion] });
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron saldar los préstamos.");
    } finally {
      setSaldando(false);
    }
  }

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <div className="pagina-cabecera">
            <div className="pagina-cabecera-texto">
              <h1 className="inventario-titulo">Préstamos entre empresas</h1>
              <div className="pagina-ayuda">
                <p>Lo que Arquitejas y Asia Business se deben entre sí, y lo que se le presta a empresas de afuera.</p>
                <ul>
                  <li><strong>Entre las dos empresas:</strong> se anota solo cuando sale material «de» la otra empresa en una cotización.</li>
                  <li><strong>Saldar:</strong> cuando las empresas cuadran cuentas, marca los préstamos y dale Saldar.</li>
                  <li><strong>Empresa de afuera:</strong> se registra con «Prestar a empresa externa» y vuelve con Devolver.</li>
                </ul>
              </div>
            </div>
            <div className="pagina-acciones">
              <button type="button" className={mostrarPrestar ? "boton-terciario" : "inventario-boton"}
                onClick={() => { setMostrarPrestar((v) => !v); setErrorPrestar(""); }}>
                {mostrarPrestar ? "Cancelar préstamo" : "+ Prestar a empresa externa"}
              </button>
            </div>
          </div>

          {aviso && <p className="inventario-exito" role="status" onClick={() => setAviso("")}>{aviso}</p>}

          {mostrarPrestar && (
            <form className="inventario-form" onSubmit={prestar} noValidate>
              <h2 className="inventario-form-subtitulo">Prestar a una empresa externa</h2>
              <p className="inventario-carga-ayuda">
                Sale de la bodega y queda «Sin saldar» hasta que lo devuelvan (<strong>Devolver</strong>) o lo paguen
                (<strong>Saldar</strong>). Los rollos se prestan completos.
              </p>
              <div className="rollo-prestado-opciones" role="radiogroup" aria-label="¿Qué prestas?" style={{ marginBottom: "0.75rem" }}>
                {([["cotizacion", "Desde una cotización"], ["producto", "Producto (ej. caballetes)"], ["rollo", "Rollo completo"]] as const).map(([valor, texto]) => (
                  <label key={valor} className={prestarQue === valor ? "rollo-prestado-activo" : ""}>
                    <input type="radio" name="prestar-que" value={valor} checked={prestarQue === valor}
                      onChange={() => { setPrestarQue(valor); setPrestarProducto(""); setBuscarProducto(""); }} />
                    {texto}
                  </label>
                ))}
              </div>
              {prestarQue === "cotizacion" && (
                <p className="inventario-carga-ayuda">
                  Escribe el número de la cotización del préstamo: lo que lleva queda anotado aquí. El material sale con la
                  <strong> Salida</strong> de la cotización, como siempre (no se descuenta dos veces).
                </p>
              )}
              <div className="inventario-form-grid">
                {prestarQue === "cotizacion" && (
                  <div>
                    <label htmlFor="prestar-cotizacion">Número de la cotización *</label>
                    <input id="prestar-cotizacion" maxLength={32} placeholder="Ej. 4140" value={prestarCotizacion}
                      onChange={(e) => setPrestarCotizacion(e.target.value)} />
                  </div>
                )}
                {prestarQue === "cotizacion" && vistaCotizacion && (
                  <div style={{ gridColumn: "1 / -1" }} role="status">
                    {vistaCotizacion === "buscando" ? <p className="inventario-carga-ayuda">Buscando la cotización...</p>
                      : typeof vistaCotizacion === "string" ? <p className="inventario-error">{vistaCotizacion}</p>
                      : (
                        <>
                          <p className="inventario-carga-ayuda" style={{ marginBottom: "0.4rem" }}>
                            <strong>Queda como préstamo</strong> (cotización {vistaCotizacion.numero_cotizacion}
                            {vistaCotizacion.cliente ? `, ${vistaCotizacion.cliente}` : ""}):
                          </p>
                          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                            {vistaCotizacion.lineas.map((l, i) => (
                              <li key={i}>
                                <strong>{l.unidad === "m" ? `${l.cantidad} m de ${l.codigo}` : `${l.cantidad} × ${l.codigo}`}</strong> {l.descripcion} · {l.bodega}
                                {!l.salio && <span style={{ color: "#b3261e" }}> (todavía no ha salido)</span>}
                              </li>
                            ))}
                          </ul>
                          {!vistaCotizacion.salio && (
                            <p className="inventario-carga-ayuda">
                              Todavía no ha salido: puedes anotarlo ya. Queda <strong>por recoger</strong> y el material sigue apartado
                              para esta cotización; cuando vengan por él, le das <strong>Salida</strong> a la cotización como siempre.
                            </p>
                          )}
                        </>
                      )}
                  </div>
                )}
                <div>
                  <label htmlFor="prestar-tercero">¿A qué empresa se le presta? *</label>
                  <input id="prestar-tercero" maxLength={150} placeholder="Ej. Constructora XYZ" value={prestarTercero}
                    onChange={(e) => setPrestarTercero(e.target.value)} />
                </div>
                {prestarQue !== "cotizacion" && (
                  <div>
                    <label htmlFor="prestar-bodega">¿De qué bodega sale? *</label>
                    <select id="prestar-bodega" value={prestarBodega} onChange={(e) => setPrestarBodega(e.target.value)}>
                      <option value="">Elige la bodega</option>
                      {almacen.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                    </select>
                  </div>
                )}
                {prestarQue !== "cotizacion" && prestarBodega && (
                  <div>
                    <label htmlFor="prestar-buscar">Buscar producto</label>
                    <input id="prestar-buscar" type="search" value={buscarProducto}
                      placeholder={prestarQue === "rollo" ? "Referencia, código o kilos (ej. 4458)" : "Código o descripción (ej. caballete)"}
                      onChange={(e) => setBuscarProducto(e.target.value)} />
                  </div>
                )}
                {prestarQue !== "cotizacion" && prestarBodega && (
                  <div>
                    <label htmlFor="prestar-producto">{prestarQue === "rollo" ? "Rollo *" : "Producto *"}</label>
                    <select id="prestar-producto" value={prestarProducto} onChange={(e) => setPrestarProducto(e.target.value)}>
                      <option value="">{productosFiltrados.length ? `Elige (${productosFiltrados.length})` : prestarQue === "rollo" ? "Ningún rollo coincide" : "Ningún producto con stock coincide"}</option>
                      {productosFiltrados.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.rollo_id
                            ? `${p.identificador_rollo} · ${p.codigo} · ${nombre(p.empresa)} · ${Number(p.stock).toLocaleString("es-CO")} m · ${kilosTexto(kilosDeLlegada(p.peso_neto))}`
                            : `${p.codigo} · ${p.descripcion} · ${nombre(p.empresa)} · hay ${Number(p.stock).toLocaleString("es-CO")}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {prestarQue === "producto" && (
                  <div>
                    <label htmlFor="prestar-cantidad">Cantidad *</label>
                    <input id="prestar-cantidad" type="number" min="0" step="any" value={prestarCantidad}
                      onChange={(e) => setPrestarCantidad(e.target.value)} />
                  </div>
                )}
                {prestarQue !== "cotizacion" && (
                  <div>
                    <label htmlFor="prestar-observaciones">Observaciones</label>
                    <input id="prestar-observaciones" maxLength={500} placeholder="Ej. los recoge Juan, devuelven en 15 días"
                      value={prestarObservaciones} onChange={(e) => setPrestarObservaciones(e.target.value)} />
                  </div>
                )}
              </div>
              {errorPrestar && <p className="inventario-error">{errorPrestar}</p>}
              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={prestando}>{prestando ? "Guardando..." : "Prestar"}</button>
              </div>
            </form>
          )}

          {/* ===== Barra: Pendientes / Saldados + filtros con etiqueta ===== */}
          <div className="prestamos-barra">
            <div className="prestamos-vista" role="tablist" aria-label="Qué ver">
              {([["pendientes", "Pendientes"], ["saldados", "Saldados"]] as const).map(([valor, texto]) => (
                <button key={valor} type="button" role="tab" aria-selected={vista === valor}
                  className={vista === valor ? "activo" : ""}
                  onClick={() => { setVista(valor); setSeleccion(new Set()); setSeccion(valor === "saldados" && (seccion === "resumen" || seccion === "sacado") ? "prestamos" : seccion); }}>
                  {texto}
                </button>
              ))}
            </div>
            <div className="prestamos-filtros">
              <label>
                <span>Empresa</span>
                <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                  <option value="">Las dos</option>
                  {Object.entries(EMPRESAS).map(([sigla, n]) => <option key={sigla} value={sigla}>{n}</option>)}
                </select>
              </label>
              <label>
                <span>Empresa de afuera</span>
                <select value={externa} onChange={(e) => setExterna(e.target.value)}>
                  <option value="">Todas</option>
                  {empresasExternas.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>
                <span>Bodega</span>
                <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
                  <option value="">Todas</option>
                  {almacen.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                </select>
              </label>
              <label>
                <span>Desde</span>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </label>
              <div className="prestamos-filtros-acciones">
                {hayFiltros && (
                  <button type="button" className="apartados-limpiar"
                    onClick={() => { setEmpresa(""); setExterna(""); setBodegaId(""); setDesde(""); setHasta(""); }}>
                    Limpiar filtros
                  </button>
                )}
                {!cargando && (reporte.resumen.length > 0 || reporte.prestamos.length > 0 || reporte.sacado_sin_existencia.length > 0) && (
                  <button type="button" className="boton-terciario" onClick={exportar} disabled={exportando}>
                    {exportando ? "Preparando..." : "Exportar a Excel"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ===== Secciones: una a la vez, con su número ===== */}
          <div className="prestamos-secciones" role="tablist" aria-label="Sección">
            {secciones.map(([valor, texto, cuantos]) => (
              <button key={valor} type="button" role="tab" aria-selected={seccion === valor}
                className={seccion === valor ? "activo" : ""} onClick={() => setSeccion(valor)}>
                {texto}
                {cuantos > 0 && <span className="prestamos-contador">{cuantos}</span>}
              </button>
            ))}
          </div>

          {error && <p className="inventario-error">{error}</p>}
          {cargando ? <p className="inventario-cargando">Cargando préstamos...</p> : (
            <>
              {/* ================== RESUMEN: LO QUE SE DEBEN ================== */}
              {seccion === "resumen" && vista === "pendientes" && <>
              <div className="prestamos-seccion-cabeza">
                <h2 className="inventario-form-subtitulo">Lo que se deben</h2>
                <p>El total sin saldar, por material. En «Cada préstamo» está el detalle para saldarlos.</p>
              </div>
              {resumenVisible.length === 0 && externosDeben.length === 0 ? (
                <p className="inventario-vacio">✓ No se debe nada{hayFiltros ? " con estos filtros" : ""}.</p>
              ) : (
                <div className="prestamos-deudas">
                  {resumenVisible.map((d) => (
                    <article key={`${d.tipo}|${d.codigo}|${d.unidad}|${d.presta}|${d.debe}`} className="prestamos-deuda">
                      <p className="prestamos-deuda-quien">
                        <strong>{nombre(d.debe)}</strong> le debe a <strong>{nombre(d.presta)}</strong>
                      </p>
                      <p className="prestamos-deuda-cantidad">{cantidadTexto(d.cantidad, d.unidad, d.kilos)}</p>
                      <p className="prestamos-deuda-material">
                        <strong>{d.codigo}</strong> · {d.tipo === "lamina" ? "lámina" : "producto"}
                      </p>
                      {(d.rollos.length > 0 || (d.cotizaciones?.length ?? 0) > 0) && (
                        <p className="prestamos-deuda-detalle">
                          {d.rollos.map((r) => `Rollo ${r.referencia} (${kilosTexto(r.kilos)})`).join(" · ")}
                          {d.rollos.length > 0 && (d.cotizaciones?.length ?? 0) > 0 ? " · " : ""}
                          {(d.cotizaciones?.length ?? 0) > 0 ? `Cot. ${d.cotizaciones!.join(", ")}` : ""}
                        </p>
                      )}
                    </article>
                  ))}
                  {externosDeben.map((f) => (
                    <article key={`ext-${f.id}`} className="prestamos-deuda prestamos-deuda-externa">
                      <p className="prestamos-deuda-quien">
                        <strong>{f.estado === "por_pagar" ? nombre(f.empresa_presta) : f.prestador}</strong> le debe a{" "}
                        <strong>{f.estado === "por_pagar" ? f.prestador : nombre(f.empresa_presta)}</strong>
                        <span className="prestamos-etiqueta">Empresa de afuera</span>
                      </p>
                      <p className="prestamos-deuda-cantidad">
                        {Math.abs(f.diferencia ?? 0).toLocaleString("es-CO")} kg <span>{f.estado === "por_pagar" ? "por pagar" : "por facturar"}</span>
                      </p>
                      <p className="prestamos-deuda-material"><strong>{f.codigo}</strong> · lámina</p>
                      <p className="prestamos-deuda-detalle">
                        Rollo prestado {f.referencia_rollo} ({(f.kilos_prestados ?? 0).toLocaleString("es-CO")} kg) · pagaron con {f.devuelto_con}
                        {f.numero_cotizacion ? ` · Cot. ${f.numero_cotizacion}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              )}
              </>}

              {/* ================== CADA PRÉSTAMO ================== */}
              {seccion === "prestamos" && <>
              <div className="prestamos-seccion-fila">
                <div className="prestamos-seccion-cabeza" style={{ margin: 0 }}>
                  <h2 className="inventario-form-subtitulo">{vista === "saldados" ? "Préstamos saldados" : "Cada préstamo"}</h2>
                  {vista === "pendientes" && sinSaldar.length > 0 && <p>Marca con la casilla los que ya se pagaron y dale Saldar.</p>}
                </div>
                {vista === "pendientes" && sinSaldar.length > 0 && (
                  <button type="button" className="inventario-boton" disabled={seleccion.size === 0 || saldando} onClick={saldar}
                    title={seleccion.size === 0 ? "Marca primero los préstamos que ya se pagaron" : ""}>
                    {saldando ? "Guardando..." : seleccion.size ? `✓ Saldar ${seleccion.size} préstamo${seleccion.size === 1 ? "" : "s"}` : "✓ Saldar"}
                  </button>
                )}
              </div>
              {prestamosVisibles.length === 0 ? (
                <p className="inventario-vacio">{vista === "saldados" ? "No hay préstamos saldados" : "✓ No hay préstamos sin saldar"}{hayFiltros ? " con estos filtros" : ""}.</p>
              ) : (
                <>
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla prestamos-tabla">
                    <thead>
                      <tr>
                        <th className="prestamos-col-marca">
                          <input type="checkbox" aria-label="Elegir todos los de esta página" checked={todosElegidos} disabled={sinSaldarPagina.length === 0}
                            onChange={() => setSeleccion((actual) => {
                              const nueva = new Set(actual);
                              sinSaldarPagina.forEach((p) => (todosElegidos ? nueva.delete(p.id) : nueva.add(p.id)));
                              return nueva;
                            })} />
                        </th>
                        <th>Fecha</th><th>Quién presta → recibe</th><th>Material</th><th className="prestamos-num">Cantidad</th>
                        <th>Cotización</th><th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prestamosPagina.map((p) => (
                        <tr key={p.id} className={seleccion.has(p.id) ? "prestamos-fila-marcada" : ""}>
                          <td className="prestamos-col-marca">
                            {!p.saldado && <input type="checkbox" aria-label={`Elegir préstamo ${p.codigo} del ${formatearFechaColombia(p.fecha, false)}`} checked={seleccion.has(p.id)} onChange={() => alternar(p.id)} />}
                          </td>
                          <td className="prestamos-fecha" title={`${ORIGEN[p.origen] || p.origen}${p.usuario ? ` · ${p.usuario}` : ""}`}>
                            {formatearFechaColombia(p.fecha, false)}
                            <small>{nombreBodega(p.bodega_id)}</small>
                          </td>
                          <td className="prestamos-quien">
                            <strong>{quienPresta(p)}</strong> <span aria-label="le presta a">→</span> {quienRecibe(p)}
                          </td>
                          <td className="prestamos-material">
                            <strong>{p.codigo}</strong>
                            <small title={p.descripcion}>{p.descripcion}</small>
                            {p.referencia_rollo && <small>Rollo {p.referencia_rollo} · {kilosTexto(p.kilos_rollo)}</small>}
                          </td>
                          <td className="prestamos-num"><strong>{cantidadTexto(p.cantidad, p.unidad, p.kilos)}</strong></td>
                          <td>{p.numero_cotizacion ? `Cot. ${p.numero_cotizacion}` : "—"}</td>
                          <td className="prestamos-estado-celda">
                            {p.saldado ? (
                              <>
                                <span className="prestamos-estado prestamos-estado-ok">✓ {p.origen === "devuelto_por_tercero" ? "Devuelto" : "Saldado"}</span>
                                {p.fecha_saldado && <small>{formatearFechaColombia(p.fecha_saldado, false)}</small>}
                              </>
                            ) : p.estado_cotizacion === "por_recoger" ? (
                              <span className="prestamos-estado prestamos-estado-espera" title={`Falta darle Salida a la cotización ${p.numero_cotizacion}`}>⏳ Por recoger</span>
                            ) : (
                              <span className="prestamos-estado prestamos-estado-pendiente">● Sin saldar</span>
                            )}
                            {p.devuelto_con && <small>Pagaron con: {p.devuelto_con}{p.factura ? ` · Factura ${p.factura}` : ""}</small>}
                            {!p.saldado && p.origen === "prestamo_a_tercero" && p.estado_cotizacion === "cancelada" && (
                              <button type="button" className="apartados-limpiar" onClick={() => cerrarCancelado(p)}>Cerrar (cotización cancelada)</button>
                            )}
                            {!p.saldado && p.origen === "prestamo_a_tercero" && (!p.estado_cotizacion || p.estado_cotizacion === "por_recoger") && (
                              <button type="button" className="prestamos-boton-devolver"
                                disabled={p.estado_cotizacion === "por_recoger"}
                                title={p.estado_cotizacion === "por_recoger"
                                  ? `Primero dale Salida a la cotización ${p.numero_cotizacion} en Apartados`
                                  : p.unidad === "m" ? "Registrar con qué rollo pagaron" : "Registrar lo que devolvieron"}
                                onClick={() => devolver(p)}>↩ Devolver</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginacion paginacion={{ total: prestamosVisibles.length, pagina: paginaPrestamos, total_paginas: totalPaginasPrestamos }}
                  alCambiarPagina={setPaginaPrestamos} etiqueta="préstamos" />
                </>
              )}
              </>}

              {/* ================== ROLLOS PRESTADOS A EMPRESAS DE AFUERA ================== */}
              <div hidden={seccion !== "cuadre"}>
                <CuadreRollosPrestados nombreBodega={nombreBodega} recargar={recargarCuadre} vista={vista} alCargar={alCargarCuadre} externa={externa} />
              </div>

              {/* ================== SACADO SIN EXISTENCIA ================== */}
              {seccion === "sacado" && vista === "pendientes" && <>
              <div className="prestamos-seccion-cabeza">
                <h2 className="inventario-form-subtitulo">Sacado sin existencia en el sistema</h2>
                <p>Lo que Planta sacó aunque el sistema decía que no había. Si hace falta, cuenta y corrige el stock en Inventario total.</p>
              </div>
              {reporte.sacado_sin_existencia.length === 0 ? (
                <p className="inventario-vacio">✓ Nada{hayFiltros ? " con estos filtros" : ""}.</p>
              ) : (
                <>
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla prestamos-tabla">
                    <thead>
                      <tr><th>Fecha</th><th>Bodega</th><th>Producto</th><th className="prestamos-num">Cantidad</th><th>Cotización</th><th>Quién</th></tr>
                    </thead>
                    <tbody>
                      {sacadoPagina.map((s, i) => (
                        <tr key={`${s.fecha}-${i}`} title={s.observaciones}>
                          <td className="prestamos-fecha">{formatearFechaColombia(s.fecha, false)}</td>
                          <td>{nombreBodega(s.bodega_id)}</td>
                          <td className="prestamos-material"><strong>{s.producto_codigo}</strong><small title={s.producto_descripcion}>{s.producto_descripcion}</small></td>
                          <td className="prestamos-num">{s.cantidad}</td>
                          <td>{s.cotizacion ? `Cot. ${s.cotizacion}` : "—"}</td>
                          <td>{s.usuario || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginacion paginacion={{ total: reporte.sacado_sin_existencia.length, pagina: paginaSacado, total_paginas: totalPaginasSacado }}
                  alCambiarPagina={setPaginaSacado} etiqueta="registros" />
                </>
              )}
              </>}
            </>
          )}
          {rolloADevolver && (
            <ModalDevolverRolloPrestado prestamo={rolloADevolver} alCerrar={() => setRolloADevolver(null)}
              alGuardar={async (mensaje) => { setRolloADevolver(null); setAviso(mensaje); setError(""); await cargar(); }} />
          )}
        </div>
      </div>
    </div>
  );
}

export default PrestamosPage;
