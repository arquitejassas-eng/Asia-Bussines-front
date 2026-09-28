import { lazy, Suspense, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAlmacenGlobal } from "./Componentes/AlmacenGlobal";
import { borrarToken } from "./Utils/auth";
import RutaProtegida from "./Componentes/RutaProtegida";
import ErrorDePantalla from "./Componentes/ErrorDePantalla";

// Cada módulo se descarga solo al abrir su ruta. Al crecer la aplicación, una
// pantalla nueva no penaliza el primer acceso de los demás usuarios.
const InicioPage = lazy(() => import("./Paginas/InicioPage"));
const InventarioPage = lazy(() => import("./Paginas/InventarioPage"));
const ApartadosPage = lazy(() => import("./Paginas/ApartadosPage"));
const RecepcionVerificacionPage = lazy(() => import("./Paginas/RecepcionverificacionPage"));
const BodegasPage = lazy(() => import("./Paginas/BodegasPage"));
const RollosPage = lazy(() => import("./Paginas/RollosPage"));
const AdminInventarioPage = lazy(() => import("./Paginas/AdminInventarioPage"));
const ProduccionPage = lazy(() => import("./Paginas/ProduccionPage"));
const HojaVidaPage = lazy(() => import("./Paginas/HojaVidaPage"));
const ReportesPage = lazy(() => import("./Paginas/ReportesPage"));
const IAPage = lazy(() => import("./Paginas/IAPage"));
const UsuariosPage = lazy(() => import("./Paginas/UsuariosPage"));

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
    <ErrorDePantalla key={pathname}>
    <Suspense fallback={<main aria-live="polite">Cargando módulo...</main>}>
      <Routes>
      <Route
        path="/"
        element={
          sesion ? (
            <Navigate to={rutaInicioPara(sesion)} replace />
          ) : (
            <InicioPage onLogin={setSesion} />
          )
        }
      />
      <Route
        path="/inventario"
        element={paginaProtegida(["administrativo"], InventarioPage)}
      />
      <Route
        path="/apartados"
        element={paginaProtegida(["administrativo", "jefe_planta"], ApartadosPage)}
      />
      <Route
        path="/recepcion"
        element={paginaProtegida(["administrativo", "admin_inventario"], RecepcionVerificacionPage)}
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
        path="/reportes"
        element={paginaProtegida(["administrativo"], ReportesPage)}
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
  );
}
