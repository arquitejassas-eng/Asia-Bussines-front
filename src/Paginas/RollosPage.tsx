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
import ModalCorregirRollo from "../Componentes/ModalCorregirRollo";
import { useState } from "react";
import { cerrarImpresion, imprimirRollosAlmacenados, ventanaParaImprimirEnLaPagina } from "../Utils/imprimirTraslados";
import { textoKilos } from "../Utils/kilos";
import { formatearFechaColombia } from "../Utils/fechas";
import { EMPRESAS } from "../Utils/empresas";
import { contarNotificaciones } from "../Utils/notificaciones";
import "../Style/Rollos.css";

function RollosPage({ sesion, onCerrarSesion, almacen }) {
  const r = useControladorRollos(sesion, almacen);
  const esAdminInventario = sesion?.rol === "admin_inventario";
  const [rolloACorregir, setRolloACorregir] = useState(null);
  const [avisoCorreccion, setAvisoCorreccion] = useState("");

  const notificaciones = contarNotificaciones(almacen, sesion);

  // Imprimir: TODOS los rollos que cumplen los filtros (no solo la página en pantalla).
  const [imprimiendo, setImprimiendo] = useState(false);
  const [errorImpresion, setErrorImpresion] = useState("");
  async function imprimirRollos() {
    if (imprimiendo) return;
    setImprimiendo(true);
    setErrorImpresion("");
    const ventana = ventanaParaImprimirEnLaPagina();
    try {
      const rollos = await r.traerTodosLosRollos();
      const bodegas = Object.fromEntries((almacen?.bodegas || []).map((b) => [b.id, b.nombre]));
      const estados = r.ESTADOS_ROLLO || {};
      const f = r.filtros || {};
      const filtro = [
        r.vista === "acabados" ? "Rollos acabados" : "Rollos activos",
        f.codigoInterno && `código ${f.codigoInterno}`, f.identificadorRollo && `referencia ${f.identificadorRollo}`,
        f.familia && f.familia, f.colorMaterial && f.colorMaterial, f.calibre && `calibre ${f.calibre}`,
        f.empresa && (EMPRESAS[f.empresa] || f.empresa), f.estado && r.vista !== "acabados" && (estados[f.estado] || f.estado),
        f.descripcion && `"${f.descripcion}"`, f.kilos && `${f.kilos} kg`,
      ].filter(Boolean).join(" · ");
      if (!ventana) throw new Error("No se pudo preparar la hoja para imprimir.");
      imprimirRollosAlmacenados(ventana, rollos.map((rollo) => ({
        codigoInterno: rollo.codigoInterno, identificadorRollo: rollo.identificadorRollo,
        empresa: EMPRESAS[rollo.empresa] || rollo.empresa, bodega: bodegas[rollo.bodegaId] || "",
        colorMaterial: rollo.colorMaterial, calibre: String(rollo.calibre || "—").replace(".", ","),
        pesoNeto: textoKilos(rollo.pesoNeto), pesoActual: textoKilos(rollo.pesoActualToneladas, true),
        metrosDisponibles: rollo.metrosDisponibles, estado: estados[rollo.estado] || rollo.estado,
        ingreso: rollo.fechaIngreso ? formatearFechaColombia(rollo.fechaIngreso, false) : "",
      })), filtro, formatearFechaColombia(new Date(), false));
    } catch (err) {
      cerrarImpresion(ventana);
      setErrorImpresion(err?.message || "No se pudieron traer los rollos para imprimir. Intenta otra vez.");
    } finally {
      setImprimiendo(false);
    }
  }

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="rollos-page">
          <h1 className="rollos-titulo">Rollos almacenados</h1>
          <div className="pagina-ayuda rollos-ayuda">
            <p>
              Los rollos de {sesion?.bodegaNombre || "la bodega"}. Cada rollo lleva sus propios metros e historial, aunque
              tenga el mismo código que otro.
            </p>
            <ul>
              <li><strong>Cargar rollos existentes desde Excel:</strong> subir de una vez los rollos que ya están en la bodega.</li>
              <li><strong>Ingresar rollo manualmente:</strong> registrar un rollo suelto.</li>
              <li><strong>Material nuevo del proveedor:</strong> entra por Recepción y Verificación, no por aquí.</li>
            </ul>
          </div>

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

          <div className="rollos-imprimir">
            <button type="button" className="rollos-boton-secundario" disabled={imprimiendo} onClick={imprimirRollos}
              title="Imprime todos los rollos que cumplen los filtros de arriba, no solo esta página">
              {imprimiendo ? "Preparando..." : `Imprimir rollos${r.paginacion?.total ? ` (${r.paginacion.total})` : ""}`}
            </button>
            {errorImpresion && <span className="rollos-error" role="alert">{errorImpresion}</span>}
          </div>

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
            abrirCorregir={esAdminInventario ? (rollo) => { setAvisoCorreccion(""); setRolloACorregir(rollo); } : null}
          />
          {avisoCorreccion && <p className="sincodigo-listo" role="status" onClick={() => setAvisoCorreccion("")}>{avisoCorreccion}</p>}
          {rolloACorregir && (
            <ModalCorregirRollo rollo={rolloACorregir} alCerrar={() => setRolloACorregir(null)}
              alGuardar={(mensaje) => { setRolloACorregir(null); setAvisoCorreccion(mensaje); void r.cargarRollos(); }} />
          )}

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
