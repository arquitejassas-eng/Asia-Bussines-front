import BarraLateral from "../Componentes/BarraLateral";
import { useUsuarios } from "../Hooks/useUsuarios";
import { contarNotificaciones } from "../Utils/notificaciones";
import "../Style/Inventario.css";
import "../Style/Bodegas.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

const ETIQUETAS_ROL: Record<string, string> = {
  superadmin: "SUPERADMIN",
  admin_inventario: "Admin Inventario",
  administrativo: "Administrativo",
  jefe_planta: "Jefe de Planta",
  vendedor: "Vendedor",
};

function UsuariosPage({ sesion, onCerrarSesion, almacen }: { sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal }) {
  const u = useUsuarios();
  const notificaciones = contarNotificaciones(almacen, sesion);
  const bodegasPorId = Object.fromEntries((almacen?.bodegas || []).map((b) => [b.id, b.nombre]));

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />
      <div className="layout-contenido">
        <div className="inventario-page">
          <div className="inventario-header">
            <h1 className="inventario-titulo">Administrar usuarios</h1>
            {!u.mostrarFormulario && (
              <button className="inventario-boton" onClick={u.abrirFormulario}>+ Nuevo usuario</button>
            )}
          </div>
          <p className="inventario-carga-ayuda">
            Crea y administra las cuentas de cualquier bodega: asigna rol, reasigna bodega, activa o
            desactiva el acceso, o restablece la contraseña de un usuario.
          </p>

          {u.errorUsuarios && <p className="inventario-error">{u.errorUsuarios}</p>}
          {u.errorAccion && <p className="inventario-error">{u.errorAccion}</p>}

          {u.mostrarFormulario && (
            <form className="inventario-form" onSubmit={u.crearUsuario} noValidate>
              <h2 className="inventario-form-subtitulo">Nuevo usuario</h2>
              <div className="inventario-form-grid">
                <div>
                  <label>Correo *</label>
                  <input
                    type="email"
                    value={u.formulario.correo}
                    onChange={(e) => u.actualizarCampo("correo", e.target.value)}
                  />
                </div>
                <div>
                  <label>Contraseña *</label>
                  <input
                    type="password"
                    value={u.formulario.contrasena}
                    onChange={(e) => u.actualizarCampo("contrasena", e.target.value)}
                  />
                </div>
                <div>
                  <label>Rol</label>
                  <select value={u.formulario.rol} onChange={(e) => u.actualizarCampo("rol", e.target.value)}>
                    <option value="administrativo">Administrativo</option>
                    <option value="jefe_planta">Jefe de Planta</option>
                    <option value="admin_inventario">Admin Inventario</option>
                    <option value="vendedor">Vendedor</option>
                    <option value="superadmin">SUPERADMIN</option>
                  </select>
                </div>
                <div>
                  <label>Bodega</label>
                  <select value={u.formulario.bodegaId} onChange={(e) => u.actualizarCampo("bodegaId", e.target.value)}>
                    <option value="">— Sin bodega fija —</option>
                    {(almacen?.bodegas || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>
              {u.errorFormulario && <p className="inventario-error">{u.errorFormulario}</p>}
              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={u.guardando}>
                  {u.guardando ? "Creando..." : "Crear usuario"}
                </button>
                <button type="button" className="inventario-boton-cancelar" onClick={u.cerrarFormulario}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {u.cargandoUsuarios ? (
            <p className="inventario-cargando">Cargando usuarios...</p>
          ) : (
            <div className="inventario-tabla-contenedor">
              <table className="inventario-tabla">
                <thead>
                  <tr>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Bodega</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {u.usuarios.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="inventario-vacio">No hay usuarios registrados.</td>
                    </tr>
                  ) : (
                    u.usuarios.map((usr) => (
                      <tr key={usr.id}>
                        <td>{usr.correo}{usr.correo === sesion?.correo ? " (tú)" : ""}</td>
                        <td>{ETIQUETAS_ROL[usr.rol] || usr.rol}</td>
                        <td>{usr.bodegaId == null ? "—" : bodegasPorId[usr.bodegaId] || usr.bodegaId}</td>
                        <td>{usr.activo ? "Activo" : "Desactivado"}</td>
                        <td className="inventario-acciones">
                          <button onClick={() => u.abrirEdicion(usr)}>Editar</button>
                          {usr.activo ? (
                            <button
                              className="inventario-boton-eliminar"
                              disabled={u.procesandoAccionId === usr.id}
                              onClick={() => u.desactivarUsuario(usr.id)}
                            >
                              {u.procesandoAccionId === usr.id ? "..." : "Desactivar"}
                            </button>
                          ) : (
                            <button disabled={u.procesandoAccionId === usr.id} onClick={() => u.activarUsuario(usr.id)}>
                              {u.procesandoAccionId === usr.id ? "..." : "Activar"}
                            </button>
                          )}
                          <button onClick={() => u.abrirRestablecer(usr)}>Restablecer contraseña</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ================== ADMINISTRAR BODEGAS ================== */}
          <div className="inventario-header" style={{ marginTop: "2.5rem" }}>
            <h2 className="inventario-titulo" style={{ fontSize: "1.3rem" }}>Administrar bodegas</h2>
            {!almacen.mostrarFormularioBodega && (
              <button className="inventario-boton" onClick={() => almacen.setMostrarFormularioBodega(true)}>
                + Nueva bodega
              </button>
            )}
          </div>
          <p className="inventario-carga-ayuda">
            Crea una nueva bodega/sede. Queda disponible de inmediato para asignar usuarios y para
            las transferencias entre bodegas.
          </p>

          {almacen.errorBodega && <p className="inventario-error">{almacen.errorBodega}</p>}

          {almacen.mostrarFormularioBodega && (
            <form className="inventario-form" onSubmit={almacen.crearBodega} noValidate>
              <div className="inventario-form-grid">
                <div>
                  <label>Nombre *</label>
                  <input
                    type="text"
                    value={almacen.nombreBodegaNueva}
                    onChange={(e) => almacen.setNombreBodegaNueva(e.target.value)}
                  />
                </div>
              </div>
              <div className="inventario-form-botones">
                <button type="submit" className="inventario-boton" disabled={almacen.guardandoBodega}>
                  {almacen.guardandoBodega ? "Creando..." : "Crear bodega"}
                </button>
                <button
                  type="button"
                  className="inventario-boton-cancelar"
                  onClick={() => { almacen.setMostrarFormularioBodega(false); almacen.setNombreBodegaNueva(""); }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <div className="inventario-tabla-contenedor">
            <table className="inventario-tabla">
              <thead>
                <tr>
                  <th>Bodega</th>
                </tr>
              </thead>
              <tbody>
                {almacen.bodegas.length === 0 ? (
                  <tr>
                    <td className="inventario-vacio">No hay bodegas registradas.</td>
                  </tr>
                ) : (
                  almacen.bodegas.map((b) => (
                    <tr key={b.id}>
                      <td>{b.nombre}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ================== MODAL: EDITAR ROL/BODEGA ================== */}
          {u.usuarioEditando && (
            <div className="bodegas-modal-fondo" onClick={u.cerrarEdicion}>
              <div className="bodegas-modal" onClick={(e) => e.stopPropagation()}>
                <h3>Editar {u.usuarioEditando.correo}</h3>
                <form onSubmit={u.guardarEdicion} noValidate>
                  <label>Rol</label>
                  <select value={u.formularioEdicion.rol} onChange={(e) => u.actualizarCampoEdicion("rol", e.target.value)}>
                    <option value="administrativo">Administrativo</option>
                    <option value="jefe_planta">Jefe de Planta</option>
                    <option value="admin_inventario">Admin Inventario</option>
                    <option value="vendedor">Vendedor</option>
                    <option value="superadmin">SUPERADMIN</option>
                  </select>
                  <label>Bodega</label>
                  <select value={u.formularioEdicion.bodegaId} onChange={(e) => u.actualizarCampoEdicion("bodegaId", e.target.value)}>
                    <option value="">— Sin bodega fija —</option>
                    {(almacen?.bodegas || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                  {u.errorEdicion && <p className="bodegas-error">{u.errorEdicion}</p>}
                  <div className="bodegas-modal-acciones">
                    <button type="button" className="bodegas-boton-secundario" onClick={u.cerrarEdicion}>
                      Cancelar
                    </button>
                    <button type="submit" className="bodegas-boton-primario" disabled={u.guardandoEdicion}>
                      {u.guardandoEdicion ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ================== MODAL: RESTABLECER CONTRASEÑA ================== */}
          {u.usuarioRestableciendo && (
            <div className="bodegas-modal-fondo" onClick={u.cerrarRestablecer}>
              <div className="bodegas-modal" onClick={(e) => e.stopPropagation()}>
                <h3>Restablecer contraseña de {u.usuarioRestableciendo.correo}</h3>
                <form onSubmit={u.confirmarRestablecer} noValidate>
                  <label>Nueva contraseña</label>
                  <input type="password" value={u.nuevaContrasena} onChange={(e) => u.setNuevaContrasena(e.target.value)} />
                  {u.errorRestablecer && <p className="bodegas-error">{u.errorRestablecer}</p>}
                  {u.exitoRestablecer && <p className="bodegas-exito">{u.exitoRestablecer}</p>}
                  <div className="bodegas-modal-acciones">
                    <button type="button" className="bodegas-boton-secundario" onClick={u.cerrarRestablecer}>
                      Cerrar
                    </button>
                    <button type="submit" className="bodegas-boton-primario" disabled={u.guardandoRestablecer}>
                      {u.guardandoRestablecer ? "Guardando..." : "Restablecer"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default UsuariosPage;
