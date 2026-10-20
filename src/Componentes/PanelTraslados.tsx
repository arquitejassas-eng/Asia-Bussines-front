import { formatearFechaColombia } from "../Utils/fechas";
import type { Solicitud } from "../types/dominio";

type Accion = { texto: string; textoProcesando: string; clase: string; ejecutar: (id: number) => void };

/** Lista de traslados entre sedes de la pantalla Bodegas: los que esta
 * bodega aceptó y tiene que despachar, o los que vienen en camino hacia ella
 * y tiene que recibir. Sin estado propio: todo llega del controlador
 * (useControladorBodegas). */
function PanelTraslados({
  titulo, ayuda, traslados, procesandoId, error, acciones, mostrar,
}: {
  titulo: string; ayuda: string; traslados: Solicitud[]; procesandoId: number | null; error: string;
  acciones: Accion[];
  // "destino": a qué bodega va (para quien despacha); "origen": de dónde viene (para quien recibe).
  mostrar: "destino" | "origen";
}) {
  if (traslados.length === 0) return null;
  return (
    <section className="bodegas-tarjeta bodegas-notificaciones">
      <h2>
        {titulo}
        <span className="bodegas-contador">{traslados.length}</span>
      </h2>
      <p className="bodegas-texto-ayuda">{ayuda}</p>
      {error && <p className="bodegas-error">{error}</p>}
      <ul className="bodegas-lista-notificaciones">
        {traslados.map((t) => (
          <li key={t.id} className="bodegas-notificacion">
            <div>
              <strong>Traslado #{t.id}</strong>{" "}
              {mostrar === "destino" ? <>para <strong>{t.bodegaSolicitanteNombre}</strong></> : <>desde <strong>{t.bodegaPropietariaNombre}</strong></>}:{" "}
              <strong>{t.cantidad}</strong> de <strong>{t.productoCodigo}</strong> — {t.productoDescripcion}
              {t.numeroCotizacion && <span className="bodegas-tag-tipo">Cotización {t.numeroCotizacion}</span>}
              <p className="bodegas-nota-solicitud">
                {mostrar === "destino"
                  ? <>Aceptado {t.fechaAceptada ? formatearFechaColombia(t.fechaAceptada) : ""}. Sigue en tu bodega, apartado para este traslado.</>
                  : <>Salió {t.fechaDespachada ? formatearFechaColombia(t.fechaDespachada) : ""}. Cuando llegue, confírmalo para que entre a tu bodega.</>}
              </p>
              {t.observaciones && <p className="bodegas-nota-solicitud">"{t.observaciones}"</p>}
            </div>
            <div className="bodegas-acciones-notificacion">
              {acciones.map((a) => (
                <button key={a.texto} className={a.clase} disabled={procesandoId === t.id} onClick={() => a.ejecutar(t.id)}>
                  {procesandoId === t.id ? a.textoProcesando : a.texto}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default PanelTraslados;
