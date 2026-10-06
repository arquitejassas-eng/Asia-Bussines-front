// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useState } from "react";
import BarraLateral from "../Componentes/BarraLateral";
import { useControladorInventario } from "../Componentes/Inventario";
import CampanaAlertas from "../Componentes/CampanaAlertas";
import PanelHistorialInventario from "../Componentes/PanelHistorialInventario";
import PanelCargaMasivaProductos from "../Componentes/PanelCargaMasivaProductos";
import PanelProductosInventario from "../Componentes/PanelProductosInventario";
import PanelMovimientosInventario from "../Componentes/PanelMovimientosInventario";
import { contarNotificaciones } from "../Utils/notificaciones";
import "../Style/Inventario.css";

function InventarioPage({ sesion, onCerrarSesion, almacen }) {
  const [pestanaActiva, setPestanaActiva] = useState("productos"); // "productos" | "movimientos" | "historial" | "carga"
  const {
    // Productos
    productos,
    gruposPorFamilia,
    cargandoProductos,
    errorProductos,
    guardandoProducto,
    formularioProducto,
    editandoProductoId,
    mostrarFormularioProducto,
    actualizarCampoProducto,
    abrirFormularioNuevoProducto,
    abrirFormularioEdicionProducto,
    cerrarFormularioProducto,
    guardarProducto,
    eliminarProducto,
    busquedaProducto,
    cambiarBusquedaProducto,
    alertasStock,
    cargandoAlertasStock,

    // Movimientos
    bodegas,
    bodegaActual,
    cargandoOpcionesMov,
    formularioMov,
    errorMov,
    exitoMov,
    guardandoMov,
    actualizarCampoMov,
    cambiarTipoMov,
    prepararEntradaProducto,
    registrarMovimiento,
    MOTIVOS_ENTRADA,
    MOTIVOS_SALIDA,

    // Historial
    filasHistorial,
    cargandoHistorial,
    errorHistorial,
    filtros,
    actualizarFiltro,
    limpiarFiltros,
    cargarHistorial,
    setPaginaHistorial,
    paginacionHistorial,

    // Carga masiva de productos
    pasoCarga,
    nombreArchivoCarga,
    procesandoArchivoCarga,
    errorArchivoCarga,
    cargarArchivoProductos,
    encabezadosCarga,
    mapeoColumnasCarga,
    hojasDisponiblesCarga,
    hojaActualCarga,
    cambiandoHojaCarga,
    cambiarHojaCargaProductos,
    actualizarMapeoColumnaProductos,
    faltanCamposRequeridosCarga,
    confirmandoCarga,
    errorConfirmacionCarga,
    confirmarCargaProductos,
    resultadoCarga,
    reiniciarCargaProductos,
  } = useControladorInventario(sesion, almacen);

  // Mismo criterio que en Rollos, Bodegas, etc.: solicitudes y envíos
  // pendientes cuentan para el badge de la barra lateral en cualquier módulo.
  const notificaciones = contarNotificaciones(almacen, sesion);


  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.75rem" }}>
          <div className="inventario-pestanas" style={{ marginBottom: 0 }}>
        <button
          className={`inventario-pestana-boton ${
            pestanaActiva === "productos" ? "inventario-pestana-activa" : ""
          }`}
          onClick={() => setPestanaActiva("productos")}
        >
          Productos
        </button>
        <button
          className={`inventario-pestana-boton ${
            pestanaActiva === "movimientos" ? "inventario-pestana-activa" : ""
          }`}
          onClick={() => setPestanaActiva("movimientos")}
        >
          Movimientos
        </button>
        <button
          className={`inventario-pestana-boton ${
            pestanaActiva === "historial" ? "inventario-pestana-activa" : ""
          }`}
          onClick={() => setPestanaActiva("historial")}
        >
          Historial
        </button>
        <button
          className={`inventario-pestana-boton ${
            pestanaActiva === "carga" ? "inventario-pestana-activa" : ""
          }`}
          onClick={() => setPestanaActiva("carga")}
        >
          Carga masiva
        </button>
      </div>
          <CampanaAlertas
            alertas={alertasStock}
            cargando={cargandoAlertasStock}
            unidadPorFamilia={almacen?.unidadPorFamilia || {}}
          />
          </div>

      <datalist id="inventario-datalist-familias">
        {(almacen?.unidadesFamilia || []).map((u) => (
          <option key={u.familia} value={u.familia} />
        ))}
      </datalist>

      {/* ================== PESTAÑA: PRODUCTOS ================== */}
      {pestanaActiva === "productos" && (
        <PanelProductosInventario
          almacen={almacen}
          mostrarFormularioProducto={mostrarFormularioProducto}
          abrirFormularioNuevoProducto={abrirFormularioNuevoProducto}
          busquedaProducto={busquedaProducto}
          cambiarBusquedaProducto={cambiarBusquedaProducto}
          guardarProducto={guardarProducto}
          editandoProductoId={editandoProductoId}
          formularioProducto={formularioProducto}
          actualizarCampoProducto={actualizarCampoProducto}
          cerrarFormularioProducto={cerrarFormularioProducto}
          errorProductos={errorProductos}
          guardandoProducto={guardandoProducto}
          cargandoProductos={cargandoProductos}
          gruposPorFamilia={gruposPorFamilia}
          abrirFormularioEdicionProducto={abrirFormularioEdicionProducto}
          eliminarProducto={eliminarProducto}
          prepararEntradaProducto={prepararEntradaProducto}
          setPestanaActiva={setPestanaActiva}
        />
      )}

      {/* ================== PESTAÑA: MOVIMIENTOS ================== */}
      {pestanaActiva === "movimientos" && (
        <PanelMovimientosInventario
          almacen={almacen}
          productos={productos}
          formularioMov={formularioMov}
          actualizarCampoMov={actualizarCampoMov}
          bodegaActual={bodegaActual}
          bodegas={bodegas}
          cargandoOpcionesMov={cargandoOpcionesMov}
          cambiarTipoMov={cambiarTipoMov}
          registrarMovimiento={registrarMovimiento}
          MOTIVOS_ENTRADA={MOTIVOS_ENTRADA}
          MOTIVOS_SALIDA={MOTIVOS_SALIDA}
          errorMov={errorMov}
          exitoMov={exitoMov}
          guardandoMov={guardandoMov}
        />
      )}

      {/* ================== PESTAÑA: HISTORIAL ================== */}
      {pestanaActiva === "historial" && (
        <PanelHistorialInventario
          sesion={sesion}
          filtros={filtros}
          actualizarFiltro={actualizarFiltro}
          limpiarFiltros={limpiarFiltros}
          cargarHistorial={cargarHistorial}
          errorHistorial={errorHistorial}
          cargandoHistorial={cargandoHistorial}
          filasHistorial={filasHistorial}
          bodegas={bodegas}
          paginacionHistorial={paginacionHistorial}
          setPaginaHistorial={setPaginaHistorial}
        />
      )}

      {/* ================== PESTAÑA: CARGA MASIVA ================== */}
      {pestanaActiva === "carga" && (
        <PanelCargaMasivaProductos
          pasoCarga={pasoCarga}
          procesandoArchivoCarga={procesandoArchivoCarga}
          cargarArchivoProductos={cargarArchivoProductos}
          errorArchivoCarga={errorArchivoCarga}
          nombreArchivoCarga={nombreArchivoCarga}
          hojasDisponiblesCarga={hojasDisponiblesCarga}
          hojaActualCarga={hojaActualCarga}
          cambiandoHojaCarga={cambiandoHojaCarga}
          cambiarHojaCargaProductos={cambiarHojaCargaProductos}
          mapeoColumnasCarga={mapeoColumnasCarga}
          actualizarMapeoColumnaProductos={actualizarMapeoColumnaProductos}
          encabezadosCarga={encabezadosCarga}
          faltanCamposRequeridosCarga={faltanCamposRequeridosCarga}
          errorConfirmacionCarga={errorConfirmacionCarga}
          reiniciarCargaProductos={reiniciarCargaProductos}
          confirmarCargaProductos={confirmarCargaProductos}
          confirmandoCarga={confirmandoCarga}
          resultadoCarga={resultadoCarga}
          setPestanaActiva={setPestanaActiva}
        />
      )}
        </div>
      </div>
    </div>
  );
}

export default InventarioPage;
