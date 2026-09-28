import { obtenerToken } from "../Utils/auth";

const URL_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Se dispara cuando el servidor rechaza el token (sesión de 8 h vencida o
// cuenta desactivada). App.tsx lo escucha y cierra la sesión con un aviso:
// antes la pantalla se quedaba congelada con datos viejos sin explicar nada.
export const EVENTO_SESION_EXPIRADA = "arquitejas:sesion-expirada";

type OpcionesPeticion = {
  metodo?: string;
  cuerpo?: unknown;
  encabezados?: HeadersInit;
};

export class ErrorApi extends Error {
  status: number;

  constructor(mensaje: string, status: number) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
  }
}

async function peticion<T = unknown>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T | null> {
  const token = obtenerToken();
  const esFormulario = opciones.cuerpo instanceof FormData;
  const encabezados = new Headers(opciones.encabezados);
  encabezados.set("Content-Type", "application/json");
  if (token) encabezados.set("Authorization", `Bearer ${token}`);
  if (esFormulario) encabezados.delete("Content-Type");

  const respuesta = await fetch(`${URL_BASE}${ruta}`, {
    method: opciones.metodo || "GET",
    headers: encabezados,
    body: esFormulario ? opciones.cuerpo as FormData : opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
  });
  if (respuesta.status === 204) return null;

  const esJson = respuesta.headers.get("content-type")?.includes("application/json");
  const datos: unknown = esJson ? await respuesta.json().catch(() => null) : await respuesta.text();
  if (!respuesta.ok) {
    // En el login un 401 solo significa "contraseña incorrecta".
    if (respuesta.status === 401 && token && !ruta.startsWith("/auth/")) {
      window.dispatchEvent(new Event(EVENTO_SESION_EXPIRADA));
    }
    const detalle = datos && typeof datos === "object" && ("detail" in datos || "message" in datos)
      ? (datos as { detail?: unknown; message?: unknown }).detail ?? (datos as { message?: unknown }).message
      : datos;
    const mensaje = Array.isArray(detalle)
      ? detalle.map((item) => typeof item === "object" && item ? (item as { msg?: string }).msg || "Error" : "Error").join(", ")
      : typeof detalle === "string" && detalle ? detalle : "Ocurrió un error inesperado. Intenta de nuevo.";
    throw new ErrorApi(mensaje, respuesta.status);
  }
  return datos as T;
}

export const api = {
  get: <T = unknown>(ruta: string) => peticion<T>(ruta),
  post: <T = unknown>(ruta: string, cuerpo?: unknown) => peticion<T>(ruta, { metodo: "POST", cuerpo }),
  put: <T = unknown>(ruta: string, cuerpo?: unknown) => peticion<T>(ruta, { metodo: "PUT", cuerpo }),
  patch: <T = unknown>(ruta: string, cuerpo?: unknown) => peticion<T>(ruta, { metodo: "PATCH", cuerpo }),
  delete: <T = unknown>(ruta: string) => peticion<T>(ruta, { metodo: "DELETE" }),
  subirArchivo: <T = unknown>(ruta: string, formData: FormData) => peticion<T>(ruta, { metodo: "POST", cuerpo: formData }),
};
