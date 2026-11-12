import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAlmacenGlobal } from "./Componentes/AlmacenGlobal";
import { EVENTO_SESION_EXPIRADA } from "./Componentes/Api";
import { borrarToken } from "./Utils/auth";
import RutaProtegida from "./Componentes/RutaProtegida";
import ErrorDePantalla from "./Componentes/ErrorDePantalla";
import { ApartadosPorEnviarContexto } from "./Componentes/AvisosApartados";
import { TrasladosRollosContexto } from "./Componentes/AvisosTrasladosRollos";
import { ProductosSinCodigoContexto } from "./Componentes/AvisosProductosSinCodigo";

// Cada módulo se descarga solo al abrir su ruta. Al crecer la aplicación, una
// pantalla nueva no penaliza el primer acceso de los demás usuarios.
// Después de subir una versión nueva, una pestaña que llevaba horas abierta
// pide los archivos de la versión vieja, que ya no existen, y la pantalla se
// quedaba congelada: entonces se recarga una vez para traer la nueva.
const CLAVE_RECARGA = "arquitejas_recarga_por_version";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pantalla<T extends { default: React.ComponentType<any> }>(importar: () => Promise<T>) {
  return lazy(() => importar().then((modulo) => {
    try { sessionStorage.removeItem(CLAVE_RECARGA); } catch { /* sin almacenamiento */ }
    return modulo;
  }).catch((error) => {
    let yaRecargo = false;
    try { yaRecargo = sessionStorage.getItem(CLAVE_RECARGA) === "1"; sessionStorage.setItem(CLAVE_RECARGA, "1"); } catch { /* sin almacenamiento */ }
    if (!yaRecargo) {
      window.location.reload();
      return new Promise<T>(() => {});
    }
    throw error;
  }));
}
const InicioPage = pantalla(() => import("./Paginas/InicioPage"));
const InventarioPage = pantalla(() => import("./Paginas/InventarioPage"));
const ApartadosPage = pantalla(() => import("./Paginas/ApartadosPage"));
const RecepcionVerificacionPage = pantalla(() => import("./Paginas/RecepcionverificacionPage"));
const BodegasPage = pantalla(() => import("./Paginas/BodegasPage"));
const RollosPage = pantalla(() => import("./Paginas/RollosPage"));
const AdminInventarioPage = pantalla(() => import("./Paginas/AdminInventarioPage"));
const ProduccionPage = pantalla(() => import("./Paginas/ProduccionPage"));
const HojaVidaPage = pantalla(() => import("./Paginas/HojaVidaPage"));
const ReportesPage = pantalla(() => import("./Paginas/ReportesPage"));
const IAPage = pantalla(() => import("./Paginas/IAPage"));
const UsuariosPage = pantalla(() => import("./Paginas/UsuariosPage"));
const MermaPage = pantalla(() => import("./Paginas/MermaPage"));
const MermaPlantaPage = pantalla(() => import("./Paginas/MermaPlantaPage"));
const PrestamosPage = pantalla(() => import("./Paginas/PrestamosPage"));

const CLAVE_SESION = "arquitejas_sesion";

type Sesion = { correo: string; bodegaId: number | null; bodegaNombre: string; rol: string };

