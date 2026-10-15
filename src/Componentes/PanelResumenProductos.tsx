import { useState } from "react";
import CeldaApartado from "./CeldaApartado";
import { FAMILIA_TEJA, normalizarFamilia, type GrupoFamilia } from "../Utils/agrupacionProductos";
import { calibrePantalla, longitudDesdeCodigo } from "../Utils/teja";
import type { ProductoResumen } from "./AdminInventario";

type Bodega = { id: number; nombre: string };

/** Resumen de productos de toda la empresa en tarjetas, agrupados igual que
 * el inventario de cada bodega (PanelProductosInventario: por familia, las
 * tejas por modelo, caballetes/flanches por medida). Al abrir una tarjeta se
 * ve cada código con lo que hay en cada bodega y el total de la empresa. */
export default function PanelResumenProductos({ grupos, bodegas, unidadPorFamilia, busqueda }: {
  grupos: GrupoFamilia<ProductoResumen>[]; bodegas: Bodega[];
  unidadPorFamilia?: Record<string, string>; busqueda: string;
}) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  if (grupos.length === 0) {
    return (
      <section className="inventario-tarjeta">
        <p className="inventario-vacio">{busqueda ? "Sin resultados para tu búsqueda." : "Sin datos."}</p>
      </section>
    );
  }

  return (
    <>
      {grupos.map((grupo) => {
        // Abierta sola si es la única (ej. al buscar un código).
        const abierto = abiertos[grupo.clave] ?? grupos.length === 1;
        const esTeja = normalizarFamilia(grupo.familia) === FAMILIA_TEJA;
        const esConversion = grupo.tipoGrupo === "conversion";
        const unidad = unidadPorFamilia?.[grupo.familia] || "";
        const total = Math.round(grupo.productos.reduce((s, p) => s + (Number(p.total) || 0), 0) * 100) / 100;
        const porBodega = (id: number) =>
          Math.round(grupo.productos.reduce((s, p) => s + (Number(p.porBodega[id]) || 0), 0) * 100) / 100;
        return (
          <section key={grupo.clave} className="inventario-tarjeta resumen-productos-grupo">
            <button className="inventario-grupo-header" onClick={() => setAbiertos((a) => ({ ...a, [grupo.clave]: !abierto }))}>
              <div className="inventario-grupo-info">
                <span className="inventario-grupo-familia">
                  {grupo.familia}
                  {esTeja && (grupo.referenciaGrupo ? ` ${grupo.referenciaGrupo}` : " (sin modelo)")}
                  {esConversion && (grupo.descripcion || grupo.calibre) && (
                    <span style={{ fontWeight: 400 }}>{" — "}{[grupo.descripcion, grupo.calibre].filter(Boolean).join(" ")}</span>
                  )}
                </span>
                <span className="resumen-productos-bodegas">
                  {bodegas.filter((b) => porBodega(b.id)).map((b) => `${b.nombre} ${porBodega(b.id)}`).join(" · ") || "Sin existencias"}
                </span>
              </div>
              {grupo.longitud != null && (
                <div className="inventario-grupo-cantidad">
                  <span className="numero">{grupo.longitud} {esConversion ? "m²/caja" : "m"}</span>
                  <span>medida</span>
                </div>
              )}
              <div className="inventario-grupo-cantidad">
                <span className="numero">{grupo.productos.length}</span>
                <span>código{grupo.productos.length === 1 ? "" : "s"}</span>
              </div>
              <div className="inventario-grupo-cantidad">
                <span className="numero">{total}</span>
                <span>{esConversion ? "cajas" : unidad || "total empresa"}</span>
              </div>
              <span className="inventario-grupo-flecha">{abierto ? "▲" : "▼"}</span>
            </button>

            {abierto && (
              <div className="inventario-tabla-contenedor">
                <table className="inventario-tabla resumen-productos-tabla">
                  <thead>
                    <tr>
                      <th>Código</th>
                      {esTeja && <th>Modelo</th>}
                      <th>Descripción</th>
                      <th>Calibre</th>
                      {esTeja && <th>Longitud</th>}
                      <th>Unidad</th>
                      {bodegas.map((b) => <th key={b.id}>{b.nombre}</th>)}
                      <th>Total empresa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.productos.map((f) => (
                      <tr key={f.codigo}>
                        <td className="resumen-productos-codigo">{f.codigo}</td>
                        {esTeja && <td data-etiqueta="Modelo">{f.referencia || "—"}</td>}
                        <td data-etiqueta="Descripción">{f.descripcion || "—"}</td>
                        <td data-etiqueta="Calibre">{calibrePantalla(f.calibre) || "—"}</td>
                        {esTeja && (
                          <td data-etiqueta="Longitud">
                            {f.metrosPorUnidad != null ? `${f.metrosPorUnidad} m` : longitudDesdeCodigo(f.codigo) != null ? `${longitudDesdeCodigo(f.codigo)} m` : "—"}
                          </td>
                        )}
                        <td data-etiqueta="Unidad">{unidadPorFamilia?.[f.familia] || "—"}</td>
                        {bodegas.map((b) => (
                          <td key={b.id} data-etiqueta={b.nombre}>
                            {f.porBodega[b.id] ?? 0}
                            <CeldaApartado reservado={f.reservadoPorBodega[b.id]} libre={f.librePorBodega[b.id]} unidad="" />
                          </td>
                        ))}
                        <td data-etiqueta="Total empresa">
                          <strong>{f.total}</strong>
                          <CeldaApartado reservado={f.reservadoTotal} libre={f.libreTotal} unidad="" />
                        </td>
                      </tr>
                    ))}
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
