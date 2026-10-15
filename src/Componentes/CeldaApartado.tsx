/** Debajo del físico: cuánto está apartado y cuánto queda libre para vender
 * (solo si hay algo apartado). En rojo si lo apartado supera lo físico
 * (material apartado que viene en camino). Lo usan las tablas del resumen de
 * Inventario total (rollos y productos). */
export default function CeldaApartado({ reservado, libre, unidad }: { reservado?: number; libre?: number; unidad: string }) {
  if (!reservado) return null;
  return (
    <span className="rollos-texto-ayuda" style={{ margin: 0, display: "block" }}>
      Apartado: {reservado}{unidad}
      <br />
      <strong style={{ color: (libre ?? 0) < 0 ? "#b3261e" : undefined }}>Libre: {libre}{unidad}</strong>
    </span>
  );
}
