import { NOMBRE_UNIDAD, type ClienteSiigo, type ProductoSiigo, type VendedorSiigo } from "../Hooks/useSiigoCotizacion";
import { numeroDe } from "../Hooks/useApartados";
import "../Style/Siigo.css";

// Lo de Siigo dentro del formulario de cotización: la sección de la
// cotización (subirla, cédula/NIT, vendedor, impuestos) y los campos de cada
// producto (producto de Siigo, cantidad en kilos/centímetros/unidades, precio).

const pesos = (valor: number) => valor.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 });
const cantidad = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 2 });

type FormularioSiigo = {
  empresa: string; subirASiigo: boolean; clienteIdentificacion: string; siigoVendedor: string; siigoIva: boolean; siigoRetefuente: boolean;
  items: { siigoCantidad: string; precio: string }[];
};

export function SeccionSiigoCotizacion({
  formulario, nombreEmpresa, editando, numeroEnSiigo, empresaConectada, enSiigo, vendedores, cliente, consultarCliente, actualizar,
}: {
  formulario: FormularioSiigo; nombreEmpresa: string; editando: boolean; numeroEnSiigo: string;
  empresaConectada: boolean; enSiigo: boolean;
  vendedores: VendedorSiigo[] | "cargando" | "error" | undefined;
  cliente: ClienteSiigo | null; consultarCliente: (nit: string) => void;
  actualizar: (campo: "subirASiigo" | "clienteIdentificacion" | "siigoVendedor" | "siigoIva" | "siigoRetefuente", valor: string | boolean) => void;
}) {
  if (!formulario.empresa) return null;
  if (!empresaConectada) {
    return (
      <p className="inventario-carga-ayuda siigo-nota">
        {nombreEmpresa} todavía no está conectada a Siigo: la cotización se guarda solo en el programa.
      </p>
    );
  }
  const datosSiigo = enSiigo || editando;
  const subtotal = formulario.items.reduce((suma, i) => suma + numeroDe(i.siigoCantidad) * numeroDe(i.precio), 0);
  return (
    <div className="siigo-seccion">
      {numeroEnSiigo ? (
        <p className="siigo-ya-subida">✓ Esta cotización ya está en Siigo como <strong>{numeroEnSiigo}</strong>. Los cambios que hagas aquí no se pasan a Siigo.</p>
      ) : editando ? (
        <p className="inventario-carga-ayuda siigo-nota">
          Esta cotización todavía no está en Siigo. Llena los datos de Siigo, guarda y después usa <strong>Subir a Siigo</strong> en la lista.
        </p>
      ) : (
        <label className="siigo-subir">
          <input type="checkbox" checked={formulario.subirASiigo} onChange={(e) => actualizar("subirASiigo", e.target.checked)} />
          <span>
            <strong>Subir esta cotización al Siigo de {nombreEmpresa} al guardar</strong>
            <small>El número lo pone Siigo. Si Siigo la rechaza, no se guarda y te dice qué falta.</small>
          </span>
        </label>
      )}

      {datosSiigo && (
        <div className="inventario-form-grid siigo-datos">
          <div>
            <label htmlFor="siigo-nit">Cédula / NIT del cliente{enSiigo ? " *" : ""}</label>
            <input id="siigo-nit" inputMode="numeric" placeholder="Ej. 901497262" value={formulario.clienteIdentificacion}
              onChange={(e) => actualizar("clienteIdentificacion", e.target.value)}
              onBlur={(e) => consultarCliente(e.target.value)} />
            {cliente?.estado === "buscando" && <p className="siigo-estado">Buscando en Siigo...</p>}
            {cliente?.estado === "existe" && <p className="siigo-estado siigo-ok">✓ En Siigo: {cliente.nombre}</p>}
            {cliente?.estado === "no_existe" && (
              <p className="siigo-estado siigo-mal">No existe en el Siigo de {nombreEmpresa}: créalo allá primero o revisa el número.</p>
            )}
            {cliente?.estado === "error" && <p className="siigo-estado siigo-mal">{cliente.mensaje || "No se pudo consultar Siigo."}</p>}
          </div>
          <div>
            <label htmlFor="siigo-vendedor">Vendedor en Siigo{enSiigo ? " *" : ""}</label>
            <select id="siigo-vendedor" value={formulario.siigoVendedor} onChange={(e) => actualizar("siigoVendedor", e.target.value)}
              disabled={!Array.isArray(vendedores)}>
              <option value="">{vendedores === "cargando" ? "Cargando vendedores..." : vendedores === "error" ? "No se pudieron cargar" : "Elige el vendedor..."}</option>
              {Array.isArray(vendedores) && vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
          <fieldset className="siigo-impuestos">
            <legend>Impuestos (los calcula Siigo)</legend>
            <label><input type="checkbox" checked={formulario.siigoIva} onChange={(e) => actualizar("siigoIva", e.target.checked)} /> IVA 19 %</label>
            <label><input type="checkbox" checked={formulario.siigoRetefuente} onChange={(e) => actualizar("siigoRetefuente", e.target.checked)} /> Retención en la fuente</label>
            <small>Según el RUT del cliente. El ReteICA va en la factura.</small>
          </fieldset>
        </div>
      )}
      {enSiigo && subtotal > 0 && (
        <p className="siigo-subtotal">Subtotal antes de impuestos: <strong>{pesos(subtotal)}</strong></p>
      )}
    </div>
  );
}

export function CamposSiigoLinea({
  indice, item, productos, buscarProducto, cerrarBusquedaProducto, actualizar,
}: {
  indice: number;
  item: { siigoProducto: string; siigoCantidad: string; siigoUnidad?: string; siigoAviso?: string; precio: string };
  productos: ProductoSiigo[] | "buscando" | "error" | undefined;
  buscarProducto: (indice: number, texto: string) => void;
  cerrarBusquedaProducto: (indice: number) => void;
  actualizar: (campo: "siigoProducto" | "siigoCantidad" | "siigoCantidadManual" | "precio", valor: string | boolean) => void;
}) {
  const unidad = item.siigoUnidad || "kg";
  const total = numeroDe(item.siigoCantidad) * numeroDe(item.precio);
  return (
    <div className="siigo-linea" style={{ gridColumn: "1 / -1" }}>
      <span className="siigo-linea-titulo">Siigo</span>
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
        <label htmlFor={`siigo-precio-${indice}`}>Precio por {NOMBRE_UNIDAD[unidad] || unidad} (antes de IVA) *</label>
        <input id={`siigo-precio-${indice}`} inputMode="decimal" placeholder="Ej. 4266,32" value={item.precio}
          onChange={(e) => actualizar("precio", e.target.value)} />
      </div>
      <p className="siigo-linea-total">
        {total > 0 ? <>{cantidad(numeroDe(item.siigoCantidad))} {unidad} × {pesos(numeroDe(item.precio))} = <strong>{pesos(total)}</strong></> : "—"}
      </p>
    </div>
  );
}
