// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { EMPRESAS } from "../Utils/empresas";

// Sección "Solicitudes de producción pendientes" de Producción. Extraído de
// ProduccionPage.tsx sin cambiar props ni comportamiento -- no usa estado
// local propio, todo viene del controlador (useControladorProduccion) vía
// props.
function PanelSolicitudesPendientes({
  solicitudesPendientes,
  cotizacionResaltada,
  errorSolicitudPendiente,
  apartadoItemId,
  limpiarSolicitud,
  seleccionarSolicitud,
  marcarProduccionTerminada,
}) {
  return (
    <section className="produccion-tarjeta">
      <h2>Solicitudes de producción pendientes</h2>
      <p className="produccion-vacio" style={{ marginBottom: "0.75rem" }}>
        Vienen de apartados que la encargada de inventario ya envió a producción. Al elegir
        "Iniciar producción" se completan los datos del producto y se muestran los rollos
        disponibles de ese código en la sección de abajo, para que elijas cuál(es) usar y
        cuántos metros consumir de cada uno. La cotización y el cliente quedan asociados
        automáticamente.
      </p>
      {errorSolicitudPendiente && <p className="produccion-error">{errorSolicitudPendiente}</p>}
      <div className="produccion-tabla-wrap">
        <table className="produccion-tabla produccion-tabla-resultados">
          <thead>
            <tr>
              <th>Cotización</th>
              <th>Empresa</th>
              <th>Cliente</th>
              <th>Código de clasificación</th>
              <th>Pendiente</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {solicitudesPendientes.map((s) => (
              <tr
                key={s.itemId}
                className={cotizacionResaltada && s.numeroCotizacion === cotizacionResaltada ? "produccion-fila-resaltada" : undefined}
                style={apartadoItemId === s.itemId ? { fontWeight: 600 } : undefined}
              >
                <td>{s.numeroCotizacion}</td>
                <td title="Usa rollos de esta empresa">{EMPRESAS[s.empresa] || s.empresa || "—"}</td>
                <td>{s.cliente || "—"}</td>
                <td>{s.codigoInterno}{s.descripcion ? ` — ${s.descripcion}` : ""}</td>
                <td>{s.metrosPendientes} m ({s.cantidad} × {s.medida} m)</td>
                <td>
                  {apartadoItemId === s.itemId ? (
                    <button type="button" className="produccion-boton-secundario" onClick={limpiarSolicitud}>
                      Quitar vínculo
                    </button>
                  ) : (
                    <button type="button" className="produccion-boton-primario" onClick={() => seleccionarSolicitud(s)}>
                      Iniciar producción
                    </button>
                  )}
                  <button type="button" className="produccion-boton-secundario" onClick={() => marcarProduccionTerminada(s.apartadoId)}>
                    Marcar producción terminada
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default PanelSolicitudesPendientes;
