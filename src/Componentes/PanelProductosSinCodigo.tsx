import { useState } from "react";
import { api, ErrorApi } from "./Api";
import { formatearFechaColombia } from "../Utils/fechas";
import { EMPRESAS } from "../Utils/empresas";
import type { ProductoSinCodigo } from "./AvisosProductosSinCodigo";

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

function IconoEtiqueta() {
  return (
    <svg className="sincodigo-icono" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z M7.5 7.5h.01" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Una tarjeta por producto: qué es, dónde está y un solo campo para el
 * código, con los códigos parecidos que ya existen a un clic. */
function TarjetaSinCodigo({ producto, alGuardar }: { producto: ProductoSinCodigo; alGuardar: (codigo: string) => void }) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const idCampo = `sincodigo-${producto.codigo}`;

  async function guardar(evento: { preventDefault: () => void }) {
    evento.preventDefault();
    const limpio = codigo.trim().toUpperCase();
    if (!limpio) { setError("Escribe el código o escoge uno de los sugeridos."); return; }
    setGuardando(true); setError("");
    try {
      await api.post("/admin-inventario/productos-sin-codigo/poner-codigo", { codigo_provisional: producto.codigo, codigo: limpio });
      alGuardar(limpio);
    } catch (e) {
      setError(e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo guardar el código.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <li className="sincodigo-item">
      <div className="sincodigo-que">
        <p className="sincodigo-descripcion">{producto.descripcion}</p>
        <p className="sincodigo-datos">
          <span><strong>{numero.format(producto.stock)}</strong> en stock</span>
          <span>{producto.bodegas.map((b) => b.nombre).join(", ")}</span>
          {producto.empresa && <span>{EMPRESAS[producto.empresa] || producto.empresa}</span>}
          {producto.calidad === "segunda" && <span className="sincodigo-segunda">Segunda</span>}
          {producto.fecha && <span>Producido el {formatearFechaColombia(producto.fecha, false)}</span>}
        </p>
      </div>

      <form className="sincodigo-form" onSubmit={guardar} noValidate>
        <label htmlFor={idCampo} className="sincodigo-label">Código del producto</label>
        <div className="sincodigo-fila">
          <input
            id={idCampo} value={codigo} autoComplete="off" spellCheck={false} placeholder="Ej. TA305-3,05"
            onChange={(e) => { setCodigo(e.target.value.toUpperCase()); setError(""); }}
            aria-invalid={Boolean(error)} aria-describedby={error ? `${idCampo}-error` : `${idCampo}-ayuda`}
          />
          <button type="submit" className="inventario-boton sincodigo-guardar" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar código"}
          </button>
        </div>
        {error ? <p id={`${idCampo}-error`} className="sincodigo-error" role="alert">{error}</p>
          : <p id={`${idCampo}-ayuda`} className="sincodigo-ayuda">Hoy tiene el código provisional {producto.codigo}.</p>}
        {producto.sugerencias.length > 0 && (
          <div className="sincodigo-sugerencias">
            <span>¿Es alguno de estos?</span>
            {producto.sugerencias.map((s) => (
              <button key={s.codigo} type="button" className={`sincodigo-sugerencia${codigo === s.codigo ? " activa" : ""}`}
                title={s.descripcion} onClick={() => { setCodigo(s.codigo); setError(""); }}>
                {s.codigo}
              </button>
            ))}
          </div>
        )}
      </form>
    </li>
  );
}

/** Aviso de Inventario total: lo que Planta mandó al stock sin que existiera
 * el producto. Va arriba de todo y se va solo cuando ya no queda ninguno. */
export default function PanelProductosSinCodigo({ productos, alCambiar }: {
  productos: ProductoSinCodigo[]; alCambiar: () => Promise<void> | void;
}) {
  const [aviso, setAviso] = useState("");
  if (productos.length === 0 && !aviso) return null;

  return (
    <section className="sincodigo" aria-labelledby="sincodigo-titulo">
      <header className="sincodigo-cabeza">
        <h2 id="sincodigo-titulo" className="sincodigo-titulo">
          <IconoEtiqueta />
          {productos.length === 1 ? "1 producto de producción sin código" : `${productos.length} productos de producción sin código`}
        </h2>
        <p className="sincodigo-explica">
          Planta los mandó al stock y no existían en el inventario. Escribe el código de cada uno y dale <strong>Guardar código</strong>.
        </p>
      </header>
      {aviso && <p className="sincodigo-listo" role="status">{aviso}</p>}
      {productos.length > 0 && (
        <ul className="sincodigo-lista">
          {productos.map((p) => (
            <TarjetaSinCodigo key={p.codigo} producto={p} alGuardar={async (codigo) => {
              setAviso(`Listo: "${p.descripcion}" ahora tiene el código ${codigo}.`);
              await alCambiar();
            }} />
          ))}
        </ul>
      )}
    </section>
  );
}
