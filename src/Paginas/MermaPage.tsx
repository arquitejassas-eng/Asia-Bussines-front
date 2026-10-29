import BarraLateral from "../Componentes/BarraLateral";
import { useControladorMerma } from "../Componentes/Merma";
import PanelMermaRollo from "../Componentes/PanelMermaRollo";
import PanelRollosMerma from "../Componentes/PanelRollosMerma";
import ModalHistorialRollo from "../Componentes/ModalHistorialRollo";
import { ESTADOS_ROLLO } from "../Componentes/Rollos";
import { FILTRO_SIN_EMPRESA, nombreEmpresa } from "../Utils/empresas";
import "../Style/Inventario.css";
import "../Style/Rollos.css";
import "../Style/Merma.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

/** Merma (Admin Inventario): rollos que ya se acabaron, de todas las bodegas,
 * con la merma que dejaron, agrupados por código como en Rollos almacenados.
 * Arriba, la misma herramienta de Inventario total para terminar un rollo o
 * registrar un sobrante. */
function MermaPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const m = useControladorMerma(almacen);

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} />

      <div className="layout-contenido">
        <div className="inventario-page">
          <h1 className="inventario-titulo">Merma</h1>
          <p className="inventario-carga-ayuda">
            Rollos que ya se acabaron, de todas las bodegas, con la merma que dejaron (los metros que el sistema todavía
            les daba y ya no existían) y los metros de más cuando rindieron más de lo registrado. Agrupados por código,
            igual que en Rollos almacenados.
          </p>

          {/* ================== TERMINAR ROLLO / SOBRANTE ================== */}
          <PanelMermaRollo bodegas={almacen.bodegas} alCambiar={m.cargar} />

          {/* ================== TOTALES ================== */}
          <div className="merma-totales">
            <div>
              <span className="numero">{m.totales.rollos}</span>
              <span>rollo{m.totales.rollos === 1 ? "" : "s"} finalizado{m.totales.rollos === 1 ? "" : "s"}</span>
            </div>
            <div><span className="numero">{m.totales.merma.toLocaleString("es-CO")} m</span><span>de merma</span></div>
            {m.totales.sobrante > 0 && (
              <div><span className="numero">{m.totales.sobrante.toLocaleString("es-CO")} m</span><span>de más</span></div>
            )}
          </div>

          {/* ================== FILTROS ================== */}
          {/* Cada filtro aparece solo si hay algo que separar con él. */}
          <div className="apartados-filtros">
            {m.opcionesFiltro.hayVarios && (
              <div className="inventario-buscador apartados-buscador">
                <input type="text" aria-label="Buscar rollos" placeholder="Buscar: código, referencia, color o kilos"
                  value={m.busqueda} onChange={(e) => m.setBusqueda(e.target.value)} />
              </div>
            )}
            {m.opcionesFiltro.empresas.length > 1 && (
              <select className={`apartados-select ${m.empresa ? "apartados-select-activo" : ""}`} aria-label="Empresa"
                value={m.empresa} onChange={(e) => m.setEmpresa(e.target.value)}>
                <option value="">Todas las empresas</option>
                {m.opcionesFiltro.empresas.map((sigla) => (
                  <option key={sigla} value={sigla}>{sigla === FILTRO_SIN_EMPRESA ? "Sin empresa" : nombreEmpresa(sigla)}</option>
                ))}
              </select>
            )}
            {m.opcionesFiltro.bodegas.length > 1 && (
              <select className={`apartados-select ${m.bodega ? "apartados-select-activo" : ""}`} aria-label="Bodega"
                value={m.bodega} onChange={(e) => m.setBodega(e.target.value)}>
                <option value="">Todas las bodegas</option>
                {m.opcionesFiltro.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            )}
            {m.opcionesFiltro.haySinMerma && (
              <select className={`apartados-select ${!m.soloConMerma ? "apartados-select-activo" : ""}`} aria-label="Qué rollos"
                value={m.soloConMerma ? "merma" : "todos"} onChange={(e) => m.setSoloConMerma(e.target.value === "merma")}>
                <option value="merma">Solo con merma o metros de más</option>
                <option value="todos">Todos los finalizados</option>
              </select>
            )}
            {/* Reporte por fechas: el día en que se anotó la merma del rollo. */}
            <label className="merma-fecha">
              <span>Desde</span>
              <input type="date" value={m.desde} max={m.hasta || undefined} onChange={(e) => m.setDesde(e.target.value)} />
            </label>
            <label className="merma-fecha">
              <span>Hasta</span>
              <input type="date" value={m.hasta} min={m.desde || undefined} onChange={(e) => m.setHasta(e.target.value)} />
            </label>
            {m.hayFiltros && <button type="button" className="apartados-limpiar" onClick={m.limpiarFiltros}>Limpiar filtros</button>}
            {m.grupos.length > 0 && <button type="button" className="apartados-limpiar" onClick={m.exportar}>Exportar a Excel</button>}
          </div>

          {/* ================== ROLLOS FINALIZADOS POR CÓDIGO ================== */}
          {m.error && <p className="inventario-error">{m.error}</p>}
          {m.cargando
            ? <p className="inventario-cargando">Cargando rollos finalizados...</p>
            : <PanelRollosMerma grupos={m.grupos} nombreBodega={m.nombreBodega} abrirHistorial={m.abrirHistorial} />}

          {/* ================== MODAL: HOJA DE VIDA DEL ROLLO ================== */}
          {m.rolloParaHistorial && (
            <ModalHistorialRollo
              rolloParaHistorial={m.rolloParaHistorial}
              cerrarHistorial={m.cerrarHistorial}
              ESTADOS_ROLLO={ESTADOS_ROLLO}
              cargandoHistorial={m.cargandoHistorial}
              errorHistorial={m.errorHistorial}
              historialRollo={m.historialRollo}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default MermaPage;
