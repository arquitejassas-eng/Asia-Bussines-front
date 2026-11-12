import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import BarraLateral from "../Componentes/BarraLateral";
import { formatearFechaColombia } from "../Utils/fechas";
import { useControladorProduccion } from "../Componentes/Produccion";
import { contarNotificaciones } from "../Utils/notificaciones";
import { filasStockAdicional } from "../Utils/produccion";
import PanelCorregirProduccion from "../Componentes/PanelCorregirProduccion";
import ModalConfirmacion from "../Componentes/ModalConfirmacion";
import { exportarArregloAExcel } from "../Utils/exportarExcel";
import "../Style/Hojadevida.css";
import type { AlmacenGlobal, Sesion } from "../types/dominio";

type ProduccionRegistro = {
  id: number | string; bodegaId: number; codigoUnico: string; cotizacion?: string; clienteApartado?: string; fecha: string;
  responsable: string; productoFabricado: string; modelo: string; medidaProducto: string;
  cantidadProductos: number; rollosUtilizados: { rolloId: number; identificadorRollo: string; metrosConsumidos: number; kilosRollo?: number | null }[];
  tipoProducto?: string;
  codigoClasificacion: string; totalMetrosConsumidos: number; saldoCodigo: number; observaciones?: string;
};

const unicos = (valores: (string | number | undefined)[]) =>
  [...new Set(valores.filter((v) => v !== undefined && v !== "").map(String))];
const redondear = (n: number) => Math.round(n * 100) / 100;
const esOrdenInterna = (prod: { clienteApartado?: string }) => (prod.clienteApartado || "").startsWith("Orden interna");
// "4119", "4119-AR" y "4119-SAL" son la misma cotización.
const numeroCotizacion = (n?: string) => (n || "").trim().toUpperCase().replace(/-(AR|ABG|SAL)$/, "");

// Varias producciones de la misma cotización (y bodega) van en una sola fila
// con los totales; `producciones` viene ordenada como la lista original, así
// que la fila queda donde estaba la producción más reciente.
type FilaHojaVida = { clave: string; producciones: ProduccionRegistro[] };
function agruparPorCotizacion(lista: ProduccionRegistro[]): FilaHojaVida[] {
  const grupos = new Map<string, FilaHojaVida>();
  const filas: FilaHojaVida[] = [];
  for (const prod of lista) {
    if (!prod.cotizacion) { filas.push({ clave: `p-${prod.id}`, producciones: [prod] }); continue; }
    const clave = `c-${prod.bodegaId}-${prod.cotizacion}`;
    const grupo = grupos.get(clave);
    if (grupo) { grupo.producciones.push(prod); continue; }
    const nuevo = { clave, producciones: [prod] };
    grupos.set(clave, nuevo);
    filas.push(nuevo);
  }
  return filas;
}

