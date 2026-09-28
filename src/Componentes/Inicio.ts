import { useState } from "react";
import { api, ErrorApi } from "./Api";
import { guardarToken } from "../Utils/auth";

// El login ahora pasa por el backend real. La contraseña ya no se valida
// en el navegador contra una lista fija: el servidor responde con el token
// y los datos de la sesión (bodega, rol) según lo que haya en MySQL.

type Sesion = { correo: string; bodegaId: number; bodegaNombre: string; rol: string };

export function useControladorInicio(onLogin: (sesion: Sesion) => void) {
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  function validarCampos() {
    if (!correo.trim()) return "El correo es obligatorio.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return "El correo no es válido.";
    if (!contrasena) return "La contraseña es obligatoria.";
    if (contrasena.length < 6) return "La contraseña debe tener al menos 6 caracteres.";
    return "";
  }

  async function iniciarSesion(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    const mensajeError = validarCampos();
    if (mensajeError) {
      setError(mensajeError);
      return;
    }

    setError("");
    setCargando(true);

    try {
      const respuesta = await api.post("/auth/login", { correo, contrasena });

      if (!respuesta) throw new Error("Respuesta vacía del servidor.");
      const datos = respuesta as { access_token: string; sesion: { correo: string; bodega_id: number; bodega_nombre: string; rol: string } };
      guardarToken(datos.access_token);

      onLogin?.({
        correo: datos.sesion.correo,
        bodegaId: datos.sesion.bodega_id,
        bodegaNombre: datos.sesion.bodega_nombre,
        rol: datos.sesion.rol,
      });
    } catch (err) {
      if (err instanceof ErrorApi && err.status === 401) {
        setError("Correo o contraseña incorrectos.");
      } else if (err instanceof ErrorApi && err.status === 429) {
        setError(err.message); // "Demasiados intentos fallidos. Espera N minuto(s)..."
      } else {
        setError("No se pudo iniciar sesión. Verifica tu conexión e intenta de nuevo.");
      }
    } finally {
      setCargando(false);
    }
  }

  return {
    correo,
    setCorreo,
    contrasena,
    setContrasena,
    error,
    cargando,
    iniciarSesion,
  };
}
