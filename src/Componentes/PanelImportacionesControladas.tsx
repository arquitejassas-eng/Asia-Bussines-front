import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import ModalConfirmacion from "./ModalConfirmacion";

type Importacion = { id: number; clave: string; nombre: string; activa: boolean; nota: string; rollos: number; metros: number };
const m = (n: number) => `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;

/** Admin Inventario (Recepción y Verificación): qué importaciones solo se
 * venden en rollo completo. Sus rollos no se cortan mientras sean de la
 * empresa que los importó; las alertas de cotizaciones salen en Apartados. */
export default function PanelImportacionesControladas() {
  const [importaciones, setImportaciones] = useState<Importacion[]>([]);
  const [nuevaClave, setNuevaClave] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<Importacion | null>(null);

  const cargar = useCallback(async () => {
    try {
      setImportaciones((await api.get<Importacion[]>("/importaciones-controladas")) || []);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron cargar las importaciones.");
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function ejecutar(accion: () => Promise<unknown>, textoAviso: string) {
    setOcupado(true);
    setError("");
    setAviso("");
    try {
      await accion();
      await cargar();
      setAviso(textoAviso);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo hacer.");
    } finally {
      setOcupado(false);
    }
  }

  const activas = importaciones.filter((i) => i.activa);

  return (
    <section className="recepcion-tarjeta">
      <h3>Importaciones que solo se venden en rollo completo ({activas.length})</h3>
      <p className="recepcion-texto-ayuda">
        Los rollos de estas importaciones, mientras sean de la empresa que los importó, <strong>no se cortan</strong>:
        solo se venden completos a la otra empresa. Sus metros sí cuentan como disponibles. Si a una cotización le falta
        material en su bodega y hay de estos rollos, te llega la alerta en <strong>Apartados</strong>.
      </p>
      {error && <p className="inventario-error">{error}</p>}
      {aviso && <p className="recepcion-exito">{aviso}</p>}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ width: "10rem" }} placeholder="Ej. 17AR" aria-label="Importación a marcar" value={nuevaClave}
          onChange={(e) => setNuevaClave(e.target.value)} maxLength={20} />
        <button type="button" className="inventario-boton" disabled={ocupado || !nuevaClave.trim()}
          onClick={() => { const clave = nuevaClave.trim().toUpperCase(); ejecutar(async () => { await api.post("/importaciones-controladas", { clave }); setNuevaClave(""); }, `${clave} quedó marcada como solo rollo completo.`); }}>
          Marcar como solo rollo completo
        </button>
        <span className="recepcion-texto-ayuda" style={{ margin: 0 }}>Es el inicio de la referencia de sus rollos: 17AR = importación 17 de Arquitejas.</span>
      </div>
      {importaciones.length > 0 && (
        <ul style={{ marginTop: "0.75rem" }}>
          {importaciones.map((i) => (
            <li key={i.id} style={{ opacity: i.activa ? 1 : 0.6, marginBottom: "0.35rem" }}>
              <strong>{i.clave}</strong> · {i.nombre} · {i.rollos} rollo{i.rollos === 1 ? "" : "s"} ({m(i.metros)}){i.activa ? "" : " · desmarcada"}{" "}
              {i.activa ? (
                <button type="button" className="apartados-limpiar" disabled={ocupado} onClick={() => setConfirmar(i)}>Quitar marca</button>
              ) : (
                <button type="button" className="apartados-limpiar" disabled={ocupado}
                  onClick={() => ejecutar(() => api.post("/importaciones-controladas", { clave: i.clave, nota: i.nota }), `${i.clave} quedó marcada otra vez.`)}>Volver a marcar</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmar && (
        <ModalConfirmacion titulo={`¿Quitar la marca a ${confirmar.clave}?`} textoConfirmar="Sí, quitar" textoCancelar="No, volver"
          mensaje="Sus rollos se podrán volver a cortar y las alertas pendientes de esa importación se cierran."
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => { const i = confirmar; setConfirmar(null); ejecutar(() => api.delete(`/importaciones-controladas/${i.id}`), `${i.clave} ya no está marcada.`); }} />
      )}
    </section>
  );
}
