import { useCallback, useEffect, useState } from "react";
import { api, ErrorApi } from "./Api";
import ModalConfirmacion from "./ModalConfirmacion";
import { EMPRESAS } from "../Utils/empresas";
import { formatearFechaColombia } from "../Utils/fechas";

type RolloControlado = { id: number; referencia: string; bodega: string; bodega_id: number; empresa: string; metros: number; importacion: string; vendido: boolean };
type RolloOtraBodega = { id: number; referencia: string; metros: number };
type OtraBodega = { bodega: string; bodega_id: number; empresa: string; metros: number; rollos?: RolloOtraBodega[] };
export type AlertaImportacion = {
  id: number; apartado_id: number | null; numero_cotizacion: string; cliente: string; empresa_cotizacion: string;
  bodega_id: number | null; bodega: string; codigo: string; descripcion: string; empresa_linea: string;
  metros_requeridos: number; metros_en_bodega: number; metros_faltantes: number;
  importaciones: { clave: string; nombre: string }[];
  opciones: { otras_bodegas?: OtraBodega[]; rollos_controlados?: RolloControlado[] };
  estado: string; fecha_creacion: string; decidida_por: string; fecha_decision: string | null; nota: string;
};
export type DatosVenta = {
  rollo_id: number; referencia: string; codigo: string; metros: number; bodega_id: number;
  empresa_vende: string; empresa_compra: string; cliente: string; numero_cotizacion: string;
};

