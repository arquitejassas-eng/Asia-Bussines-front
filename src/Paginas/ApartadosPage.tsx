import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BarraLateral from "../Componentes/BarraLateral";
import ModalConfirmacion from "../Componentes/ModalConfirmacion";
import { formatearFechaColombia } from "../Utils/fechas";
import { useApartados } from "../Hooks/useApartados";
import { contarNotificacionesBarraLateral } from "../Utils/notificaciones";
import { calcularSolicitudesPendientes } from "../Utils/produccion";
import "../Style/Inventario.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

// Flag temporal: la entrega física a cliente es responsabilidad del módulo
// de Despachos, que todavía no existe -- mismo flag y motivo que
// backend/app/services/apartados.py::DESPACHOS_INTEGRADO. Cuando Despachos
// se integre, cambiar a true (o eliminar la condición) en ambos lados.
const DESPACHOS_INTEGRADO = false;

// Mismos estados que backend/app/services/apartados.py::ESTADOS_CANCELABLES:
// se puede cancelar mientras la producción no haya terminado.
const ESTADOS_CANCELABLES = ["apartado", "enviado_a_produccion", "en_produccion"];

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
  stock?: number; cantidadReservada?: number; cantidadDisponible?: number;
  productoId?: number; codigo?: string; descripcion?: string;
};
type ItemDisponibilidad = { cargando?: boolean; error?: boolean; datos?: DatosDisponibilidad };

function ApartadosPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const a = useApartados(sesion);
  const disponibilidadItems = a.disponibilidadItems as Record<number, ItemDisponibilidad>;
  const navigate = useNavigate();

  const notificaciones = contarNotificacionesBarraLateral(almacen, sesion);
  const [mensajeInformativo, setMensajeInformativo] = useState("");
  // Acciones que cambian el estado de un apartado piden confirmación: antes
  // un clic accidental lo enviaba a producción o cerraba la producción.
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
            {a.puedeGestionarApartados && !a.mostrarFormularioApartado && (
              <button className="inventario-boton" onClick={a.abrirFormularioApartado}>
                + Nuevo apartado
              </button>
            )}
          </div>
          <p className="inventario-carga-ayuda">
            Reserva material para la cotización de un cliente sin enviarlo aún a producción/entrega.
            Cada línea puede ser material por rollo (código de clasificación, color y calibre) o un
            producto de stock (Tornillos, Amarres, etc.) — puedes mezclar ambos tipos en el mismo
            apartado. El material queda como "reservado" hasta que canceles el apartado o lo entregues.
          </p>

          {a.errorAccionApartado && <p className="inventario-error">{a.errorAccionApartado}</p>}

          {a.mostrarFormularioApartado && (
            <form className="inventario-form" onSubmit={a.crearApartado} noValidate>
              <h2 className="inventario-form-subtitulo">Nuevo apartado</h2>

              <div className="inventario-form-grid">
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
                  <div style={{ gridColumn: "1 / -1" }}>
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
                        value={item.codigoInterno}
                        onChange={(e) => a.actualizarItemApartado(indice, "codigoInterno", e.target.value)}
                        onBlur={(e) => a.consultarDisponibilidadItem(indice, e.target.value)}
                      />
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
                        disponibilidadItems[indice].datos.cantidadRollos === 0 ? (
                          <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
                            No hay rollos con ese código en tu bodega.
                          </p>
                        ) : (
                          <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
                            {disponibilidadItems[indice].datos.familia && `${disponibilidadItems[indice].datos.familia} · `}
                            {disponibilidadItems[indice].datos.cantidadRollos} rollo{disponibilidadItems[indice].datos.cantidadRollos === 1 ? "" : "s"} ·{" "}
                            <strong>{disponibilidadItems[indice].datos.metrosDisponibles} m disponibles</strong>
                            {(disponibilidadItems[indice].datos?.metrosReservados ?? 0) > 0 && ` · ${disponibilidadItems[indice].datos?.metrosReservados} m ya reservados`}
                          </p>
                        )
                      )}
                    </div>
                  ) : (
                    <div>
                      <label>Producto *</label>
                      {item.productoId ? (
                        <div className="inventario-carga-ayuda" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span><strong>{item.productoCodigo}</strong> — {item.productoDescripcion}</span>
                          <button type="button" className="inventario-boton-cancelar" onClick={() => a.cambiarModalidadItem(indice, "por_stock")}>
                            Cambiar
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            placeholder="Buscar por código o descripción..."
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
                  {a.formulario.items.length > 1 && (
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

              {a.errorFormularioApartado && <p className="inventario-error">{a.errorFormularioApartado}</p>}

              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={a.guardandoApartado}>
                  {a.guardandoApartado ? "Guardando..." : "Crear apartado"}
                </button>
                <button type="button" className="inventario-boton-cancelar" onClick={a.cerrarFormularioApartado}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {!a.mostrarFormularioApartado && (
            <>
              <div className="inventario-buscador">
                <select value={a.filtroEstado} onChange={(e) => a.setFiltroEstado(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {Object.entries(ETIQUETAS_ESTADO).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>{etiqueta}</option>
                  ))}
                </select>
              </div>

              {a.cargandoApartados ? (
                <p className="inventario-cargando">Cargando apartados...</p>
              ) : (
                <div className="inventario-tabla-contenedor">
                  <table className="inventario-tabla">
                    <thead>
                      <tr>
                        <th>Cotización</th>
                        <th>Cliente</th>
                        <th>Productos</th>
                        <th>Estado</th>
                        <th>Creado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.apartados.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="inventario-vacio">No hay apartados registrados.</td>
                        </tr>
                      ) : (
                        a.apartados.map((ap) => {
                          const itemsRollo = ap.items.filter((it) => it.modalidad === "por_rollo");
                          const itemsStock = ap.items.filter((it) => it.modalidad === "por_stock");
                          const rolloPendientes = itemsRollo.filter((it) => (it.metrosPendientes ?? 0) > 0).length;
                          // Punto unificado: una cotización es un solo Apartado (ver
                          // UniqueConstraint bodega+numero_cotizacion en el backend) que
                          // puede mezclar ítems de stock y de rollo -- se ven en la misma
                          // fila, no en pantallas separadas.
                          const tieneProduccionPendiente = (ap.estado === "enviado_a_produccion" || ap.estado === "en_produccion")
                            && calcularSolicitudesPendientes([ap]).length > 0;
                          return (
                          <tr key={ap.id}>
                            <td>{ap.numeroCotizacion}</td>
                            <td>{ap.cliente || "—"}</td>
                            <td>
                              <div>
                                {ap.items.map((it) => (
                                  it.modalidad === "por_stock"
                                    ? `${it.cantidad} × ${it.descripcion || `producto #${it.productoId}`}`
                                    : `${it.cantidad} × ${it.codigoInterno}${it.descripcion ? ` (${it.descripcion})` : ""}`
                                )).join("; ")}
                              </div>
                              {itemsStock.length > 0 && (
                                <div className="inventario-carga-ayuda" style={{ margin: "0.15rem 0 0" }}>
                                  Stock ({itemsStock.length}): {ap.stockSeparadoConfirmado ? "separado ✓" : "pendiente de separar"}
                                </div>
                              )}
                              {itemsRollo.length > 0 && (
                                <div className="inventario-carga-ayuda" style={{ margin: "0.15rem 0 0" }}>
                                  Rollo: {itemsRollo.length - rolloPendientes} de {itemsRollo.length} producido{itemsRollo.length === 1 ? "" : "s"}
                                  {rolloPendientes > 0 ? ` — ${rolloPendientes} pendiente${rolloPendientes === 1 ? "" : "s"}` : " ✓"}
                                </div>
                              )}
                            </td>
                            <td>{ETIQUETAS_ESTADO[ap.estado] || ap.estado}</td>
                            <td>{formatearFechaColombia(ap.fechaCreacion)}</td>
                            <td className="inventario-acciones">
                              {a.puedeGestionarApartados && ap.estado === "apartado" && (
                                <button onClick={() => setConfirmacion({
                                  titulo: `¿Enviar ${ap.numeroCotizacion} a producción?`,
                                  mensaje: "Planta verá esta cotización como pendiente de producir.",
                                  textoConfirmar: "Sí, enviar a producción",
                                  ejecutar: () => a.enviarApartadoAProduccion(ap.id),
                                })}>Enviar a producción</button>
                              )}
                              {a.puedeGestionarApartados && ESTADOS_CANCELABLES.includes(ap.estado) && (
                                <button className="inventario-boton-eliminar" onClick={() => setConfirmacion({
                                  titulo: `¿Cancelar el apartado ${ap.numeroCotizacion}?`,
                                  mensaje: ap.estado === "apartado"
                                    ? "El material que tenía reservado queda libre para otras ventas."
                                    : "Ya fue enviado a producción. Al cancelarlo, el material que faltaba por producir queda libre para otras ventas. Lo que ya se produjo NO vuelve al inventario.",
                                  textoConfirmar: "Sí, cancelar apartado",
                                  ejecutar: () => a.cancelarApartado(ap.id),
                                })}>Cancelar</button>
                              )}
                              {tieneProduccionPendiente && (
                                <button onClick={() => irAIniciarProduccion(ap.numeroCotizacion)}>Iniciar Producción</button>
                              )}
                              {a.puedeMarcarTerminado && (ap.estado === "enviado_a_produccion" || ap.estado === "en_produccion") && (
                                <button onClick={() => setConfirmacion({
                                  titulo: `¿Marcar como terminada la producción de ${ap.numeroCotizacion}?`,
                                  mensaje: "Se cierra la producción de esta cotización y se descuenta el stock de sus productos apartados. No se puede deshacer.",
                                  textoConfirmar: "Sí, marcar terminada",
                                  ejecutar: () => a.marcarApartadoProduccionTerminada(ap.id),
                                })}>Marcar producción terminada</button>
                              )}
                              {DESPACHOS_INTEGRADO && ap.estado === "produccion_terminada" && (
                                <button onClick={() => a.marcarApartadoEntregado(ap.id)}>Marcar entregado</button>
                              )}
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
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
