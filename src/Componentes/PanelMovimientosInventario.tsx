// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useEffect, useState } from "react";
import { redondear } from "../Utils/numeros";

// Pestaña "Movimientos" de Inventario: registrar entrada/salida/traslado,
// incluida la lógica de Porcelanato (cantidad por cajas o por m²).
// Extraído de InventarioPage.tsx sin cambiar props ni comportamiento -- todo
// el estado/derivados que solo usaba esta pestaña (productoSeleccionadoMov,
// familiaSeleccionadaMov, movRequiereEntero, porcelanatoSeleccionadoMov,
// modoCantidadMov, m2SolicitadosMov, el useEffect que los resetea, y los
// valores calculados de cajas/m²) se movió aquí tal cual, sin tocar la
// lógica ni el orden de cálculo.
function PanelMovimientosInventario({
  almacen,
  productos,
  formularioMov,
  actualizarCampoMov,
  bodegaActual,
  bodegas,
  cargandoOpcionesMov,
  cambiarTipoMov,
  registrarMovimiento,
  MOTIVOS_ENTRADA,
  MOTIVOS_SALIDA,
  errorMov,
  exitoMov,
  guardandoMov,
}) {
  // Familia del producto elegido en el formulario de Movimientos (o de la
  // familia escrita a mano si es un producto nuevo), para saber si esa
  // familia solo admite cantidades enteras.
  const productoSeleccionadoMov = productos.find((p) => String(p.id) === String(formularioMov.productoId));
  const familiaSeleccionadaMov = formularioMov.productoId === "nuevo"
    ? formularioMov.familiaNueva
    : productoSeleccionadoMov?.familia || "";
  const movRequiereEntero = almacen?.decimalesPorFamilia?.[familiaSeleccionadaMov] === false;

  // El producto seleccionado se vende por CAJAS con un área fija por caja
  // (ej. Porcelanato: m² por caja) — para SALIDA, no para el consumo de
  // rollo de Producción: aquí el cliente puede pedir en m² y el sistema
  // calcula solo las cajas exactas a descontar (ceil, nunca redondeo
  // normal — ver point 3 de la especificación de Porcelanato).
  //
  // Se identifica por tipoProducto === "conversion" — mismo campo
  // estructural que ya distingue caballete/flanche, poblado por el backend
  // al crear/editar el producto (no se infiere aquí a partir de
  // metrosPorUnidad + produccionId: eso confundía el stock adicional de
  // tejas, que también usa metrosPorUnidad pero para metros lineales).
  const porcelanatoSeleccionadoMov = formularioMov.tipo === "salida"
    && productoSeleccionadoMov?.tipoProducto === "conversion"
    && Number(productoSeleccionadoMov.metrosPorUnidad) > 0
    ? productoSeleccionadoMov
    : null;
  const [modoCantidadMov, setModoCantidadMov] = useState("cajas"); // "cajas" | "m2"
  const [m2SolicitadosMov, setM2SolicitadosMov] = useState("");

  useEffect(() => {
    setModoCantidadMov("cajas");
    setM2SolicitadosMov("");
  }, [formularioMov.productoId, formularioMov.tipo]);

  const m2PorCajaMov = porcelanatoSeleccionadoMov ? Number(porcelanatoSeleccionadoMov.metrosPorUnidad) : 0;
  const m2SolicitadosNum = Number(m2SolicitadosMov);
  const cajasCalculadasMov = modoCantidadMov === "m2" && m2SolicitadosNum > 0 && m2PorCajaMov > 0
    ? Math.ceil(m2SolicitadosNum / m2PorCajaMov)
    : null;
  const m2EquivalentesMov = cajasCalculadasMov != null
    ? redondear(cajasCalculadasMov * m2PorCajaMov)
    : null;

  function cambiarM2SolicitadosMov(valor) {
    setM2SolicitadosMov(valor);
    const m2 = Number(valor);
    if (m2 > 0 && m2PorCajaMov > 0) {
      actualizarCampoMov("cantidad", String(Math.ceil(m2 / m2PorCajaMov)));
    } else {
      actualizarCampoMov("cantidad", "");
    }
  }

  return (
    <div>
      <h1 className="inventario-titulo" style={{ marginBottom: "1.5rem" }}>
        Registrar movimiento
      </h1>

      {cargandoOpcionesMov ? (
        <p className="inventario-cargando">Cargando datos...</p>
      ) : (
        <form className="inventario-form" onSubmit={registrarMovimiento} noValidate>
          <div className="inventario-tipos">
            {["entrada", "salida", "traslado"].map((tipo) => (
              <button
                key={tipo}
                type="button"
                className={`inventario-tipo-boton ${
                  formularioMov.tipo === tipo ? "inventario-tipo-activo" : ""
                }`}
                onClick={() => cambiarTipoMov(tipo)}
              >
                {tipo === "entrada" && "Entrada"}
                {tipo === "salida" && "Salida"}
                {tipo === "traslado" && "Traslado"}
              </button>
            ))}
          </div>

          <div className="inventario-form-grid">
            {(formularioMov.tipo === "entrada" || formularioMov.tipo === "salida") && (
              <div>
                <label>Motivo</label>
                <select
                  value={formularioMov.motivo}
                  onChange={(e) => actualizarCampoMov("motivo", e.target.value)}
                >
                  <option value="">Selecciona un motivo</option>
                  {(formularioMov.tipo === "entrada" ? MOTIVOS_ENTRADA : MOTIVOS_SALIDA).map(
                    (m) => (
                      <option key={m.valor} value={m.valor}>
                        {m.etiqueta}
                      </option>
                    )
                  )}
                </select>
              </div>
            )}

            <div>
              <label>Producto</label>
              <select
                value={formularioMov.productoId}
                onChange={(e) => actualizarCampoMov("productoId", e.target.value)}
              >
                <option value="">Selecciona un producto</option>
                {formularioMov.tipo === "entrada" && (
                  <option value="nuevo">+ Registrar producto nuevo</option>
                )}
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.codigo} — {p.descripcion}
                  </option>
                ))}
              </select>
            </div>

            {formularioMov.tipo === "entrada" && formularioMov.productoId === "nuevo" && (
              <>
                <div>
                  <label>Código del producto *</label>
                  <input value={formularioMov.codigoNuevo} onChange={(e) => actualizarCampoMov("codigoNuevo", e.target.value)} />
                </div>
                <div>
                  <label>Descripción *</label>
                  <input value={formularioMov.descripcionNueva} onChange={(e) => actualizarCampoMov("descripcionNueva", e.target.value)} />
                </div>
                <div>
                  <label>Familia</label>
                  <input
                    list="inventario-datalist-familias"
                    placeholder="Ej. Tornillos"
                    value={formularioMov.familiaNueva}
                    onChange={(e) => actualizarCampoMov("familiaNueva", e.target.value)}
                  />
                </div>
                <div>
                  <label>Calibre</label>
                  <input value={formularioMov.calibreNuevo} onChange={(e) => actualizarCampoMov("calibreNuevo", e.target.value)} />
                </div>
              </>
            )}

            {(formularioMov.tipo === "salida" || formularioMov.tipo === "traslado") && (
              <div>
                <label>Bodega de origen</label>
                <input value={bodegaActual?.nombre || ""} disabled readOnly />
              </div>
            )}

            {formularioMov.tipo === "traslado" && (
              <div>
                <label>Bodega de destino</label>
                <select
                  value={formularioMov.bodegaDestinoId}
                  onChange={(e) => actualizarCampoMov("bodegaDestinoId", e.target.value)}
                >
                  <option value="">Selecciona una bodega</option>
                  {bodegas.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {porcelanatoSeleccionadoMov && (
              <div>
                <label>¿Cómo indicas la cantidad?</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className={`inventario-tipo-boton ${modoCantidadMov === "cajas" ? "inventario-tipo-activo" : ""}`}
                    onClick={() => { setModoCantidadMov("cajas"); actualizarCampoMov("cantidad", ""); }}
                  >
                    Cajas
                  </button>
                  <button
                    type="button"
                    className={`inventario-tipo-boton ${modoCantidadMov === "m2" ? "inventario-tipo-activo" : ""}`}
                    onClick={() => setModoCantidadMov("m2")}
                  >
                    Metros cuadrados (m²)
                  </button>
                </div>
              </div>
            )}

            {porcelanatoSeleccionadoMov && modoCantidadMov === "m2" ? (
              <div>
                <label>Metros cuadrados solicitados</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  placeholder={`Ej. 20 (${m2PorCajaMov} m² por caja)`}
                  value={m2SolicitadosMov}
                  onChange={(e) => cambiarM2SolicitadosMov(e.target.value)}
                />
                {cajasCalculadasMov != null ? (
                  <p className="inventario-carga-ayuda" style={{ margin: "0.4rem 0 0" }}>
                    {m2SolicitadosNum} m² ÷ {m2PorCajaMov} m²/caja = {cajasCalculadasMov} caja
                    {cajasCalculadasMov === 1 ? "" : "s"} (redondeado hacia arriba) — se entregan{" "}
                    <strong>{m2EquivalentesMov} m²</strong> equivalentes. Se descuentan {cajasCalculadasMov} caja
                    {cajasCalculadasMov === 1 ? "" : "s"} del inventario, no {m2SolicitadosNum} m².
                  </p>
                ) : (
                  <p className="inventario-carga-ayuda" style={{ margin: "0.4rem 0 0" }}>
                    Indica cuántos m² pide el cliente — el sistema calcula solas las cajas necesarias.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label>Cantidad{porcelanatoSeleccionadoMov ? " (cajas)" : ""}</label>
                <input
                  type="number"
                  min="1"
                  step={movRequiereEntero ? "1" : "any"}
                  value={formularioMov.cantidad}
                  onChange={(e) => actualizarCampoMov("cantidad", e.target.value)}
                />
                {movRequiereEntero && (
                  <p className="inventario-carga-ayuda" style={{ margin: "0.4rem 0 0" }}>
                    Familia "{familiaSeleccionadaMov}": solo cantidades enteras ({almacen?.unidadPorFamilia?.[familiaSeleccionadaMov]}).
                  </p>
                )}
              </div>
            )}

            <div className="inventario-observaciones">
              <label>Observaciones</label>
              <textarea
                rows={3}
                value={formularioMov.observaciones}
                onChange={(e) => actualizarCampoMov("observaciones", e.target.value)}
              />
            </div>
          </div>

          {errorMov && <p className="inventario-error">{errorMov}</p>}
          {exitoMov && <p className="inventario-exito">{exitoMov}</p>}

          <button type="submit" className="inventario-boton" disabled={guardandoMov}>
            {guardandoMov ? "Registrando..." : "Registrar movimiento"}
          </button>
        </form>
      )}
    </div>
  );
}

export default PanelMovimientosInventario;
