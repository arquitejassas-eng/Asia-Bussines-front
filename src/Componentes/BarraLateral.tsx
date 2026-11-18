import { useContext, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApartadosPorEnviarContexto } from "./AvisosApartados";
import { TrasladosRollosContexto } from "./AvisosTrasladosRollos";
import { ProductosSinCodigoContexto } from "./AvisosProductosSinCodigo";
import { PedirMaterialContexto } from "./AvisosPedirMaterial";
import "../Style/Barralateral.css";

type Sesion = { rol?: string; bodegaNombre?: string } | null | undefined;
type Props = { sesion: Sesion; onCerrarSesion: () => void; notificaciones?: number };

// `roles` debe reflejar exactamente los mismos arrays que protegen cada ruta
// en App.tsx (paginaProtegida) — si un rol no puede entrar a la página, tampoco
// debería ver el enlace en la barra lateral.
const MODULOS = [
  { clave: "inventario", etiqueta: "Inventario", ruta: "/inventario", disponible: true, roles: ["administrativo"] },
  { clave: "apartados", etiqueta: "Apartados", ruta: "/apartados", disponible: true, roles: ["administrativo", "jefe_planta", "admin_inventario", "vendedor"] },
  { clave: "recepcion", etiqueta: "Recepción y Verificación", ruta: "/recepcion", disponible: true, roles: ["admin_inventario"] },
  { clave: "bodegas", etiqueta: "Bodegas", ruta: "/bodegas", disponible: true, notificable: true, roles: ["administrativo"] },
  { clave: "rollos", etiqueta: "Rollos almacenados", ruta: "/rollos", disponible: true, roles: ["administrativo", "admin_inventario"] },
  { clave: "admin_inventario", etiqueta: "Inventario total", ruta: "/admin-inventario", disponible: true, roles: ["admin_inventario", "vendedor"] },
  { clave: "merma", etiqueta: "Merma", ruta: "/merma", disponible: true, roles: ["admin_inventario"] },
  { clave: "prestamos", etiqueta: "Préstamos entre empresas", ruta: "/prestamos", disponible: true, roles: ["admin_inventario"] },
  { clave: "reportes", etiqueta: "Reportes", ruta: "/reportes", disponible: true, roles: ["administrativo", "superadmin", "admin_inventario"] },
  { clave: "ia", etiqueta: "Asistente de IA", ruta: "/ia", disponible: true, roles: ["administrativo", "admin_inventario"] },
  { clave: "produccion", etiqueta: "Registrar Producción", ruta: "/produccion", disponible: true, notificable: true, roles: ["jefe_planta"] },
  { clave: "merma_planta", etiqueta: "Merma", ruta: "/merma-planta", disponible: true, roles: ["jefe_planta"] },
  { clave: "hoja_vida", etiqueta: "Hoja de Vida", ruta: "/hoja-vida", disponible: true, roles: ["administrativo", "admin_inventario"] },
  { clave: "usuarios", etiqueta: "Administrar usuarios", ruta: "/usuarios", disponible: true, roles: ["superadmin"] },
];

export default function BarraLateral({ sesion, onCerrarSesion, notificaciones = 0 }: Props) {
  const location = useLocation();
  const apartadosPorEnviar = useContext(ApartadosPorEnviarContexto);
  const trasladosRollos = useContext(TrasladosRollosContexto);
  const productosSinCodigo = useContext(ProductosSinCodigoContexto);
  const pedirMaterial = useContext(PedirMaterialContexto);
  const [verPedir, setVerPedir] = useState(false);
  // Solo la encargada de la bodega: cotizaciones a las que les falta material que nadie ha mandado.
  const cotizacionesPorPedir = sesion?.rol === "administrativo" ? pedirMaterial.filter((c) => c.porPedir) : [];
  const yaPedidas = sesion?.rol === "administrativo" ? pedirMaterial.filter((c) => !c.porPedir) : [];
  const formato = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
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
              {modulo.clave === "admin_inventario" && sesion?.rol === "admin_inventario" && trasladosRollos > 0 && (
                <span className="barra-notificacion" title="Rollos pedidos entre bodegas que todavía no llegan">{trasladosRollos}</span>
              )}
              {modulo.clave === "admin_inventario" && sesion?.rol === "admin_inventario" && productosSinCodigo > 0 && (
                <span className="barra-notificacion barra-notificacion-aviso" title="Productos de producción a los que les falta el código"
                  aria-label={`${productosSinCodigo} ${productosSinCodigo === 1 ? "producto" : "productos"} sin código`}>
                  {productosSinCodigo} sin código
                </span>
              )}
            </Link>
            {modulo.clave === "inventario" && <p className="barra-item-nota">Productos · Movimientos · Historial</p>}
          </div>
        ))}
      </nav>
      {(cotizacionesPorPedir.length > 0 || yaPedidas.length > 0) && (
        <div className="barra-pedir">
          <button type="button" className={`barra-pedir-boton ${cotizacionesPorPedir.length ? "" : "barra-pedir-boton-ok"}`}
            onClick={() => setVerPedir((v) => !v)} aria-expanded={verPedir}>
            {cotizacionesPorPedir.length
              ? <>⚠ Pide material: <strong>{cotizacionesPorPedir.length}</strong> cotizaci{cotizacionesPorPedir.length === 1 ? "ón" : "ones"}</>
              : <>⏳ Material pedido: {yaPedidas.length} cotizaci{yaPedidas.length === 1 ? "ón" : "ones"}</>}
          </button>
          {verPedir && (
            <div className="barra-pedir-panel" role="dialog" aria-label="Material por pedir">
              <div className="barra-pedir-cabeza">
                <strong>Material para sustentar cotizaciones</strong>
                <button type="button" onClick={() => setVerPedir(false)} aria-label="Cerrar">✕</button>
              </div>
              <p className="barra-pedir-ayuda">
                A estas cotizaciones les falta material en tu bodega y nadie lo ha mandado. Pídelo en
                <strong> Bodegas</strong> (Solicitar) a la bodega que lo tiene; escribe el número de la cotización al pedirlo.
              </p>
              {[...cotizacionesPorPedir, ...yaPedidas].map((c) => (
                <div key={c.id} className={`barra-pedir-cot ${c.porPedir ? "" : "barra-pedir-cot-ok"}`}>
                  <div><strong>{c.numeroCotizacion}</strong> · {c.cliente || "sin cliente"}</div>
                  <ul>
                    {c.lineas.map((l) => (
                      <li key={l.codigo + l.empresa}>
                        {l.porPedir > 0.005
                          ? <>Pide <strong>{formato(l.porPedir)}{l.unidad === "m" ? " m" : ""}</strong> de {l.codigo}</>
                          : <>Ya pediste {formato(l.yaPedido)}{l.unidad === "m" ? " m" : ""} de {l.codigo}: falta que la otra bodega lo despache</>}
                        <span>
                          {(() => { const donde = l.detalle.match(/\(([^)]*)\)/)?.[1]; return donde ? `Hay en ${donde.replace(/^hay en /, "")}` : "No hay en otra bodega"; })()}
                          {l.porPedir > 0.005 && l.yaPedido > 0 ? ` · ya pediste ${formato(l.yaPedido)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="barra-pedir-acciones">
                <Link to="/bodegas" onClick={() => setVerPedir(false)}>Ir a Bodegas a pedirlo</Link>
                <Link to="/apartados" onClick={() => setVerPedir(false)}>Ver en Apartados</Link>
              </div>
            </div>
          )}
        </div>
      )}
      <button type="button" className="barra-boton-salir" onClick={onCerrarSesion}>Cerrar sesión</button>
    </aside>
  );
}
