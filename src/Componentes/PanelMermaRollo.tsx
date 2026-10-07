import { useState } from "react";
import { api, ErrorApi } from "./Api";
import ModalConfirmacion from "./ModalConfirmacion";
import { rolloDesdeApi } from "./Mapeo";
import { nombreEmpresa } from "../Utils/empresas";
import "../Style/Produccion.css";

type Rollo = ReturnType<typeof rolloDesdeApi>;
type Bodega = { id: number; nombre: string };

const ESTADOS: Record<string, string> = { cerrado: "Cerrado", abierto: "Abierto", agotado: "Agotado" };

/** Merma y sobrante de un rollo, con la referencia de la hoja de vida.
 * "Terminar rollo": lo que le queda en el sistema sale como merma y queda
 * agotado. "Sobrante": el rollo rindió más de lo registrado y se le suman
 * esos metros. Lo usan Planta y Admin Inventario (ver backend merma_rollo). */
export default function PanelMermaRollo({ bodegas = [], alCambiar }: { bodegas?: Bodega[]; alCambiar?: () => void }) {
  const [referencia, setReferencia] = useState("");
  const [rollo, setRollo] = useState<Rollo | null>(null);
  const [metrosSobrante, setMetrosSobrante] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [confirmacion, setConfirmacion] = useState<{ titulo: string; mensaje: string; textoConfirmar: string; ejecutar: () => void } | null>(null);

  async function buscar(evento?: { preventDefault: () => void }) {
    evento?.preventDefault();
    if (!referencia.trim()) return;
    setCargando(true); setError(""); setAviso(""); setRollo(null);
    try {
      const datos = await api.get<Record<string, unknown>>(`/rollos/por-referencia?referencia=${encodeURIComponent(referencia.trim())}`);
      if (datos) setRollo(rolloDesdeApi(datos));
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo buscar el rollo.");
    } finally {
      setCargando(false);
    }
  }

  async function ejecutar(ruta: string, cuerpo: unknown, mensaje: (r: Rollo) => string) {
    if (!rollo) return;
    setCargando(true); setError(""); setAviso("");
    try {
      const datos = await api.post<Record<string, unknown>>(`/rollos/${rollo.id}/${ruta}`, cuerpo);
      if (datos) {
        const actualizado = rolloDesdeApi(datos);
        setRollo(actualizado);
        setAviso(mensaje(actualizado));
      }
      setMetrosSobrante(""); setObservaciones("");
      alCambiar?.();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo registrar.");
    } finally {
      setCargando(false);
    }
  }

  const bodega = rollo ? bodegas.find((b) => b.id === rollo.bodegaId)?.nombre || "" : "";

  return (
    <section className="produccion-tarjeta">
      <h2>Merma / sobrante de rollo</h2>
      <p className="produccion-vacio" style={{ marginBottom: "0.75rem" }}>
        Cuando un rollo se acaba, escribe su referencia (la de la hoja de vida). <strong>Terminar rollo</strong>: lo
        que todavía le queda en el sistema sale como <strong>merma</strong> y el rollo queda agotado.{" "}
        <strong>Sobrante</strong>: si el rollo rindió más metros de los que dice el sistema, súmaselos aquí antes de
        registrar la producción.
      </p>
      <form onSubmit={buscar} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          className="produccion-input"
          style={{ flex: "1 1 240px" }}
          placeholder="Referencia del rollo, ej. ABG1LR30020,33-13"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
        />
        <button type="submit" className="produccion-boton-secundario" disabled={cargando || !referencia.trim()}>Buscar</button>
      </form>
      {error && <p className="produccion-error">{error}</p>}
      {aviso && <p className="produccion-exito">{aviso}</p>}

      {rollo && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>{rollo.identificadorRollo}</strong> · {rollo.codigoInterno} · {nombreEmpresa(rollo.empresa)}
            {bodega && ` · ${bodega}`} · {ESTADOS[rollo.estado] || rollo.estado}
            <br />
            Le quedan <strong>{rollo.metrosDisponibles} m</strong> en el sistema · consumidos {rollo.metrosConsumidos} m
            <br />
            Merma <strong>{rollo.mermaMetros || 0} m</strong> · metros de más <strong>{rollo.sobranteMetros || 0} m</strong>
          </p>
          <input
            className="produccion-input"
            placeholder="Observaciones (opcional)"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            style={{ marginBottom: "0.5rem" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="produccion-boton-primario"
              disabled={cargando || rollo.metrosDisponibles <= 0}
              onClick={() => setConfirmacion({
                titulo: `¿Terminar el rollo ${rollo.identificadorRollo}?`,
                mensaje: `Los ${rollo.metrosDisponibles} m que le quedan en el sistema se registran como MERMA y el rollo queda agotado. No se puede deshacer.`,
                textoConfirmar: "Sí, terminar rollo",
                ejecutar: () => ejecutar("terminar", { observaciones }, (r) => `Rollo ${r.identificadorRollo} terminado: ${rollo.metrosDisponibles} m de merma.`),
              })}
            >
              Terminar rollo{rollo.metrosDisponibles > 0 ? ` (merma ${rollo.metrosDisponibles} m)` : ""}
            </button>
            <span style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
              <input
                type="number" min="0" step="0.01"
                className="produccion-input-metros"
                aria-label="Metros de sobrante"
                placeholder="Metros"
                value={metrosSobrante}
                onChange={(e) => setMetrosSobrante(e.target.value)}
              />
              <button
                type="button"
                className="produccion-boton-secundario"
                disabled={cargando || !(Number(metrosSobrante) > 0)}
                onClick={() => setConfirmacion({
                  titulo: `¿Registrar ${metrosSobrante} m de sobrante?`,
                  mensaje: `El rollo ${rollo.identificadorRollo} rindió ${metrosSobrante} m más de lo registrado: se le suman a sus metros disponibles.`,
                  textoConfirmar: "Sí, registrar sobrante",
                  ejecutar: () => ejecutar("sobrante", { metros: Number(metrosSobrante), observaciones },
                    (r) => `Sobrante registrado: el rollo ${r.identificadorRollo} ahora tiene ${r.metrosDisponibles} m.`),
                })}
              >
                Registrar sobrante
              </button>
            </span>
          </div>
        </div>
      )}
      {confirmacion && (
        <ModalConfirmacion
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          textoCancelar="No, volver"
          textoConfirmar={confirmacion.textoConfirmar}
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={() => { const { ejecutar: accion } = confirmacion; setConfirmacion(null); accion(); }}
        />
      )}
    </section>
  );
}
