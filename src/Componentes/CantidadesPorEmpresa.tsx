import { NOMBRE_CORTO_EMPRESA, siglasEnOrden } from "../Utils/empresas";

/** Lo de cada empresa en el encabezado de una tarjeta de productos (ej.
 * "186 Arquitejas · -48 Asia"): el mismo código existe en las dos empresas
 * y el total solo no dice de quién es. En rojo si una empresa está en negativo. */
export function TotalesEmpresaTarjeta({ totales }: { totales: Record<string, number> }) {
  const siglas = siglasEnOrden(Object.keys(totales));
  if (siglas.length === 0) return null;
  return (
    <>
      {siglas.map((sigla) => (
        <div key={sigla} className="inventario-grupo-cantidad">
          <span className="numero" style={{ color: totales[sigla] < 0 ? "#b3261e" : undefined }}>{totales[sigla]}</span>
          <span>{NOMBRE_CORTO_EMPRESA[sigla] ?? sigla}</span>
        </div>
      ))}
    </>
  );
}

/** Línea pequeña bajo un número: "AR 186 · ABG -21". Solo si hay más de una empresa. */
export function DetalleEmpresaCelda({ porEmpresa }: { porEmpresa?: Record<string, number> }) {
  const siglas = siglasEnOrden(Object.keys(porEmpresa || {}));
  if (!porEmpresa || siglas.length < 2) return null;
  return (
    <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block", whiteSpace: "nowrap" }}>
      {siglas.map((sigla, i) => (
        <span key={sigla}>
          {i > 0 && " · "}
          {sigla || "Sin emp."}{" "}
          <span style={{ color: porEmpresa[sigla] < 0 ? "#b3261e" : undefined }}>{porEmpresa[sigla]}</span>
        </span>
      ))}
    </span>
  );
}
