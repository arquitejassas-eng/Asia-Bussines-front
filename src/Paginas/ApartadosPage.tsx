import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BarraLateral from "../Componentes/BarraLateral";
import ModalConfirmacion from "../Componentes/ModalConfirmacion";
import { formatearFechaColombia } from "../Utils/fechas";
import { EMPRESAS } from "../Utils/empresas";
import PanelImportarCotizaciones from "../Componentes/PanelImportarCotizaciones";
import PanelRegistrarSalida from "../Componentes/PanelRegistrarSalida";
import PanelSepararCotizacion from "../Componentes/PanelSepararCotizacion";
import Paginacion from "../Componentes/Paginacion";
import { useApartados } from "../Hooks/useApartados";
import { contarNotificacionesBarraLateral } from "../Utils/notificaciones";
import { calcularSolicitudesPendientes } from "../Utils/produccion";
import "../Style/Inventario.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

// Mismos estados que backend/app/services/apartados.py::ESTADOS_CANCELABLES:
// se puede cancelar mientras la producción no haya terminado.
const ESTADOS_CANCELABLES = ["apartado", "enviado_a_produccion", "en_produccion"];

const APARTADOS_POR_PAGINA = 15;
// Cotizaciones con muchas líneas (ej. 18 tejas distintas) muestran estas y un "+N más".
const LINEAS_VISIBLES = 4;

/** Cantidad legible de una línea: metros para rollo (con la cuenta si son
 * piezas de una medida, ej. "18 × 6 m = 108 m"), unidades para producto. */
function cantidadLinea(it: { modalidad: string; cantidad: number; medida: number | null; metrosRequeridos: number | null }) {
  if (it.modalidad === "por_stock") return `${it.cantidad} und`;
  if (it.medida && it.medida !== 1) return `${it.cantidad} × ${it.medida} m = ${it.metrosRequeridos} m`;
  return `${it.metrosRequeridos ?? it.cantidad} m`;
}

