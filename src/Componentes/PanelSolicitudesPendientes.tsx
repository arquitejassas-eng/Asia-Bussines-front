// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { EMPRESAS } from "../Utils/empresas";

// Sección "Solicitudes de producción pendientes" de Producción. Extraído de
// ProduccionPage.tsx sin cambiar props ni comportamiento -- no usa estado
// local propio, todo viene del controlador (useControladorProduccion) vía
// props.
function PanelSolicitudesPendientes({
  solicitudesPendientes,
  errorSolicitudPendiente,
  apartadoItemId,
  limpiarSolicitud,
  seleccionarSolicitud,
  marcarProduccionTerminada,
}) {
  const primera = solicitudesPendientes[0];
  return (
    <section className="produccion-tarjeta">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ marginBottom: "0.25rem" }}>Cotización {primera?.numeroCotizacion}</h2>
          <p className="produccion-vacio" style={{ margin: 0 }}>
            {primera?.cliente || "Sin cliente"} · Rollos de {EMPRESAS[primera?.empresa] || primera?.empresa || "—"}
          </p>
        </div>
        <button type="button" className="produccion-boton-secundario" onClick={() => marcarProduccionTerminada(primera.apartadoId)}>
          Marcar producción terminada
        </button>
      </div>
      <p className="produccion-vacio" style={{ margin: "0.75rem 0" }}>
        Elige la línea a producir con "Iniciar producción": se llenan los datos del producto y abajo
        aparecen los rollos de ese código para que elijas cuál(es) usar.
      </p>
      {errorSolicitudPendiente && <p className="produccion-error">{errorSolicitudPendiente}</p>}
      <div className="produccion-tabla-wrap">
        <table className="produccion-tabla produccion-tabla-resultados">
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Pendiente</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {solicitudesPendientes.map((s) => (
              <tr
                key={s.itemId}
                className={apartadoItemId === s.itemId ? "produccion-fila-resaltada" : undefined}
                style={apartadoItemId === s.itemId ? { fontWeight: 600 } : undefined}
              >
                <td style={{ whiteSpace: "nowrap" }}>{s.codigoInterno}</td>
                <td>{s.descripcion || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{s.metrosPendientes} m</td>
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
