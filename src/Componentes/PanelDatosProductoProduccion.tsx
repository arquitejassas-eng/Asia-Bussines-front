// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { anchoPorSeccion, NOMBRE_POR_TIPO_PRODUCTO, SECCIONES_POR_TIPO_PRODUCTO } from "../Utils/produccion";
import { MODELOS_TEJA, normalizarModeloTeja } from "../Utils/teja";

// Sección "1. Datos del producto fabricado" de Producción. Extraído de
// ProduccionPage.tsx sin cambiar props ni comportamiento -- no usa estado
// local propio, todo viene del controlador (useControladorProduccion) vía
// props.
function PanelDatosProductoProduccion({
  tipoProducto,
  setTipoProducto,
  productoFabricado,
  setProductoFabricado,
  modelo,
  setModelo,
  medidaProducto,
  setMedidaProducto,
  cantidadProductos,
  setCantidadProductos,
  ayudaCantidad,
  lineasProduccion = [],
  actualizarLineaProduccion,
  metrosPorUnidad,
  setMetrosPorUnidad,
  responsable,
  setResponsable,
  color,
  setColor,
  ral,
  setRal,
  calibreLote,
  setCalibreLote,
  infoCorte,
  rollosDisponibles,
  codigoBusqueda,
}) {
  return (
    <section className="produccion-tarjeta">
      <h2>1. Datos del producto fabricado</h2>

      <div className="produccion-tipos" style={{ marginBottom: "1.1rem" }}>
        <button
          type="button"
          className={`produccion-tipo-boton ${tipoProducto === "teja" ? "produccion-tipo-activo" : ""}`}
          onClick={() => setTipoProducto("teja")}
        >
          Teja
        </button>
        <button
          type="button"
          className={`produccion-tipo-boton ${tipoProducto === "caballete" ? "produccion-tipo-activo" : ""}`}
          onClick={() => setTipoProducto("caballete")}
        >
          Caballete
        </button>
        <button
          type="button"
          className={`produccion-tipo-boton ${tipoProducto === "flanche" ? "produccion-tipo-activo" : ""}`}
          onClick={() => setTipoProducto("flanche")}
        >
          Flanche
        </button>
        {tipoProducto === "lamina_lisa" && (
          <button type="button" className="produccion-tipo-boton produccion-tipo-activo">
            Lámina lisa
          </button>
        )}
      </div>

      {tipoProducto === "lamina_lisa" && (
        <p className="produccion-texto-ayuda" style={{ marginBottom: "1rem" }}>
          Láminas lisas de una orden interna: entran al stock de tu bodega y después se convierten en caballetes o
          flanches en la bodega que diga la orden (si es otra, se le mandan con un traslado).
        </p>
      )}

      {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && (
        <p className="produccion-texto-ayuda" style={{ marginBottom: "1rem" }}>
          El ancho del rollo se divide siempre en {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]}: cada
          corte a lo largo del rollo produce {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]}{" "}
          {NOMBRE_POR_TIPO_PRODUCTO[tipoProducto]}s, sin importar cuántos necesites. Indica la
          longitud del {NOMBRE_POR_TIPO_PRODUCTO[tipoProducto]} abajo — el sistema calcula solo
          cuántos cortes hacen falta y cuánto sobra.
        </p>
      )}

      {lineasProduccion.length > 1 && (
        <div className="produccion-lineas-juntas">
          <p className="produccion-label">Cantidad y medida de cada línea</p>
          {lineasProduccion.map((linea) => (
            <div key={linea.itemId} className="produccion-linea-junta">
              <span className="produccion-linea-junta-nombre">
                {linea.descripcion}
                <small>Pide {linea.metrosPendientes} m · salen {linea.metros} m</small>
              </span>
              <label>
                <span>Cantidad</span>
                <input type="number" min="1" step="1" inputMode="numeric" className="produccion-input"
                  value={linea.cantidad} onChange={(e) => actualizarLineaProduccion(linea.itemId, "cantidad", e.target.value)} />
              </label>
              <label>
                <span>Medida (m)</span>
                <input type="number" min="0" step="any" inputMode="decimal" className="produccion-input"
                  value={linea.medida} onChange={(e) => actualizarLineaProduccion(linea.itemId, "medida", e.target.value)} />
              </label>
            </div>
          ))}
          {ayudaCantidad && <p className="produccion-texto-ayuda">{ayudaCantidad}</p>}
        </div>
      )}

      <div className="produccion-form-grid">
        <div>
          <label className="produccion-label" htmlFor="prod-producto">Producto (opcional)</label>
          <input
            id="prod-producto"
            maxLength={150}
            type="text"
            className="produccion-input"
            placeholder="Ej. Cubierta metálica"
            value={productoFabricado}
            onChange={(e) => setProductoFabricado(e.target.value)}
          />
        </div>
        {tipoProducto !== "lamina_lisa" && <div>
          <label className="produccion-label" htmlFor="prod-modelo">Modelo</label>
          <input
            id="prod-modelo"
            type="text"
            className="produccion-input"
            placeholder={tipoProducto === "teja" ? "Ej. arqui, super..." : "Ej. M-200"}
            list={tipoProducto === "teja" ? "prod-modelos-teja" : undefined}
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            onBlur={() => { if (tipoProducto === "teja" && modelo.trim()) setModelo(normalizarModeloTeja(modelo)); }}
          />
          {tipoProducto === "teja" && (
            <datalist id="prod-modelos-teja">
              {Object.keys(MODELOS_TEJA).map((nombre) => <option key={nombre} value={nombre} />)}
            </datalist>
          )}
          {tipoProducto === "teja" && modelo.trim() && normalizarModeloTeja(modelo) !== modelo.trim() && (
            <p className="produccion-texto-ayuda">Se guarda como <strong>{normalizarModeloTeja(modelo)}</strong></p>
          )}
        </div>}
        {!SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && lineasProduccion.length < 2 && (
          <div>
            <label className="produccion-label" htmlFor="prod-medida">Medida del producto</label>
            <input
              id="prod-medida"
              type="text"
              className="produccion-input"
              placeholder="Ej. 3m x 1m"
              value={medidaProducto}
              onChange={(e) => setMedidaProducto(e.target.value)}
            />
          </div>
        )}
        {lineasProduccion.length < 2 && <div>
          <label className="produccion-label" htmlFor="prod-cantidad">
            {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]
              ? `Cantidad de ${NOMBRE_POR_TIPO_PRODUCTO[tipoProducto]}s necesarios`
              : "Cantidad de productos obtenidos"}
          </label>
          <input
            id="prod-cantidad"
            type="number"
            min="1"
            step="1"
            className="produccion-input"
            placeholder="Ej. 50"
            value={cantidadProductos}
            onChange={(e) => setCantidadProductos(e.target.value)}
          />
          {ayudaCantidad && <p className="produccion-texto-ayuda">{ayudaCantidad}</p>}
        </div>}
        {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && (
          <div>
            <label className="produccion-label" htmlFor="prod-longitud-caballete">
              Longitud del {NOMBRE_POR_TIPO_PRODUCTO[tipoProducto]} (m)
            </label>
            <input
              id="prod-longitud-caballete"
              type="number"
              min="0"
              step="any"
              className="produccion-input"
              placeholder="Ej. 6"
              value={metrosPorUnidad}
              onChange={(e) => setMetrosPorUnidad(e.target.value)}
            />
          </div>
        )}
        <div>
          <label className="produccion-label" htmlFor="prod-responsable">Responsable</label>
          <input
            id="prod-responsable"
            type="text"
            className="produccion-input"
            placeholder="Nombre de quien produce"
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
          />
        </div>
        <div>
          <label className="produccion-label" htmlFor="prod-color">Color (opcional)</label>
          <input
            id="prod-color"
            type="text"
            className="produccion-input"
            placeholder="Ej. Azul"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div>
          <label className="produccion-label" htmlFor="prod-ral">RAL (opcional)</label>
          <input
            id="prod-ral"
            type="text"
            className="produccion-input"
            placeholder="Ej. RAL 5015"
            value={ral}
            onChange={(e) => setRal(e.target.value)}
          />
        </div>
        <div>
          <label className="produccion-label" htmlFor="prod-calibre">
            {tipoProducto === "teja" ? "Espesor" : "Espesor (opcional)"}
          </label>
          <input
            id="prod-calibre"
            type="text"
            className="produccion-input"
            placeholder="Ej. 27"
            value={calibreLote}
            onChange={(e) => setCalibreLote(e.target.value)}
          />
        </div>
      </div>

      {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && infoCorte && (
        <p className="produccion-resumen" style={{ marginTop: "1rem" }}>
          <strong>{infoCorte.cortes}</strong> corte{infoCorte.cortes === 1 ? "" : "s"} ×{" "}
          {infoCorte.secciones} = <strong>{infoCorte.producidoFisico}</strong>{" "}
          {NOMBRE_POR_TIPO_PRODUCTO[tipoProducto]}s producidos —{" "}
          <strong>{infoCorte.producidoFisico - infoCorte.sobrante}</strong> van para la cotización
          {infoCorte.sobrante > 0 ? (
            <>
              {" "}y <strong>{infoCorte.sobrante}</strong> quedan como stock adicional (sección 2).
            </>
          ) : (
            " y no sobra ninguno."
          )}{" "}
          Consumo de rollo: <strong>{infoCorte.metrosNecesarios} m</strong>.
        </p>
      )}

      {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto] && rollosDisponibles.length > 0 && (
        <p className="produccion-texto-ayuda" style={{ marginTop: "0.5rem" }}>
          Ancho del rollo {codigoBusqueda}: <strong>{rollosDisponibles[0].anchoMaterial} m</strong> ÷{" "}
          {SECCIONES_POR_TIPO_PRODUCTO[tipoProducto]} ={" "}
          <strong>{anchoPorSeccion(rollosDisponibles[0].anchoMaterial, tipoProducto)} m</strong> por
          sección (dato del rollo, no de este formulario — corrígelo en Rollos si está mal).
        </p>
      )}
    </section>
  );
}

export default PanelDatosProductoProduccion;
