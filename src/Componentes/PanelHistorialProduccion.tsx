// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { formatearFechaColombia } from "../Utils/fechas";
import { filasStockAdicional } from "../Utils/produccion";

// Sección "Producciones registradas" (historial) de Producción. Extraído de
// ProduccionPage.tsx sin cambiar props ni comportamiento -- no usa estado
// local propio, todo viene del controlador (useControladorProduccion) vía
// props.
function PanelHistorialProduccion({ misProducciones }) {
  if (misProducciones.length === 0) {
    return <p className="produccion-vacio">Todavía no hay producciones registradas en tu bodega.</p>;
  }

  return (
    <section className="produccion-tarjeta produccion-tabla-wrap">
      <h2>Producciones registradas</h2>
      <table className="produccion-tabla produccion-tabla-tarjetas produccion-tarjetas-historial produccion-tabla-historial">
        <thead>
          <tr>
            <th>Código único</th>
            <th>Cotización</th>
            <th>Cliente</th>
            <th>Fecha</th>
            <th>Modelo</th>
            <th>Cantidad</th>
            <th>Medida</th>
            <th>Código clasificación</th>
            <th>Referencia</th>
            <th>Metros usados</th>
            <th>Saldo del rollo</th>
            <th>Responsable</th>
            <th>Observación</th>
          </tr>
        </thead>
        <tbody>
          {misProducciones.flatMap((prod) => [
            <tr key={prod.id}>
              <td data-etiqueta="Código">{prod.codigoUnico}</td>
              <td data-etiqueta="Cotización">{prod.cotizacion || "—"}</td>
              <td data-etiqueta="Cliente">{prod.clienteApartado || "—"}</td>
              <td data-etiqueta="Fecha">{formatearFechaColombia(prod.fecha)}</td>
              <td data-etiqueta="Modelo">{prod.modelo || "—"}</td>
              <td data-etiqueta="Cantidad">{prod.cantidadProductos}</td>
              <td data-etiqueta="Medida">{prod.medidaProducto || "—"}</td>
              <td data-etiqueta="Código clasificación">{prod.codigoClasificacion}</td>
              <td data-etiqueta="Rollo">{prod.rollosUtilizados.map((r) => r.identificadorRollo).join(", ")}</td>
              <td data-etiqueta="Metros usados">{prod.totalMetrosConsumidos}</td>
              <td data-etiqueta="Saldo del rollo">{prod.saldoCodigo}</td>
              <td data-etiqueta="Responsable">{prod.responsable}</td>
              <td data-etiqueta="Observación">{prod.observaciones || "—"}</td>
            </tr>,
            ...filasStockAdicional(prod).map((fila) => (
              <tr key={fila.key} className="produccion-fila-stock">
                <td data-etiqueta="Código">{fila.codigoProduccion}</td>
                <td data-etiqueta="Cotización" className="produccion-cotizacion-stock">{fila.cotizacion}</td>
                <td data-etiqueta="Cliente">{fila.cliente}</td>
                <td data-etiqueta="Fecha">{formatearFechaColombia(fila.fecha)}</td>
                <td data-etiqueta="Modelo">{fila.modelo || "—"}</td>
                <td data-etiqueta="Cantidad">{fila.cantidad}</td>
                <td data-etiqueta="Medida">{fila.medida || "—"}</td>
                <td data-etiqueta="Código clasificación">{fila.codigoClasificacion}</td>
                <td data-etiqueta="Rollo">{fila.referencia}</td>
                <td data-etiqueta="Metros usados">{fila.metrosConsumidos}</td>
                <td data-etiqueta="Saldo del rollo">{fila.saldoRestante}</td>
                <td data-etiqueta="Responsable">{fila.responsable}</td>
                <td data-etiqueta="Observación">{fila.observaciones}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </section>
  );
}

export default PanelHistorialProduccion;