export default function HojaVidaPage({ sesion, onCerrarSesion, almacen }: {
  sesion: Sesion; onCerrarSesion: () => void; almacen: AlmacenGlobal;
}) {
  const p = useControladorProduccion({ bodegaId: sesion?.bodegaId ?? undefined, rol: sesion?.rol }, almacen);
  // Admin Inventario recibe las producciones de TODAS las sedes (el backend
  // ya se las manda así) para verificar que el material que sale de cada
  // una sea el real: por eso ve la columna Bodega y puede filtrar por sede.
  const esAdminInventario = sesion?.rol === "admin_inventario";
  const [bodegaFiltro, setBodegaFiltro] = useState("");
  // "Ver hoja de vida" desde Apartados: solo las producciones de esa cotización, para imprimirlas.
  const [parametros, setParametros] = useSearchParams();
  const cotizacionFiltro = numeroCotizacion(parametros.get("cotizacion") || "");
  // Filtro por rollo: la referencia (o parte de ella) de un rollo usado en la producción.
  const [rolloFiltro, setRolloFiltro] = useState("");
  const rolloBuscado = rolloFiltro.trim().toUpperCase();
  // Filtro por código del material (ej. LR30020,33): junto con los kilos, separa
  // rollos que pesan lo mismo pero son de otro código.
  const [codigoFiltro, setCodigoFiltro] = useState("");
  const codigoBuscado = codigoFiltro.trim().toUpperCase();
  // Como en Bodegas: "4458" o "4.458" encuentra el rollo de 4458 kg.
  const kilosBuscados = rolloBuscado.replace(/[.,\s]/g, "");
  const coincideRollo = (r: { identificadorRollo: string; kilosRollo?: number | null }) =>
    r.identificadorRollo.toUpperCase().includes(rolloBuscado)
    || (/^\d+$/.test(kilosBuscados) && r.kilosRollo != null && String(Math.round(r.kilosRollo)).includes(kilosBuscados));
  // "Corregir metros": la producción que se está corrigiendo y el aviso al terminar.
  const [corrigiendo, setCorrigiendo] = useState<ProduccionRegistro | null>(null);
  const [aviso, setAviso] = useState("");
  // Caballetes, flanches y lámina lisa se registran con metros exactos.
  const sePuedeCorregir = (prod: ProduccionRegistro) =>
    esAdminInventario && !["caballete", "flanche", "lamina_lisa"].includes(prod.tipoProducto || "teja");
  const nombreBodega = (id: number) => (almacen?.bodegas || []).find((b) => b.id === id)?.nombre || `Bodega ${id}`;
  const misProducciones = (p.misProducciones as ProduccionRegistro[])
    .filter((prod) => !bodegaFiltro || String(prod.bodegaId) === bodegaFiltro)
    .filter((prod) => !cotizacionFiltro || numeroCotizacion(prod.cotizacion) === cotizacionFiltro)
    .filter((prod) => !codigoBuscado || (prod.codigoClasificacion || "").toUpperCase().includes(codigoBuscado))
    .filter((prod) => !rolloBuscado || prod.rollosUtilizados.some(coincideRollo));
  const clienteFiltro = cotizacionFiltro ? misProducciones.find((prod) => prod.clienteApartado)?.clienteApartado : undefined;

  const notificaciones = contarNotificaciones(almacen, sesion);

  // Con el filtro de rollo: por cada rollo que coincide, cuántos metros se le
  // sacaron en total y en cuántas producciones (una producción puede usar varios rollos).
  const resumenRollos = (() => {
    if (!rolloBuscado) return [];
    const porRollo = new Map<string, { identificador: string; kilos: number | null; producciones: number; metros: number }>();
    for (const prod of misProducciones) {
      for (const r of prod.rollosUtilizados.filter(coincideRollo)) {
        const fila = porRollo.get(r.identificadorRollo) || { identificador: r.identificadorRollo, kilos: r.kilosRollo ?? null, producciones: 0, metros: 0 };
        fila.producciones += 1; fila.metros = redondear(fila.metros + r.metrosConsumidos);
        porRollo.set(r.identificadorRollo, fila);
      }
    }
    return [...porRollo.values()];
  })();

  // Las mismas filas de la tabla (cada producción y su stock adicional), una por línea.
  function exportarExcel() {
    const filasExcel = misProducciones.flatMap((prod) => [
      {
        Bodega: nombreBodega(prod.bodegaId), Fecha: formatearFechaColombia(prod.fecha, false),
        Cotización: prod.cotizacion || "", Cliente: prod.clienteApartado || "", Tipo: "Producción",
        "Producto fabricado": prod.productoFabricado, Modelo: prod.modelo, Medida: prod.medidaProducto,
        Cantidad: Number(prod.cantidadProductos) || 0,
        Rollos: prod.rollosUtilizados.map((r) => `${r.identificadorRollo} (${redondear(r.metrosConsumidos)} m)`).join(", "),
        ...(rolloBuscado ? { "Metros del rollo buscado": redondear(prod.rollosUtilizados.filter(coincideRollo).reduce((s, r) => s + r.metrosConsumidos, 0)) } : {}),
        "Código material": prod.codigoClasificacion, "Metros usados": Number(prod.totalMetrosConsumidos) || 0,
        "Saldo del código (m)": Number(prod.saldoCodigo) || 0, Responsable: prod.responsable,
        "Código producción": prod.codigoUnico, Observaciones: prod.observaciones || "",
      },
      ...filasStockAdicional(prod)
        .filter((fila) => !(esOrdenInterna(prod) && Number(fila.cantidad) === Number(prod.cantidadProductos)))
        .map((fila) => ({
          Bodega: nombreBodega(prod.bodegaId), Fecha: formatearFechaColombia(fila.fecha, false),
          Cotización: fila.cotizacion || "", Cliente: fila.cliente || "", Tipo: "Stock adicional",
          "Producto fabricado": fila.productoFabricado, Modelo: fila.modelo, Medida: fila.medida,
          Cantidad: Number(fila.cantidad) || 0, Rollos: fila.referencia || "", "Código material": prod.codigoClasificacion,
          "Metros usados": fila.metrosConsumidos == null ? "" : Number(fila.metrosConsumidos),
          "Saldo del código (m)": Number(fila.saldoRestante) || 0, Responsable: fila.responsable,
          "Código producción": fila.codigoProduccion, Observaciones: fila.observaciones || "",
        })),
    ]);
    exportarArregloAExcel(filasExcel, `Hoja_de_vida${cotizacionFiltro ? `_cotizacion_${cotizacionFiltro}` : ""}${codigoBuscado ? `_${codigoBuscado.replace(/[^A-Z0-9,.-]/g, "")}` : ""}${rolloBuscado ? `_rollo_${rolloBuscado.replace(/[^A-Z0-9,.-]/g, "")}` : ""}.xlsx`, "Hoja de vida");
  }

  const totalProducciones = misProducciones.length;
  const filas = agruparPorCotizacion(misProducciones);

  // Cotizaciones que el usuario desplegó para ver cada producción.
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  const alternar = (clave: string) => setAbiertas((actual) => {
    const nuevas = new Set(actual);
    if (nuevas.has(clave)) nuevas.delete(clave); else nuevas.add(clave);
    return nuevas;
  });

  // Cada fila se lee de izquierda a derecha como "cuándo · para quién · qué
  // se hizo · con qué material": lo que más se busca va primero y el código
  // de producción (solo para rastrear) queda al final.
  const segundaLinea = (...partes: (string | number | undefined)[]) => unicos(partes).join(" · ");

  const celdasDeProduccion = (fila: {
    fecha: string; cotizacion?: string; cliente?: string; producto: string; detalle: string; cantidad: number | string;
    rollos: { referencia: string; metros?: number; buscado?: boolean }[]; metros: number | string | null; saldo: string; responsable: string; codigo: string;
    observaciones?: string; esStock?: boolean; prod?: ProduccionRegistro; esDetalle: boolean; bodegaId: number;
  }) => (
    <>
      <td className="hv-col-toggle" aria-hidden="true">{fila.esDetalle ? <span className="hv-rama" /> : null}</td>
      {esAdminInventario && <td className="hv-bodega">{nombreBodega(fila.bodegaId)}</td>}
      <td className="hv-fecha">{formatearFechaColombia(fila.fecha, false)}</td>
      <td className="hv-col-cotizacion">
        {fila.esDetalle && !fila.esStock ? <span className="hv-tenue">Misma cotización</span> : (
          <>
            <span className={fila.esStock ? "hv-etiqueta-stock" : "hv-cotizacion"}>{fila.cotizacion || "—"}</span>
            {fila.cliente && fila.cliente !== "-" && <span className="hv-sub">{fila.cliente}</span>}
          </>
        )}
      </td>
      <td className="hv-col-producto">
        <span className="hv-producto">{fila.producto || "—"}</span>
        {fila.detalle && <span className="hv-sub">{fila.detalle}</span>}
      </td>
      <td className="num hv-cantidad">{fila.cantidad}</td>
      <td className="hv-col-rollo">
        {fila.rollos.length === 0 ? "—" : (
          // Un rollo por línea, con los metros que se le sacaron (el buscado, resaltado).
          <span className="hv-rollos-lista">
            {fila.rollos.map((r, i) => (
              <span key={`${r.referencia}-${i}`} className={`hv-codigo-rollo${r.buscado ? " hv-rollo-buscado" : ""}`}>
                {r.referencia}{r.metros != null && <strong className="hv-rollo-metros">{redondear(r.metros)} m</strong>}
              </span>
            ))}
          </span>
        )}
      </td>
      <td className="num hv-metros">
        {fila.metros == null ? "—" : `${fila.metros} m`}
        {fila.prod && sePuedeCorregir(fila.prod) && (
          <button type="button" className="hv-corregir" onClick={(e) => { e.stopPropagation(); setCorrigiendo(fila.prod!); }}>
            Corregir
          </button>
        )}
      </td>
      <td className="num hv-saldo">{fila.saldo}</td>
      <td className="hv-responsable">{fila.responsable}</td>
      <td><span className="hv-codigo">{fila.codigo}</span></td>
      <td className="hv-observaciones">{fila.observaciones || "—"}</td>
    </>
  );

  const filasDeProduccion = (prod: ProduccionRegistro, esDetalle = false) => [
    <tr key={prod.id} className={esDetalle ? "hv-fila-detalle" : undefined}>
      {celdasDeProduccion({
        fecha: prod.fecha, cotizacion: prod.cotizacion, cliente: prod.clienteApartado, producto: prod.productoFabricado,
        detalle: segundaLinea(prod.modelo, prod.medidaProducto), cantidad: prod.cantidadProductos,
        rollos: prod.rollosUtilizados.map((r) => ({ referencia: r.identificadorRollo, metros: r.metrosConsumidos, buscado: Boolean(rolloBuscado) && coincideRollo(r) })),
        metros: prod.totalMetrosConsumidos,
        saldo: `${prod.saldoCodigo} m`, responsable: prod.responsable, codigo: prod.codigoUnico,
        observaciones: prod.observaciones, prod, esDetalle, bodegaId: prod.bodegaId,
      })}
    </tr>,
    // En una orden interna lo producido ES el stock: su fila "STOCK" con la
    // misma cantidad repetía la producción (2 producciones se veían como 4).
    ...filasStockAdicional(prod).filter((fila) => !(esOrdenInterna(prod) && Number(fila.cantidad) === Number(prod.cantidadProductos))).map((fila) => (
      <tr key={fila.key} className={`hv-fila-stock${esDetalle ? " hv-fila-detalle" : ""}`}>
        {celdasDeProduccion({
          fecha: fila.fecha, cotizacion: fila.cotizacion, cliente: fila.cliente, producto: fila.productoFabricado,
          detalle: segundaLinea(fila.modelo, fila.medida), cantidad: fila.cantidad, rollos: fila.referencia ? [{ referencia: fila.referencia }] : [],
          metros: fila.metrosConsumidos, saldo: `${fila.saldoRestante} m`, responsable: fila.responsable,
          codigo: fila.codigoProduccion, observaciones: fila.observaciones, esStock: true, esDetalle, bodegaId: prod.bodegaId,
        })}
      </tr>
    )),
  ];

  const filaDeCotizacion = ({ clave, producciones }: FilaHojaVida) => {
    // De una sola cotización (para imprimir) o de un rollo se ve cada producción.
    const abierta = abiertas.has(clave) || Boolean(cotizacionFiltro) || Boolean(rolloBuscado) || Boolean(codigoBuscado);
    const reciente = producciones[0];
    const lista = (valores: (string | number | undefined)[], plural: string) => {
      const distintos = unicos(valores);
      return distintos.length <= 2 ? distintos.join(", ") || "—" : `${distintos.length} ${plural}`;
    };
    const productos = unicos(producciones.map((x) => x.productoFabricado));
    // El saldo solo tiene sentido si todas salieron del mismo código: entonces
    // el de la producción más reciente es lo que queda ahora.
    const unSoloCodigo = unicos(producciones.map((x) => x.codigoClasificacion)).length === 1;
    return [
      <tr key={clave} className={`hv-fila-grupo${abierta ? " hv-abierta" : ""}`} onClick={() => alternar(clave)}>
        <td className="hv-col-toggle">
          <button type="button" className="hv-toggle" aria-expanded={abierta}
            aria-label={abierta ? "Ocultar cada producción" : "Ver cada producción"}
            onClick={(e) => { e.stopPropagation(); alternar(clave); }}>
            <span className="hv-chevron" aria-hidden="true">›</span>
          </button>
        </td>
        {esAdminInventario && <td className="hv-bodega">{nombreBodega(reciente.bodegaId)}</td>}
        <td className="hv-fecha">{formatearFechaColombia(reciente.fecha, false)}</td>
        <td className="hv-col-cotizacion">
          <span className="hv-cotizacion">{reciente.cotizacion}</span>
          {reciente.clienteApartado && <span className="hv-sub">{reciente.clienteApartado}</span>}
        </td>
        <td className="hv-col-producto">
          <span className="hv-producto">{productos.length === 1 ? productos[0] : `${productos.length} productos distintos`}</span>
          <span className="hv-badge">{producciones.length} producciones · {abierta ? "clic para ocultar" : "clic para ver cada una"}</span>
        </td>
        <td className="num hv-cantidad">{redondear(producciones.reduce((s, x) => s + (Number(x.cantidadProductos) || 0), 0))}</td>
        <td className="hv-col-rollo">
          <span className="hv-codigo-rollo">
            {lista(producciones.flatMap((x) => x.rollosUtilizados.map((r) => r.identificadorRollo)), "rollos")}
          </span>
        </td>
        <td className="num hv-metros">{redondear(producciones.reduce((s, x) => s + (Number(x.totalMetrosConsumidos) || 0), 0))} m</td>
        <td className="num hv-saldo">{unSoloCodigo ? `${reciente.saldoCodigo} m` : "—"}</td>
        <td className="hv-responsable">{lista(producciones.map((x) => x.responsable), "responsables")}</td>
        <td className="hv-tenue">—</td>
        <td className="hv-observaciones">—</td>
      </tr>,
      ...(abierta ? producciones.flatMap((prod) => filasDeProduccion(prod, true)) : []),
    ];
  };

  return (
    <div className="layout-con-sidebar">
      <BarraLateral
        sesion={sesion}
        onCerrarSesion={onCerrarSesion}
        notificaciones={notificaciones}
      />

      <div className="layout-contenido">
        <div className="hv-page">
          <header className="hv-header">
            <div className="hv-header-texto">
              <h1 className="hv-titulo">
                {cotizacionFiltro ? `Hoja de Vida · Cotización ${cotizacionFiltro}` : "Hoja de Vida"}{codigoBuscado ? ` · ${codigoFiltro.trim().toUpperCase()}` : ""}{rolloBuscado ? ` · Rollo ${rolloFiltro.trim()}` : ""}
              </h1>
              <p className="hv-subtitulo">
                {cotizacionFiltro
                  ? `${clienteFiltro ? `${clienteFiltro} · ` : ""}Producciones registradas para esta cotización. Impreso el ${formatearFechaColombia(new Date().toISOString(), false)}.`
                  : esAdminInventario
                    ? "Reporte de control de material: verifica las producciones registradas en todas las bodegas."
                    : "Reporte de control de material: consulta las producciones registradas en tu bodega."}
              </p>
              {(cotizacionFiltro || rolloBuscado || codigoBuscado) && (
                <div className="hv-no-imprimir" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <button type="button" className="inventario-boton" onClick={() => window.print()} disabled={totalProducciones === 0}>
                    Imprimir
                  </button>
                  <button type="button" className="inventario-boton" onClick={exportarExcel} disabled={totalProducciones === 0}>
                    Exportar a Excel
                  </button>
                  <button type="button" className="rollos-boton-secundario" onClick={() => { setParametros({}); setRolloFiltro(""); setCodigoFiltro(""); }}>
                    Ver todas las producciones
                  </button>
                </div>
              )}
              <label className="hv-no-imprimir" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", marginRight: "1rem" }}>
                Rollo
                <input type="search" value={rolloFiltro} onChange={(e) => setRolloFiltro(e.target.value)}
                  placeholder="Referencia o kilos (ej. 4458)" aria-label="Filtrar por rollo: referencia o kilos" style={{ minWidth: 220 }} />
              </label>
              <label className="hv-no-imprimir" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", marginRight: "1rem" }}>
                Código
                <input type="search" value={codigoFiltro} onChange={(e) => setCodigoFiltro(e.target.value)}
                  placeholder="Ej. LR30020,33" aria-label="Filtrar por código del material" style={{ minWidth: 160 }} />
              </label>
              {esAdminInventario && !cotizacionFiltro && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
                  Bodega
                  <select value={bodegaFiltro} onChange={(e) => setBodegaFiltro(e.target.value)}>
                    <option value="">Todas</option>
                    {(almacen?.bodegas || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.nombre}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {totalProducciones > 0 && (
              <div className="hv-conteo">
                <strong>{totalProducciones}</strong>
                <span>{totalProducciones === 1 ? "registro" : "registros"}</span>
              </div>
            )}
          </header>

          {totalProducciones > 0 ? (
            <section className="hv-card">
              {rolloBuscado && resumenRollos.length > 0 && (
                <div className="hv-resumen-rollo" style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--at-border-soft, #EBE2D2)" }}>
                  <h2 style={{ margin: "0 0 0.5rem" }}>Lo que salió del rollo</h2>
                  <table className="hv-tabla" style={{ minWidth: 0 }}>
                    <thead>
                      <tr><th>Rollo</th><th className="num">Kilos al llegar</th><th className="num">Producciones</th><th className="num">Metros que se le sacaron</th></tr>
                    </thead>
                    <tbody>
                      {resumenRollos.map((r) => (
                        <tr key={r.identificador}>
                          <td><span className="hv-codigo-rollo">{r.identificador}</span></td>
                          <td className="num">{r.kilos != null ? r.kilos.toLocaleString("es-CO") : "—"}</td>
                          <td className="num">{r.producciones}</td>
                          <td className="num"><strong>{r.metros.toLocaleString("es-CO", { maximumFractionDigits: 2 })} m</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="hv-sub" style={{ marginTop: "0.5rem" }}>
                    Abajo, en la columna Rollo, cada producción dice cuántos metros salieron de cada rollo (si usó dos rollos, salen los dos).
                  </p>
                </div>
              )}
              <h2>Historial de Producción</h2>

              <div className="hv-tabla-wrap">
                <table className="hv-tabla">
                  <thead>
                    <tr>
                      <th className="hv-col-toggle"><span className="hv-oculto">Detalle</span></th>
                      {esAdminInventario && <th>Bodega</th>}
                      <th>Fecha</th>
                      <th>Cotización / Cliente</th>
                      <th>Producto fabricado</th>
                      <th className="num">Cant.</th>
                      <th>Rollo</th>
                      <th className="num">Metros usados</th>
                      <th className="num">Saldo del código</th>
                      <th>Responsable</th>
                      <th>Código prod.</th>
                      <th>Observaciones</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filas.flatMap((fila) => (fila.producciones.length > 1
                      ? filaDeCotizacion(fila)
                      : filasDeProduccion(fila.producciones[0])))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="hv-vacio">
              <div className="hv-vacio-icono">◎</div>
              <p>
                {rolloBuscado || codigoBuscado ? `No hay producciones con ${[codigoBuscado && `el código ${codigoFiltro.trim().toUpperCase()}`, rolloBuscado && `el rollo "${rolloFiltro.trim()}"`].filter(Boolean).join(" y ")}${cotizacionFiltro ? ` en la cotización ${cotizacionFiltro}` : ""}.`
                  : cotizacionFiltro ? `La cotización ${cotizacionFiltro} todavía no tiene producciones registradas.`
                  : esAdminInventario
                  ? bodegaFiltro ? "Todavía no hay producciones registradas en esta bodega." : "Todavía no hay producciones registradas en ninguna bodega."
                  : "Todavía no hay producciones registradas en tu bodega."}
              </p>
            </div>
          )}
        </div>
      </div>
      {corrigiendo && (
        <PanelCorregirProduccion
          produccion={{ ...corrigiendo, totalMetrosConsumidos: Number(corrigiendo.totalMetrosConsumidos) }}
          alTerminar={(mensaje) => { setCorrigiendo(null); setAviso(mensaje); p.cargarProducciones(true); }}
          alCerrar={() => setCorrigiendo(null)}
        />
      )}
      {aviso && <ModalConfirmacion mensaje={aviso} textoConfirmar="Entendido" onConfirmar={() => setAviso("")} />}
    </div>
  );
}
