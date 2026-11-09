import { NOMBRE_UNIDAD, type CentroCostoSiigo, type ClienteSiigo, type ProductoSiigo, type VendedorSiigo } from "../Hooks/useSiigoCotizacion";
import { factorIva, numeroDe } from "../Hooks/useApartados";
import "../Style/Siigo.css";

// Lo de Siigo dentro del formulario de cotización: el aviso de qué pasa al
// guardar, cédula/NIT y vendedor, impuestos, los campos de cada producto
// (producto de Siigo, cantidad en kilos/centímetros/unidades, precio) y el
// resumen del valor.

const pesos = (valor: number) => valor.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });
const cantidad = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 2 });

type FormularioSiigo = {
  empresa: string; clienteIdentificacion: string; siigoVendedor: string; siigoCentroCosto: string; siigoIva: boolean; siigoRetefuente: boolean;
  items: { valorLinea: string; siigoCantidad?: string; siigoUnidad?: string; siigoKilos?: number | null; siigoIncluido?: boolean }[];
};

/** Lo que pesa la lámina de la cotización: en las líneas que van a Siigo en
 * kilos, lo que dice su cantidad (el vendedor la puede corregir); en las
 * demás (Arquitejas va en centímetros), el peso que calculó el servidor. */
function kilosTotales(items: FormularioSiigo["items"]) {
  let total = 0;
  let sinPeso = 0;
  for (const item of items) {
    const kilos = item.siigoUnidad === "kg" ? numeroDe(item.siigoCantidad ?? "") : (item.siigoKilos ?? 0);
    if (kilos > 0) total += kilos;
    else if (item.siigoUnidad === "kg" || item.siigoUnidad === "cm") sinPeso += 1;
  }
  return { total, sinPeso };
}
type CampoSiigo = "clienteIdentificacion" | "siigoVendedor" | "siigoCentroCosto" | "siigoIva" | "siigoRetefuente";

/** Arriba del formulario: qué va a pasar con Siigo al guardar. */
export function AvisoSiigoCotizacion({
  nombreEmpresa, empresaConectada, enSiigo, editando, numeroEnSiigo, pendiente, motivo,
}: {
  nombreEmpresa: string; empresaConectada: boolean; enSiigo: boolean; editando: boolean;
  numeroEnSiigo: string; pendiente: boolean; motivo: string;
}) {
  if (!nombreEmpresa) return null;
  if (!empresaConectada) {
    return <p className="inventario-carga-ayuda siigo-nota">{nombreEmpresa} todavía no está conectada a Siigo: la cotización se guarda solo en el programa.</p>;
  }
  if (!enSiigo) {
    return editando
      ? <p className="inventario-carga-ayuda siigo-nota">Esta cotización se hizo en Siigo a mano: los cambios quedan solo en el programa.</p>
      : null;
  }
  if (pendiente) {
    return (
      <p className="siigo-aviso siigo-aviso-pendiente">
        <strong>Pendiente de Siigo.</strong> {motivo || "No se pudo pasar a Siigo."} Al guardar se vuelve a intentar.
      </p>
    );
  }
  return (
    <p className="siigo-aviso">
      {numeroEnSiigo
        ? <>Está en Siigo como <strong>{numeroEnSiigo}</strong>: al guardar, los cambios también se pasan a Siigo.</>
        : <>Al guardar, la cotización se crea en el <strong>Siigo de {nombreEmpresa}</strong> y Siigo le pone el número.</>}
    </p>
  );
}