const ESTADOS: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: "Pendiente de decisión", color: "#b3261e" },
  autorizada: { texto: "Autorizada", color: "#1b7a3a" },
  anulada: { texto: "Cotización anulada", color: "#666" },
  resuelta: { texto: "Ya no hace falta", color: "#1b7a3a" },
};
const m = (n: number) => `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;
const empresa = (sigla: string) => EMPRESAS[sigla] || sigla || "—";

/** Admin Inventario: cotizaciones a las que les falta material en su bodega
 * y hay de una importación que solo se vende en rollo completo. Decide:
 * autorizar con otro material, vender el rollo completo o anular. Las importaciones
 * se marcan en Recepción y Verificación. */
export default function PanelAlertasImportacion({ alAbrirVenta, alCambiar }: {
  alAbrirVenta: (datos: DatosVenta) => void;
  alCambiar: () => void;
}) {
  const [alertas, setAlertas] = useState<AlertaImportacion[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [autorizando, setAutorizando] = useState<AlertaImportacion | null>(null);
  const [confirmar, setConfirmar] = useState<{ titulo: string; mensaje: string; texto: string; ejecutar: () => Promise<void> } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const a = await api.get<AlertaImportacion[]>(`/importaciones-controladas/alertas${verHistorial ? "?todas=true" : ""}`);
      setAlertas(a || []);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudieron cargar las alertas de importaciones.");
    }
  }, [verHistorial]);
  useEffect(() => { cargar(); }, [cargar]);

  async function ejecutar(accion: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await accion();
      await cargar();
      alCambiar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo hacer.");
    } finally {
      setOcupado(false);
    }
  }

  async function vender(alerta: AlertaImportacion, rollo: RolloControlado) {
    setError("");
    try {
      const datos = await api.post<DatosVenta>(`/importaciones-controladas/alertas/${alerta.id}/vender`, { rollo_id: rollo.id });
      if (datos) alAbrirVenta(datos);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo preparar la venta.");
    }
  }

  const pendientes = alertas.filter((a) => a.estado === "pendiente");
  if (!alertas.length && !verHistorial) return null;

  const boton = { padding: "0.2rem 0.6rem", fontSize: "0.8rem", minHeight: 0 } as const;
  const fila = { margin: "0.15rem 0", fontSize: "0.88rem" } as const;

  return (
    <section style={{ marginBottom: "0.75rem", padding: "0.6rem 0.9rem", borderRadius: "10px",
      background: pendientes.length ? "#fdf1ef" : "var(--at-tarjeta, #fff)", border: `1px solid ${pendientes.length ? "#e7b4ad" : "#e2d9cc"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ color: pendientes.length ? "#b3261e" : undefined }}
          title="Rollos de importaciones que solo se venden completos: no se les sacan metros. Mientras decides, la cotización no puede ir a producción. Las importaciones se marcan en Recepción y Verificación.">
          {pendientes.length ? `⚠ ${pendientes.length} cotizaci${pendientes.length === 1 ? "ón necesita" : "ones necesitan"} tu autorización` : "Alertas de importaciones"}
        </strong>
        <label className="apartados-check" style={{ fontSize: "0.8rem" }}>
          <input type="checkbox" checked={verHistorial} onChange={(e) => setVerHistorial(e.target.checked)} /> Ver decididas
        </label>
      </div>
      {error && <p className="inventario-error" style={fila}>{error}</p>}
      {aviso && <p style={{ ...fila, color: "#1b7a3a" }}>✔ {aviso}</p>}

      {alertas.length === 0 ? (
        <p style={fila}>{verHistorial ? "Todavía no hay alertas." : "Nada pendiente."}</p>
      ) : alertas.map((a) => {
        const estado = ESTADOS[a.estado] || { texto: a.estado, color: "#666" };
        const rollos = a.opciones.rollos_controlados || [];
        const otras = a.opciones.otras_bodegas || [];
        const compra = a.empresa_linea && EMPRESAS[a.empresa_linea] ? a.empresa_linea : a.empresa_cotizacion;
        const pendiente = a.estado === "pendiente";
        return (
          <div key={a.id} style={{ borderTop: "1px solid #ead9d4", marginTop: "0.45rem", paddingTop: "0.45rem" }}>
            <p style={{ ...fila, fontSize: "0.92rem" }}>
              <strong>Cot. {a.numero_cotizacion}</strong>{a.cliente ? ` · ${a.cliente}` : ""} · {a.bodega} — <strong>{a.codigo}</strong> ({empresa(a.empresa_linea)}):{" "}
              <span style={{ color: "#b3261e" }}>faltan <strong>{m(a.metros_faltantes)}</strong></span>
              <span style={{ color: "#777" }}> (pide {m(a.metros_requeridos)}, hay {m(a.metros_en_bodega)})</span>
              {!pendiente && <strong style={{ color: estado.color }}> · {estado.texto}</strong>}
            </p>
            {pendiente && (
              <>
                {otras.length > 0 && (
                  <p style={fila}>
                    ✔ Otro material: {otras.map((o) => `${o.bodega} ${m(o.metros)}${o.empresa !== compra && compra ? ` (de ${empresa(o.empresa)}, préstamo)` : ""}`).join(" · ")}
                  </p>
                )}
                {rollos.map((r) => (
                  <p key={r.id} style={{ ...fila, display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                    <span>🔒 {r.referencia} · {r.bodega} · {m(r.metros)} <span style={{ color: "#777" }}>(solo completo)</span>{r.vendido ? " · ya vendido" : ""}</span>
                    {!r.vendido && r.empresa !== compra && compra && (
                      <button type="button" className="inventario-boton" style={boton} onClick={() => vender(a, r)}>Vender a {empresa(compra)}</button>
                    )}
                  </p>
                ))}
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.3rem" }}>
                  <button type="button" className="inventario-boton" style={{ ...boton, background: "#1b7a3a" }} disabled={ocupado}
                    onClick={() => setAutorizando(a)}>
                    Autorizar y pedir traslado
                  </button>
                  <button type="button" className="inventario-boton-eliminar" style={boton} disabled={ocupado}
                    onClick={() => setConfirmar({ titulo: `¿Anular la cotización ${a.numero_cotizacion}?`, texto: "Sí, anular",
                      mensaje: "Se anula como siempre (todas sus partes): lo apartado queda libre y no se descuenta nada.",
                      ejecutar: () => ejecutar(() => api.post(`/importaciones-controladas/alertas/${a.id}/anular`, {})) })}>
                    Anular
                  </button>
                </div>
              </>
            )}
            {!pendiente && (a.decidida_por || a.nota) && (
              <p style={{ ...fila, color: "#777", fontSize: "0.8rem" }}>
                {a.decidida_por && `Decidió ${a.decidida_por}`}{a.fecha_decision ? ` el ${formatearFechaColombia(a.fecha_decision)}` : ""}{a.nota ? ` · ${a.nota}` : ""}
              </p>
            )}
            {pendiente && a.nota && <p style={{ ...fila, color: "#777", fontSize: "0.8rem" }}>{a.nota}</p>}
          </div>
        );
      })}
      {autorizando && (
        <ModalAutorizar alerta={autorizando} alCerrar={() => setAutorizando(null)}
          alTerminar={async (mensaje) => { setAutorizando(null); await cargar(); alCambiar(); setAviso(mensaje); }} />
      )}
      {confirmar && (
        <ModalConfirmacion titulo={confirmar.titulo} mensaje={confirmar.mensaje} textoConfirmar={confirmar.texto} textoCancelar="No, volver"
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => { const accion = confirmar.ejecutar; setConfirmar(null); accion(); }} />
      )}
    </section>
  );
}

