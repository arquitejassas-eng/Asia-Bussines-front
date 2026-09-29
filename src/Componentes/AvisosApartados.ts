import { createContext } from "react";

/** Cotizaciones aprobadas por Admin Inventario (apartados en estado
 * "apartado") que esperan a que la bodega las envíe a producción. Lo llena
 * App.tsx desde useAlmacenGlobal y BarraLateral lo muestra en "Apartados",
 * así la encargada se entera desde cualquier pantalla. */
export const ApartadosPorEnviarContexto = createContext(0);
