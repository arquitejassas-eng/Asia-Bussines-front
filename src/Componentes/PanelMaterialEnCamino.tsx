import { Fragment, useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import ModalConfirmacion from "./ModalConfirmacion";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";
import { formatearFechaColombia } from "../Utils/fechas";

type RolloEnCamino = {
  id: number; identificador_rollo: string; codigo_interno: string; descripcion: string; metros: number;
  llego: boolean; llego_por: string; fecha_llegada: string | null; ya_tiene_ingreso: boolean;
};
type Cargamento = {
  id: number; proveedor: string; archivo_origen: string; creado_por: string; fecha_creacion: string;
  total_rollos: number; rollos_llegados: number; total_metros: number; metros_pendientes: number;
  rollos_ya_con_ingreso: number; rollos: RolloEnCamino[];
};
type Confirmacion = { titulo: string; mensaje: string; textoConfirmar: string; ejecutar: () => void };

const minusculas = (texto: string) => texto.trim().toLowerCase();

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

  const cargar = useCallback(async () => {
    try {
      setCargamentos(await api.get<Cargamento[]>("/material-en-camino") || []);
    } catch {
      // Silencioso: si falla una recarga se queda la lista anterior.
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recargar]);
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
    try {
      await accion();
      setSeleccion(new Set());
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : textoError);
    }
  }

  if (cargamentos.length === 0 && !error) return null;

  return (
    <section className="recepcion-tarjeta">
      <h3>Material en camino</h3>
      <p className="recepcion-texto-ayuda">
        Checklists de material comprado que todavía no llega. Es de la empresa: cualquier bodega puede apartar
        de aquí. {puedeGestionar
          ? "Cuando llegue una mula, dale ingreso a sus rollos arriba en Recepción y márcalos aquí como llegados."
          : "Admin Inventario marca los rollos a medida que llegan."}
      </p>
      {error && <p className="recepcion-error">{error}</p>}
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
            const visibles = cg.rollos.filter((r) => !texto
              || minusculas(r.identificador_rollo).includes(texto) || minusculas(r.codigo_interno).includes(texto));
            const conIngreso = cg.rollos.filter((r) => r.ya_tiene_ingreso).map((r) => r.id);
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
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", margin: "0.5rem 0" }}>
                        <input
                          placeholder="Buscar referencia o código..."
                          value={busqueda}
                          onChange={(e) => setBusqueda(e.target.value)}
                          style={{ maxWidth: 260 }}
                        />
                        {puedeGestionar && (
                          <>
                            {conIngreso.length > 0 && (
                              <button type="button" className="recepcion-boton-secundario" onClick={() => setSeleccion(new Set(conIngreso))}>
                                Seleccionar los que ya tienen ingreso ({conIngreso.length})
                              </button>
                            )}
                            <button
                              type="button"
                              className="recepcion-boton-primario"
                              disabled={seleccion.size === 0}
                              onClick={() => setConfirmacion({
                                titulo: `¿Llegaron estos ${seleccion.size} rollos?`,
                                mensaje: "Dejan de contar como \"en camino\" y pasan a contar como material de Admin Inventario por repartir. Recuerda darles ingreso en Recepción.",
                                textoConfirmar: "Sí, llegaron",
                                ejecutar: () => ejecutar(() => api.patch(`/material-en-camino/${cg.id}/llegada`, { rollo_ids: [...seleccion] }), "No se pudieron marcar los rollos."),
                              })}
                            >
                              Marcar {seleccion.size || ""} como llegados
                            </button>
                            <button type="button" className="recepcion-boton-secundario" onClick={() => setConfirmacion({
                              titulo: `¿Cerrar el checklist ${cg.archivo_origen}?`,
                              mensaje: `Los ${cg.total_rollos - cg.rollos_llegados} rollos que no han llegado dejan de contar: úsalo si ya no van a venir. Lo que se apartó contando con ellos quedará esperando material.`,
                              textoConfirmar: "Sí, cerrar",
                              ejecutar: () => ejecutar(() => api.patch(`/material-en-camino/${cg.id}/cerrar`), "No se pudo cerrar el checklist."),
                            })}>Cerrar checklist</button>
                            <button type="button" className="recepcion-boton-secundario" onClick={() => setConfirmacion({
                              titulo: `¿Eliminar el checklist ${cg.archivo_origen}?`,
                              mensaje: "Úsalo solo si se subió por error. Lo que se apartó contando con este material quedará esperando material.",
                              textoConfirmar: "Sí, eliminar",
                              ejecutar: () => ejecutar(() => api.delete(`/material-en-camino/${cg.id}`), "No se pudo eliminar."),
                            })}>Eliminar</button>
                          </>
                        )}
                      </div>
                      <table className="recepcion-tabla">
                        <thead>
                          <tr>
                            {puedeGestionar && <th></th>}
                            <th>Referencia</th>
                            <th>Código</th>
                            <th>Metros</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibles.map((r) => (
                            <tr key={r.id}>
                              {puedeGestionar && (
                                <td>
                                  {!r.llego && (
                                    <input
                                      type="checkbox"
                                      aria-label={`Llegó ${r.identificador_rollo}`}
                                      checked={seleccion.has(r.id)}
                                      onChange={() => alternar(r.id)}
                                    />
                                  )}
                                </td>
                              )}
                              <td>{r.identificador_rollo}</td>
                              <td>{r.codigo_interno}</td>
                              <td>{r.metros}</td>
                              <td>
                                {r.llego
                                  ? `✓ Llegó ${r.fecha_llegada ? formatearFechaColombia(r.fecha_llegada, false) : ""}`
                                  : r.ya_tiene_ingreso ? "En camino · ya tiene ingreso" : "En camino"}
                              </td>
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
