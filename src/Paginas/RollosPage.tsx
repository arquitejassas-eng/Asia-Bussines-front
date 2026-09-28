// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import BarraLateral from "../Componentes/BarraLateral";
import { useControladorRollos } from "../Componentes/Rollos";
import Paginacion from "../Componentes/Paginacion";
import ModalConsumoRollo from "../Componentes/ModalConsumoRollo";
import ModalSalidaExternaRollo from "../Componentes/ModalSalidaExternaRollo";
import ModalHistorialRollo from "../Componentes/ModalHistorialRollo";
import PanelFiltrosRollos from "../Componentes/PanelFiltrosRollos";
import PanelCargaMasivaRollos from "../Componentes/PanelCargaMasivaRollos";
import ModalIngresoRollo from "../Componentes/ModalIngresoRollo";
import PanelToggleVistaRollos from "../Componentes/PanelToggleVistaRollos";
import PanelAgrupacionRollos from "../Componentes/PanelAgrupacionRollos";
import { contarNotificaciones } from "../Utils/notificaciones";
import "../Style/Rollos.css";

function RollosPage({ sesion, onCerrarSesion, almacen }) {
  const r = useControladorRollos(sesion, almacen);

  const notificaciones = contarNotificaciones(almacen, sesion);

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="rollos-page">
          <h1 className="rollos-titulo">Rollos almacenados</h1>
          <p className="rollos-subtitulo">
            Materia prima (rollos de acero) de {sesion?.bodegaNombre}. Aunque varios rollos
            compartan el mismo código interno, cada uno mantiene sus propios metros, estado e
            historial — el sistema nunca los une ni suma sus metros automáticamente.
          </p>

          {/* ================== CARGA MASIVA DE ROLLOS EXISTENTES ================== */}
          <PanelCargaMasivaRollos
            abrirFormularioRollo={r.abrirFormularioRollo}
            reiniciarCargaRollos={r.reiniciarCargaRollos}
            pasoCargaRollos={r.pasoCargaRollos}
            procesandoArchivoCargaRollos={r.procesandoArchivoCargaRollos}
            cargarArchivoRollos={r.cargarArchivoRollos}
            errorArchivoCargaRollos={r.errorArchivoCargaRollos}
            nombreArchivoCargaRollos={r.nombreArchivoCargaRollos}
            hojasDisponiblesCargaRollos={r.hojasDisponiblesCargaRollos}
            hojaActualCargaRollos={r.hojaActualCargaRollos}
            cambiandoHojaCargaRollos={r.cambiandoHojaCargaRollos}
            cambiarHojaCargaRollos={r.cambiarHojaCargaRollos}
            mapeoColumnasCargaRollos={r.mapeoColumnasCargaRollos}
            actualizarMapeoColumnaRollos={r.actualizarMapeoColumnaRollos}
            encabezadosCargaRollos={r.encabezadosCargaRollos}
            faltanCamposRequeridosCargaRollos={r.faltanCamposRequeridosCargaRollos}
            errorConfirmacionCargaRollos={r.errorConfirmacionCargaRollos}
            confirmarCargaRollos={r.confirmarCargaRollos}
            confirmandoCargaRollos={r.confirmandoCargaRollos}
            resultadoCargaRollos={r.resultadoCargaRollos}
          />

          {/* ================== ACTIVOS / ROLLOS ACABADOS ================== */}
          <PanelToggleVistaRollos vista={r.vista} cambiarVista={r.cambiarVista} />

          {/* ================== FILTROS / BÚSQUEDA ================== */}
          <PanelFiltrosRollos
            filtros={r.filtros}
            actualizarFiltro={r.actualizarFiltro}
            familiasDisponibles={r.familiasDisponibles}
            coloresDisponibles={r.coloresDisponibles}
            vista={r.vista}
            ESTADOS_ROLLO={r.ESTADOS_ROLLO}
            limpiarFiltros={r.limpiarFiltros}
          />

          <Paginacion
            paginacion={r.paginacion}
            alCambiarPagina={r.setPagina}
            etiqueta="rollos"
          />

          {/* ================== AGRUPACIÓN VISUAL POR CÓDIGO ================== */}
          {r.errorEdicionRollo && (
            <p className="rollos-error" role="alert">
              {r.errorEdicionRollo}{" "}
              <button type="button" className="rollos-boton-secundario" onClick={r.limpiarErrorEdicionRollo}>Cerrar</button>
            </p>
          )}
          <PanelAgrupacionRollos
            gruposPorCodigo={r.gruposPorCodigo}
            ESTADOS_ROLLO={r.ESTADOS_ROLLO}
            actualizarFamiliaRollo={r.actualizarFamiliaRollo}
            actualizarAnchoRollo={r.actualizarAnchoRollo}
            actualizarEmpresaRollo={r.actualizarEmpresaRollo}
            abrirConsumo={r.abrirConsumo}
            abrirHistorial={r.abrirHistorial}
            abrirSalidaExterna={r.abrirSalidaExterna}
          />

          {/* ================== MODAL: INGRESO MANUAL DE ROLLO ================== */}
          {r.mostrarFormularioRollo && (
            <ModalIngresoRollo
              cerrarFormularioRollo={r.cerrarFormularioRollo}
              crearRollo={r.crearRollo}
              formularioRollo={r.formularioRollo}
              actualizarCodigoInternoRollo={r.actualizarCodigoInternoRollo}
              sugerirReferenciaRollo={r.sugerirReferenciaRollo}
              sugerirClasificacionRollo={r.sugerirClasificacionRollo}
              estadoClasificacionRollo={r.estadoClasificacionRollo}
              actualizarCampoRollo={r.actualizarCampoRollo}
              guardandoRollo={r.guardandoRollo}
              errorFormularioRollo={r.errorFormularioRollo}
            />
          )}

          {/* ================== MODAL: REGISTRAR CONSUMO ================== */}
          {r.rolloParaConsumo && (
            <ModalConsumoRollo
              rolloParaConsumo={r.rolloParaConsumo}
              cantidadConsumo={r.cantidadConsumo}
              setCantidadConsumo={r.setCantidadConsumo}
              observacionesConsumo={r.observacionesConsumo}
              setObservacionesConsumo={r.setObservacionesConsumo}
              errorConsumo={r.errorConsumo}
              guardandoConsumo={r.guardandoConsumo}
              cerrarConsumo={r.cerrarConsumo}
              registrarConsumo={r.registrarConsumo}
            />
          )}

          {/* ================== MODAL: HOJA DE VIDA DEL ROLLO ================== */}
          {r.rolloParaHistorial && (
            <ModalHistorialRollo
              rolloParaHistorial={r.rolloParaHistorial}
              cerrarHistorial={r.cerrarHistorial}
              ESTADOS_ROLLO={r.ESTADOS_ROLLO}
              cargandoHistorial={r.cargandoHistorial}
              errorHistorial={r.errorHistorial}
              historialRollo={r.historialRollo}
            />
          )}

          {/* ================== MODAL: SALIDA EXTERNA (INTERCAMBIO) ================== */}
          {r.rolloParaSalidaExterna && (
            <ModalSalidaExternaRollo
              rolloParaSalidaExterna={r.rolloParaSalidaExterna}
              empresaSalidaExterna={r.empresaSalidaExterna}
              setEmpresaSalidaExterna={r.setEmpresaSalidaExterna}
              observacionesSalidaExterna={r.observacionesSalidaExterna}
              setObservacionesSalidaExterna={r.setObservacionesSalidaExterna}
              errorSalidaExterna={r.errorSalidaExterna}
              guardandoSalidaExterna={r.guardandoSalidaExterna}
              cerrarSalidaExterna={r.cerrarSalidaExterna}
              registrarSalidaExterna={r.registrarSalidaExterna}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default RollosPage;
