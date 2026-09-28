// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useState } from "react";
import { ETIQUETAS_CAMPOS_CARGA_ROLLOS, TODOS_LOS_CAMPOS_CARGA_ROLLOS } from "../Utils/cargaRollos";

// Sección "Carga masiva de rollos existentes" de Rollos. Extraído de
// RollosPage.tsx sin cambiar props ni comportamiento -- incluye el estado
// local "mostrarCarga" que solo esta sección usaba, movido aquí tal cual.
function PanelCargaMasivaRollos({
  abrirFormularioRollo,
  reiniciarCargaRollos,
  pasoCargaRollos,
  procesandoArchivoCargaRollos,
  cargarArchivoRollos,
  errorArchivoCargaRollos,
  nombreArchivoCargaRollos,
  hojasDisponiblesCargaRollos,
  hojaActualCargaRollos,
  cambiandoHojaCargaRollos,
  cambiarHojaCargaRollos,
  mapeoColumnasCargaRollos,
  actualizarMapeoColumnaRollos,
  encabezadosCargaRollos,
  faltanCamposRequeridosCargaRollos,
  errorConfirmacionCargaRollos,
  confirmarCargaRollos,
  confirmandoCargaRollos,
  resultadoCargaRollos,
}) {
  const [mostrarCarga, setMostrarCarga] = useState(false);

  return (
    <section className="rollos-tarjeta">
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          className="rollos-boton-secundario"
          onClick={() => {
            setMostrarCarga((actual) => !actual);
            if (mostrarCarga) reiniciarCargaRollos();
          }}
        >
          {mostrarCarga ? "Ocultar" : "Cargar rollos existentes desde Excel"}
        </button>
        <button className="rollos-boton-primario" onClick={abrirFormularioRollo}>
          + Ingresar rollo manualmente
        </button>
      </div>

      {mostrarCarga && (
        <div style={{ marginTop: "1.1rem" }}>
          <p className="rollos-texto-ayuda">
            Sube un Excel con tu inventario actual de rollos (código, referencia, metros
            disponibles). Es para cargar de una vez lo que ya tienes en bodega — no pasa por
            el flujo de verificación de "Recepción y Verificación", que es para envíos nuevos
            del proveedor.
          </p>

          {pasoCargaRollos === "carga" && (
            <>
              <label className="rollos-boton-primario" style={{ display: "inline-flex", cursor: "pointer" }}>
                {procesandoArchivoCargaRollos ? "Procesando..." : "Seleccionar archivo Excel"}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={cargarArchivoRollos}
                  disabled={procesandoArchivoCargaRollos}
                  hidden
                />
              </label>
              {errorArchivoCargaRollos && <p className="rollos-error">{errorArchivoCargaRollos}</p>}
            </>
          )}

          {pasoCargaRollos === "mapeo" && (
            <>
              <h3>Verifica las columnas de "{nombreArchivoCargaRollos}"</h3>

              {hojasDisponiblesCargaRollos.length > 1 && (
                <div className="rollos-mapeo-campo" style={{ maxWidth: 320, marginBottom: "1rem" }}>
                  <label>Hoja del Excel</label>
                  <select
                    value={hojaActualCargaRollos}
                    disabled={cambiandoHojaCargaRollos}
                    onChange={(e) => cambiarHojaCargaRollos(e.target.value)}
                  >
                    {hojasDisponiblesCargaRollos.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="rollos-mapeo-grid">
                {TODOS_LOS_CAMPOS_CARGA_ROLLOS.map((campo) => (
                  <div key={campo} className="rollos-mapeo-campo">
                    <label>{ETIQUETAS_CAMPOS_CARGA_ROLLOS[campo]}</label>
                    <select
                      value={mapeoColumnasCargaRollos[campo] || ""}
                      onChange={(e) => actualizarMapeoColumnaRollos(campo, e.target.value)}
                    >
                      <option value="">— No aplica —</option>
                      {encabezadosCargaRollos.map((enc) => (
                        <option key={enc} value={enc}>
                          {enc}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {faltanCamposRequeridosCargaRollos && (
                <p className="rollos-error">
                  Asigna una columna a código, referencia y metros disponibles antes de confirmar.
                </p>
              )}
              {errorConfirmacionCargaRollos && <p className="rollos-error">{errorConfirmacionCargaRollos}</p>}

              <div className="rollos-modal-acciones" style={{ marginTop: "1.1rem" }}>
                <button className="rollos-boton-secundario" onClick={reiniciarCargaRollos}>
                  Cancelar
                </button>
                <button
                  className="rollos-boton-primario"
                  onClick={confirmarCargaRollos}
                  disabled={faltanCamposRequeridosCargaRollos || confirmandoCargaRollos}
                >
                  {confirmandoCargaRollos ? "Confirmando..." : "Confirmar carga"}
                </button>
              </div>
            </>
          )}

          {pasoCargaRollos === "resultado" && resultadoCargaRollos && (
            <>
              <h3>Resultado de la carga</h3>
              <div className="rollos-carga-resumen">
                <div>
                  <span className="numero">{resultadoCargaRollos.filas_totales}</span>
                  <span>Filas leídas</span>
                </div>
                <div>
                  <span className="numero">{resultadoCargaRollos.creados}</span>
                  <span>Creados</span>
                </div>
                <div>
                  <span className="numero">{resultadoCargaRollos.actualizados}</span>
                  <span title="Se actualizaron sus datos (descripción, color, empresa...), nunca sus metros ni su código.">Ya existían</span>
                </div>
                <div>
                  <span className="numero">{resultadoCargaRollos.omitidas}</span>
                  <span>Omitidas</span>
                </div>
              </div>

              {resultadoCargaRollos.actualizados > 0 && (
                <p className="rollos-texto-ayuda">
                  De los rollos que ya existían solo se actualizaron sus datos (descripción, color, empresa,
                  peso, proveedor, lote). Sus metros y su código NO se cambian con el Excel: la app ya tiene
                  registrado lo que se ha consumido.
                </p>
              )}

              {(resultadoCargaRollos.diferencias || []).length > 0 && (
                <>
                  <h3>Diferencias sin aplicar ({resultadoCargaRollos.diferencias.length})</h3>
                  <p className="rollos-texto-ayuda">
                    En estos rollos el Excel dice algo distinto a la app. No se cambió nada: si el Excel es el
                    correcto, corrígelo en el rollo (consumo, salida o edición) para que quede registrado.
                  </p>
                  <table className="rollos-tabla">
                    <thead>
                      <tr>
                        <th>Fila</th>
                        <th>Referencia</th>
                        <th>Dato</th>
                        <th>En la app</th>
                        <th>En el Excel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultadoCargaRollos.diferencias.map((d, indice) => (
                        <tr key={indice}>
                          <td>{d.fila}</td>
                          <td>{d.identificador_rollo}</td>
                          <td>{d.campo}</td>
                          <td>{d.en_la_app}</td>
                          <td>{d.en_el_excel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {resultadoCargaRollos.detalle_omitidas.length > 0 && (
                <>
                  <h3>Filas omitidas</h3>
                  <table className="rollos-tabla">
                    <thead>
                      <tr>
                        <th>Fila</th>
                        <th>Referencia</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultadoCargaRollos.detalle_omitidas.map((o, indice) => (
                        <tr key={indice}>
                          <td>{o.fila}</td>
                          <td>{o.identificador_rollo || "—"}</td>
                          <td>{o.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="rollos-modal-acciones" style={{ marginTop: "1.1rem" }}>
                <button className="rollos-boton-primario" onClick={reiniciarCargaRollos}>
                  Cargar otro archivo
                </button>
                <button
                  className="rollos-boton-secundario"
                  onClick={() => {
                    setMostrarCarga(false);
                    reiniciarCargaRollos();
                  }}
                >
                  Listo
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default PanelCargaMasivaRollos;