/** Autorizar: escoge los rollos de otra bodega y pide el traslado (o
 * préstamo) de una vez para la bodega de la cotización. Los rollos de la
 * importación controlada siguen sin poder cortarse. */
function ModalAutorizar({ alerta, alCerrar, alTerminar }: {
  alerta: AlertaImportacion; alCerrar: () => void; alTerminar: (mensaje: string) => void;
}) {
  // Al abrir se consulta la alerta de nuevo: los rollos de otras bodegas
  // cambian (traslados, ventas) y la lista de la página puede estar vieja.
  const [fresca, setFresca] = useState<AlertaImportacion | null>(null);
  useEffect(() => {
    let vivo = true;
    api.get<AlertaImportacion[]>("/importaciones-controladas/alertas")
      .then((lista) => { if (vivo) setFresca((lista || []).find((a) => a.id === alerta.id) || alerta); })
      .catch(() => { if (vivo) setFresca(alerta); });
    return () => { vivo = false; };
  }, [alerta]);
  if (!fresca) {
    return (
      <div className="rollos-modal-fondo" onClick={alCerrar}>
        <div className="rollos-modal" role="dialog" aria-modal="true"><p>Buscando rollos en otras bodegas...</p></div>
      </div>
    );
  }
  return <ModalAutorizarContenido alerta={fresca} alCerrar={alCerrar} alTerminar={alTerminar} />;
}