/** Cédula/NIT, vendedor o centro de costo: van dentro de la cuadrícula de datos de la cotización. */
export function CampoSiigoCliente({
  campo, formulario, nombreEmpresa, vendedores, centrosCosto, cliente, consultarCliente, actualizar,
}: {
  campo: "nit" | "vendedor" | "centro"; formulario: FormularioSiigo; nombreEmpresa: string;
  vendedores: VendedorSiigo[] | "cargando" | "error" | undefined;
  centrosCosto: CentroCostoSiigo[] | undefined;
  cliente: ClienteSiigo | null; consultarCliente: (nit: string) => void;
  actualizar: (campo: CampoSiigo, valor: string | boolean) => void;
}) {
  if (campo === "nit") {
    return (
      <div>
        <label htmlFor="siigo-nit">Cédula / NIT del cliente *</label>
        <input id="siigo-nit" inputMode="numeric" placeholder="Ej. 901497262" value={formulario.clienteIdentificacion}
          onChange={(e) => actualizar("clienteIdentificacion", e.target.value)}
          onBlur={(e) => consultarCliente(e.target.value)} />
        {cliente?.estado === "buscando" && <p className="siigo-estado">Buscando en Siigo...</p>}
        {cliente?.estado === "existe" && <p className="siigo-estado siigo-ok">✓ Está en Siigo</p>}
        {cliente?.estado === "no_existe" && (
          <p className="siigo-estado siigo-mal">No existe en el Siigo de {nombreEmpresa}: créalo allá primero o revisa el número.</p>
        )}
        {cliente?.estado === "error" && <p className="siigo-estado siigo-mal">{cliente.mensaje || "No se pudo consultar Siigo."}</p>}
      </div>
    );
  }
  if (campo === "centro") {
    // Solo lo pide el Siigo de Arquitejas: en las demás la lista llega vacía.
    if (!centrosCosto?.length) return null;
    return (
      <div>
        <label htmlFor="siigo-centro">Centro de costo *</label>
        <select id="siigo-centro" value={formulario.siigoCentroCosto} onChange={(e) => actualizar("siigoCentroCosto", e.target.value)}>
          <option value="">Elige el centro de costo...</option>
          {centrosCosto.map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nombre}</option>)}
        </select>
      </div>
    );
  }
  return (
      <div>
        <label htmlFor="siigo-vendedor">Vendedor *</label>
        <select id="siigo-vendedor" value={formulario.siigoVendedor} onChange={(e) => actualizar("siigoVendedor", e.target.value)}
          disabled={!Array.isArray(vendedores)}>
          <option value="">{vendedores === "cargando" ? "Cargando vendedores..." : vendedores === "error" ? "Siigo no respondió" : "Elige el vendedor..."}</option>
          {Array.isArray(vendedores) && vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
        </select>
      </div>
  );
}

/** IVA y retención: según el RUT del cliente (los calcula Siigo). */
export function ImpuestosSiigo({ formulario, porcentajes, actualizar }: {
  formulario: FormularioSiigo; porcentajes: { iva: number | null; retefuente: number | null } | undefined;
  actualizar: (campo: CampoSiigo, valor: string | boolean) => void;
}) {
  const pct = (valor: number | null | undefined) => (valor == null ? "" : ` ${cantidad(valor)} %`);
  return (
    <fieldset className="siigo-impuestos">
      <legend>Impuestos del cliente</legend>
      <label><input type="checkbox" checked={formulario.siigoIva} onChange={(e) => actualizar("siigoIva", e.target.checked)} /> IVA{pct(porcentajes?.iva ?? 19)}</label>
      <label><input type="checkbox" checked={formulario.siigoRetefuente} onChange={(e) => actualizar("siigoRetefuente", e.target.checked)} /> Retención en la fuente{pct(porcentajes?.retefuente)}</label>
      <small>Según el RUT del cliente. Se recuerdan para la próxima. El ReteICA va en la factura.</small>
    </fieldset>
  );
}

/** Al final del formulario: el valor de la cotización como lo va a calcular Siigo. */
export function ResumenSiigo({ formulario, porcentajes }: {
  formulario: FormularioSiigo; porcentajes: { iva: number | null; retefuente: number | null } | undefined;
}) {
  // Lo que escribió el vendedor trae el IVA: el subtotal es sin él (y sin
  // IVA marcado, el cliente paga solo el subtotal).
  const conIva = formulario.items.reduce((suma, i) => suma + (i.siigoIncluido ? 0 : numeroDe(i.valorLinea)), 0);
  const subtotal = conIva / factorIva(porcentajes?.iva);
  const kilos = kilosTotales(formulario.items);
  if (!(subtotal > 0) && !(kilos.total > 0)) return null;
  const pctIva = porcentajes?.iva ?? 19;
  const iva = formulario.siigoIva ? conIva - subtotal : 0;
  const retencion = formulario.siigoRetefuente && porcentajes?.retefuente != null ? subtotal * porcentajes.retefuente / 100 : 0;
  return (
    <dl className="siigo-resumen" aria-label="Valor de la cotización">
      {subtotal > 0 && <>
        <div><dt>Subtotal</dt><dd>{pesos(subtotal)}</dd></div>
        {formulario.siigoIva && <div><dt>IVA {cantidad(pctIva)} %</dt><dd>{pesos(iva)}</dd></div>}
        {formulario.siigoRetefuente && (
          <div><dt>Retención en la fuente{porcentajes?.retefuente != null ? ` ${cantidad(porcentajes.retefuente)} %` : ""}</dt>
            <dd>{porcentajes?.retefuente != null ? `− ${pesos(retencion)}` : "la calcula Siigo"}</dd></div>
        )}
        <div className="siigo-resumen-total"><dt>Total</dt><dd>{pesos(subtotal + iva - retencion)}</dd></div>
      </>}
      {kilos.total > 0 && (
        <div><dt>Kilos totales</dt><dd>{kilos.total.toLocaleString("es-CO", { maximumFractionDigits: 3 })} kg</dd></div>
      )}
      {kilos.sinPeso > 0 && (
        <p>Sin contar {kilos.sinPeso} línea{kilos.sinPeso === 1 ? "" : "s"} de lámina sin peso (falta el espesor o la cantidad).</p>
      )}
      {subtotal > 0 && <p>Aproximado: el valor exacto lo da Siigo al guardar.</p>}
    </dl>
  );
}

