import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import ModalConfirmacion from "./ModalConfirmacion";
import { SECCIONES_POR_TIPO_PRODUCTO } from "../Utils/produccion";
import { EMPRESAS } from "../Utils/empresas";

type LaminaParaConvertir = { id: number; codigo: string; descripcion: string; empresa: string; calidad: string; disponibles: number };
type ConversionPendiente = {
  item_id: number; numero_orden: string; bodega_orden: string; descripcion: string; codigo_interno: string;
  medida: number; convertir_en: string; laminas_pedidas: number; laminas_convertidas: number; laminas_por_convertir: number;
  laminas: LaminaParaConvertir[];
};

const metros = (n: number) => String(n).replace(".", ",");

// Planta convierte en caballetes (3 por lámina) o flanches (5) la lámina lisa
// de una orden interna que le toca a su bodega (cortada aquí o recibida por
// traslado, ej. Ricaurte -> Santander). Ver POST /produccion/convertir-lamina-lisa.
function PanelConvertirLaminaLisa() {
  const [pendientes, setPendientes] = useState<ConversionPendiente[]>([]);
  const [itemId, setItemId] = useState("");
  const [laminaId, setLaminaId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [responsable, setResponsable] = useState("");
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setPendientes(await api.get<ConversionPendiente[]>("/produccion/conversiones-pendientes") || []);
    } catch {
      setPendientes([]);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const linea = pendientes.find((p) => String(p.item_id) === itemId);
  const lamina = linea?.laminas.find((l) => String(l.id) === laminaId);
  const numero = Number(cantidad) || 0;
  const piezas = linea ? numero * SECCIONES_POR_TIPO_PRODUCTO[linea.convertir_en] : 0;
  const nombre = linea?.convertir_en === "flanche" ? "flanches" : "caballetes";

  function elegirLinea(id: string) {
    setItemId(id);
    const nueva = pendientes.find((p) => String(p.item_id) === id);
    const unica = nueva?.laminas.length === 1 ? nueva.laminas[0] : undefined;
    setLaminaId(unica ? String(unica.id) : "");
    setCantidad(nueva ? String(Math.min(nueva.laminas_por_convertir, unica?.disponibles ?? nueva.laminas_por_convertir)) : "");
    setError("");
  }

  function revisar() {
    setExito("");
    if (!linea) return setError("Escoge la orden.");
    if (!lamina) return setError("Escoge la lámina lisa de tu bodega que vas a usar.");
    if (!(numero > 0) || !Number.isInteger(numero)) return setError("Escribe cuántas láminas usaste (número entero).");
    if (numero > linea.laminas_por_convertir) return setError(`La orden solo tiene ${linea.laminas_por_convertir} láminas por convertir.`);
    if (numero > lamina.disponibles) return setError(`Solo hay ${lamina.disponibles} láminas libres de esa.`);
    if (!responsable.trim()) return setError("Escribe quién hizo la conversión.");
    setError("");
    setConfirmando(true);
  }

  async function convertir() {
    setConfirmando(false);
    setGuardando(true);
    try {
      const r = await api.post<{ piezas: number; producto_descripcion: string }>("/produccion/convertir-lamina-lisa", {
        apartado_item_id: linea!.item_id, producto_id: lamina!.id, laminas: numero, responsable: responsable.trim(),
      });
      setExito(`Listo (${linea!.numero_orden}): entraron ${r?.piezas} ${nombre} (${r?.producto_descripcion}) y salieron ${numero} láminas lisas.`);
      setItemId(""); setLaminaId(""); setCantidad("");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo convertir la lámina lisa.");
    } finally {
      setGuardando(false);
    }
  }

  if (pendientes.length === 0 && !exito) return null;

  return (
    <section className="produccion-tarjeta">
      <h2>Convertir lámina lisa (órdenes internas)</h2>
      <p className="produccion-texto-ayuda">
        Lámina lisa que Admin Inventario ordenó convertir en tu bodega. Cada lámina da 3 caballetes o 5 flanches del mismo largo:
        las láminas salen de tu stock y entran los caballetes o flanches.
      </p>
      {pendientes.length > 0 && (
        <div className="produccion-form-grid">
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="produccion-label" htmlFor="lisa-orden">Orden</label>
            <select id="lisa-orden" className="produccion-input" value={itemId} onChange={(e) => elegirLinea(e.target.value)}>
              <option value="">Escoge la orden...</option>
              {pendientes.map((p) => (
                <option key={p.item_id} value={p.item_id}>
                  {p.numero_orden} ({p.bodega_orden}) · {p.codigo_interno} de {metros(p.medida)} m → {p.convertir_en}s ·
                  faltan {p.laminas_por_convertir} de {p.laminas_pedidas} láminas
                </option>
              ))}
            </select>
          </div>
          {linea && (
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="produccion-label" htmlFor="lisa-producto">Lámina lisa de tu bodega</label>
              {linea.laminas.length === 0 ? (
                <p className="produccion-error">
                  Todavía no tienes lámina lisa de {linea.codigo_interno} de {metros(linea.medida)} m
                  {linea.bodega_orden ? ` (si la corta ${linea.bodega_orden}, falta que llegue el traslado)` : ""}.
                </p>
              ) : (
                <select id="lisa-producto" className="produccion-input" value={laminaId} onChange={(e) => setLaminaId(e.target.value)}>
                  <option value="">Escoge la lámina...</option>
                  {linea.laminas.map((l) => (
                    <option key={l.id} value={l.id} disabled={l.disponibles <= 0}>
                      {l.descripcion} · {EMPRESAS[l.empresa] || l.empresa || "sin empresa"} · {l.disponibles} libres
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {linea && linea.laminas.length > 0 && (
            <>
              <div>
                <label className="produccion-label" htmlFor="lisa-cantidad">Láminas usadas</label>
                <input id="lisa-cantidad" type="number" min="1" step="1" className="produccion-input"
                  value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              </div>
              <div>
                <label className="produccion-label" htmlFor="lisa-responsable">Responsable</label>
                <input id="lisa-responsable" type="text" className="produccion-input" placeholder="Nombre de quien la hizo"
                  value={responsable} onChange={(e) => setResponsable(e.target.value)} />
              </div>
            </>
          )}
        </div>
      )}
      {linea && numero > 0 && (
        <p className="produccion-resumen" style={{ marginTop: "1rem" }}>
          {numero} lámina{numero === 1 ? "" : "s"} de {metros(linea.medida)} m = <strong>{piezas} {nombre}</strong> de {metros(linea.medida)} m.
        </p>
      )}
      {error && <p className="produccion-error">{error}</p>}
      {exito && <p className="produccion-exito">{exito}</p>}
      {linea && linea.laminas.length > 0 && (
        <div className="produccion-acciones">
          <button className="produccion-boton-primario" onClick={revisar} disabled={guardando}>
            {guardando ? "Convirtiendo..." : "Convertir"}
          </button>
        </div>
      )}
      {confirmando && linea && lamina && (
        <ModalConfirmacion
          titulo="Convertir lámina lisa"
          mensaje={`Orden ${linea.numero_orden}: salen ${numero} láminas lisas (${lamina.descripcion}) y entran ${piezas} ${nombre}. ¿Confirmas?`}
          textoConfirmar="Sí, convertir"
          textoCancelar="No"
          onConfirmar={convertir}
          onCancelar={() => setConfirmando(false)}
        />
      )}
    </section>
  );
}

export default PanelConvertirLaminaLisa;
