// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { claseColorMaterial } from "../Utils/colorRollo";
import { formatearCalibre } from "../Utils/calibre";
import { EMPRESAS, nombreEmpresa } from "../Utils/empresas";

const ETIQUETAS_ESTADO = {
  cerrado: "Cerrado",
  abierto: "Abierto",
  agotado: "Acabado",
};

// Sección "3. Buscar por código de clasificación o de rollo" de Producción.
// Extraído de ProduccionPage.tsx sin cambiar props ni comportamiento -- no
// usa estado local propio, todo viene del controlador
// (useControladorProduccion) vía props. La constante ETIQUETAS_ESTADO solo
// la usaba esta sección, se movió aquí tal cual.
function PanelBusquedaRollosProduccion({
  codigoBusqueda,
  setCodigoBusqueda,
  empresaFiltro,
  setEmpresaFiltro,
  rollosDisponibles,
  seleccion,
  alternarSeleccionRollo,
  actualizarMetrosRollo,
}) {
  return (
    <section className="produccion-tarjeta">
      <h2>3. Buscar por código de clasificación o de rollo</h2>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          type="text"
          className="produccion-input"
          style={{ flex: "1 1 220px" }}
          placeholder="Ej. LA50030,25 ó R-0042"
          value={codigoBusqueda}
          onChange={(e) => setCodigoBusqueda(e.target.value)}
        />
        <select
          className="produccion-input"
          style={{ flex: "0 1 200px" }}
          aria-label="Empresa del rollo"
          value={empresaFiltro}
          onChange={(e) => setEmpresaFiltro(e.target.value)}
        >
          <option value="">Todas las empresas</option>
          {Object.entries(EMPRESAS).map(([sigla, nombre]) => (
            <option key={sigla} value={sigla}>{nombre}</option>
          ))}
        </select>
      </div>

      {codigoBusqueda.trim() && (
        <>
          {rollosDisponibles.length === 0 ? (
            <p className="produccion-vacio">
              {empresaFiltro
                ? `No hay rollos de ${EMPRESAS[empresaFiltro] || empresaFiltro} con ese código en tu bodega. Prueba con "Todas las empresas".`
                : "No hay rollos registrados con ese código en tu bodega."}
            </p>
          ) : (
            <div className="produccion-tabla-wrap">
              <table className="produccion-tabla produccion-tabla-resultados">
                <thead>
                  <tr>
                    <th></th>
                    <th>Rollo</th>
                    <th>Empresa</th>
                    <th>Color</th>
                    <th>Calibre</th>
                    <th>Disponibles</th>
                    <th>Estado</th>
                    <th>Metros a consumir</th>
                  </tr>
                </thead>
                <tbody>
                  {rollosDisponibles.map((rollo) => {
                    const seleccionado = !!seleccion[rollo.id]?.seleccionado;
                    const esAgotado = rollo.estado === "agotado";
                    const colorClase = claseColorMaterial(rollo.colorMaterial);
                    return (
                      <tr
                        key={rollo.id}
                        className={`rollos-color-${colorClase} ${esAgotado ? "fila-agotada" : ""}`}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={seleccionado}
                            disabled={esAgotado}
                            onChange={() => alternarSeleccionRollo(rollo)}
                          />
                        </td>
                        <td>{rollo.identificadorRollo}</td>
                        <td>{nombreEmpresa(rollo.empresa)}</td>
                        <td>
                          <span className={`rollos-color-etiqueta color-${colorClase}`}>
                            <span className="rollos-color-muestra" aria-hidden="true" />
                            {rollo.colorMaterial || "Sin color"}
                          </span>
                        </td>
                        <td>{formatearCalibre(rollo.calibre)}</td>
                        <td>{rollo.metrosDisponibles}</td>
                        <td>
                          <span className={`produccion-estado-badge estado-${rollo.estado}`}>
                            {ETIQUETAS_ESTADO[rollo.estado]}
                          </span>
                        </td>
                        <td>
                          {seleccionado && (
                            <input
                              type="number"
                              min="1"
                              max={rollo.metrosDisponibles}
                              className="produccion-input-metros"
                              value={seleccion[rollo.id]?.metrosTexto ?? ""}
                              onChange={(e) =>
                                actualizarMetrosRollo(rollo.id, e.target.value)
                              }
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default PanelBusquedaRollosProduccion;
