import { useState } from "react";
import { formatearFechaColombia } from "../Utils/fechas";
import { EMPRESAS } from "../Utils/empresas";
import type { TrasladoRollo } from "./AvisosTrasladosRollos";

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

// Etiqueta corta del paso (el detalle va en la línea de la ruta).
const PASO: Record<TrasladoRollo["estado"], string> = {
  pendiente: "Falta aceptarlo",
  aceptada: "Por despachar",
  despachada: "En camino",
};

function IconoTraslado() {
  return (
    <svg className="traslados-icono" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Aviso de Inventario total: los rollos que una bodega le pidió a otra y
 * todavía no llegan. Tocar uno filtra el resumen por su código. */
export default function PanelTrasladosRollos({ traslados, verCodigo }: {
  traslados: TrasladoRollo[]; verCodigo: (codigo: string) => void;
}) {
  const [abierto, setAbierto] = useState(true);
  if (traslados.length === 0) return null;
  const cuantos = (estado: TrasladoRollo["estado"]) => traslados.filter((t) => t.estado === estado).length;
  const resumen = (["pendiente", "aceptada", "despachada"] as const)
    .filter((estado) => cuantos(estado) > 0)
    .map((estado) => ({ estado, texto: `${cuantos(estado)} ${PASO[estado].toLowerCase()}` }));

  return (
    <section className="traslados" aria-labelledby="traslados-titulo">
      <header className="traslados-cabeza">
        <div className="traslados-cabeza-texto">
          <h2 id="traslados-titulo" className="traslados-titulo">
            <IconoTraslado />
            Rollos pedidos entre bodegas
            <span className="traslados-cuenta" role="status" aria-label={`${traslados.length} rollos en traslado`}>{traslados.length}</span>
          </h2>
          <ul className="traslados-resumen" aria-label="Por paso">
            {resumen.map((r) => <li key={r.estado} className={`traslados-paso paso-${r.estado}`}>{r.texto}</li>)}
          </ul>
        </div>
        <button type="button" className="traslados-alternar" aria-expanded={abierto} aria-controls="traslados-lista"
          onClick={() => setAbierto((a) => !a)}>
          {abierto ? "Ocultar" : "Ver rollos"}
        </button>
      </header>

      {abierto && (
        <>
          <p className="traslados-ayuda">
            Ya están comprometidos: las bodegas los aceptan, despachan y reciben desde <strong>Bodegas</strong>.
            Toca un rollo para verlo en el resumen.
          </p>
          <ul id="traslados-lista" className="traslados-lista">
            {traslados.map((t) => (
              <li key={t.id}>
                <button type="button" className={`traslados-item paso-${t.estado}`} onClick={() => verCodigo(t.codigo)}
                  aria-label={`Rollo ${t.referencia}, ${PASO[t.estado]}, de ${t.desde} a ${t.hacia}. Ver en el resumen`}>
                  <span className="traslados-item-ref">{t.referencia}</span>
                  <span className={`traslados-paso paso-${t.estado}`}>{PASO[t.estado]}</span>
                  <span className="traslados-ruta">
                    {t.desde} <span aria-hidden="true">→</span> <strong>{t.hacia}</strong>
                  </span>
                  <span className="traslados-datos">
                    <span>{t.codigo}</span>
                    <span>{EMPRESAS[t.empresa] || t.empresa || "Sin empresa"}</span>
                    <span>{numero.format(t.metros)} m</span>
                    {t.kilos != null && <span>{numero.format(t.kilos)} kg</span>}
                    {t.cotizacion && <span>Cotización {t.cotizacion}</span>}
                  </span>
                  <span className="traslados-fecha">Pedido {t.fecha ? formatearFechaColombia(t.fecha) : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