export function CamposSiigoLinea({
  indice, item, unidad, factor, productos, buscarProducto, cerrarBusquedaProducto, actualizar, puedeIncluirse,
}: {
  indice: number; unidad: string;
  /** Línea de stock: puede ir incluida en otra línea de Siigo (capuchón con su tornillo). */
  puedeIncluirse: boolean;
  /** 1,19: el valor escrito siempre trae el IVA (ver factorIva). */
  factor: number;
  item: { siigoProducto: string; siigoCantidad: string; siigoUnidad?: string; siigoAviso?: string; valorLinea: string; siigoIncluido?: boolean };
  productos: ProductoSiigo[] | "buscando" | "error" | undefined;
  buscarProducto: (indice: number, texto: string) => void;
  cerrarBusquedaProducto: (indice: number) => void;
  actualizar: (campo: "siigoProducto" | "siigoCantidad" | "siigoCantidadManual" | "valorLinea" | "siigoIncluido", valor: string | boolean) => void;
}) {
  const valor = numeroDe(item.valorLinea);
  const sinIva = valor / factor;
  const porUnidad = numeroDe(item.siigoCantidad) > 0 ? sinIva / numeroDe(item.siigoCantidad) : 0;
  const incluida = puedeIncluirse && Boolean(item.siigoIncluido);
  const casilla = puedeIncluirse && (
    <label className="siigo-linea-incluida">
      <input type="checkbox" checked={incluida} onChange={(e) => actualizar("siigoIncluido", e.target.checked)} />
      <span>
        Va incluido con otra línea en Siigo
        <small>Ej. el capuchón cuando el tornillo va como «TORNILLO 2" CON CAPUCHON AZUL». Descuenta su inventario, pero no sube a Siigo.</small>
      </span>
    </label>
  );
  if (incluida) {
    return <div className="siigo-linea" style={{ gridColumn: "1 / -1" }}>{casilla}</div>;
  }
  return (
    <div className="siigo-linea" style={{ gridColumn: "1 / -1" }}>
      {casilla}
      <div className="siigo-linea-campo siigo-linea-producto">
        <label htmlFor={`siigo-producto-${indice}`}>Producto en Siigo *</label>
        <input id={`siigo-producto-${indice}`} placeholder="Busca por código o nombre" autoComplete="off" value={item.siigoProducto}
          onChange={(e) => { actualizar("siigoProducto", e.target.value); buscarProducto(indice, e.target.value); }}
          onBlur={() => setTimeout(() => cerrarBusquedaProducto(indice), 200)} />
        {productos === "buscando" && <p className="siigo-estado">Buscando en Siigo...</p>}
        {productos === "error" && <p className="siigo-estado siigo-mal">No se pudo buscar en Siigo.</p>}
        {Array.isArray(productos) && (
          <ul className="siigo-resultados" role="listbox">
            {productos.length === 0 && <li className="siigo-sin-resultados">No hay productos con ese texto en Siigo.</li>}
            {productos.map((p) => (
              <li key={p.codigo}>
                <button type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { actualizar("siigoProducto", p.codigo); cerrarBusquedaProducto(indice); }}>
                  <strong>{p.codigo}</strong> {p.nombre}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="siigo-linea-campo">
        <label htmlFor={`siigo-cantidad-${indice}`}>Cantidad ({unidad}) *</label>
        <input id={`siigo-cantidad-${indice}`} inputMode="decimal" value={item.siigoCantidad}
          onChange={(e) => { actualizar("siigoCantidad", e.target.value); actualizar("siigoCantidadManual", true); }} />
        {item.siigoAviso && <p className="siigo-estado siigo-mal">{item.siigoAviso}</p>}
      </div>
      <div className="siigo-linea-campo">
        <label htmlFor={`siigo-valor-${indice}`}>Valor de la venta con IVA incluido *</label>
        <input id={`siigo-valor-${indice}`} inputMode="decimal" placeholder="Ej. 1.114.448" value={item.valorLinea}
          onChange={(e) => actualizar("valorLinea", e.target.value)} />
      </div>
      <p className="siigo-linea-total">
        {valor > 0 && porUnidad > 0
          ? <>{pesos(valor)} con IVA → <strong>{pesos(sinIva)} sin IVA</strong> ÷ {cantidad(numeroDe(item.siigoCantidad))} {unidad} = {pesos(porUnidad)} por {NOMBRE_UNIDAD[unidad] || unidad} sin IVA (así va a Siigo)</>
          : valor === 0 && item.valorLinea.trim() ? "Sin valor: va a Siigo en $ 0." : "—"}
      </p>
    </div>
  );
}
