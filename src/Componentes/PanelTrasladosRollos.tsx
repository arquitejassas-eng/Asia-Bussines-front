import { useState } from "react";
import { formatearFechaColombia } from "../Utils/fechas";
import { nombreEmpresa } from "../Utils/empresas";
import { pasoDelTraslado, type TrasladoRollo } from "./AvisosTrasladosRollos";

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** Aviso de Inventario total: los rollos que una bodega le pidió a otra y
 * todavía no llegan. Tocar uno filtra el resumen por su código. */
export default function PanelTrasladosRollos({ traslados, verCodigo }: {
  traslados: TrasladoRollo[]; verCodigo: (codigo: string) => void;
}) {
  const [abierto, setAbierto] = useState(true);
  if (traslados.length === 0) return null;
  return (
    <section className="traslados-rollos" aria-live="polite">
      <button type="button" className="traslados-rollos-cabeza" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        <span className="traslados-rollos-titulo">
          Rollos solicitados entre bodegas <span className="traslados-rollos-cuenta">{traslados.length}</span>
        </span>
        <span aria-hidden="true">{abierto ? "Ocultar ▲" : "Ver ▼"}</span>
      </button>
      {abierto && (
        <>
          <p className="traslados-rollos-ayuda">
            Estos rollos ya están comprometidos: las bodegas los aceptan, despachan y reciben desde Bodegas.
            Toca un rollo para ver su código en el resumen.
          </p>
          <ul className="traslados-rollos-lista">
            {traslados.map((t) => (
              <li key={t.id}>
                <button type="button" className={`traslados-rollos-item paso-${t.estado}`} onClick={() => verCodigo(t.codigo)}
                  title={`Ver los rollos de ${t.codigo}`}>
                  <span className="traslados-rollos-ref">{t.referencia}</span>
                  <span className="traslados-rollos-dato">{t.codigo} · {nombreEmpresa(t.empresa)}</span>
                  <span className="traslados-rollos-dato">
                    {numero.format(t.metros)} m{t.kilos != null ? ` · ${numero.format(t.kilos)} kg` : ""}
                  </span>
                  <span className="traslados-rollos-dato">{t.desde} → {t.hacia}</span>
                  <span className={`traslados-rollos-paso paso-${t.estado}`}>{pasoDelTraslado(t)}</span>
                  <span className="traslados-rollos-dato">
                    {t.cotizacion ? `Cotización ${t.cotizacion} · ` : ""}{t.fecha ? formatearFechaColombia(t.fecha) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
