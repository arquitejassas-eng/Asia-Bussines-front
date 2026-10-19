import BarraLateral from "../Componentes/BarraLateral";
import PanelMermaRollo from "../Componentes/PanelMermaRollo";
import { contarNotificacionesBarraLateral } from "../Utils/notificaciones";
import "../Style/Inventario.css";
import "../Style/Produccion.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

/** Merma (Planta): terminar un rollo que se acabó (lo que le quedaba en el
 * sistema sale como merma) o sumarle el sobrante. Antes estaba debajo de
 * Registrar Producción y estorbaba; es la misma herramienta de Admin
 * Inventario, limitada a los rollos de la bodega de Planta. */
function MermaPlantaPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const notificaciones = contarNotificacionesBarraLateral(almacen, sesion);

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <h1 className="inventario-titulo">Merma</h1>
          <p className="inventario-carga-ayuda">
            Cuando se acabe un rollo, búscalo aquí por su referencia o sus kilos y dale salida a los metros de merma.
          </p>
          <PanelMermaRollo bodegas={almacen?.bodegas} />
        </div>
      </div>
    </div>
  );
}

export default MermaPlantaPage;
