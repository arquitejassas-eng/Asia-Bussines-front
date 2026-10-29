// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { claseColorMaterial } from "../Utils/colorRollo";
import { EMPRESAS } from "../Utils/empresas";

// Modal "Ingresar rollo manualmente" de Rollos. Extraído de RollosPage.tsx
// sin cambiar props ni comportamiento -- no usa estado local propio, todo
// viene del controlador (useControladorRollos) vía props.
function ModalIngresoRollo({
  cerrarFormularioRollo,
  crearRollo,
  formularioRollo,
  actualizarCodigoInternoRollo,
  sugerirReferenciaRollo,
  sugerirClasificacionRollo,
  estadoClasificacionRollo,
  actualizarCampoRollo,
  guardandoRollo,
  errorFormularioRollo,
}) {
  return (
    <div className="rollos-modal-fondo" onClick={cerrarFormularioRollo}>
      <div className="rollos-modal rollos-modal--ancho" onClick={(e) => e.stopPropagation()}>
        <h3>Ingresar rollo manualmente</h3>
        <p className="rollos-texto-ayuda">
          Registra un rollo físico que ya tienes en bodega, uno a la vez. Para varios de golpe
          usa "Cargar rollos existentes desde Excel".
        </p>

        <form onSubmit={crearRollo} noValidate>
          <div className="rollos-form-seccion">
            <h4>Identificación</h4>
            <div className="rollos-mapeo-grid">
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-codigo-interno">Código interno *</label>
                <input
                  id="rollo-codigo-interno"
                  placeholder="Ej. LA50170,20"
                  value={formularioRollo.codigoInterno}
                  onChange={(e) => actualizarCodigoInternoRollo(e.target.value)}
                  onBlur={(e) => {
                    sugerirReferenciaRollo(e.target.value);
                    sugerirClasificacionRollo(e.target.value);
                  }}
                />
                {estadoClasificacionRollo === "faltante" && (
                  <p className="rollos-error" style={{ margin: "0.35rem 0 0" }}>
                    Este código no está en la tabla de equivalencias ni coincide con ningún rollo tuyo —
                    no se puede guardar así. Ve a Recepción y Verificación → Administrar tablas de
                    equivalencias y agrega su color antes de continuar.
                  </p>
                )}
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-identificador">Referencia del rollo *</label>
                <input
                  id="rollo-identificador"
                  placeholder="Ej. LA50170,20-01"
                  value={formularioRollo.identificadorRollo}
                  onChange={(e) => actualizarCampoRollo("identificadorRollo", e.target.value)}
                />
                <p className="rollos-texto-ayuda" style={{ margin: "0.35rem 0 0" }}>
                  Se sugiere sola al salir del código interno (-01, -02...); puedes cambiarla si quieres.
                </p>
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-descripcion">Descripción</label>
                <input
                  id="rollo-descripcion"
                  placeholder="Ej. Teja de 6 metros"
                  value={formularioRollo.descripcion}
                  onChange={(e) => actualizarCampoRollo("descripcion", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="rollos-form-seccion">
            <h4>Clasificación</h4>
            <div className="rollos-mapeo-grid">
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-color">Color del material</label>
                <input
                  id="rollo-color"
                  list="rollo-colores-conocidos"
                  placeholder="Ej. Azul, Amarillo, Gris..."
                  value={formularioRollo.colorMaterial}
                  onChange={(e) => actualizarCampoRollo("colorMaterial", e.target.value)}
                />
                <datalist id="rollo-colores-conocidos">
                  <option value="Azul" />
                  <option value="Blanco" />
                  <option value="Negro" />
                  <option value="Rojo" />
                  <option value="Verde" />
                  <option value="Amarillo" />
                  <option value="Gris" />
                  <option value="Plata" />
                  <option value="Natural" />
                </datalist>
                <div className="rollos-color-ayuda">
                  <p className="rollos-texto-ayuda">
                    Escribe el nombre del color (no el calibre): "Azul", "Amarillo", "Gris"...
                  </p>
                  {formularioRollo.colorMaterial && (
                    <span className={`rollos-color-etiqueta color-${claseColorMaterial(formularioRollo.colorMaterial)}`}>
                      <span className="rollos-color-muestra" aria-hidden="true" />
                      {formularioRollo.colorMaterial}
                    </span>
                  )}
                </div>
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-calibre">Calibre</label>
                <input
                  id="rollo-calibre"
                  type="number" min="0" step="0.01"
                  placeholder="Ej. 0.27"
                  value={formularioRollo.calibre}
                  onChange={(e) => actualizarCampoRollo("calibre", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="rollos-form-seccion">
            <h4>Metraje</h4>
            <div className="rollos-mapeo-grid">
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-metros-disponibles">Metros disponibles *</label>
                <input
                  id="rollo-metros-disponibles"
                  type="number" min="0" step="0.01"
                  value={formularioRollo.metrosDisponibles}
                  onChange={(e) => actualizarCampoRollo("metrosDisponibles", e.target.value)}
                />
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-metros-consumidos">Metros ya consumidos</label>
                <input
                  id="rollo-metros-consumidos"
                  type="number" min="0" step="0.01"
                  value={formularioRollo.metrosConsumidos}
                  onChange={(e) => actualizarCampoRollo("metrosConsumidos", e.target.value)}
                />
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-metros-proveedor">Metros totales (proveedor)</label>
                <input
                  id="rollo-metros-proveedor"
                  type="number" min="0" step="0.01"
                  placeholder="Vacío = se calcula solo"
                  value={formularioRollo.metrosProveedor}
                  onChange={(e) => actualizarCampoRollo("metrosProveedor", e.target.value)}
                />
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-peso-neto">Peso neto (t)</label>
                <input
                  id="rollo-peso-neto"
                  type="number" min="0" step="0.01"
                  value={formularioRollo.pesoNeto}
                  onChange={(e) => actualizarCampoRollo("pesoNeto", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="rollos-form-seccion">
            <h4>Origen</h4>
            <div className="rollos-mapeo-grid">
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-proveedor">Proveedor</label>
                <input
                  id="rollo-proveedor"
                  value={formularioRollo.proveedor}
                  onChange={(e) => actualizarCampoRollo("proveedor", e.target.value)}
                />
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-codigo-proveedor">Código del proveedor</label>
                <input
                  id="rollo-codigo-proveedor"
                  value={formularioRollo.codigoProveedor}
                  onChange={(e) => actualizarCampoRollo("codigoProveedor", e.target.value)}
                />
              </div>
              <div className="rollos-mapeo-campo">
                <label htmlFor="rollo-lote">Lote</label>
                <input
                  id="rollo-lote"
                  value={formularioRollo.lote}
                  onChange={(e) => actualizarCampoRollo("lote", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Prestado: queda en Préstamos entre empresas a nombre de quien lo prestó. */}
          <div className="rollos-form-seccion">
            <h4>¿Es prestado? *</h4>
            <div className="rollo-prestado-opciones" role="radiogroup" aria-label="¿Es prestado?">
              {[["no", "No, es nuestro"], ["si", "Sí, nos lo prestaron"]].map(([valor, texto]) => (
                <label key={valor} className={formularioRollo.prestado === valor ? "rollo-prestado-activo" : ""}>
                  <input type="radio" name="rollo-prestado" value={valor} checked={formularioRollo.prestado === valor}
                    onChange={() => actualizarCampoRollo("prestado", valor)} />
                  {texto}
                </label>
              ))}
            </div>
            {formularioRollo.prestado === "si" && (
              <div className="rollos-mapeo-campo" style={{ marginTop: "0.6rem" }}>
                <label htmlFor="rollo-prestador">¿Quién lo prestó? *</label>
                <input id="rollo-prestador" list="rollo-prestador-opciones" maxLength={150}
                  placeholder="Empresa o persona (ej. Aceros XYZ)" value={formularioRollo.prestador}
                  onChange={(e) => actualizarCampoRollo("prestador", e.target.value)} />
                <datalist id="rollo-prestador-opciones">
                  {Object.values(EMPRESAS).map((n) => <option key={n} value={n} />)}
                </datalist>
                <p className="rollos-texto-ayuda">Sus metros quedan en Préstamos entre empresas hasta que lo marques como saldado.</p>
              </div>
            )}
          </div>

          <div className="rollos-form-seccion">
            <label htmlFor="rollo-observaciones">Observaciones</label>
            <textarea
              id="rollo-observaciones"
              rows={2}
              value={formularioRollo.observaciones}
              onChange={(e) => actualizarCampoRollo("observaciones", e.target.value)}
            />
          </div>

          {errorFormularioRollo && <p className="rollos-error">{errorFormularioRollo}</p>}

          <div className="rollos-modal-acciones">
            <button type="button" className="rollos-boton-secundario" onClick={cerrarFormularioRollo}>
              Cancelar
            </button>
            <button
              type="submit"
              className="rollos-boton-primario"
              disabled={guardandoRollo || estadoClasificacionRollo === "faltante"}
            >
              {guardandoRollo ? "Guardando..." : "Registrar rollo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ModalIngresoRollo;
