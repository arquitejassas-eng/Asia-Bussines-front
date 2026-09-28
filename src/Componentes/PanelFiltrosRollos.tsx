// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { EMPRESAS, FILTRO_SIN_EMPRESA, nombreEmpresa } from "../Utils/empresas";

// Sección "Filtros / búsqueda" de Rollos. Extraído de RollosPage.tsx sin
// cambiar props ni comportamiento -- no usa estado local propio, todo viene
// del controlador (useControladorRollos) vía props.
function PanelFiltrosRollos({
  filtros,
  actualizarFiltro,
  familiasDisponibles,
  coloresDisponibles,
  vista,
  ESTADOS_ROLLO,
  limpiarFiltros,
}) {
  return (
    <section className="rollos-tarjeta">
      <h2>Buscar rollos</h2>
      <div className="rollos-filtros-grid">
        <div>
          <label htmlFor="rollos-f-empresa">Empresa</label>
          <select
            id="rollos-f-empresa"
            value={filtros.empresa}
            onChange={(e) => actualizarFiltro("empresa", e.target.value)}
          >
            <option value="">Todas</option>
            {Object.keys(EMPRESAS).map((sigla) => (
              <option key={sigla} value={sigla}>
                {nombreEmpresa(sigla)}
              </option>
            ))}
            <option value={FILTRO_SIN_EMPRESA}>Sin empresa</option>
          </select>
        </div>
        <div>
          <label htmlFor="rollos-f-codigo-interno">Código interno</label>
          <input
            id="rollos-f-codigo-interno"
            type="text"
            value={filtros.codigoInterno}
            onChange={(e) => actualizarFiltro("codigoInterno", e.target.value)}
            placeholder="Ej. LA50170,27"
          />
        </div>
        <div>
          <label htmlFor="rollos-f-referencia">Referencia</label>
          <input
            id="rollos-f-referencia"
            type="text"
            value={filtros.identificadorRollo}
            onChange={(e) => actualizarFiltro("identificadorRollo", e.target.value)}
            placeholder="Ej. 13ARLA50170,50-05"
          />
        </div>
        <div>
          <label htmlFor="rollos-f-codigo-proveedor">Código del proveedor</label>
          <input
            id="rollos-f-codigo-proveedor"
            type="text"
            value={filtros.codigoProveedor}
            onChange={(e) => actualizarFiltro("codigoProveedor", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rollos-f-descripcion">Descripción</label>
          <input
            id="rollos-f-descripcion"
            type="text"
            value={filtros.descripcion}
            onChange={(e) => actualizarFiltro("descripcion", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rollos-f-familia">Familia</label>
          <select
            id="rollos-f-familia"
            value={filtros.familia}
            onChange={(e) => actualizarFiltro("familia", e.target.value)}
          >
            <option value="">Todas</option>
            {familiasDisponibles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rollos-f-color">Color del material</label>
          <select
            id="rollos-f-color"
            value={filtros.colorMaterial}
            onChange={(e) => actualizarFiltro("colorMaterial", e.target.value)}
          >
            <option value="">Todos</option>
            {coloresDisponibles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rollos-f-calibre">Calibre</label>
          <input
            id="rollos-f-calibre"
            type="text"
            value={filtros.calibre}
            onChange={(e) => actualizarFiltro("calibre", e.target.value)}
            placeholder="Ej. 0.27"
          />
        </div>
        {vista === "activos" && (
          <div>
            <label htmlFor="rollos-f-estado">Estado</label>
            <select
              id="rollos-f-estado"
              value={filtros.estado}
              onChange={(e) => actualizarFiltro("estado", e.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(ESTADOS_ROLLO).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="rollos-f-proveedor">Proveedor</label>
          <input
            id="rollos-f-proveedor"
            type="text"
            value={filtros.proveedor}
            onChange={(e) => actualizarFiltro("proveedor", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rollos-f-fecha-desde">Ingreso desde</label>
          <input
            id="rollos-f-fecha-desde"
            type="date"
            value={filtros.fechaDesde}
            onChange={(e) => actualizarFiltro("fechaDesde", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rollos-f-fecha-hasta">Ingreso hasta</label>
          <input
            id="rollos-f-fecha-hasta"
            type="date"
            value={filtros.fechaHasta}
            onChange={(e) => actualizarFiltro("fechaHasta", e.target.value)}
          />
        </div>
      </div>
      <button className="rollos-boton-secundario" onClick={limpiarFiltros}>
        Limpiar filtros
      </button>
    </section>
  );
}

export default PanelFiltrosRollos;
