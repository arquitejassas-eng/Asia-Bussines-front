import { useState } from "react";
import { api, ErrorApi } from "./Api";

type Linea = { id: number; descripcion: string; cantidad: number; codigoInterno: string | null; convertirEn: string;
  bodegaConversionId: number | null; laminasConvertidas: number };

/** Orden interna con lámina lisa que se produjo sin decir en qué se convierte:
 * Admin Inventario escoge caballete o flanche y qué bodega la convierte. Desde
 * ahí le aparece a esa Planta en "Convertir lámina lisa". */
export default function ModalDefinirConversion({ orden, lineas, bodegas, bodegaOrden, alCerrar, alGuardar }: {
  orden: { id: number; numeroCotizacion: string }; lineas: Linea[]; bodegas: { id: number; nombre: string }[];
  bodegaOrden: number; alCerrar: () => void; alGuardar: () => Promise<void> | void;
}) {
  const [valores, setValores] = useState(() => Object.fromEntries(lineas.map((l) => [l.id, {
    convertirEn: l.convertirEn || "caballete", bodega: String(l.bodegaConversionId ?? bodegaOrden),
  }])));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true); setError("");
    try {
      await api.post(`/apartados/${orden.id}/definir-conversion`, {
        lineas: lineas.map((l) => ({
          item_id: l.id, convertir_en: valores[l.id].convertirEn,
          bodega_conversion_id: Number(valores[l.id].bodega) === bodegaOrden ? null : Number(valores[l.id].bodega),
        })),
      });
      await alGuardar();
    } catch (e) {
      setError(e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo guardar.");
      setGuardando(false);
    }
  }

  return (
    <div className="rollos-modal-fondo" onClick={alCerrar}>
      <div className="rollos-modal" role="dialog" aria-modal="true" aria-labelledby="conversion-titulo" onClick={(e) => e.stopPropagation()}>
        <h3 id="conversion-titulo">Definir conversión — orden {orden.numeroCotizacion}</h3>
        <p className="rollos-texto-ayuda">
          Escoge en qué se convierte cada lámina lisa y qué bodega la convierte. Si es otra bodega, primero mándale las
          láminas con un traslado; cuando le lleguen, le aparecen a su Planta en <strong>Convertir lámina lisa</strong>.
        </p>
        {lineas.map((l) => {
          const yaEmpezo = l.laminasConvertidas > 0.005;
          return (
            <fieldset key={l.id} className="conversion-linea">
              <legend>{l.descripcion || `${l.cantidad} láminas ${l.codigoInterno ?? ""}`}</legend>
              <label>
                Se convierte en
                <select value={valores[l.id].convertirEn} disabled={yaEmpezo}
                  onChange={(e) => setValores({ ...valores, [l.id]: { ...valores[l.id], convertirEn: e.target.value } })}>
                  <option value="caballete">Caballetes (3 por lámina)</option>
                  <option value="flanche">Flanches (5 por lámina)</option>
                </select>
              </label>
              <label>
                La convierte
                <select value={valores[l.id].bodega}
                  onChange={(e) => setValores({ ...valores, [l.id]: { ...valores[l.id], bodega: e.target.value } })}>
                  {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                </select>
              </label>
              {yaEmpezo && <small>Ya se convirtieron {l.laminasConvertidas}: solo se puede cambiar la bodega.</small>}
            </fieldset>
          );
        })}
        {error && <p className="rollos-error" role="alert">{error}</p>}
        <div className="rollos-modal-acciones">
          <button type="button" className="rollos-boton-secundario" onClick={alCerrar}>Cancelar</button>
          <button type="button" className="rollos-boton-primario" disabled={guardando} onClick={guardar}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