function ModalAutorizarContenido({ alerta, alCerrar, alTerminar }: {
  alerta: AlertaImportacion; alCerrar: () => void; alTerminar: (mensaje: string) => void;
}) {
  const compra = alerta.empresa_linea && EMPRESAS[alerta.empresa_linea] ? alerta.empresa_linea : alerta.empresa_cotizacion;
  const grupos = (alerta.opciones.otras_bodegas || []).filter((o) => (o.rollos || []).length > 0)
    .sort((x, y) => Number(x.empresa !== compra) - Number(y.empresa !== compra));
  // Quedan marcados de una vez los rollos de la misma empresa (los más
  // grandes primero) hasta cubrir lo que falta.
  const [marcados, setMarcados] = useState<Set<number>>(() => {
    const ids = new Set<number>();
    let suma = 0;
    for (const g of grupos) {
      if (compra && g.empresa !== compra) continue;
      for (const r of g.rollos || []) {
        if (suma >= alerta.metros_faltantes) break;
        ids.add(r.id);
        suma += r.metros;
      }
    }
    return ids;
  });
  const [tipo, setTipo] = useState("solicitud");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const todos = grupos.flatMap((g) => (g.rollos || []).map((r) => ({ ...r, bodega: g.bodega, empresa: g.empresa })));
  const escogidos = todos.filter((r) => marcados.has(r.id));
  const metros = escogidos.reduce((t, r) => t + r.metros, 0);
  const palabra = tipo === "prestamo" ? "préstamo" : "traslado";

  function cambiar(id: number) {
    setMarcados((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function autorizar() {
    if (!alerta.bodega_id && escogidos.length) { setError("No se sabe la bodega de la cotización."); return; }
    setEnviando(true);
    setError("");
    const pedidos: string[] = [];
    try {
      for (const r of escogidos) {
        await api.post("/bodegas/solicitudes", {
          rollo_id: r.id, bodega_destino_id: alerta.bodega_id, tipo_operacion: tipo,
          numero_cotizacion: alerta.numero_cotizacion,
          observaciones: `Para la cotización ${alerta.numero_cotizacion} (alerta de importación).`,
        });
        pedidos.push(`${r.referencia} de ${r.bodega}`);
      }
      const nota = pedidos.length
        ? `Autorizada: se pidió ${palabra} de ${pedidos.join(", ")} para ${alerta.bodega}.`
        : "Autorizada sin pedir traslado (se cubre con otro material).";
      await api.post(`/importaciones-controladas/alertas/${alerta.id}/autorizar`, { nota: nota.slice(0, 400) });
      alTerminar(`Cotización ${alerta.numero_cotizacion} autorizada.${pedidos.length ? ` Se pidió ${pedidos.join(", ")}: esa bodega lo debe aceptar y despachar.` : ""}`);
    } catch (e) {
      const msg = e instanceof ErrorApi || e instanceof Error ? e.message : "No se pudo.";
      setError(pedidos.length
        ? `Se alcanzó a pedir ${pedidos.join(", ")}, pero falló el siguiente: ${msg} La cotización todavía NO está autorizada.`
        : msg);
      setEnviando(false);
    }
  }

  return (
    <div className="rollos-modal-fondo" onClick={alCerrar}>
      <div className="rollos-modal" role="dialog" aria-modal="true" aria-labelledby="autorizar-titulo"
        onClick={(e) => e.stopPropagation()} style={{ maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}>
        <h3 id="autorizar-titulo">Autorizar cotización {alerta.numero_cotizacion}</h3>
        <p className="rollos-texto-ayuda">
          A {alerta.bodega} le faltan <strong>{m(alerta.metros_faltantes)}</strong> de {alerta.codigo}. Escoge de dónde
          traerlos: se pide el {palabra} para <strong>{alerta.bodega}</strong> y la cotización queda autorizada. Los rollos
          de la importación siguen sin poder cortarse.
        </p>
        {todos.length === 0 ? (
          <p className="rollos-texto-ayuda">No hay rollos de este código en otras bodegas. Puedes autorizar igual si lo vas a cubrir de otra forma.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.3rem", margin: "0.5rem 0" }}>
            {todos.map((r) => (
              <label key={r.id} className="apartados-check" style={{ fontSize: "0.9rem" }}>
                <input type="checkbox" checked={marcados.has(r.id)} onChange={() => cambiar(r.id)} />{" "}
                {r.referencia} · {r.bodega} · {m(r.metros)}
                {compra && r.empresa !== compra && <span style={{ color: "#b3261e" }}> (es de {empresa(r.empresa)})</span>}
              </label>
            ))}
          </div>
        )}
        {escogidos.length > 0 && (
          <>
            <p style={{ margin: "0.25rem 0", fontSize: "0.9rem", color: metros + 0.01 < alerta.metros_faltantes ? "#b3261e" : "#1b7a3a" }}>
              Escogiste {m(metros)} de {m(alerta.metros_faltantes)} que faltan.
            </p>
            <label>
              Tipo
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="solicitud">Traslado (se queda allá)</option>
                <option value="prestamo">Préstamo (el rollo vuelve cuando tú digas)</option>
              </select>
            </label>
          </>
        )}
        {error && <p className="rollos-error" role="alert">{error}</p>}
        <div className="rollos-modal-acciones">
          <button type="button" className="rollos-boton-secundario" onClick={alCerrar}>Cancelar</button>
          <button type="button" className="rollos-boton-primario" disabled={enviando} onClick={autorizar}>
            {enviando ? "Autorizando..."
              : escogidos.length ? `Pedir ${escogidos.length === 1 ? "el rollo" : `${escogidos.length} rollos`} y autorizar`
              : "Autorizar sin pedir traslado"}
          </button>
        </div>
      </div>
    </div>
  );
}
