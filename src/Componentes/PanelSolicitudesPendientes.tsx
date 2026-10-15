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
  itemsJuntos = [],
  puedeProducirJunto = () => false,
  alternarProducirJunto = () => {},
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
        aparecen los rollos de ese código para que elijas cuál(es) usar. Si otra línea es del mismo modelo,
        color y espesor (solo cambia la medida), dale "+ Producir junto" para registrarlas en la misma producción.
      </p>
      {errorSolicitudPendiente && <p className="produccion-error">{errorSolicitudPendiente}</p>}
      <div className="produccion-tabla-wrap">
        <table className="produccion-tabla produccion-tabla-tarjetas produccion-tarjetas-solicitudes produccion-tabla-resultados">
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Pendiente</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {solicitudesPendientes.map((s) => {
              const elegida = apartadoItemId === s.itemId || itemsJuntos.includes(s.itemId);
              return (
              <tr
                key={s.itemId}
                className={elegida ? "produccion-fila-resaltada" : undefined}
                style={elegida ? { fontWeight: 600 } : undefined}
              >
                <td data-etiqueta="Código" style={{ whiteSpace: "nowrap" }}>{s.codigoInterno}</td>
                <td>{s.descripcion || "—"}</td>
                <td data-etiqueta="Pendiente" style={{ whiteSpace: "nowrap" }}>{s.metrosPendientes} m</td>
                <td>
                  {apartadoItemId === s.itemId ? (
                    <button type="button" className="produccion-boton-secundario" onClick={limpiarSolicitud}>
                      Quitar vínculo
                    </button>
                  ) : itemsJuntos.includes(s.itemId) ? (
                    <button type="button" className="produccion-boton-secundario" onClick={() => alternarProducirJunto(s)}>
                      Quitar de esta producción
                    </button>
                  ) : puedeProducirJunto(s) ? (
                    <button type="button" className="produccion-boton-primario" onClick={() => alternarProducirJunto(s)}>
                      + Producir junto
                    </button>
                  ) : (
                    <button type="button" className="produccion-boton-primario" onClick={() => seleccionarSolicitud(s)}>
                      Iniciar producción
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default PanelSolicitudesPendientes;
