// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useState } from "react";
import Paginacion from "./Paginacion";
import { formatearFechaColombia } from "../Utils/fechas";

const unicos = (valores) => [...new Set(valores.filter(Boolean))].join(", ") || "—";

// Pestaña "Historial" de Inventario: filtros + tabla de movimientos +
// paginación. Extraído de InventarioPage.tsx sin cambiar props ni
// comportamiento -- solo recibe lo que ya usaba de useControladorInventario.
function PanelHistorialInventario({
  sesion,
  filtros,
  actualizarFiltro,
  limpiarFiltros,
  cargarHistorial,
  errorHistorial,
  cargandoHistorial,
  filasHistorial,
  bodegas,
  paginacionHistorial,
  setPaginaHistorial,
}) {
  // Filas de cotización (varios movimientos en una) que el usuario desplegó.
  const [abiertas, setAbiertas] = useState(() => new Set());
  const alternar = (clave) => setAbiertas((actual) => {
    const nuevas = new Set(actual);
    if (nuevas.has(clave)) nuevas.delete(clave); else nuevas.add(clave);
    return nuevas;
  });
  const nombreBodega = (id) => bodegas.find((b) => b.id === id)?.nombre || "—";

  const filaMovimiento = (m, { clave = m.id, esDetalle = false } = {}) => (
    <tr key={clave} style={esDetalle ? { opacity: 0.8, fontSize: "0.92em" } : undefined}>
      <td style={esDetalle ? { paddingLeft: "1.6rem" } : undefined}>{esDetalle ? "└" : m.cotizacion || "—"}</td>
      <td>{formatearFechaColombia(m.fecha)}</td>
      <td style={{ textTransform: "capitalize" }}>{m.tipo}</td>
      <td style={{ textTransform: "capitalize" }}>
        {(m.motivo || "—").replace("_", " ")}
      </td>
      <td>
        {m.productoCodigo} — {m.productoDescripcion}
      </td>
      <td>{m.identificadorRollo || "—"}</td>
      <td>{nombreBodega(m.bodegaOrigenId)}</td>
      <td>{nombreBodega(m.bodegaDestinoId)}</td>
      <td>{m.empresaExterna || "—"}</td>
      <td>{m.cantidad}</td>
      <td>{m.usuario}</td>
      <td>{m.observaciones || "—"}</td>
    </tr>
  );

  const filaCotizacion = ({ clave, movimiento: m, detalle, total }) => {
    const abierta = abiertas.has(clave);
    const productos = new Set(detalle.map((d) => `${d.productoCodigo} — ${d.productoDescripcion}`));
    const nombre = m.motivo === "produccion" ? "producciones" : "movimientos";
    return [
      <tr key={clave} onClick={() => alternar(clave)} style={{ cursor: "pointer", fontWeight: 600 }}
        title={abierta ? "Ocultar el detalle" : "Ver cada movimiento"}>
        <td style={{ whiteSpace: "nowrap" }}>{abierta ? "▾" : "▸"} {m.cotizacion}</td>
        <td>{formatearFechaColombia(m.fecha)}</td>
        <td style={{ textTransform: "capitalize" }}>{m.tipo}</td>
        <td style={{ textTransform: "capitalize" }}>{(m.motivo || "—").replace("_", " ")}</td>
        <td>{productos.size === 1 ? [...productos][0] : `${productos.size} productos`}</td>
        <td>{unicos(detalle.map((d) => d.identificadorRollo))}</td>
        <td>{unicos(detalle.map((d) => bodegas.find((b) => b.id === d.bodegaOrigenId)?.nombre))}</td>
        <td>{unicos(detalle.map((d) => bodegas.find((b) => b.id === d.bodegaDestinoId)?.nombre))}</td>
        <td>{unicos(detalle.map((d) => d.empresaExterna))}</td>
        <td>{total}</td>
        <td>{unicos(detalle.map((d) => d.usuario))}</td>
        <td>{detalle.length} {nombre}</td>
      </tr>,
      ...(abierta ? detalle.map((d) => filaMovimiento(d, { clave: `${clave}-${d.id}`, esDetalle: true })) : []),
    ];
  };

  return (
    <div>
      <h1 className="inventario-titulo" style={{ marginBottom: "1.5rem" }}>
        Historial de movimientos — {sesion?.bodegaNombre || "mi bodega"}
      </h1>

      <div className="inventario-form inventario-filtros">
        <div className="inventario-form-grid">
          <div>
            <label>Código de producto</label>
            <input
              value={filtros.codigoProducto}
              onChange={(e) => actualizarFiltro("codigoProducto", e.target.value)}
              placeholder="Ej: PRD-001"
            />
          </div>

          <div>
            <label>N° Cotización</label>
            <input
              value={filtros.cotizacion}
              onChange={(e) => actualizarFiltro("cotizacion", e.target.value)}
              placeholder="Ej: COT-00125"
            />
          </div>

          <div>
            <label>Empresa (salida externa)</label>
            <input
              value={filtros.empresaExterna}
              onChange={(e) => actualizarFiltro("empresaExterna", e.target.value)}
              placeholder="Ej: Tejas del Norte"
            />
          </div>

          <div>
            <label>Desde</label>
            <input
              type="date"
              value={filtros.fechaDesde}
              onChange={(e) => actualizarFiltro("fechaDesde", e.target.value)}
            />
          </div>

          <div>
            <label>Hasta</label>
            <input
              type="date"
              value={filtros.fechaHasta}
              onChange={(e) => actualizarFiltro("fechaHasta", e.target.value)}
            />
          </div>
        </div>

        <div className="inventario-form-botones">
          <button className="inventario-boton" onClick={cargarHistorial}>
            Filtrar
          </button>
          <button className="inventario-boton-cancelar" onClick={limpiarFiltros}>
            Limpiar filtros
          </button>
        </div>
      </div>

      {errorHistorial && <p className="inventario-error">{errorHistorial}</p>}

      {cargandoHistorial ? (
        <p className="inventario-cargando">Cargando historial...</p>
      ) : (
        <>
        <div className="inventario-tabla-contenedor">
          <table className="inventario-tabla">
            <thead>
              <tr>
                <th>N° Cotización</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Motivo</th>
                <th>Producto</th>
                <th>Referencia</th>
                <th>Origen</th>
                <th>Destino</th>
                <th>Empresa</th>
                <th>Cantidad</th>
                <th>Usuario</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {filasHistorial.length === 0 ? (
                <tr>
                  <td colSpan={12} className="inventario-vacio">
                    No hay movimientos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filasHistorial.map((fila) => (fila.detalle ? filaCotizacion(fila) : filaMovimiento(fila.movimiento)))
              )}
            </tbody>
          </table>
        </div>
        <Paginacion
          paginacion={paginacionHistorial}
          alCambiarPagina={setPaginaHistorial}
          etiqueta="movimientos"
        />
        </>
      )}
    </div>
  );
}

export default PanelHistorialInventario;
