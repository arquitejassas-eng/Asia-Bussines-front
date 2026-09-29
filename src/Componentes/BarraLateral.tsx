import { Link, useLocation } from "react-router-dom";
import "../Style/Barralateral.css";
import { MODULOS } from "../Utils/modulos";
import type { Sesion as SesionCompleta } from "../types/dominio";
type Sesion = Partial<SesionCompleta> | null | undefined;
type Props = { sesion: Sesion; onCerrarSesion: () => void; notificaciones?: number };

export default function BarraLateral({ sesion, onCerrarSesion, notificaciones = 0 }: Props) {
  const location = useLocation();
  const modulosVisibles = MODULOS.filter((modulo) => (modulo.roles as readonly string[]).includes(sesion?.rol ?? ""));

  return (
    <aside className="barra-lateral">
      <div className="barra-marca"><span className="barra-marca-icono">◆</span> Arquitejas</div>
      <p className="barra-bodega">{sesion?.bodegaNombre || "—"}</p>
      <nav className="barra-nav">
        {modulosVisibles.map((modulo) => (
          <div key={modulo.clave} className="barra-item-grupo">
            <Link to={modulo.ruta} className={`barra-item ${location.pathname === modulo.ruta ? "barra-item-activo" : ""}`}>
              <span>{modulo.etiqueta}</span>
              {"notificable" in modulo && modulo.notificable && notificaciones > 0 && <span className="barra-notificacion">{notificaciones}</span>}
            </Link>
            {modulo.clave === "inventario" && <p className="barra-item-nota">Productos · Movimientos · Historial</p>}
          </div>
        ))}
      </nav>
      <button type="button" className="barra-boton-salir" onClick={onCerrarSesion}>Cerrar sesión</button>
    </aside>
  );
}
