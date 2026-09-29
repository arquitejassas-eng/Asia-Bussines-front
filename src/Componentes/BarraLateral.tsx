import { useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApartadosPorEnviarContexto } from "./AvisosApartados";
import "../Style/Barralateral.css";

type Sesion = { rol?: string; bodegaNombre?: string } | null | undefined;
type Props = { sesion: Sesion; onCerrarSesion: () => void; notificaciones?: number };

// `roles` debe reflejar exactamente los mismos arrays que protegen cada ruta
// en App.tsx (paginaProtegida) — si un rol no puede entrar a la página, tampoco
// debería ver el enlace en la barra lateral.
const MODULOS = [
  { clave: "inventario", etiqueta: "Inventario", ruta: "/inventario", disponible: true, roles: ["administrativo"] },
  { clave: "apartados", etiqueta: "Apartados", ruta: "/apartados", disponible: true, roles: ["administrativo", "jefe_planta", "admin_inventario"] },
  { clave: "recepcion", etiqueta: "Recepción y Verificación", ruta: "/recepcion", disponible: true, roles: ["administrativo", "admin_inventario"] },
  { clave: "bodegas", etiqueta: "Bodegas", ruta: "/bodegas", disponible: true, notificable: true, roles: ["administrativo"] },
  { clave: "rollos", etiqueta: "Rollos almacenados", ruta: "/rollos", disponible: true, roles: ["administrativo", "admin_inventario"] },
  { clave: "admin_inventario", etiqueta: "Inventario total", ruta: "/admin-inventario", disponible: true, roles: ["admin_inventario", "vendedor"] },
  { clave: "reportes", etiqueta: "Reportes", ruta: "/reportes", disponible: true, roles: ["administrativo"] },
  { clave: "ia", etiqueta: "Asistente de IA", ruta: "/ia", disponible: true, roles: ["administrativo", "admin_inventario"] },
  { clave: "produccion", etiqueta: "Registrar Producción", ruta: "/produccion", disponible: true, notificable: true, roles: ["jefe_planta"] },
  { clave: "hoja_vida", etiqueta: "Hoja de Vida", ruta: "/hoja-vida", disponible: true, roles: ["administrativo", "admin_inventario"] },
  { clave: "usuarios", etiqueta: "Administrar usuarios", ruta: "/usuarios", disponible: true, roles: ["superadmin"] },
];

export default function BarraLateral({ sesion, onCerrarSesion, notificaciones = 0 }: Props) {
  const location = useLocation();
  const apartadosPorEnviar = useContext(ApartadosPorEnviarContexto);
  const modulosVisibles = MODULOS.filter((modulo) => !modulo.roles || modulo.roles.includes(sesion?.rol ?? ""));

  return (
    <aside className="barra-lateral">
      <div className="barra-marca"><span className="barra-marca-icono">◆</span> Arquitejas</div>
      <p className="barra-bodega">{sesion?.bodegaNombre || "—"}</p>
      <nav className="barra-nav">
        {modulosVisibles.map((modulo) => modulo.disponible && (
          <div key={modulo.clave} className="barra-item-grupo">
            <Link to={modulo.ruta} className={`barra-item ${location.pathname === modulo.ruta ? "barra-item-activo" : ""}`}>
              <span>{modulo.etiqueta}</span>
              {modulo.notificable && notificaciones > 0 && <span className="barra-notificacion">{notificaciones}</span>}
              {modulo.clave === "apartados" && sesion?.rol === "administrativo" && apartadosPorEnviar > 0 && (
                <span className="barra-notificacion" title="Cotizaciones aprobadas por enviar a producción">{apartadosPorEnviar}</span>
              )}
            </Link>
            {modulo.clave === "inventario" && <p className="barra-item-nota">Productos · Movimientos · Historial</p>}
          </div>
        ))}
      </nav>
      <button type="button" className="barra-boton-salir" onClick={onCerrarSesion}>Cerrar sesión</button>
    </aside>
  );
}
