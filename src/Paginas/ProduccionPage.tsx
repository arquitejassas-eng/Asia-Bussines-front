// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import BarraLateral from "../Componentes/BarraLateral";
import ModalConfirmacion from "../Componentes/ModalConfirmacion";
import { useControladorProduccion } from "../Componentes/Produccion";
import { contarNotificacionesBarraLateral } from "../Utils/notificaciones";
import PanelDatosProductoProduccion from "../Componentes/PanelDatosProductoProduccion";
import PanelProduccionConfirmada from "../Componentes/PanelProduccionConfirmada";
import PanelStockAdicionalProduccion from "../Componentes/PanelStockAdicionalProduccion";
import PanelBusquedaRollosProduccion from "../Componentes/PanelBusquedaRollosProduccion";
import PanelResumenProduccion from "../Componentes/PanelResumenProduccion";
import PanelSolicitudesPendientes from "../Componentes/PanelSolicitudesPendientes";
import PanelHistorialProduccion from "../Componentes/PanelHistorialProduccion";
import PanelMermaRollo from "../Componentes/PanelMermaRollo";
import "../Style/Produccion.css";
import "../Style/Rollos.css";

function ProduccionPage({ sesion, onCerrarSesion, almacen }) {
  const p = useControladorProduccion(sesion, almacen);

  const notificaciones = contarNotificacionesBarraLateral(almacen, sesion);

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="produccion-page">
          <h1 className="produccion-titulo">
            {p.puedeRegistrarProduccion ? "Registrar Producción" : "Hoja de Vida"}
          </h1>
          <p className="produccion-subtitulo">
            {p.puedeRegistrarProduccion
              ? "Consume uno o varios rollos para un proceso de producción. Cada rollo descuenta sus propios metros — nunca se resta de un total agrupado."
              : "Reporte de control de material: consulta las producciones registradas en tu bodega."}
          </p>

          {p.puedeRegistrarProduccion && (
            <>
          {!p.produccionConfirmada && p.solicitudesPendientes.length > 0 && (
            <PanelSolicitudesPendientes
              solicitudesPendientes={p.solicitudesPendientes}
              cotizacionResaltada={p.cotizacionResaltada}
              errorSolicitudPendiente={p.errorSolicitudPendiente}
              apartadoItemId={p.apartadoItemId}
              limpiarSolicitud={p.limpiarSolicitud}
              seleccionarSolicitud={p.seleccionarSolicitud}
              marcarProduccionTerminada={p.marcarProduccionTerminada}
            />
          )}

          {p.produccionConfirmada ? (
            <PanelProduccionConfirmada
              produccionConfirmada={p.produccionConfirmada}
              iniciarNuevoRegistro={p.iniciarNuevoRegistro}
            />
          ) : (
            <>
              <PanelDatosProductoProduccion
                tipoProducto={p.tipoProducto}
                setTipoProducto={p.setTipoProducto}
                productoFabricado={p.productoFabricado}
                setProductoFabricado={p.setProductoFabricado}
                modelo={p.modelo}
                setModelo={p.setModelo}
                medidaProducto={p.medidaProducto}
                setMedidaProducto={p.setMedidaProducto}
                cantidadProductos={p.cantidadProductos}
                setCantidadProductos={p.setCantidadProductos}
                metrosPorUnidad={p.metrosPorUnidad}
                setMetrosPorUnidad={p.setMetrosPorUnidad}
                responsable={p.responsable}
                setResponsable={p.setResponsable}
                color={p.color}
                setColor={p.setColor}
                ral={p.ral}
                setRal={p.setRal}
                calibreLote={p.calibreLote}
                setCalibreLote={p.setCalibreLote}
                infoCorte={p.infoCorte}
                rollosDisponibles={p.rollosDisponibles}
                codigoBusqueda={p.codigoBusqueda}
              />

              <PanelStockAdicionalProduccion
                tipoProducto={p.tipoProducto}
                stockAdicional={p.stockAdicional}
                metrosPorUnidad={p.metrosPorUnidad}
                setMetrosPorUnidad={p.setMetrosPorUnidad}
                actualizarLineaStock={p.actualizarLineaStock}
                quitarLineaStock={p.quitarLineaStock}
                agregarLineaStock={p.agregarLineaStock}
              />

              <PanelBusquedaRollosProduccion
                codigoBusqueda={p.codigoBusqueda}
                setCodigoBusqueda={p.setCodigoBusqueda}
                empresaFiltro={p.empresaFiltro}
                setEmpresaFiltro={p.setEmpresaFiltro}
                rollosDisponibles={p.rollosDisponibles}
                seleccion={p.seleccion}
                alternarSeleccionRollo={p.alternarSeleccionRollo}
                actualizarMetrosRollo={p.actualizarMetrosRollo}
              />

              {p.advertenciaSeleccion && <p className="produccion-error">{p.advertenciaSeleccion}</p>}

              {p.rollosSeleccionados.length > 0 && (
                <PanelResumenProduccion
                  rollosSeleccionados={p.rollosSeleccionados}
                  totalMetrosAConsumir={p.totalMetrosAConsumir}
                  observaciones={p.observaciones}
                  setObservaciones={p.setObservaciones}
                />
              )}

              {p.errorValidacion && <p className="produccion-error">{p.errorValidacion}</p>}

              <div className="produccion-acciones">
                <button className="produccion-boton-secundario" onClick={p.cancelar}>
                  Cancelar
                </button>
                <button
                  className="produccion-boton-primario"
                  onClick={p.registrarProduccion}
                  disabled={p.guardando}
                >
                  {p.guardando ? "Registrando..." : "Registrar Producción"}
                </button>
              </div>
            </>
          )}

            </>
          )}

          {sesion?.rol === "jefe_planta" && <PanelMermaRollo bodegas={almacen?.bodegas} />}
          <PanelHistorialProduccion misProducciones={p.misProducciones} />
        </div>
      </div>
      {p.confirmacionStockPendiente && (
        <ModalConfirmacion
          titulo="Confirmar separación de stock"
          mensaje={`La cotización ${p.confirmacionStockPendiente.numeroCotizacion} también tiene material de stock pendiente. ¿Ya separaste el stock de esta cotización?`}
          textoConfirmar="Sí"
          textoCancelar="No"
          onConfirmar={p.confirmarSeparacionYRegistrar}
          onCancelar={p.cancelarConfirmacionSeparacion}
        />
      )}
    </div>
  );
}

export default ProduccionPage;
