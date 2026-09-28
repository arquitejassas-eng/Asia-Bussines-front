import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import { usuarioDesdeApi } from "../Componentes/Mapeo";
import type { Usuario } from "../types/dominio";

const FORMULARIO_VACIO = { correo: "", contrasena: "", rol: "administrativo", bodegaId: "" };
// Mismo mínimo que LONGITUD_MINIMA_CONTRASENA en backend/app/schemas/usuario.py.
const LONGITUD_MINIMA_CONTRASENA = 8;

type FormularioUsuario = typeof FORMULARIO_VACIO;
type RegistroApi = Record<string, unknown>;

/** Administración de cuentas (crear, editar rol/bodega, activar/desactivar,
 * restablecer contraseña) — exclusivo de SUPERADMIN. */
export function useUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [errorUsuarios, setErrorUsuarios] = useState("");

  const cargarUsuarios = useCallback(async () => {
    setCargandoUsuarios(true);
    setErrorUsuarios("");
    try {
      const datos = await api.get<RegistroApi[]>("/usuarios");
      setUsuarios((datos || []).map(usuarioDesdeApi));
    } catch (err) {
      setErrorUsuarios(err instanceof ErrorApi ? err.message : "No se pudieron cargar los usuarios.");
      setUsuarios([]);
    } finally {
      setCargandoUsuarios(false);
    }
  }, []);

  useEffect(() => { cargarUsuarios(); }, [cargarUsuarios]);

  // ---------- Crear usuario ----------
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [formulario, setFormulario] = useState<FormularioUsuario>(FORMULARIO_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [errorFormulario, setErrorFormulario] = useState("");

  function abrirFormulario() {
    setFormulario(FORMULARIO_VACIO);
    setErrorFormulario("");
    setMostrarFormulario(true);
  }
  function cerrarFormulario() {
    setMostrarFormulario(false);
    setErrorFormulario("");
  }
  function actualizarCampo(campo: keyof FormularioUsuario, valor: string) {
    setFormulario((actual) => ({ ...actual, [campo]: valor }));
  }

  async function crearUsuario(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!formulario.correo.trim() || !formulario.contrasena.trim()) {
      setErrorFormulario("Correo y contraseña son obligatorios.");
      return;
    }
    if (formulario.contrasena.length < LONGITUD_MINIMA_CONTRASENA) {
      setErrorFormulario(`La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`);
      return;
    }
    setGuardando(true);
    setErrorFormulario("");
    try {
      await api.post("/usuarios", {
        correo: formulario.correo.trim(),
        contrasena: formulario.contrasena,
        rol: formulario.rol,
        bodega_id: formulario.bodegaId ? Number(formulario.bodegaId) : null,
      });
      await cargarUsuarios();
      setMostrarFormulario(false);
    } catch (err) {
      setErrorFormulario(err instanceof ErrorApi ? err.message : "No se pudo crear el usuario.");
    } finally {
      setGuardando(false);
    }
  }

  // ---------- Editar rol/bodega ----------
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | null>(null);
  const [formularioEdicion, setFormularioEdicion] = useState({ rol: "", bodegaId: "" });
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState("");

  function abrirEdicion(usuario: Usuario) {
    setUsuarioEditando(usuario);
    setFormularioEdicion({ rol: usuario.rol, bodegaId: usuario.bodegaId == null ? "" : String(usuario.bodegaId) });
    setErrorEdicion("");
  }
  function cerrarEdicion() {
    setUsuarioEditando(null);
    setErrorEdicion("");
  }
  function actualizarCampoEdicion(campo: "rol" | "bodegaId", valor: string) {
    setFormularioEdicion((actual) => ({ ...actual, [campo]: valor }));
  }

  async function guardarEdicion(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!usuarioEditando) return;
    setGuardandoEdicion(true);
    setErrorEdicion("");
    try {
      await api.patch(`/usuarios/${usuarioEditando.id}`, {
        rol: formularioEdicion.rol,
        bodega_id: formularioEdicion.bodegaId ? Number(formularioEdicion.bodegaId) : null,
      });
      await cargarUsuarios();
      setUsuarioEditando(null);
    } catch (err) {
      setErrorEdicion(err instanceof ErrorApi ? err.message : "No se pudo guardar el cambio.");
    } finally {
      setGuardandoEdicion(false);
    }
  }

  // ---------- Activar / desactivar ----------
  const [procesandoAccionId, setProcesandoAccionId] = useState<number | null>(null);
  const [errorAccion, setErrorAccion] = useState("");

  async function activarUsuario(id: number) {
    setProcesandoAccionId(id);
    setErrorAccion("");
    try {
      await api.patch(`/usuarios/${id}/activar`);
      await cargarUsuarios();
    } catch (err) {
      setErrorAccion(err instanceof ErrorApi ? err.message : "No se pudo activar el usuario.");
    } finally {
      setProcesandoAccionId(null);
    }
  }

  async function desactivarUsuario(id: number) {
    setProcesandoAccionId(id);
    setErrorAccion("");
    try {
      await api.patch(`/usuarios/${id}/desactivar`);
      await cargarUsuarios();
    } catch (err) {
      setErrorAccion(err instanceof ErrorApi ? err.message : "No se pudo desactivar el usuario.");
    } finally {
      setProcesandoAccionId(null);
    }
  }

  // ---------- Restablecer contraseña ----------
  const [usuarioRestableciendo, setUsuarioRestableciendo] = useState<Usuario | null>(null);
  const [nuevaContrasena, setNuevaContrasena] = useState("");
  const [guardandoRestablecer, setGuardandoRestablecer] = useState(false);
  const [errorRestablecer, setErrorRestablecer] = useState("");
  const [exitoRestablecer, setExitoRestablecer] = useState("");

  function abrirRestablecer(usuario: Usuario) {
    setUsuarioRestableciendo(usuario);
    setNuevaContrasena("");
    setErrorRestablecer("");
    setExitoRestablecer("");
  }
  function cerrarRestablecer() {
    setUsuarioRestableciendo(null);
  }

  async function confirmarRestablecer(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!usuarioRestableciendo || !nuevaContrasena.trim()) {
      setErrorRestablecer("Escribe la nueva contraseña.");
      return;
    }
    if (nuevaContrasena.length < LONGITUD_MINIMA_CONTRASENA) {
      setErrorRestablecer(`La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`);
      return;
    }
    setGuardandoRestablecer(true);
    setErrorRestablecer("");
    try {
      await api.patch(`/usuarios/${usuarioRestableciendo.id}/restablecer-contrasena`, {
        contrasena_nueva: nuevaContrasena,
      });
      setExitoRestablecer("Contraseña actualizada.");
    } catch (err) {
      setErrorRestablecer(err instanceof ErrorApi ? err.message : "No se pudo restablecer la contraseña.");
    } finally {
      setGuardandoRestablecer(false);
    }
  }

  return {
    usuarios, cargandoUsuarios, errorUsuarios, cargarUsuarios,

    mostrarFormulario, formulario, guardando, errorFormulario,
    abrirFormulario, cerrarFormulario, actualizarCampo, crearUsuario,

    usuarioEditando, formularioEdicion, guardandoEdicion, errorEdicion,
    abrirEdicion, cerrarEdicion, actualizarCampoEdicion, guardarEdicion,

    procesandoAccionId, errorAccion, activarUsuario, desactivarUsuario,

    usuarioRestableciendo, nuevaContrasena, setNuevaContrasena, guardandoRestablecer, errorRestablecer, exitoRestablecer,
    abrirRestablecer, cerrarRestablecer, confirmarRestablecer,
  };
}
