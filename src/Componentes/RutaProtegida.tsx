import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import type { Sesion as SesionCompleta } from "../types/dominio";
type Sesion = Pick<SesionCompleta, "rol"> | null | undefined;

type Props = {
  sesion: Sesion;
  roles?: string[];
  rutaInicio: string;
  children: ReactNode;
};

/** Centraliza la protección de la navegación; la API mantiene la autorización. */
export default function RutaProtegida({ sesion, roles, rutaInicio, children }: Props) {
  if (!sesion) return <Navigate to="/" replace />;
  if (roles && !roles.includes(sesion.rol)) return <Navigate to={rutaInicio} replace />;
  return children;
}
