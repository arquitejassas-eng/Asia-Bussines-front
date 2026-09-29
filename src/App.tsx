import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAlmacenGlobal } from "./Componentes/AlmacenGlobal";
import { EVENTO_SESION_EXPIRADA } from "./Componentes/Api";
import { borrarToken } from "./Utils/auth";
import RutaProtegida from "./Componentes/RutaProtegida";
import ErrorDePantalla from "./Componentes/ErrorDePantalla";
import { rolesDelModulo } from "./Utils/modulos";
import type { Sesion } from "./types/dominio";

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
        element={paginaProtegida(rolesDelModulo("inventario"), InventarioPage)}
      />
      <Route
        path="/apartados"
        element={paginaProtegida(rolesDelModulo("apartados"), ApartadosPage)}
      />
      <Route
        path="/recepcion"
        element={paginaProtegida(rolesDelModulo("recepcion"), RecepcionVerificacionPage)}
      />
      <Route
        path="/bodegas"
        element={paginaProtegida(rolesDelModulo("bodegas"), BodegasPage)}
      />
      <Route
        path="/rollos"
        element={paginaProtegida(rolesDelModulo("rollos"), RollosPage)}
      />
      <Route
        path="/admin-inventario"
        element={paginaProtegida(rolesDelModulo("admin_inventario"), AdminInventarioPage)}
      />
      <Route
        path="/reportes"
        element={paginaProtegida(rolesDelModulo("reportes"), ReportesPage)}
      />
      <Route
        path="/ia"
        element={paginaProtegida(rolesDelModulo("ia"), IAPage)}
      />
      <Route
        path="/produccion"
        element={paginaProtegida(rolesDelModulo("produccion"), ProduccionPage)}
      />
      <Route
        path="/hoja-vida"
        element={paginaProtegida(rolesDelModulo("hoja_vida"), HojaVidaPage)}
      />
      <Route
        path="/usuarios"
        element={paginaProtegida(rolesDelModulo("usuarios"), UsuariosPage)}
      />
      <Route path="*" element={<Navigate to={rutaInicioPara(sesion)} replace />} />
      </Routes>
    </Suspense>
    </ErrorDePantalla>
  );
}
