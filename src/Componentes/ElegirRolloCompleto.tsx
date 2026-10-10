import { useState } from "react";
import type { RolloParaApartar } from "../Hooks/useApartados";
import { coincideKilos, kilosBuscados, kilosDelRollo } from "../Utils/kilos";


function normalizar(texto: unknown) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function resumen(r: RolloParaApartar) {
  const kilos = kilosDelRollo(r.pesoNeto);
  return [r.codigoInterno, kilos ? `${kilos.toLocaleString("es-CO")} kg` : "", `${r.metrosDisponibles.toLocaleString("es-CO")} m`]
    .filter(Boolean).join(" · ");
}

/** Línea de "Rollo completo" en el formulario de cotización: buscar el rollo
 * por referencia, código o kilos y elegirlo. Ese rollo queda apartado solo
 * para esta cotización (ver backend preparar_rollo_completo). */
export default function ElegirRolloCompleto({ rollos, rolloId, rolloResumen, ocupados, fijo, sinBodega, alElegir, alReintentar }: {
  rollos: RolloParaApartar[] | "cargando" | "error" | undefined;
  rolloId: number | null; rolloResumen: string;
  ocupados: number[];
  // Línea ya guardada: el rollo no se cambia (se quita la línea y se agrega otra).
  fijo: boolean;
  sinBodega: boolean;
  alElegir: (rollo: RolloParaApartar | null) => void;
  alReintentar: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const lista = Array.isArray(rollos) ? rollos : [];
  const elegido = lista.find((r) => r.id === rolloId);

  if (rolloId) {
    return (
      <div>
        <label>Rollo *</label>
        <div className="rollo-completo-elegido">
          <span>
            <strong>{elegido?.identificadorRollo || rolloResumen}</strong>
            {elegido && <small>{resumen(elegido)}</small>}
          </span>
          {!fijo && <button type="button" className="inventario-boton-cancelar" onClick={() => alElegir(null)}>Cambiar</button>}
        </div>
      </div>
    );
  }

  // Cada palabra tiene que coincidir con algo del rollo: texto (referencia,
  // código, color...) o, si son números, sus kilos o sus metros. Así
  // "LR30020,27 4484" o "4484 1810" encuentran el rollo exacto.
  const termino = normalizar(busqueda);
  const palabras = termino.split(/\s+/).filter(Boolean);
  const libres = lista.filter((r) => !ocupados.includes(r.id));
  const coincide = (r: RolloParaApartar, palabra: string) => {
    const digitos = kilosBuscados(palabra);
    return normalizar(r.identificadorRollo).includes(palabra) || normalizar(r.codigoInterno).includes(palabra)
      || normalizar(r.descripcion).includes(palabra) || normalizar(r.colorMaterial).includes(palabra)
      || coincideKilos(r.pesoNeto, digitos)
      || (Boolean(digitos) && String(Math.round(r.metrosDisponibles)).startsWith(digitos));
  };
  const encontrados = palabras.length ? libres.filter((r) => palabras.every((p) => coincide(r, p))) : [];

  return (
    <div className="rollo-completo">
      <label>Rollo *</label>
      <input
        placeholder={sinBodega ? "Elige primero la bodega" : "Buscar rollo: referencia, código, kilos o metros (ej. 4484 1810)"}
        disabled={sinBodega} value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
      />
      {rollos === "cargando" && <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>Cargando rollos...</p>}
      {rollos === "error" && (
        <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>
          No se pudieron cargar los rollos. <button type="button" className="apartados-limpiar" onClick={alReintentar}>Reintentar</button>
        </p>
      )}
      {Array.isArray(rollos) && !termino && (
        <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
          {libres.length} rollo{libres.length === 1 ? "" : "s"} libres en esta bodega. Escribe para buscar.
        </p>
      )}
      {termino && Array.isArray(rollos) && encontrados.length === 0 && (
        <p className="inventario-error" style={{ margin: "0.25rem 0 0" }}>Ningún rollo libre coincide en esta bodega.</p>
      )}
      {encontrados.length > 0 && (
        <p className="inventario-carga-ayuda" style={{ margin: "0.25rem 0 0" }}>
          {encontrados.length} rollo{encontrados.length === 1 ? "" : "s"}{encontrados.length > 4 ? " (desliza la lista para ver todos)" : ""}
        </p>
      )}
      {encontrados.length > 0 && (
        <div className="rollo-completo-opciones">
          {encontrados.map((r) => (
            <button type="button" key={r.id} onClick={() => { setBusqueda(""); alElegir(r); }}>
              <strong>{r.identificadorRollo}</strong>
              <small>{resumen(r)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