function leerSesionGuardada(): Sesion | null {
  try {
    const guardada = sessionStorage.getItem(CLAVE_SESION);
    return guardada ? JSON.parse(guardada) as Sesion : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [sesion, setSesionState] = useState<Sesion | null>(leerSesionGuardada);

  function setSesion(nuevaSesion: Sesion | null) {
    setSesionState(nuevaSesion);
    if (nuevaSesion) {
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify(nuevaSesion));
    } else {
      sessionStorage.removeItem(CLAVE_SESION);
    }
  }

  const almacen = useAlmacenGlobal(sesion);
  const { pathname } = useLocation();

  function cerrarSesion() {
    borrarToken();
    setSesion(null);
  }

  // Sesión vencida (dura 8 h) o cuenta desactivada: el servidor rechaza el
  // token y Api.ts avisa con este evento. Se cierra la sesión y la pantalla
  // de inicio explica por qué, en vez de quedar congelada con datos viejos.
  const [avisoInicio, setAvisoInicio] = useState("");
  useEffect(() => {
    function alExpirar() {
      borrarToken();
      setSesionState(null);
      sessionStorage.removeItem(CLAVE_SESION);
      setAvisoInicio("Tu sesión se cerró porque venció (dura 8 horas) o tu cuenta fue desactivada. Vuelve a iniciar sesión.");
    }
    window.addEventListener(EVENTO_SESION_EXPIRADA, alExpirar);
    return () => window.removeEventListener(EVENTO_SESION_EXPIRADA, alExpirar);
  }, []);

  function iniciarSesion(nuevaSesion: Sesion) {
    setAvisoInicio("");
    setSesion(nuevaSesion);
  }

  function rutaInicioPara(s: Sesion | null) {
    if (!s) return "/";
    if (s.rol === "jefe_planta") return "/produccion";
    if (s.rol === "admin_inventario" || s.rol === "vendedor") return "/admin-inventario";
    if (s.rol === "superadmin") return "/usuarios";
    return "/inventario";
  }

  function paginaProtegida(roles: string[], Pagina: React.ElementType) {
    return (
      <RutaProtegida sesion={sesion} roles={roles} rutaInicio={rutaInicioPara(sesion)}>
        <Pagina sesion={sesion} onCerrarSesion={cerrarSesion} almacen={almacen} />
      </RutaProtegida>
    );
  }

  return (
    <ApartadosPorEnviarContexto.Provider value={almacen.apartadosPorEnviarCount}>
    <TrasladosRollosContexto.Provider value={almacen.trasladosRollos.length}>
    <ProductosSinCodigoContexto.Provider value={almacen.productosSinCodigo.length}>
    <ErrorDePantalla key={pathname}>
    <Suspense fallback={<main aria-live="polite">Cargando módulo...</main>}>
      <Routes>
      <Route
        path="/"
        element={
          sesion ? (
            <Navigate to={rutaInicioPara(sesion)} replace />
          ) : (
            <InicioPage onLogin={iniciarSesion} aviso={avisoInicio} />
          )
        }
      />
      <Route
        path="/inventario"
        element={paginaProtegida(["administrativo"], InventarioPage)}
      />
      <Route
        path="/apartados"
        element={paginaProtegida(["administrativo", "jefe_planta", "admin_inventario", "vendedor"], ApartadosPage)}
      />
      <Route
        path="/recepcion"
        element={paginaProtegida(["admin_inventario"], RecepcionVerificacionPage)}
      />
      <Route
        path="/bodegas"
        element={paginaProtegida(["administrativo"], BodegasPage)}
      />
      <Route
        path="/rollos"
        element={paginaProtegida(["administrativo", "admin_inventario"], RollosPage)}
      />
      <Route
        path="/admin-inventario"
        element={paginaProtegida(["admin_inventario", "vendedor"], AdminInventarioPage)}
      />
      <Route
        path="/merma"
        element={paginaProtegida(["admin_inventario"], MermaPage)}
      />
      <Route
        path="/prestamos"
        element={paginaProtegida(["admin_inventario"], PrestamosPage)}
      />
      <Route
        path="/merma-planta"
        element={paginaProtegida(["jefe_planta"], MermaPlantaPage)}
      />
      <Route
        path="/reportes"
        element={paginaProtegida(["administrativo", "superadmin", "admin_inventario"], ReportesPage)}
      />
      <Route
        path="/ia"
        element={paginaProtegida(["administrativo", "admin_inventario"], IAPage)}
      />
      <Route
        path="/produccion"
        element={paginaProtegida(["jefe_planta"], ProduccionPage)}
      />
      <Route
        path="/hoja-vida"
        element={paginaProtegida(["administrativo", "admin_inventario"], HojaVidaPage)}
      />
      <Route
        path="/usuarios"
        element={paginaProtegida(["superadmin"], UsuariosPage)}
      />
      <Route path="*" element={<Navigate to={rutaInicioPara(sesion)} replace />} />
      </Routes>
    </Suspense>
    </ErrorDePantalla>
    </ProductosSinCodigoContexto.Provider>
    </TrasladosRollosContexto.Provider>
    </ApartadosPorEnviarContexto.Provider>
  );
}
