import { Fragment, useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import ModalConfirmacion from "./ModalConfirmacion";
import { useActualizacionAutomatica } from "../Hooks/useActualizacionAutomatica";
import { formatearFechaColombia } from "../Utils/fechas";

type CodigoEnCamino = { codigo_interno: string; descripcion: string; rollos: number; metros: number };
type Cargamento = {
  id: number; bodega_nombre: string; proveedor: string; archivo_origen: string; creado_por: string;
  fecha_creacion: string; total_rollos: number; total_metros: number; rollos_ya_registrados: number;
  codigos: CodigoEnCamino[];
};

/** Checklists de material que todavía no llega (se guardan desde Recepción).
 * Lo que está aquí cuenta para apartar. Admin Inventario lo marca "Llegó"
 * cuando le da ingreso en Recepción, o lo elimina si se subió por error. */
export default function PanelMaterialEnCamino({ puedeGestionar, recargar }: { puedeGestionar: boolean; recargar: number }) {
  const [cargamentos, setCargamentos] = useState<Cargamento[]>([]);
  const [expandido, setExpandido] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");
  const [confirmacion, setConfirmacion] = useState<{ titulo: string; mensaje: string; textoConfirmar: string; ejecutar: () => void } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCargamentos(await api.get<Cargamento[]>("/material-en-camino") || []);
    } catch {
      // Silencioso: si falla una recarga se queda la lista anterior.
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recargar]);
  useActualizacionAutomatica(cargar);

  async function ejecutar(accion: () => Promise<unknown>, textoError: string) {
    setError("");
    try {
      await accion();
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
        Checklists de material comprado que todavía no llega. Lo que está aquí se puede apartar
        (bodega + en camino − apartado). Cuando llegue, dale ingreso arriba como siempre
        {puedeGestionar ? " y márcalo como \"Llegó\" para que deje de contar." : "; Admin Inventario lo marcará como llegado."}
      </p>
      {error && <p className="recepcion-error">{error}</p>}
      <table className="recepcion-tabla">
        <thead>
          <tr>
            <th>Va para</th>
            <th>Proveedor</th>
            <th>Archivo</th>
            <th>Cargado</th>
            <th>Rollos</th>
            <th>Metros</th>
            {puedeGestionar && <th></th>}
          </tr>
        </thead>
        <tbody>
          {cargamentos.map((cg) => (
            <Fragment key={cg.id}>
              <tr>
                <td>{cg.bodega_nombre}</td>
                <td>{cg.proveedor}</td>
                <td>
                  <button type="button" className="recepcion-boton-secundario" onClick={() => setExpandido((a) => ({ ...a, [cg.id]: !a[cg.id] }))}>
                    {expandido[cg.id] ? "▲" : "▼"} {cg.archivo_origen}
                  </button>
                </td>
                <td>{formatearFechaColombia(cg.fecha_creacion)}</td>
                <td>
                  {cg.total_rollos}
                  {cg.rollos_ya_registrados > 0 && (
                    <div className="recepcion-error" style={{ margin: 0 }}>
                      Ya se les dio ingreso a {cg.rollos_ya_registrados} de {cg.total_rollos}
                      {puedeGestionar ? ": márcalo como \"Llegó\" para no contarlo dos veces." : "."}
                    </div>
                  )}
                </td>
                <td>{cg.total_metros}</td>
                {puedeGestionar && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="recepcion-boton-primario" onClick={() => setConfirmacion({
                      titulo: `¿Llegó el material de ${cg.archivo_origen}?`,
                      mensaje: "Deja de contar como \"en camino\". Asegúrate de haberle dado ingreso en Recepción: si no, lo que está apartado con este material quedará esperando.",
                      textoConfirmar: "Sí, llegó",
                      ejecutar: () => ejecutar(() => api.patch(`/material-en-camino/${cg.id}/llego`), "No se pudo marcar como llegado."),
                    })}>Llegó</button>{" "}
                    <button type="button" className="recepcion-boton-secundario" onClick={() => setConfirmacion({
                      titulo: `¿Eliminar el checklist ${cg.archivo_origen}?`,
                      mensaje: "Úsalo si se subió por error o si el pedido se canceló. Lo que se apartó contando con este material quedará esperando material.",
                      textoConfirmar: "Sí, eliminar",
                      ejecutar: () => ejecutar(() => api.delete(`/material-en-camino/${cg.id}`), "No se pudo eliminar."),
                    })}>Eliminar</button>
                  </td>
                )}
              </tr>
              {expandido[cg.id] && cg.codigos.map((cod) => (
                <tr key={`${cg.id}-${cod.codigo_interno}`} style={{ background: "rgba(0,0,0,0.03)" }}>
                  <td></td>
                  <td colSpan={3}><strong>{cod.codigo_interno}</strong> — {cod.descripcion}</td>
                  <td>{cod.rollos}</td>
                  <td>{cod.metros}</td>
                  {puedeGestionar && <td></td>}
                </tr>
              ))}
            </Fragment>
          ))}
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
