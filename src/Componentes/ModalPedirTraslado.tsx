import { useState } from "react";
import { api, ErrorApi } from "./Api";

type RolloParaPedir = { id: number; identificadorRollo: string; bodegaId: number | null; metrosDisponibles: number };

/** Admin Inventario pide un rollo de una bodega para otra (ej. de Santander
 * para Ricaurte). Sigue el traslado normal: la bodega dueña acepta y
 * despacha, y la otra lo recibe. */
export default function ModalPedirTraslado({ rollo, bodegas, alCerrar, alPedir }: {
  rollo: RolloParaPedir; bodegas: { id: number; nombre: string }[];
  alCerrar: () => void; alPedir: (mensaje: string) => void;
}) {
  const destinos = bodegas.filter((b) => b.id !== rollo.bodegaId);
  const origen = bodegas.find((b) => b.id === rollo.bodegaId)?.nombre || "su bodega";
  const [destino, setDestino] = useState(destinos[0] ? String(destinos[0].id) : "");
  const [tipo, setTipo] = useState("solicitud");
  const [cotizacion, setCotizacion] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function pedir(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    if (!destino) { setError("Escoge para qué bodega es."); return; }
    setEnviando(true); setError("");
    try {
      await api.post("/bodegas/solicitudes", {
        rollo_id: rollo.id, bodega_destino_id: Number(destino), tipo_operacion: tipo,
        numero_cotizacion: cotizacion.trim(), observaciones: observaciones.trim(),
      });
      const nombre = destinos.find((b) => String(b.id) === destino)?.nombre || "";
      alPedir(`Listo: se le pidió a ${origen} el rollo ${rollo.identificadorRollo} para ${nombre}. ${origen} lo debe aceptar y despachar.`);
    } catch (e) {
      setError(e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo pedir el traslado.");
      setEnviando(false);
    }
  }

  return (
    <div className="rollos-modal-fondo" onClick={alCerrar}>
      <form className="rollos-modal" role="dialog" aria-modal="true" aria-labelledby="pedir-traslado-titulo"
        onClick={(e) => e.stopPropagation()} onSubmit={pedir} noValidate
        style={{ maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}>
        <h3 id="pedir-traslado-titulo">Pedir el rollo {rollo.identificadorRollo}</h3>
        <p className="rollos-texto-ayuda">
          Está en <strong>{origen}</strong> con {rollo.metrosDisponibles} m. {origen} recibe la solicitud, la acepta y lo
          despacha; la bodega que escojas lo recibe.
        </p>
        <label>
          Para la bodega
          <select value={destino} onChange={(e) => setDestino(e.target.value)}>
            {destinos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </label>
        <label>
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="solicitud">Traslado (se queda allá)</option>
            <option value="prestamo">Préstamo (el rollo vuelve cuando tú digas)</option>
          </select>
        </label>
        <label>
          Para la cotización (opcional)
          <input value={cotizacion} onChange={(e) => setCotizacion(e.target.value)} maxLength={32} placeholder="Ej. 4119" />
        </label>
        <label>
          Observaciones (opcional)
          <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} />
        </label>
        {error && <p className="rollos-error" role="alert">{error}</p>}
        <div className="rollos-modal-acciones">
          <button type="button" className="rollos-boton-secundario" onClick={alCerrar}>Cancelar</button>
          <button type="submit" className="rollos-boton-primario" disabled={enviando}>
            {enviando ? "Pidiendo..." : "Pedir traslado"}
          </button>
        </div>
      </form>
    </div>
  );
}
