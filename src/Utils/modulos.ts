// Única lista de módulos y de qué roles entran a cada uno. La usan App.tsx
// (para proteger cada ruta) y BarraLateral.tsx (para mostrar el enlace): si un
// rol no puede entrar a la página, tampoco ve el enlace.
export const MODULOS = [
  { clave: "inventario", etiqueta: "Inventario", ruta: "/inventario", roles: ["administrativo"] },
  { clave: "apartados", etiqueta: "Apartados", ruta: "/apartados", roles: ["administrativo", "jefe_planta"] },
  { clave: "recepcion", etiqueta: "Recepción y Verificación", ruta: "/recepcion", roles: ["administrativo", "admin_inventario"] },
  { clave: "bodegas", etiqueta: "Bodegas", ruta: "/bodegas", notificable: true, roles: ["administrativo"] },
  { clave: "rollos", etiqueta: "Rollos almacenados", ruta: "/rollos", roles: ["administrativo", "admin_inventario"] },
  { clave: "admin_inventario", etiqueta: "Inventario total", ruta: "/admin-inventario", roles: ["admin_inventario", "vendedor"] },
  { clave: "reportes", etiqueta: "Reportes", ruta: "/reportes", roles: ["administrativo"] },
  { clave: "ia", etiqueta: "Asistente de IA", ruta: "/ia", roles: ["administrativo", "admin_inventario"] },
  { clave: "produccion", etiqueta: "Registrar Producción", ruta: "/produccion", notificable: true, roles: ["jefe_planta"] },
  { clave: "hoja_vida", etiqueta: "Hoja de Vida", ruta: "/hoja-vida", roles: ["administrativo", "admin_inventario"] },
  { clave: "usuarios", etiqueta: "Administrar usuarios", ruta: "/usuarios", roles: ["superadmin"] },
] as const satisfies readonly { clave: string; etiqueta: string; ruta: string; notificable?: boolean; roles: readonly string[] }[];

export type ClaveModulo = (typeof MODULOS)[number]["clave"];

export function rolesDelModulo(clave: ClaveModulo): string[] {
  return [...MODULOS.find((modulo) => modulo.clave === clave)!.roles];
}
