import { useState } from "react";
import { claseColorMaterial } from "../Utils/colorRollo";
import { nombreEmpresa } from "../Utils/empresas";
import { formatearCalibre } from "../Utils/calibre";
import { formatearFechaColombia } from "../Utils/fechas";
import { kilosDelRollo } from "../Utils/kilos";
import { redondearMetros, type GrupoMerma, type RolloMerma } from "./Merma";

const metros = (n: number) => `${redondearMetros(n).toLocaleString("es-CO")} m`;

/** Rollos finalizados agrupados por código, mismas tarjetas que Rollos
 * almacenados (PanelAgrupacionRollos), pero con la merma y los metros de más
 * en vez de los metros disponibles. En celular cada rollo es una tarjeta. */
export default function PanelRollosMerma({ grupos, nombreBodega, abrirHistorial }: {
  grupos: GrupoMerma[]; nombreBodega: (id: number | null) => string; abrirHistorial: (rollo: RolloMerma) => void;
}) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  if (grupos.length === 0) {
    return <section className="rollos-tarjeta"><p className="rollos-vacio">No hay rollos finalizados que coincidan.</p></section>;
  }

  return (
    <>
      {grupos.map((grupo) => {
        const abierto = !!abiertos[grupo.codigoInterno];
        const color = claseColorMaterial(grupo.colorMaterial);
        return (
          <section key={grupo.codigoInterno} className={`rollos-tarjeta rollos-grupo merma-grupo rollos-color-${color}`}>
            <button className="rollos-grupo-header"
              onClick={() => setAbiertos((a) => ({ ...a, [grupo.codigoInterno]: !a[grupo.codigoInterno] }))}>
              <div className="rollos-grupo-info">
                <span className="rollos-grupo-codigo">{grupo.codigoInterno}</span>
                <span className="rollos-grupo-detalle">
                  <span className={`rollos-color-etiqueta color-${color}`}>
                    <span className="rollos-color-muestra" aria-hidden="true" />{grupo.colorMaterial || "Sin color"}
                  </span>
                  <span>Calibre {formatearCalibre(grupo.calibre)}</span>
                </span>
              </div>
              <div className="rollos-grupo-cantidad">
                <span className="numero">{grupo.rollos.length}</span><span>rollo{grupo.rollos.length === 1 ? "" : "s"}</span>
              </div>
              <div className="rollos-grupo-cantidad">
                <span className="numero">{redondearMetros(grupo.merma).toLocaleString("es-CO")}</span><span>m de merma</span>
              </div>
              {grupo.sobrante > 0 && (
                <div className="rollos-grupo-cantidad">
                  <span className="numero">{redondearMetros(grupo.sobrante).toLocaleString("es-CO")}</span><span>m de más</span>
                </div>
              )}
              <span className="rollos-grupo-flecha">{abierto ? "▲" : "▼"}</span>
            </button>

            {abierto && (
              <div className="inventario-tabla-contenedor">
                <table className="rollos-tabla merma-tabla">
                  <thead>
                    <tr>
                      <th>Referencia</th><th>Bodega</th><th>Empresa</th><th>Kilos</th><th>Metros proveedor</th>
                      <th>Consumidos</th><th>Merma</th><th>Metros de más</th><th>Ingreso</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.rollos.map((r) => {
                      const kilos = kilosDelRollo(r.pesoNeto);
                      return (
                        <tr key={r.id}>
                          <td className="merma-ref">{r.identificadorRollo}</td>
                          <td data-etiqueta="Bodega">{nombreBodega(r.bodegaId)}</td>
                          <td data-etiqueta="Empresa">{nombreEmpresa(r.empresa)}</td>
                          <td data-etiqueta="Kilos">{kilos != null ? `${kilos.toLocaleString("es-CO")} kg` : "—"}</td>
                          <td data-etiqueta="Metros proveedor">{r.metrosProveedor ?? "—"}</td>
                          <td data-etiqueta="Consumidos">{r.metrosConsumidos}</td>
                          <td data-etiqueta="Merma"><strong>{r.mermaMetros ? metros(r.mermaMetros) : "—"}</strong></td>
                          <td data-etiqueta="Metros de más">{r.sobranteMetros ? metros(r.sobranteMetros) : "—"}</td>
                          <td data-etiqueta="Ingreso">{formatearFechaColombia(r.fechaIngreso, false)}</td>
                          <td>
                            <button type="button" className="rollos-boton-secundario" onClick={() => abrirHistorial(r)}>
                              Ver historial
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
