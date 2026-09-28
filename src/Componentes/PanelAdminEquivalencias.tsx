// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useState } from "react";
import { formatearCalibre } from "../Utils/calibre";

// ---------------------------------------------------------------------------
// Panel de administración de las 3 tablas de equivalencias (puntos 5 y 6 del
// requerimiento). Usa directamente las funciones que ya expone el
// controlador: agregarEquivalenciaColor, agregarEquivalenciaTipo y
// agregarEquivalenciaEspesor. Solo el estado de los formularios vive aquí,
// porque es puramente de edición de UI, no de datos de la recepción.
// ---------------------------------------------------------------------------
function PanelAdminEquivalencias({
  tablaColores,
  tablaTipos,
  tablaEspesor,
  agregarEquivalenciaColor,
  agregarEquivalenciaTipo,
  agregarEquivalenciaEspesor,
  // false = solo lectura (encargados de sede): las tablas son globales y solo
  // Admin Inventario / superadmin las cambian (el backend también lo exige).
  puedeEditar = true,
}) {
  const [formColor, setFormColor] = useState({ ral: "", nombre: "", codigoInterno: "" });
  const [formTipo, setFormTipo] = useState({ nombre: "", codigoInterno: "" });
  const [formEspesor, setFormEspesor] = useState({ espesor: "", mtPorTon: "", pesoPorMetro: "" });

  // El código interno del color es opcional: si se deja vacío, el sistema
  // lo genera solo con la inicial del nombre (regla del documento de
  // clasificación). Por eso aquí solo se exige el RAL y el nombre.
  function enviarColor(e) {
    e.preventDefault();
    if (!formColor.ral || !formColor.nombre) return;
    agregarEquivalenciaColor(formColor.ral, formColor.nombre, formColor.codigoInterno);
    setFormColor({ ral: "", nombre: "", codigoInterno: "" });
  }

  function enviarTipo(e) {
    e.preventDefault();
    if (!formTipo.nombre || !formTipo.codigoInterno) return;
    agregarEquivalenciaTipo(formTipo.nombre, formTipo.codigoInterno);
    setFormTipo({ nombre: "", codigoInterno: "" });
  }

  function enviarEspesor(e) {
    e.preventDefault();
    if (!formEspesor.espesor) return;
    agregarEquivalenciaEspesor(formEspesor.espesor, {
      mtPorTonTexto: formEspesor.mtPorTon,
      pesoPorMetroTexto: formEspesor.pesoPorMetro,
    });
    setFormEspesor({ espesor: "", mtPorTon: "", pesoPorMetro: "" });
  }

  return (
    <div className="recepcion-admin-panel">
      <div className="recepcion-admin-columna">
        <h4>Colores (RAL → código interno)</h4>
        <p className="recepcion-texto-ayuda">
          El código es la inicial del color (Azul→A, Negro→N, Gris→G...). Si dos
          colores empiezan igual, escribe el código a mano para diferenciarlos.
        </p>
        <table className="recepcion-admin-tabla">
          <thead>
            <tr>
              <th>RAL</th>
              <th>Nombre</th>
              <th>Código</th>
            </tr>
          </thead>
          <tbody>
            {tablaColores.map((c) => (
              <tr key={c.ral}>
                <td>{c.ral}</td>
                <td>{c.nombre}</td>
                <td>{c.codigoInterno}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {puedeEditar !== false && (<form className="recepcion-admin-form" onSubmit={enviarColor}>
          <input
            placeholder="RAL (ej. 5017)"
            value={formColor.ral}
            onChange={(e) => setFormColor({ ...formColor, ral: e.target.value })}
          />
          <input
            placeholder="Nombre (ej. Azul)"
            value={formColor.nombre}
            onChange={(e) => setFormColor({ ...formColor, nombre: e.target.value })}
          />
          <input
            placeholder="Código (opcional, ej. A)"
            value={formColor.codigoInterno}
            onChange={(e) => setFormColor({ ...formColor, codigoInterno: e.target.value })}
          />
          <button className="recepcion-boton-secundario" type="submit">
            Agregar / actualizar
          </button>
        </form>)}
      </div>

      <div className="recepcion-admin-columna">
        <h4>Tipos de material</h4>
        <table className="recepcion-admin-tabla">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Código</th>
            </tr>
          </thead>
          <tbody>
            {tablaTipos.map((t) => (
              <tr key={t.nombre}>
                <td>{t.nombre}</td>
                <td>{t.codigoInterno}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {puedeEditar !== false && (<form className="recepcion-admin-form" onSubmit={enviarTipo}>
          <input
            placeholder="Tipo (ej. Lamina)"
            value={formTipo.nombre}
            onChange={(e) => setFormTipo({ ...formTipo, nombre: e.target.value })}
          />
          <input
            placeholder="Código (ej. L)"
            value={formTipo.codigoInterno}
            onChange={(e) => setFormTipo({ ...formTipo, codigoInterno: e.target.value })}
          />
          <button className="recepcion-boton-secundario" type="submit">
            Agregar / actualizar
          </button>
        </form>)}
      </div>

      <div className="recepcion-admin-columna">
        <h4>Espesor → metros por tonelada</h4>
        <table className="recepcion-admin-tabla">
          <thead>
            <tr>
              <th>Espesor</th>
              <th>MT x TON</th>
              <th>Peso/m</th>
            </tr>
          </thead>
          <tbody>
            {tablaEspesor.map((e) => (
              <tr key={e.espesor}>
                <td>{formatearCalibre(e.espesor)}</td>
                <td>{e.mtPorTon}</td>
                <td>{e.pesoPorMetro}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {puedeEditar !== false && (<form className="recepcion-admin-form" onSubmit={enviarEspesor}>
          <input
            placeholder="Espesor (ej. 0.25)"
            value={formEspesor.espesor}
            onChange={(e) => setFormEspesor({ ...formEspesor, espesor: e.target.value })}
          />
          <input
            placeholder="MT x TON"
            value={formEspesor.mtPorTon}
            onChange={(e) => setFormEspesor({ ...formEspesor, mtPorTon: e.target.value })}
          />
          <input
            placeholder="Peso/m (kg/m)"
            value={formEspesor.pesoPorMetro}
            onChange={(e) => setFormEspesor({ ...formEspesor, pesoPorMetro: e.target.value })}
          />
          <button className="recepcion-boton-secundario" type="submit">
            Agregar / actualizar
          </button>
        </form>)}
        <p className="recepcion-texto-ayuda">
          Solo necesitas llenar uno de los dos valores (MT x TON o Peso/m); el sistema
          calcula el otro automáticamente.
        </p>
      </div>
    </div>
  );
}

export default PanelAdminEquivalencias;
