// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { NOMBRE_POR_TIPO_PRODUCTO, SECCIONES_POR_TIPO_PRODUCTO } from "../Utils/produccion";

// Sección "2. Stock adicional" de Producción. Extraído de ProduccionPage.tsx
// sin cambiar props ni comportamiento -- no usa estado local propio, todo
// viene del controlador (useControladorProduccion) vía props.
function PanelStockAdicionalProduccion({
  tipoProducto,
  stockAdicional,
  rollosSeleccionados = [],
  actualizarLineaStock,
  quitarLineaStock,
  agregarLineaStock,
}) {
  return (
    <section className="produccion-tarjeta">
      <h2>2. Stock adicional (unidades que quedaron disponibles)</h2>
      <p className="produccion-texto-ayuda">
        {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]
          ? `Ningún ${NOMBRE_POR_TIPO_PRODUCTO[tipoProducto]} cortado se pierde: el sobrante del corte tiene que quedar declarado aquí, clasificado como Primera o Segunda.`
          : "Si en esta producción salieron más unidades de las que necesitaba el apartado (o simplemente quieres dejar unidades en inventario), regístralas aquí. No es obligatorio."}
      </p>

      {stockAdicional.map((linea, indice) => (
        <div key={indice} className="produccion-form-grid produccion-stock-linea" style={{ marginTop: "0.85rem", alignItems: "end" }}>
          <span className="produccion-stock-linea-titulo">Línea {indice + 1}</span>
          <div>
            <label className="produccion-label">Cantidad</label>
            <input
              type="number"
              min="1"
              className="produccion-input"
              value={linea.cantidad}
              onChange={(e) => actualizarLineaStock(indice, "cantidad", e.target.value)}
            />
          </div>
          {!SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && (
            <div>
              <label className="produccion-label">Medida (m por unidad)</label>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                className="produccion-input"
                placeholder="Ej. 6"
                value={linea.metros ?? ""}
                onChange={(e) => actualizarLineaStock(indice, "metros", e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="produccion-label">Calidad</label>
            <select
              className="produccion-input"
              value={linea.calidad}
              onChange={(e) => actualizarLineaStock(indice, "calidad", e.target.value)}
            >
              <option value="primera">Primera</option>
              <option value="segunda">Segunda</option>
            </select>
          </div>
          {rollosSeleccionados.length > 1 && (
            <div>
              <label className="produccion-label">Salió del rollo</label>
              <select
                className="produccion-input"
                value={linea.rolloId ?? ""}
                onChange={(e) => actualizarLineaStock(indice, "rolloId", e.target.value)}
              >
                <option value="">Escoge el rollo...</option>
                {rollosSeleccionados.map(({ rollo }) => (
                  <option key={rollo.id} value={rollo.id}>{rollo.identificadorRollo}</option>
                ))}
              </select>
            </div>
          )}
          {linea.calidad === "segunda" && (
            <div>
              <label className="produccion-label">Motivo / descripción del defecto</label>
              <input
                type="text"
                className="produccion-input"
                placeholder='Ej. "Tiene un rayón en la superficie."'
                value={linea.motivoSegunda}
                onChange={(e) => actualizarLineaStock(indice, "motivoSegunda", e.target.value)}
              />
            </div>
          )}
          <div>
            <button type="button" className="produccion-boton-secundario" onClick={() => quitarLineaStock(indice)}>
              Quitar
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="produccion-boton-secundario"
        style={{ marginTop: "0.85rem" }}
        onClick={agregarLineaStock}
      >
        + Agregar línea de stock
      </button>
    </section>
  );
}

export default PanelStockAdicionalProduccion;
