// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useState } from "react";
import { formatearFechaColombia } from "../Utils/fechas";
import { claseColorMaterial } from "../Utils/colorRollo";
import { EMPRESAS, nombreEmpresa } from "../Utils/empresas";

// "Arquitejas 3 · Asia Business 2" para la cabecera de cada grupo: el mismo
// código de clasificación puede tener rollos de las dos empresas.
function resumenEmpresas(rollos) {
  const conteo = {};
  for (const rollo of rollos) conteo[rollo.empresa || ""] = (conteo[rollo.empresa || ""] || 0) + 1;
  return Object.entries(conteo)
    .map(([sigla, cantidad]) => `${sigla ? EMPRESAS[sigla] || sigla : "Sin empresa"} ${cantidad}`)
    .join(" · ");
}

// Sección "Agrupación visual por código" de Rollos: la tabla principal,
// agrupada por código interno, expandible por grupo. Extraído de
// RollosPage.tsx sin cambiar props ni comportamiento -- incluye el estado
// local "gruposExpandidos" y la función "alternarGrupo" que solo esta
// sección usaba, movidos aquí tal cual.
function PanelAgrupacionRollos({
  gruposPorCodigo,
  ESTADOS_ROLLO,
  actualizarFamiliaRollo,
  actualizarAnchoRollo,
  actualizarEmpresaRollo,
  abrirConsumo,
  abrirHistorial,
  abrirSalidaExterna,
}) {
  const [gruposExpandidos, setGruposExpandidos] = useState({});

  function alternarGrupo(codigoInterno) {
    setGruposExpandidos((actual) => ({ ...actual, [codigoInterno]: !actual[codigoInterno] }));
  }

  if (gruposPorCodigo.length === 0) {
    return (
      <section className="rollos-tarjeta">
        <p className="rollos-vacio">No hay rollos que coincidan con la búsqueda.</p>
      </section>
    );
  }

  return (
    <>
      {gruposPorCodigo.map((grupo) => {
        const expandido = !!gruposExpandidos[grupo.codigoInterno];
        const colorClase = claseColorMaterial(grupo.colorMaterial);
        const totalMetrosFisicos = Math.round(
          grupo.rollos.reduce((suma, rollo) => suma + (Number(rollo.metrosDisponibles) || 0), 0) * 100
        ) / 100;
        const metrosReservados = Number(grupo.metrosReservados) || 0;
        const totalMetrosDisponibles = Math.round((totalMetrosFisicos - metrosReservados) * 100) / 100;
        return (
          <section key={grupo.codigoInterno} className={`rollos-tarjeta rollos-grupo rollos-color-${colorClase}`}>
            <button
              className="rollos-grupo-header"
              onClick={() => alternarGrupo(grupo.codigoInterno)}
            >
              <div className="rollos-grupo-info">
                <span className="rollos-grupo-codigo">{grupo.codigoInterno}</span>
                <span className="rollos-grupo-detalle">
                  <span className={`rollos-color-etiqueta color-${colorClase}`}>
                    <span className="rollos-color-muestra" aria-hidden="true" />
                    {grupo.colorMaterial || "Sin color"}
                  </span>
                  <span>Calibre {grupo.calibre}</span>
                  <span>{resumenEmpresas(grupo.rollos)}</span>
                </span>
              </div>
              <div className="rollos-grupo-cantidad">
                <span className="numero">{grupo.rollos.length}</span>
                <span>rollo{grupo.rollos.length === 1 ? "" : "s"}</span>
              </div>
              <div className="rollos-grupo-cantidad">
                <span className="numero">{totalMetrosDisponibles}</span>
                <span>m disponibles</span>
              </div>
              {metrosReservados > 0 && (
                <div className="rollos-grupo-cantidad" title="Metros reservados por apartados activos, aún sin enviar a producción o en producción">
                  <span className="numero">{metrosReservados}</span>
                  <span>m reservados</span>
                </div>
              )}
              <span className="rollos-grupo-flecha">{expandido ? "▲" : "▼"}</span>
            </button>

            {expandido && (
              <table className="rollos-tabla">
                <thead>
                  <tr>
                    <th>Referencia</th>
                    <th>Empresa</th>
                    <th>Familia</th>
                    <th>Ancho (m)</th>
                    <th>Proveedor</th>
                    <th>Código proveedor</th>
                    <th>Peso neto (t)</th>
                    <th>Peso actual (t)</th>
                    <th>Metros proveedor</th>
                    <th>Metros calculados</th>
                    <th>Disponibles</th>
                    <th>Consumidos</th>
                    <th>Ingreso</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {grupo.rollos.map((rollo) => (
                    <tr key={rollo.id}>
                      <td>{rollo.identificadorRollo}</td>
                      <td>
                        <select
                          className="rollos-input-familia"
                          value={rollo.empresa}
                          title="Se deduce sola de la referencia; cámbiala solo si quedó mal."
                          onChange={(e) => actualizarEmpresaRollo(rollo.id, e.target.value)}
                        >
                          <option value="">Sin empresa</option>
                          {[...new Set([...Object.keys(EMPRESAS), rollo.empresa].filter(Boolean))].map((sigla) => (
                            <option key={sigla} value={sigla}>{nombreEmpresa(sigla)}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="rollos-input-familia"
                          defaultValue={rollo.familia}
                          title="Familia para el módulo Inventario (ej. Teja Colonial)"
                          onBlur={(e) => e.target.value.trim() !== rollo.familia && actualizarFamiliaRollo(rollo.id, e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number" min="0" step="any"
                          className="rollos-input-familia"
                          style={{ maxWidth: 90 }}
                          defaultValue={rollo.anchoMaterial}
                          title="Ancho físico del rollo — normalmente 122 m. Solo lo usa Producción de Caballetes (ancho ÷ 3 = ancho de cada sección)."
                          onBlur={(e) => {
                            const valor = Number(e.target.value);
                            if (valor > 0 && valor !== rollo.anchoMaterial) actualizarAnchoRollo(rollo.id, valor);
                          }}
                        />
                      </td>
                      <td>{rollo.proveedor || "—"}</td>
                      <td>{rollo.codigoProveedor || "—"}</td>
                      <td>{rollo.pesoNeto ?? "—"}</td>
                      <td>{rollo.pesoActualToneladas ?? "—"}</td>
                      <td>{rollo.metrosProveedor ?? "—"}</td>
                      <td>{rollo.metrosCalculados ?? "—"}</td>
                      <td>{rollo.metrosDisponibles}</td>
                      <td>{rollo.metrosConsumidos}</td>
                      <td>{formatearFechaColombia(rollo.fechaIngreso, false)}</td>
                      <td>
                        <span className={`rollos-estado-badge estado-${rollo.estado}`}>
                          {ESTADOS_ROLLO[rollo.estado]}
                        </span>
                      </td>
                      <td style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        <button
                          className="rollos-boton-consumo"
                          disabled={rollo.estado === "agotado"}
                          onClick={() => abrirConsumo(rollo)}
                        >
                          Registrar consumo
                        </button>
                        <button
                          type="button"
                          className="rollos-boton-secundario"
                          onClick={() => abrirHistorial(rollo)}
                        >
                          Ver historial
                        </button>
                        <button
                          type="button"
                          className="rollos-boton-secundario"
                          disabled={rollo.estado === "agotado"}
                          onClick={() => abrirSalidaExterna(rollo)}
                        >
                          Salida externa
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </>
  );
}

export default PanelAgrupacionRollos;
