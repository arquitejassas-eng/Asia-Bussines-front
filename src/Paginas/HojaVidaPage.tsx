import { useState } from "react";
import BarraLateral from "../Componentes/BarraLateral";
import { formatearFechaColombia } from "../Utils/fechas";
import { useControladorProduccion } from "../Componentes/Produccion";
import { contarNotificaciones } from "../Utils/notificaciones";
import { filasStockAdicional } from "../Utils/produccion";
import "../Style/Hojadevida.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

type ProduccionRegistro = {
  id: number | string; bodegaId: number; codigoUnico: string; cotizacion?: string; clienteApartado?: string; fecha: string;
  responsable: string; productoFabricado: string; modelo: string; medidaProducto: string;
  cantidadProductos: number; rollosUtilizados: { identificadorRollo: string }[];
  codigoClasificacion: string; totalMetrosConsumidos: number; saldoCodigo: number; observaciones?: string;
};

export default function HojaVidaPage({ sesion, onCerrarSesion, almacen }: {
  sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal;
}) {
  const p = useControladorProduccion({ bodegaId: sesion?.bodegaId ?? undefined, rol: sesion?.rol }, almacen);
  // Admin Inventario recibe las producciones de TODAS las sedes (el backend
  // ya se las manda así) para verificar que el material que sale de cada
  // una sea el real: por eso ve la columna Bodega y puede filtrar por sede.
  const esAdminInventario = sesion?.rol === "admin_inventario";
  const [bodegaFiltro, setBodegaFiltro] = useState("");
  const nombreBodega = (id: number) => (almacen?.bodegas || []).find((b) => b.id === id)?.nombre || `Bodega ${id}`;
  const misProducciones = (p.misProducciones as ProduccionRegistro[])
    .filter((prod) => !bodegaFiltro || String(prod.bodegaId) === bodegaFiltro);

  const notificaciones = contarNotificaciones(almacen, sesion);

  const totalProducciones = misProducciones.length;

  return (
    <div className="layout-con-sidebar">
      <BarraLateral
        sesion={sesion}
        onCerrarSesion={onCerrarSesion}
        notificaciones={notificaciones}
      />

      <div className="layout-contenido">
        <div className="hv-page">
          <header className="hv-header">
            <div className="hv-header-texto">
              <h1 className="hv-titulo">Hoja de Vida</h1>
              <p className="hv-subtitulo">
                {esAdminInventario
                  ? "Reporte de control de material: verifica las producciones registradas en todas las bodegas."
                  : "Reporte de control de material: consulta las producciones registradas en tu bodega."}
              </p>
              {esAdminInventario && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
                  Bodega
                  <select value={bodegaFiltro} onChange={(e) => setBodegaFiltro(e.target.value)}>
                    <option value="">Todas</option>
                    {(almacen?.bodegas || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {totalProducciones > 0 && (
              <div className="hv-conteo">
                <strong>{totalProducciones}</strong>
                <span>{totalProducciones === 1 ? "registro" : "registros"}</span>
              </div>
            )}
          </header>

          {totalProducciones > 0 ? (
            <section className="hv-card">
              <h2>Historial de Producción</h2>

              <div className="hv-tabla-wrap">
                <table className="hv-tabla">
                  <thead>
                    <tr>
                      {esAdminInventario && <th>Bodega</th>}
                      <th>Código de Producción</th>
                      <th>Cotización</th>
                      <th>Cliente</th>
                      <th>Fecha</th>
                      <th>Responsable</th>
                      <th>Producto Fabricado</th>
                      <th>Modelo</th>
                      <th>Medida</th>
                      <th className="num">Cantidad</th>
                      <th>Referencia</th>
                      <th className="num">Metros Consumidos</th>
                      <th className="num">Saldo Restante</th>
                      <th>Observaciones</th>
                    </tr>
                  </thead>

                  <tbody>
                    {misProducciones.flatMap((prod) => [
                      <tr key={prod.id}>
                        {esAdminInventario && <td>{nombreBodega(prod.bodegaId)}</td>}
                        <td>
                          <span className="hv-codigo">{prod.codigoUnico}</span>
                        </td>

                        <td>{prod.cotizacion || "—"}</td>
                        <td>{prod.clienteApartado || "—"}</td>

                        <td className="hv-fecha">
                          {formatearFechaColombia(prod.fecha, false)}
                        </td>

                        <td>{prod.responsable}</td>
                        <td>{prod.productoFabricado}</td>
                        <td>{prod.modelo}</td>
                        <td>{prod.medidaProducto}</td>
                        <td className="num">{prod.cantidadProductos}</td>

                        <td>
                          <span className="hv-codigo-rollo">
                            {prod.rollosUtilizados.map((r) => r.identificadorRollo).join(", ")}
                          </span>
                        </td>

                        <td className="num hv-metros">{prod.totalMetrosConsumidos} m</td>
                        <td className="num hv-saldo">{prod.saldoCodigo} m</td>

                        <td className="hv-observaciones">{prod.observaciones || "—"}</td>
                      </tr>,
                      ...filasStockAdicional(prod).map((fila) => (
                        <tr key={fila.key} className="hv-fila-stock">
                          {esAdminInventario && <td>{nombreBodega(prod.bodegaId)}</td>}
                          <td>
                            <span className="hv-codigo">{fila.codigoProduccion}</span>
                          </td>

                          <td className="hv-cotizacion-stock">{fila.cotizacion}</td>
                          <td>{fila.cliente}</td>

                          <td className="hv-fecha">
                            {formatearFechaColombia(fila.fecha, false)}
                          </td>

                          <td>{fila.responsable}</td>
                          <td>{fila.productoFabricado}</td>
                          <td>{fila.modelo}</td>
                          <td>{fila.medida}</td>
                          <td className="num">{fila.cantidad}</td>

                          <td>
                            <span className="hv-codigo-rollo">{fila.referencia}</span>
                          </td>

                          <td className="num hv-metros">{fila.metrosConsumidos} m</td>
                          <td className="num hv-saldo">{fila.saldoRestante} m</td>

                          <td className="hv-observaciones">{fila.observaciones}</td>
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="hv-vacio">
              <div className="hv-vacio-icono">◎</div>
              <p>
                {esAdminInventario
                  ? bodegaFiltro ? "Todavía no hay producciones registradas en esta bodega." : "Todavía no hay producciones registradas en ninguna bodega."
                  : "Todavía no hay producciones registradas en tu bodega."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