// Pestañas de la lista: las abiertas, y aparte las entregadas y las canceladas.
// "Pendientes por dar salida": ya salieron pero falta saber de qué rollo
// (REFERENCIA "SI" en el Excel); se cierran con Registrar salida.
type Pestana = "cotizaciones" | "pendientes_salida" | "entregadas" | "canceladas";
const PESTANAS: Record<Pestana, string> = {
  cotizaciones: "Cotizaciones", pendientes_salida: "Pendientes por dar salida", entregadas: "Entregadas", canceladas: "Canceladas",
};
const ESTADO_DE_PESTANA: Partial<Record<Pestana, string>> = { entregadas: "entregado", canceladas: "cancelado" };
const CERRADAS = Object.values(ESTADO_DE_PESTANA);
function vaEnPestana(ap: { estado: string; salidaPendiente: boolean }, pestana: Pestana) {
  const estadoPropio = ESTADO_DE_PESTANA[pestana];
  if (estadoPropio) return ap.estado === estadoPropio;
  if (CERRADAS.includes(ap.estado)) return false;
  return ap.salidaPendiente === (pestana === "pendientes_salida");
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  apartado: "Apartado",
  enviado_a_produccion: "Enviado a producción",
  en_produccion: "En producción",
  produccion_terminada: "Producción terminada",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

type DatosDisponibilidad = {
  cantidadRollos?: number; familia?: string; metrosDisponibles?: number; metrosReservados?: number;
  metrosEnCamino?: number; metrosPorRepartir?: number; metrosEsperando?: number; metrosParaApartar?: number;
  stock?: number; cantidadReservada?: number; cantidadDisponible?: number;
  productoId?: number; codigo?: string; descripcion?: string;
};
type ItemDisponibilidad = { cargando?: boolean; error?: boolean; sinBodega?: boolean; datos?: DatosDisponibilidad };

function ApartadosPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const a = useApartados(sesion, almacen.refrescarApartadosPorEnviar);
  const esAdminInventario = sesion.rol === "admin_inventario";
  // Cotizaciones que Admin Inventario ya aprobó y esperan que la bodega
  // decida cuándo mandarlas a producción.
  const cotizacionesAprobadas = a.puedeEnviarAProduccion ? a.apartados.filter((ap) => ap.estado === "apartado") : [];

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
    return datos.cantidadRollos === 0 || Number(item.cantidad) * Number(item.medida) > (datos.metrosDisponibles ?? 0);
  });
  const ofrecerMaterialEnCamino = lineaSinMaterial || a.formulario.materialEnCamino
    || a.errorFormularioApartado.includes("viene en camino");

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
  const totalPaginas = Math.max(1, Math.ceil(apartadosFiltrados.length / APARTADOS_POR_PAGINA));
  const paginaSegura = Math.min(paginaApartados, totalPaginas);
  const apartadosPagina = apartadosFiltrados.slice((paginaSegura - 1) * APARTADOS_POR_PAGINA, paginaSegura * APARTADOS_POR_PAGINA);
  const paginacionApartados = { total: apartadosFiltrados.length, pagina: paginaSegura, total_paginas: totalPaginas };
  function cambiarPagina(pagina: number) {
    setPaginaApartados(Math.min(Math.max(1, pagina), totalPaginas));
    setSalidaAbierta(null);
  }

  const [confirmacion, setConfirmacion] = useState<{
    titulo: string; mensaje: string; textoConfirmar: string; ejecutar: () => void;
  } | null>(null);

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

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <div className="inventario-header">
            <h1 className="inventario-titulo">Apartados</h1>
            {a.puedeCrearApartados && !a.mostrarFormularioApartado && !mostrarImportar && (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button className="inventario-boton-cancelar" onClick={() => setMostrarImportar(true)}>
                  📥 Cargar desde Excel
                </button>
                <button className="inventario-boton" onClick={a.abrirFormularioApartado}>
                  + Nuevo apartado
                </button>
              </div>
            )}
          </div>
          <p className="inventario-carga-ayuda">
            {esAdminInventario
              ? <>Cuando se aprueba una cotización, créala aquí y elige de qué bodega sale el material.
                Cada línea puede ser material por rollo (código de clasificación, color y calibre) o un
                producto de stock (Tornillos, Amarres, etc.). El material queda reservado en esa bodega y a
                su encargada le llega el aviso para enviarlo a producción cuando quiera.</>
              : a.puedeEnviarAProduccion
                ? <>Aquí llegan las cotizaciones aprobadas por Admin Inventario con el material ya reservado en tu
                  bodega. Envíalas a producción cuando estés lista.</>
                : <>Cotizaciones aprobadas con su material reservado.</>}
          </p>

          {!a.mostrarFormularioApartado && cotizacionesAprobadas.map((ap) => (
            <div key={ap.id} className="inventario-exito" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span>
                {ap.faltantes.length ? "⏳" : "✅"} Cotización {ap.numeroCotizacion} aprobada{ap.cliente ? ` — ${ap.cliente}` : ""}
                {ap.empresa && <> · material de <strong>{EMPRESAS[ap.empresa] || ap.empresa}</strong></>}
                <span style={{ fontWeight: 400 }}> · {formatearFechaColombia(ap.fechaCreacion)}</span>
                {ap.faltantes.length > 0 && (
                  <span style={{ display: "block", fontWeight: 400 }}>
                    Esperando material: {ap.faltantes.join("; ")}. Podrás enviarla cuando le des ingreso.
                  </span>
                )}
              </span>
              <button className="inventario-boton" disabled={ap.faltantes.length > 0} onClick={() => confirmarEnvioAProduccion(ap)}>
                Enviar a producción
              </button>
            </div>
          ))}

          {a.errorAccionApartado && <p className="inventario-error">{a.errorAccionApartado}</p>}

          {a.mostrarFormularioApartado && (
            <form className="inventario-form" onSubmit={a.crearApartado} noValidate>
              <h2 className="inventario-form-subtitulo">
                {a.editandoId ? `Editar cotización ${a.formulario.numeroCotizacion}` : "Nuevo apartado"}
              </h2>
              {a.editandoId && (
                <p className="inventario-carga-ayuda">
                  Puedes cambiar los datos y las líneas. Las líneas que ya tuvieron salida no se pueden quitar ni bajar de
                  lo que ya salió, y la bodega solo se puede cambiar si todavía no ha salido nada.
                </p>
              )}

              <div className="inventario-form-grid">
                <div>
                  <label>Bodega de donde sale *</label>
                  <select value={a.formulario.bodegaId} onChange={(e) => a.cambiarBodegaApartado(e.target.value)}>
                    <option value="">Elige la bodega...</option>
                    {almacen.bodegas.map((bodega) => (
                      <option key={bodega.id} value={bodega.id}>{bodega.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Empresa de la que sale el material *</label>
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
                    placeholder="Ej. COT-00125"
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
                    </p>
                  ) : null}
                  {indice > 0 && !item.id && !a.editandoId && almacen.bodegas.length > 1 && (
                    <div className="apartado-linea-cabecera">
                      <strong>Producto {indice + 1}</strong>
                      <select
                        aria-label="Bodega de donde sale este producto"
                        title="Si sale de otra bodega, al guardar se crea la misma cotización también en esa bodega."
                        className={`apartados-select ${item.bodegaId ? "apartados-select-activo" : ""}`}
                        value={item.bodegaId || ""}
                        onChange={(e) => a.cambiarBodegaItem(indice, e.target.value)}
                      >
                        <option value="">
                          Sale de {almacen.bodegas.find((b) => String(b.id) === String(a.formulario.bodegaId))?.nombre || "la bodega de la cotización"}
                        </option>
                        {almacen.bodegas.filter((b) => String(b.id) !== String(a.formulario.bodegaId)).map((b) => (
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
                            No hay rollos con ese código en esa bodega.
                          </p>
                        ) : (
                          <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
                            {disponibilidadItems[indice].datos.familia && `${disponibilidadItems[indice].datos.familia} · `}
                            {disponibilidadItems[indice].datos.cantidadRollos} rollo{disponibilidadItems[indice].datos.cantidadRollos === 1 ? "" : "s"} ·{" "}
                            <strong>{disponibilidadItems[indice].datos.metrosDisponibles} m disponibles</strong>
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
                    </div>
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
                            placeholder={(item.bodegaId || a.formulario.bodegaId) ? "Buscar por código o descripción..." : "Elige primero la bodega"}
                            disabled={!(item.bodegaId || a.formulario.bodegaId)}
                            value={item.busquedaProducto}
                            onChange={(e) => a.buscarProductoParaItem(indice, e.target.value)}
                          />
                          {a.resultadosBusquedaProducto[indice]?.length > 0 && (
                            <div className="inventario-tabla-contenedor" style={{ maxHeight: "180px", overflowY: "auto" }}>
                              {a.resultadosBusquedaProducto[indice].map((p: Record<string, any>) => (
                                <button
                                  type="button"
                                  key={p.id}
                                  className="inventario-resultado-busqueda"
                                  style={{ display: "block", width: "100%", textAlign: "left", padding: "0.4rem" }}
                                  onClick={() => a.seleccionarProductoParaItem(indice, p)}
                                >
                                  <strong>{p.codigo}</strong> — {p.descripcion} (stock: {p.stock})
                                </button>
                              ))}
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
                          <strong>{disponibilidadItems[indice].datos.cantidadDisponible} disponible</strong>
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label>Descripción</label>
                    <input
                      placeholder="Ej. Teja de 6 metros"
                      value={item.descripcion}
                      onChange={(e) => a.actualizarItemApartado(indice, "descripcion", e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Cantidad *</label>
                    <input
                      type="number" min="0" step="1"
                      value={item.cantidad}
                      onChange={(e) => a.actualizarItemApartado(indice, "cantidad", e.target.value)}
                    />
                  </div>
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
                  {a.formulario.items.length > 1 && !(item.metrosConsumidos || item.stockDescontado) && (
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
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", margin: "0.75rem 0" }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto", marginTop: "0.2rem" }}
                    checked={a.formulario.materialEnCamino}
                    onChange={(e) => a.marcarMaterialEnCamino(e.target.checked)}
                  />
                  <span>
                    <strong>El material viene en camino.</strong> En la bodega no alcanza, pero ya está comprado.
                    El apartado queda "esperando material" y la bodega podrá enviarlo a producción cuando le dé ingreso.
                  </span>
                </label>
              )}

              {a.errorFormularioApartado && <p className="inventario-error">{a.errorFormularioApartado}</p>}

              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={a.guardandoApartado}>
                  {a.guardandoApartado ? "Guardando..." : a.editandoId ? "Guardar cambios" : "Crear apartado"}
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
                    {Object.entries(ETIQUETAS_ESTADO).filter(([valor]) => !Object.values(ESTADO_DE_PESTANA).includes(valor)).map(([valor, etiqueta]) => (
                      <option key={valor} value={valor}>{etiqueta}</option>
                    ))}
                  </select>
                )}
                {esAdminInventario && (
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
                    ? `${apartadosFiltrados.length} ${apartadosFiltrados.length === 1 ? "cotización" : "cotizaciones"} con material que ya salió, pero falta saber de qué rollo. Cuando revisen la hoja de vida, usa "Registrar salida" con la referencia del rollo.`
                    : pestana === "entregadas"
                    ? `${apartadosFiltrados.length} ${apartadosFiltrados.length === 1 ? "cotización entregada" : "cotizaciones entregadas"} al cliente.`
                    : pestana === "canceladas"
                    ? `${apartadosFiltrados.length} ${apartadosFiltrados.length === 1 ? "cotización cancelada" : "cotizaciones canceladas"}.`
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
                        {esAdminInventario && <th>Bodega</th>}
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
                          <td colSpan={esAdminInventario ? 8 : 7} className="inventario-vacio">
                            {pestana !== "cotizaciones" && !hayFiltros
                              ? `Todavía no hay cotizaciones ${pestana}.`
                              : a.apartados.length === 0 ? "No hay apartados registrados." : "Ninguna cotización coincide con los filtros."}
                          </td>
                        </tr>
                      ) : (
                        apartadosPagina.map((ap) => {
                          const itemsRollo = ap.items.filter((it) => it.modalidad === "por_rollo");
                          const itemsStock = ap.items.filter((it) => it.modalidad === "por_stock");
                          const rolloPendientes = itemsRollo.filter((it) => (it.metrosPendientes ?? 0) > 0).length;
                          // Punto unificado: una cotización es un solo Apartado (ver
                          // UniqueConstraint bodega+numero_cotizacion en el backend) que
                          // puede mezclar ítems de stock y de rollo -- se ven en la misma
                          // fila, no en pantallas separadas.
                          const tieneProduccionPendiente = (ap.estado === "enviado_a_produccion" || ap.estado === "en_produccion")
                            && !ap.salidaPendiente && calcularSolicitudesPendientes([ap]).length > 0;
                          return (
                          <Fragment key={ap.id}>
                          <tr>
                            {esAdminInventario && <td className="ap-col-bodega" data-etiqueta="Bodega">{ap.bodegaNombre || "—"}</td>}
                            <td className="ap-col-cotizacion">{ap.numeroCotizacion}</td>
                            <td className="ap-col-empresa" data-etiqueta="Empresa">{EMPRESAS[ap.empresa] || ap.empresa || "—"}</td>
                            <td className="ap-col-cliente">{ap.cliente || "—"}</td>
                            <td className="ap-col-productos" style={{ minWidth: 340 }}>
                              <ul className="apartado-lineas">
                                {(lineasExpandidas.has(ap.id) ? ap.items : ap.items.slice(0, LINEAS_VISIBLES)).map((it) => {
                                  const lista = it.modalidad === "por_stock" ? it.stockDescontado : (it.metrosPendientes ?? 0) <= 0;
                                  const codigo = it.modalidad === "por_stock" ? "" : it.codigoInterno;
                                  const texto = it.descripcion || (it.modalidad === "por_stock" ? `producto #${it.productoId}` : "");
                                  return (
                                    <li key={it.id} className={lista ? "apartado-linea-lista" : undefined}>
                                      <div className="apartado-linea-cabeza">
                                        <strong>{cantidadLinea(it)}</strong>
                                        {codigo && <span className="apartado-linea-codigo">{codigo}</span>}
                                        {lista
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
                            </td>
                            <td className="ap-col-estado">
                              {ap.salidaPendiente && !CERRADAS.includes(ap.estado)
                                ? <span className="apartados-estado estado-por_dar_salida">Por dar salida</span>
                                : <span className={`apartados-estado estado-${ap.estado}`}>{ETIQUETAS_ESTADO[ap.estado] || ap.estado}</span>}
                            </td>
                            <td className="ap-col-fecha" data-etiqueta="Creado" style={{ whiteSpace: "nowrap" }}>{formatearFechaColombia(ap.fechaCreacion, false)}</td>
                            <td className="inventario-acciones ap-col-acciones">
                              {a.puedeEnviarAProduccion && ap.estado === "apartado" && (
                                <button
                                  disabled={ap.faltantes.length > 0}
                                  title={ap.faltantes.length ? "Esperando material: se habilita cuando le des ingreso" : undefined}
                                  onClick={() => confirmarEnvioAProduccion(ap)}
                                >Enviar a producción</button>
                              )}
                              {a.puedeCancelarApartados && ESTADOS_CANCELABLES.includes(ap.estado) && (
                                <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
                                  titulo: `¿Cancelar el apartado ${ap.numeroCotizacion}?`,
                                  mensaje: ap.estado === "apartado"
                                    ? "El material que tenía reservado queda libre para otras ventas."
                                    : "Ya fue enviado a producción. Al cancelarlo, el material que faltaba por producir queda libre para otras ventas. Lo que ya se produjo NO vuelve al inventario.",
                                  textoConfirmar: "Sí, cancelar apartado",
                                  ejecutar: () => a.cancelarApartado(ap.id),
                                })}>Cancelar</button>
                              )}
                              {a.puedeCancelarApartados && ap.estado === "cancelado" && !ap.items.some((it) => it.tieneProduccionRegistrada) && (
                                <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
                                  titulo: `¿Eliminar la cotización cancelada ${ap.numeroCotizacion}?`,
                                  mensaje: "Se borra de la lista para siempre. No afecta el inventario: su material ya quedó libre al cancelarla.",
                                  textoConfirmar: "Sí, eliminar",
                                  ejecutar: () => a.eliminarApartado(ap.id),
                                })}>Eliminar</button>
                              )}
                              {esAdminInventario && ESTADOS_CANCELABLES.includes(ap.estado) && (
                                <button onClick={() => { setSalidaAbierta(null); a.abrirEdicionApartado(ap); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                                  Editar
                                </button>
                              )}
                              {esAdminInventario && ESTADOS_CANCELABLES.includes(ap.estado) && (
                                <button onClick={() => { setSepararAbierta(null); setSalidaAbierta(ap.id); }}>Registrar salida</button>
                              )}
                              {(ap.items.length > 1 || (ap.items[0]?.cantidad ?? 0) > 1)
                                && ((esAdminInventario && (ESTADOS_CANCELABLES.includes(ap.estado) || ap.estado === "produccion_terminada"))
                                  || (a.puedeMarcarEntregado && ap.estado === "produccion_terminada")) && (
                                <button onClick={() => { setSalidaAbierta(null); setSepararAbierta(ap.id); }}>Separar</button>
                              )}
                              {tieneProduccionPendiente && !esAdminInventario && (
                                <button onClick={() => irAIniciarProduccion(ap.numeroCotizacion)}>Iniciar Producción</button>
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
                            </td>
                          </tr>
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
