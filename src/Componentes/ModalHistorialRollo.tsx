// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { formatearFechaColombia } from "../Utils/fechas";
import { formatearCalibre } from "../Utils/calibre";
import { nombreEmpresa } from "../Utils/empresas";

// Venta del rollo entre Arquitejas y Asia: el movimiento guarda en la
// observación "ahora es de X (era de Y)". Devuelve "Y le vendió a X" o "".
function ventaEntreEmpresas(m) {
  if (m.motivo !== "compra_otra_empresa") return "";
  const partes = /ahora es de (.+?) \(era de (.+?)\)/.exec(m.observaciones || "");
  return partes ? `${partes[2]} le vendió a ${partes[1]}` : "Venta entre empresas";
}

const MOTIVOS = { intercambio_externo: "salida externa", compra_otra_empresa: "venta entre empresas" };

// Modal "Hoja de vida del rollo" de Rollos: muestra los datos del rollo y su
// historial de movimientos. Extraído de RollosPage.tsx sin cambiar props ni
// comportamiento -- no usa estado local propio, todo viene del controlador
// (useControladorRollos) vía props. Es de solo lectura, sin formularios.
function ModalHistorialRollo({
  rolloParaHistorial,
  cerrarHistorial,
  ESTADOS_ROLLO,
  cargandoHistorial,
  errorHistorial,
  historialRollo,
}) {
  const ventas = historialRollo.filter((m) => ventaEntreEmpresas(m));
  return (
    <div className="rollos-modal-fondo" onClick={cerrarHistorial}>
      <div className="rollos-modal rollos-modal--ancho" onClick={(e) => e.stopPropagation()}>
        <h3>
          Historial — {rolloParaHistorial.codigoInterno} (rollo{" "}
          {rolloParaHistorial.identificadorRollo})
        </h3>

        <div className="rollos-filtros-grid" style={{ marginBottom: "1rem" }}>
          <div>
            <span className="rollos-texto-ayuda">Empresa (dueña hoy)</span>
            <p>{rolloParaHistorial.empresa ? nombreEmpresa(rolloParaHistorial.empresa) : "—"}</p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Familia</span>
            <p>{rolloParaHistorial.familia || "—"}</p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Color</span>
            <p>{rolloParaHistorial.colorMaterial || "—"}</p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Calibre</span>
            <p>{formatearCalibre(rolloParaHistorial.calibre)}</p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Proveedor</span>
            <p>{rolloParaHistorial.proveedor || "—"}</p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Metros proveedor / calculados</span>
            <p>{rolloParaHistorial.metrosProveedor} / {rolloParaHistorial.metrosCalculados}</p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Disponibles / consumidos</span>
            <p>{rolloParaHistorial.metrosDisponibles} / {rolloParaHistorial.metrosConsumidos}</p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Estado</span>
            <p>
              <span className={`rollos-estado-badge estado-${rolloParaHistorial.estado}`}>
                {ESTADOS_ROLLO[rolloParaHistorial.estado]}
              </span>
            </p>
          </div>
          <div>
            <span className="rollos-texto-ayuda">Fecha de ingreso</span>
            <p>{formatearFechaColombia(rolloParaHistorial.fechaIngreso, false)}</p>
          </div>
          {rolloParaHistorial.observaciones && (
            <div>
              <span className="rollos-texto-ayuda">Observaciones</span>
              <p>{rolloParaHistorial.observaciones}</p>
            </div>
          )}
        </div>

        {ventas.map((m) => (
          <p key={m.id} className="sincodigo-listo" style={{ margin: "0 0 0.75rem" }}>
            <strong>{ventaEntreEmpresas(m)}</strong> este rollo
            {m.cotizacion ? ` con la cotización ${m.cotizacion}` : ""} el {formatearFechaColombia(m.fecha, false)}.
          </p>
        ))}

        {cargandoHistorial ? (
          <p className="rollos-texto-ayuda">Cargando historial...</p>
        ) : errorHistorial ? (
          <p className="rollos-error">{errorHistorial}</p>
        ) : historialRollo.length === 0 ? (
          <p className="rollos-vacio">Este rollo todavía no tiene movimientos registrados.</p>
        ) : (
          <div className="rollos-tabla-wrap">
            <table className="rollos-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Motivo</th>
                  <th>Empresa</th>
                  <th>Cantidad</th>
                  <th>Cotización</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {historialRollo.map((m) => {
                  // Stock que sobró de una producción donde se usó este rollo:
                  // va en unidades y dice qué producto quedó.
                  const esStock = m.motivo === "produccion_excedente";
                  return (
                    <tr key={m.id} className={esStock ? "rollos-historial-stock" : undefined}>
                      <td>{formatearFechaColombia(m.fecha)}</td>
                      <td>{m.tipo}</td>
                      <td>{esStock ? "stock que quedó" : MOTIVOS[m.motivo] || m.motivo || "—"}</td>
                      <td>{ventaEntreEmpresas(m) || m.empresaExterna || "—"}</td>
                      <td>{esStock ? `${m.cantidad} und` : `${m.cantidad} m`}</td>
                      <td>{m.cotizacion || "—"}</td>
                      <td>{esStock ? `${m.productoDescripcion} · ${m.observaciones}` : m.observaciones || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="rollos-modal-acciones">
          <button type="button" className="rollos-boton-secundario" onClick={cerrarHistorial}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalHistorialRollo;
