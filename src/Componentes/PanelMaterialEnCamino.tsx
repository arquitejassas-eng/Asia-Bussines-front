import { Fragment, useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import ModalConfirmacion from "./ModalConfirmacion";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";
import { formatearFechaColombia } from "../Utils/fechas";

type RolloEnCamino = {
  id: number; identificador_rollo: string; codigo_interno: string; descripcion: string; metros: number; peso_neto: number | null;
  llego: boolean; llego_por: string; fecha_llegada: string | null; ya_tiene_ingreso: boolean;
  rollo_inventario_id?: number | null; destino?: string; estado_envio?: string;
};
type Cargamento = {
  id: number; estado?: string; proveedor: string; archivo_origen: string; creado_por: string; fecha_creacion: string;
  total_rollos: number; rollos_llegados: number; total_metros: number; metros_pendientes: number;
  rollos_ya_con_ingreso: number; rollos: RolloEnCamino[];
};
type Confirmacion = { titulo: string; mensaje: string; textoConfirmar: string; ejecutar: () => void };

const minusculas = (texto: string) => texto.trim().toLowerCase();
/** Se puede mandar a una bodega: no ha llegado (se marca al enviarlo) o ya
 * llegó y sigue por repartir en Admin Inventario. */
const sePuedeEnviar = (r: RolloEnCamino, abierto: boolean) =>
  r.llego ? Boolean(r.rollo_inventario_id) && !r.estado_envio : abierto;

function EnviadoA({ r }: { r: RolloEnCamino }) {
  if (r.estado_envio === "recibido") return <span style={{ color: "#1b7a3a" }}>✓ En {r.destino}</span>;
  if (r.estado_envio === "pendiente_confirmacion") {
    return <span style={{ color: "#B8720A" }}>→ {r.destino} <small>(falta que lo reciban)</small></span>;
  }
  if (r.rollo_inventario_id) return <span className="recepcion-texto-secundario">Por repartir</span>;
  return <span className="recepcion-texto-secundario">—</span>;
}

/** Checklists de material que todavía no llega (se guardan desde Recepción).
 * Son de la empresa: cualquier bodega puede apartar de ellos. Llegan por
 * partes (mulas): Admin Inventario marca a mano los rollos de cada mula. */
export default function PanelMaterialEnCamino({ puedeGestionar, recargar }: { puedeGestionar: boolean; recargar: number }) {
  const [cargamentos, setCargamentos] = useState<Cargamento[]>([]);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState("");
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [verCerrados, setVerCerrados] = useState(false);
  const [bodegas, setBodegas] = useState<{ id: number; nombre: string }[]>([]);
  const [destino, setDestino] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    try {
      setCargamentos(await api.get<Cargamento[]>(`/material-en-camino${verCerrados ? "?incluir_cerrados=true" : ""}`) || []);
    } catch {
      // Silencioso: si falla una recarga se queda la lista anterior.
    }
  }, [verCerrados]);
  useEffect(() => { cargar(); }, [cargar, recargar]);
  useEffect(() => {
    if (!puedeGestionar) return;
    api.get<{ id: number; nombre: string }[]>("/bodegas").then((b) => setBodegas(b || [])).catch(() => setBodegas([]));
  }, [puedeGestionar]);
  useActualizacionAutomatica(cargar);

  function abrir(id: number) {
    setAbierto((actual) => (actual === id ? null : id));
    setSeleccion(new Set());
    setBusqueda("");
  }

  function alternar(id: number) {
    setSeleccion((actual) => {
      const nueva = new Set(actual);
      if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
      return nueva;
    });
  }

  async function ejecutar(accion: () => Promise<unknown>, textoError: string) {
    setError("");
    setAviso("");
    try {
      await accion();
      setSeleccion(new Set());
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : textoError);
    }
  }

  if (cargamentos.length === 0 && !error && !verCerrados) {
    if (!puedeGestionar) return null;
    return (
      <p className="recepcion-texto-ayuda">
        No hay material en camino.{" "}
        <button type="button" className="recepcion-boton-secundario" onClick={() => setVerCerrados(true)}>Ver checklists ya cerrados</button>
      </p>
    );
  }

  return (
    <section className="recepcion-tarjeta">
      <h3>Material en camino</h3>
      <p className="recepcion-texto-ayuda">
        Checklists de material comprado que todavía no llega. Es de la empresa: cualquier bodega puede apartar
        de aquí. {puedeGestionar
          ? "Cuando llegue una mula, dale ingreso a sus rollos arriba en Recepción y márcalos aquí como llegados."
          : "Admin Inventario marca los rollos a medida que llegan."}
      </p>
      {puedeGestionar && (
        <label style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", margin: "0 0 0.5rem" }}>
          <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} /> Ver también los checklists cerrados
        </label>
      )}
      {error && <p className="recepcion-error">{error}</p>}
      {aviso && <p className="recepcion-exito">{aviso}</p>}
      <table className="recepcion-tabla">
        <thead>
          <tr>
            <th>Checklist</th>
            <th>Proveedor</th>
            <th>Cargado</th>
            <th>Llegados</th>
            <th>Metros por llegar</th>
          </tr>
        </thead>
        <tbody>
          {cargamentos.map((cg) => {
            const texto = minusculas(busqueda);
            // Los kilos se escriben con coma o punto: "2035,5" encuentra el de 2035.5 kg.
            const kilos = texto.replace(",", ".");
            const visibles = cg.rollos.filter((r) => !texto
              || minusculas(r.identificador_rollo).includes(texto) || minusculas(r.codigo_interno).includes(texto)
              || (r.peso_neto != null && String(r.peso_neto).includes(kilos)));
            const conIngreso = cg.rollos.filter((r) => r.ya_tiene_ingreso).map((r) => r.id);
            const estaAbierto = (cg.estado || "en_camino") === "en_camino";
            const marcadosSinLlegar = cg.rollos.filter((r) => seleccion.has(r.id) && !r.llego).map((r) => r.id);
            const marcadosEnviables = cg.rollos.filter((r) => seleccion.has(r.id) && sePuedeEnviar(r, estaAbierto));
            const enviados = cg.rollos.filter((r) => r.estado_envio).length;
            const nombreDestino = bodegas.find((b) => String(b.id) === destino)?.nombre || "";
            const seleccionables = visibles.filter((r) => (!r.llego && estaAbierto) || sePuedeEnviar(r, estaAbierto)).map((r) => r.id);
            const seleccionados = cg.rollos.filter((r) => seleccion.has(r.id));
            const todosMarcados = seleccionables.length > 0 && seleccionables.every((id) => seleccion.has(id));
            return (
              <Fragment key={cg.id}>
                <tr>
                  <td>
                    <button type="button" className="recepcion-boton-secundario" onClick={() => abrir(cg.id)}>
                      {abierto === cg.id ? "▲" : "▼"} {cg.archivo_origen}
                    </button>
                  </td>
                  <td>{cg.proveedor}</td>
                  <td>{formatearFechaColombia(cg.fecha_creacion)}</td>
                  <td>
                    <strong>{cg.rollos_llegados} de {cg.total_rollos}</strong>
                    {enviados > 0 && <div className="recepcion-texto-secundario">{enviados} enviados a bodegas</div>}
                    {!estaAbierto && <div className="recepcion-texto-secundario">Cerrado</div>}
                    {puedeGestionar && cg.rollos_ya_con_ingreso > 0 && (
                      <div className="recepcion-error" style={{ margin: 0 }}>
                        {cg.rollos_ya_con_ingreso} ya tienen ingreso en Recepción: márcalos como llegados.
                      </div>
                    )}
                  </td>
                  <td>{cg.metros_pendientes}</td>
                </tr>
                {abierto === cg.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="encamino-barra">
                        <div className="encamino-barra-fila">
                          <label className="encamino-buscar">
                            <span>Buscar</span>
                            <input
                              type="search"
                              placeholder="Referencia, código o kilos"
                              value={busqueda}
                              onChange={(e) => setBusqueda(e.target.value)}
                            />
                          </label>
                          {puedeGestionar && (
                            <div className="encamino-admin" aria-label="Administrar checklist">
                              {estaAbierto && (
                                <button type="button" className="encamino-boton encamino-boton-suave" onClick={() => setConfirmacion({
                                  titulo: `¿Cerrar el checklist ${cg.archivo_origen}?`,
                                  mensaje: `Los ${cg.total_rollos - cg.rollos_llegados} rollos que no han llegado dejan de contar: úsalo si ya no van a venir. Lo que se apartó contando con ellos quedará esperando material.`,
                                  textoConfirmar: "Sí, cerrar",
                                  ejecutar: () => ejecutar(() => api.patch(`/material-en-camino/${cg.id}/cerrar`), "No se pudo cerrar el checklist."),
                                })}>Cerrar checklist</button>
                              )}
                              <button type="button" className="encamino-boton encamino-boton-peligro" onClick={() => setConfirmacion({
                                titulo: `¿Eliminar el checklist ${cg.archivo_origen}?`,
                                mensaje: "Úsalo solo si se subió por error. Lo que se apartó contando con este material quedará esperando material.",
                                textoConfirmar: "Sí, eliminar",
                                ejecutar: () => ejecutar(() => api.delete(`/material-en-camino/${cg.id}`), "No se pudo eliminar."),
                              })}>Eliminar</button>
                            </div>
                          )}
                        </div>

                        {puedeGestionar && (
                          <div className={`encamino-acciones${seleccionados.length ? " activa" : ""}`} aria-live="polite">
                            <div className="encamino-seleccion">
                              {seleccionados.length ? (
                                <>
                                  <strong>{seleccionados.length} rollo{seleccionados.length === 1 ? "" : "s"} marcado{seleccionados.length === 1 ? "" : "s"}</strong>
                                  <button type="button" className="encamino-enlace" onClick={() => setSeleccion(new Set())}>Desmarcar</button>
                                </>
                              ) : (
                                <span>Marca rollos en la tabla para registrarlos como llegados o enviarlos a una bodega.</span>
                              )}
                              {conIngreso.length > 0 && (
                                <button type="button" className="encamino-enlace" onClick={() => setSeleccion(new Set(conIngreso))}>
                                  Marcar los que ya tienen ingreso ({conIngreso.length})
                                </button>
                              )}
                            </div>
                            <div className="encamino-grupos">
                              <div className="encamino-grupo">
                                <span className="encamino-grupo-titulo">Llegada</span>
                                <button
                                  type="button"
                                  className="encamino-boton encamino-boton-secundario"
                                  disabled={marcadosSinLlegar.length === 0}
                                  title={marcadosSinLlegar.length === 0 ? "Marca rollos que todavía no han llegado" : ""}
                                  onClick={() => setConfirmacion({
                                    titulo: `¿Llegaron estos ${marcadosSinLlegar.length} rollos?`,
                                    mensaje: "Dejan de contar como \"en camino\" y pasan a contar como material de Admin Inventario por repartir.",
                                    textoConfirmar: "Sí, llegaron",
                                    ejecutar: () => ejecutar(() => api.patch(`/material-en-camino/${cg.id}/llegada`, { rollo_ids: marcadosSinLlegar }), "No se pudieron marcar los rollos."),
                                  })}
                                >
                                  ✓ Marcar como llegados{marcadosSinLlegar.length ? ` (${marcadosSinLlegar.length})` : ""}
                                </button>
                              </div>
                              <div className="encamino-grupo">
                                <label className="encamino-grupo-titulo" htmlFor={`encamino-destino-${cg.id}`}>Enviar a bodega</label>
                                <div className="encamino-enviar">
                                  <select id={`encamino-destino-${cg.id}`} value={destino} onChange={(e) => setDestino(e.target.value)}>
                                    <option value="">Escoge la bodega</option>
                                    {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                                  </select>
                                  <button
                                    type="button"
                                    className="encamino-boton encamino-boton-primario"
                                    disabled={!destino || marcadosEnviables.length === 0}
                                    title={!destino ? "Escoge la bodega" : marcadosEnviables.length === 0 ? "Marca los rollos que vas a enviar" : ""}
                                    onClick={() => {
                                      const ids = marcadosEnviables.map((r) => r.id);
                                      const sinLlegar = marcadosEnviables.filter((r) => !r.llego).length;
                                      const plural = ids.length === 1 ? "" : "s";
                                      setConfirmacion({
                                        titulo: `¿Enviar ${ids.length} rollo${plural} a ${nombreDestino}?`,
                                        mensaje: (sinLlegar ? `${sinLlegar} de ellos todavía no estaba${sinLlegar === 1 ? "" : "n"} marcado${sinLlegar === 1 ? "" : "s"} como llegado${sinLlegar === 1 ? "" : "s"}: se marca${sinLlegar === 1 ? "" : "n"} de una vez. ` : "")
                                          + `${nombreDestino} los recibe como cualquier envío: confirma que llegaron.`,
                                        textoConfirmar: "Sí, enviar",
                                        ejecutar: () => ejecutar(async () => {
                                          await api.post(`/material-en-camino/${cg.id}/enviar`, { rollo_ids: ids, bodega_destino_id: Number(destino) });
                                          setAviso(`Listo: ${ids.length} rollo${plural} enviado${plural} a ${nombreDestino}.`);
                                        }, "No se pudo hacer el envío."),
                                      });
                                    }}
                                  >
                                    Enviar{marcadosEnviables.length ? ` ${marcadosEnviables.length}` : ""} →
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <table className="recepcion-tabla">
                        <thead>
                          <tr>
                            {puedeGestionar && (
                              <th>
                                {seleccionables.length > 0 && (
                                  <input
                                    type="checkbox"
                                    aria-label="Marcar todos los rollos de la lista"
                                    checked={todosMarcados}
                                    onChange={(e) => setSeleccion((actual) => {
                                      const nueva = new Set(actual);
                                      seleccionables.forEach((id) => (e.target.checked ? nueva.add(id) : nueva.delete(id)));
                                      return nueva;
                                    })}
                                  />
                                )}
                              </th>
                            )}
                            <th>Referencia</th>
                            <th>Código</th>
                            <th>Kilos</th>
                            <th>Metros</th>
                            <th>Estado</th>
                            <th>Enviado a</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibles.map((r) => (
                            <tr key={r.id}>
                              {puedeGestionar && (
                                <td>
                                  {((!r.llego && estaAbierto) || sePuedeEnviar(r, estaAbierto)) && (
                                    <input
                                      type="checkbox"
                                      aria-label={`Marcar ${r.identificador_rollo}`}
                                      checked={seleccion.has(r.id)}
                                      onChange={() => alternar(r.id)}
                                    />
                                  )}
                                </td>
                              )}
                              <td>{r.identificador_rollo}</td>
                              <td>{r.codigo_interno}</td>
                              <td>{r.peso_neto ?? "—"}</td>
                              <td>{r.metros}</td>
                              <td>
                                {r.llego
                                  ? `✓ Llegó ${r.fecha_llegada ? formatearFechaColombia(r.fecha_llegada, false) : ""}`
                                  : r.ya_tiene_ingreso ? "En camino · ya tiene ingreso" : "En camino"}
                              </td>
                              <td><EnviadoA r={r} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {confirmacion && (
        <ModalConfirmacion
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          textoCancelar="No, volver"
          textoConfirmar={confirmacion.textoConfirmar}
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={() => { const { ejecutar: accion } = confirmacion; setConfirmacion(null); accion(); }}
        />
      )}
    </section>
  );
}
