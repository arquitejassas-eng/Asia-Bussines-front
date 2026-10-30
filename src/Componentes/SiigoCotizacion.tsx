import { NOMBRE_UNIDAD, type ClienteSiigo, type ProductoSiigo, type VendedorSiigo } from "../Hooks/useSiigoCotizacion";
import { numeroDe } from "../Hooks/useApartados";
import "../Style/Siigo.css";

// Lo de Siigo dentro del formulario de cotización: el aviso de qué pasa al
// guardar, cédula/NIT y vendedor, impuestos, los campos de cada producto
// (producto de Siigo, cantidad en kilos/centímetros/unidades, precio) y el
// resumen del valor.

const pesos = (valor: number) => valor.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });
const cantidad = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 2 });

type FormularioSiigo = {
  empresa: string; clienteIdentificacion: string; siigoVendedor: string; siigoIva: boolean; siigoRetefuente: boolean;
  items: { valorLinea: string }[];
};
type CampoSiigo = "clienteIdentificacion" | "siigoVendedor" | "siigoIva" | "siigoRetefuente";

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

/** Cédula/NIT o vendedor: van dentro de la cuadrícula de datos de la cotización. */
export function CampoSiigoCliente({
  campo, formulario, nombreEmpresa, vendedores, cliente, consultarCliente, actualizar,
}: {
  campo: "nit" | "vendedor"; formulario: FormularioSiigo; nombreEmpresa: string;
  vendedores: VendedorSiigo[] | "cargando" | "error" | undefined;
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
  const subtotal = formulario.items.reduce((suma, i) => suma + numeroDe(i.valorLinea), 0);
  if (!(subtotal > 0)) return null;
  const pctIva = porcentajes?.iva ?? 19;
  const iva = formulario.siigoIva ? subtotal * pctIva / 100 : 0;
  const retencion = formulario.siigoRetefuente && porcentajes?.retefuente != null ? subtotal * porcentajes.retefuente / 100 : 0;
  return (
    <dl className="siigo-resumen" aria-label="Valor de la cotización">
      <div><dt>Subtotal</dt><dd>{pesos(subtotal)}</dd></div>
      {formulario.siigoIva && <div><dt>IVA {cantidad(pctIva)} %</dt><dd>{pesos(iva)}</dd></div>}
      {formulario.siigoRetefuente && (
        <div><dt>Retención en la fuente{porcentajes?.retefuente != null ? ` ${cantidad(porcentajes.retefuente)} %` : ""}</dt>
          <dd>{porcentajes?.retefuente != null ? `− ${pesos(retencion)}` : "la calcula Siigo"}</dd></div>
      )}
      <div className="siigo-resumen-total"><dt>Total</dt><dd>{pesos(subtotal + iva - retencion)}</dd></div>
      <p>Aproximado: el valor exacto lo da Siigo al guardar.</p>
    </dl>
  );
}

export function CamposSiigoLinea({
  indice, item, unidad, productos, buscarProducto, cerrarBusquedaProducto, actualizar,
}: {
  indice: number; unidad: string;
  item: { siigoProducto: string; siigoCantidad: string; siigoUnidad?: string; siigoAviso?: string; valorLinea: string };
  productos: ProductoSiigo[] | "buscando" | "error" | undefined;
  buscarProducto: (indice: number, texto: string) => void;
  cerrarBusquedaProducto: (indice: number) => void;
  actualizar: (campo: "siigoProducto" | "siigoCantidad" | "siigoCantidadManual" | "valorLinea", valor: string | boolean) => void;
}) {
  const valor = numeroDe(item.valorLinea);
  const porUnidad = numeroDe(item.siigoCantidad) > 0 ? valor / numeroDe(item.siigoCantidad) : 0;
  return (
    <div className="siigo-linea" style={{ gridColumn: "1 / -1" }}>
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
        <label htmlFor={`siigo-valor-${indice}`}>Valor de la venta sin IVA *</label>
        <input id={`siigo-valor-${indice}`} inputMode="decimal" placeholder="Ej. 1.114.448" value={item.valorLinea}
          onChange={(e) => actualizar("valorLinea", e.target.value)} />
      </div>
      <p className="siigo-linea-total">
        {valor > 0 && porUnidad > 0
          ? <><strong>{pesos(valor)}</strong> ÷ {cantidad(numeroDe(item.siigoCantidad))} {unidad} = {pesos(porUnidad)} por {NOMBRE_UNIDAD[unidad] || unidad} (va así a Siigo)</>
          : "—"}
      </p>
    </div>
  );
}
