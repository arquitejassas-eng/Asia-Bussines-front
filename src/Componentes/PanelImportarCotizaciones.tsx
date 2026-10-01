import { useState } from "react";
import { api, ErrorApi } from "./Api";
import { EMPRESAS } from "../Utils/empresas";

type Linea = { fila: number; codigo: string; descripcion: string; cantidad: number; modalidad: string; producto_nuevo: boolean };
type ApartadoPrevio = {
  numero_cotizacion: string; bodega_nombre: string; empresa: string; cliente: string; fecha: string; lineas: Linea[];
};
type Omitida = { fila: number; cotizacion: string; codigo: string; motivo: string };
type Previa = {
  apartados: ApartadoPrevio[]; omitidas: Omitida[]; lineas_producidas: number; lineas_stock_ajuste: number; lineas_traslado?: number; lineas_producto?: number;
  total_apartados: number; total_lineas: number; productos_nuevos: number; creados?: number; esperando_material?: number;
};

/** Carga las cotizaciones que siguen apartadas en el Excel de control (hoja
 * SALIDA, REFERENCIA vacía). Primero muestra qué se va a crear y qué líneas
 * se omiten; solo al confirmar se crean (ver backend importar_cotizaciones). */
export default function PanelImportarCotizaciones({ alTerminar, alCerrar }: { alTerminar: () => void; alCerrar: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);

  async function enviar(confirmar: boolean, elegido: File | null = archivo) {
    if (!elegido) return;
    setCargando(true); setError("");
    try {
      const datos = new FormData();
      datos.append("archivo", elegido);
      const respuesta = await api.subirArchivo<Previa>(`/apartados/importar${confirmar ? "?confirmar=true" : ""}`, datos);
      if (!respuesta) throw new Error("Respuesta vacía del servidor.");
      if (confirmar) {
        setResultado(`Se cargaron ${respuesta.creados} cotizaciones, todas "enviadas a producción".${respuesta.esperando_material
          ? ` ${respuesta.esperando_material} esperan material (en la lista dice cuánto les falta; se cubre solo cuando le des ingreso).`
          : ""}`);
        setPrevia(null);
        alTerminar();
      } else {
        setPrevia(respuesta);
      }
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo leer el archivo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <section className="inventario-form">
      <h2 className="inventario-form-subtitulo">Cargar cotizaciones apartadas desde Excel</h2>
      <p className="inventario-carga-ayuda">
        Sube el Excel de control. Se lee la hoja <strong>SALIDA</strong> y se cargan las líneas de <strong>rollo</strong> de
        cotizaciones de clientes que todavía no tienen <strong>REFERENCIA</strong> (su producción no ha salido). Los productos de
        stock no se cargan. Las cotizaciones que ya estén cargadas no se repiten.
        Nada se guarda hasta que confirmes.
      </p>
      {!previa && !resultado && (
        <input
          type="file"
          accept=".xlsx,.xls,.xlsm"
          disabled={cargando}
          onChange={(e) => {
            const elegido = e.target.files?.[0] || null;
            setArchivo(elegido);
            if (elegido) enviar(false, elegido);
          }}
        />
      )}
      {cargando && <p className="inventario-cargando">Leyendo el archivo...</p>}
      {error && <p className="inventario-error">{error}</p>}
      {resultado && <p className="inventario-exito">{resultado}</p>}

      {previa && (
        <>
          <p className="inventario-exito" style={{ display: "block" }}>
            Se van a cargar <strong>{previa.total_apartados} cotizaciones</strong> ({previa.total_lineas} líneas).
            <br />
            <span style={{ fontWeight: 400 }}>
              No se cargan: {previa.lineas_producidas} líneas que ya tienen REFERENCIA (ya salieron), {previa.lineas_stock_ajuste} de STOCK/AJUSTE, {previa.lineas_traslado ?? 0} traslados entre bodegas y {previa.lineas_producto ?? 0} de productos de stock (tornillos, caballetes, perfiles…).
            </span>
          </p>
          {previa.omitidas.length > 0 && (
            <div className="inventario-error" style={{ display: "block" }}>
              <strong>{previa.omitidas.length} líneas no se pueden cargar</strong> (corrígelas en el Excel y vuelve a subirlo si las necesitas):
              <ul style={{ margin: "0.25rem 0 0" }}>
                {previa.omitidas.map((o) => (
                  <li key={`${o.fila}-${o.codigo}`}>Fila {o.fila} · cotización {o.cotizacion}{o.codigo ? ` · ${o.codigo}` : ""}: {o.motivo}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="inventario-tabla-contenedor" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="inventario-tabla">
              <thead>
                <tr><th>Cotización</th><th>Fecha</th><th>Bodega</th><th>Empresa</th><th>Cliente</th><th>Líneas</th></tr>
              </thead>
              <tbody>
                {previa.apartados.map((a) => (
                  <tr key={`${a.bodega_nombre}-${a.numero_cotizacion}`}>
                    <td>
                      <button type="button" className="inventario-boton-cancelar" style={{ padding: "0.2rem 0.5rem" }}
                        onClick={() => setAbierta(abierta === a.numero_cotizacion + a.bodega_nombre ? null : a.numero_cotizacion + a.bodega_nombre)}>
                        {abierta === a.numero_cotizacion + a.bodega_nombre ? "▲" : "▼"} {a.numero_cotizacion}
                      </button>
                    </td>
                    <td>{a.fecha}</td>
                    <td>{a.bodega_nombre}</td>
                    <td>{EMPRESAS[a.empresa] || a.empresa}</td>
                    <td>{a.cliente || "—"}</td>
                    <td>
                      {a.lineas.length}
                      {abierta === a.numero_cotizacion + a.bodega_nombre && (
                        <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1rem" }}>
                          {a.lineas.map((l) => (
                            <li key={l.fila}>
                              {l.codigo}: {l.cantidad}{l.modalidad === "por_rollo" ? " m" : " und"} — {l.descripcion}
                              {l.producto_nuevo && " (producto nuevo)"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="inventario-form-botones">
        {previa && previa.total_apartados > 0 && (
          <button type="button" className="inventario-boton" disabled={cargando} onClick={() => enviar(true)}>
            {cargando ? "Cargando..." : `Confirmar carga (${previa.total_apartados} cotizaciones)`}
          </button>
        )}
        <button type="button" className="inventario-boton-cancelar" onClick={alCerrar}>
          {resultado ? "Cerrar" : "Cancelar"}
        </button>
      </div>
    </section>
  );
}
