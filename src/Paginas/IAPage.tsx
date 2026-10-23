import { useCallback, useEffect, useState } from "react";
import BarraLateral from "../Componentes/BarraLateral";
import { api, ErrorApi } from "../Componentes/Api";
import { alertaIaDesdeApi, prediccionNegocioDesdeApi, prediccionStockDesdeApi } from "../Componentes/Mapeo";
import "../Style/IA.css";
import type { Sesion } from "../types/dominio";

type Mensaje = { id: string; rol: "usuario" | "ia"; texto: string; fecha: string };

const PREGUNTAS_SUGERIDAS = [
  { icono: "↓", titulo: "Stock bajo", texto: "¿Qué productos tienen el stock más bajo?" },
  { icono: "↔", titulo: "Movimientos", texto: "Hazme un resumen de los movimientos de esta semana" },
  { icono: "◌", titulo: "Rollos", texto: "¿Cuántos rollos tengo disponibles para producción?" },
  { icono: "↗", titulo: "Planeación", texto: "¿Qué debería reabastecer pronto?" },
];

let siguienteIdMensaje = 1;
function generarIdMensaje() {
  return `msg-${Date.now()}-${siguienteIdMensaje++}`;
}

function horaMensaje(fecha: string) {
  return new Date(fecha).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

function useControladorIa(sesion: Sesion) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [textoChat, setTextoChat] = useState("");
  const [enviandoChat, setEnviandoChat] = useState(false);
  const [errorChat, setErrorChat] = useState("");

  async function enviarTexto(texto: string) {
    const limpio = texto.trim();
    if (!limpio || enviandoChat) return;

    setErrorChat("");
    const mensajeUsuario: Mensaje = { id: generarIdMensaje(), rol: "usuario", texto: limpio, fecha: new Date().toISOString() };
    const historialParaApi = [...mensajes, mensajeUsuario].map((m) => ({ rol: m.rol, texto: m.texto }));

    setMensajes((actual) => [...actual, mensajeUsuario]);
    setTextoChat("");
    setEnviandoChat(true);

    try {
      const respuesta = await api.post<{ respuesta: string }>("/ia/chat", {
        mensaje: limpio,
        historial: historialParaApi,
        bodega_id: sesion?.bodegaId ?? null,
      });
      setMensajes((actual) => [
        ...actual,
        { id: generarIdMensaje(), rol: "ia", texto: respuesta?.respuesta ?? "", fecha: new Date().toISOString() },
      ]);
    } catch (err) {
      setErrorChat(err instanceof ErrorApi ? err.message : "No se pudo obtener respuesta del asistente.");
    } finally {
      setEnviandoChat(false);
    }
  }

  const enviarMensaje = (evento: { preventDefault: () => void }) => {
    evento.preventDefault();
    enviarTexto(textoChat);
  };

  const [alertas, setAlertas] = useState<ReturnType<typeof alertaIaDesdeApi>[]>([]);
  const [cargandoAlertas, setCargandoAlertas] = useState(true);
  // Si fallan, se avisa: antes quedaba vacío y parecía que no había alertas críticas.
  const [errorAlertas, setErrorAlertas] = useState("");
  const cargarAlertas = useCallback(async () => {
    setCargandoAlertas(true);
    setErrorAlertas("");
    try {
      const datos = await api.get<Record<string, unknown>[]>("/ia/alertas");
      setAlertas((datos ?? []).map(alertaIaDesdeApi));
    } catch {
      setAlertas([]);
      setErrorAlertas("No se pudieron revisar las alertas de inventario. Recarga la página para intentar de nuevo.");
    } finally {
      setCargandoAlertas(false);
    }
  }, []);

  useEffect(() => { cargarAlertas(); }, [cargarAlertas]);

  const [prediccionNegocio, setPrediccionNegocio] = useState<ReturnType<typeof prediccionNegocioDesdeApi> | null>(null);
  const [prediccionesStock, setPrediccionesStock] = useState<ReturnType<typeof prediccionStockDesdeApi>[]>([]);
  const [cargandoPredicciones, setCargandoPredicciones] = useState(true);
  const cargarPredicciones = useCallback(async () => {
    setCargandoPredicciones(true);
    try {
      const [negocio, stock] = await Promise.all([
        api.get<Record<string, unknown>>("/ia/predicciones/negocio"),
        api.get<Record<string, unknown>[]>("/ia/predicciones/stock"),
      ]);
      if (!negocio || !stock) throw new Error("Respuesta vacía del servidor.");
      setPrediccionNegocio(prediccionNegocioDesdeApi(negocio));
      setPrediccionesStock(
        stock
          .map(prediccionStockDesdeApi)
          .filter((p) => p.diasEstimadosAgotamiento !== null)
          .sort((a, b) => (a.diasEstimadosAgotamiento as number) - (b.diasEstimadosAgotamiento as number))
          .slice(0, 5)
      );
    } catch {
      setPrediccionNegocio(null);
      setPrediccionesStock([]);
    } finally {
      setCargandoPredicciones(false);
    }
  }, []);

  useEffect(() => { cargarPredicciones(); }, [cargarPredicciones]);

  return {
    mensajes, textoChat, setTextoChat, enviandoChat, errorChat,
    enviarMensaje, enviarSugerencia: enviarTexto,
    limpiarChat: () => { setMensajes([]); setErrorChat(""); },
    alertas, cargandoAlertas, errorAlertas,
    prediccionNegocio, prediccionesStock, cargandoPredicciones,
  };
}

function IAPage({ sesion, onCerrarSesion }: { sesion: Sesion; onCerrarSesion: () => void }) {
  const ia = useControladorIa(sesion);
  const [alertaExpandida, setAlertaExpandida] = useState(false);
  const alertasCriticas = ia.alertas.filter((a) => a.nivel === "critico");

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={alertasCriticas.length} />
      <main className="layout-contenido">
        <div className="ia-page">
          <header className="ia-hero">
            <div className="ia-identidad">
              <div className="ia-avatar ia-avatar-principal" aria-hidden="true">✦</div>
              <div>
                <p className="ia-eyebrow">ARQUITEJAS · INTELIGENCIA DE NEGOCIO</p>
                <h1 className="ia-titulo">Asistente de operaciones</h1>
                <p className="ia-subtitulo">Consulta el estado de {sesion?.bodegaNombre || "tu bodega"} y toma decisiones con tus datos.</p>
              </div>
            </div>
            <div className="ia-estado"><span className="ia-estado-punto" /> Disponible ahora</div>
          </header>

          {ia.errorAlertas && <p className="inventario-error" style={{ margin: "0 0 1rem" }}>{ia.errorAlertas}</p>}
          {alertasCriticas.length > 0 && (
            <section className="ia-alerta-banner">
              <button className="ia-alerta-banner-boton" onClick={() => setAlertaExpandida((valor) => !valor)}>
                <span className="ia-alerta-icono">!</span>
                <span><strong>Atención requerida</strong><small>{alertasCriticas.length} {alertasCriticas.length === 1 ? "alerta crítica" : "alertas críticas"} de inventario</small></span>
                <span className="ia-alerta-banner-flecha">{alertaExpandida ? "⌃" : "⌄"}</span>
              </button>
              {alertaExpandida && (
                <ul className="ia-alerta-banner-lista">
                  {alertasCriticas.map((alerta) => <li key={alerta.id}><strong>{alerta.titulo}</strong><span>{alerta.mensaje}</span></li>)}
                </ul>
              )}
            </section>
          )}

          {!ia.cargandoPredicciones && ia.prediccionNegocio && (
            <section className="ia-prediccion-panel" aria-label="Predicción del negocio">
              <div className="ia-prediccion-cabecera">
                <h2>Predicción del negocio</h2>
                <span className={`ia-tendencia-badge tendencia-${ia.prediccionNegocio.tendencia}`}>
                  {ia.prediccionNegocio.tendencia === "creciente" && "↑ Creciente"}
                  {ia.prediccionNegocio.tendencia === "decreciente" && "↓ Decreciente"}
                  {ia.prediccionNegocio.tendencia === "estable" && "→ Estable"}
                </span>
              </div>
              <p className="ia-prediccion-resumen">{ia.prediccionNegocio.resumen}</p>

              {ia.prediccionNegocio.recomendaciones.length > 0 && (
                <ul className="ia-prediccion-lista">
                  {ia.prediccionNegocio.recomendaciones.map((texto, i) => (
                    <li key={i}>{texto}</li>
                  ))}
                </ul>
              )}

              {ia.prediccionesStock.length > 0 && (
                <>
                  <h3>Productos a vigilar</h3>
                  <table className="ia-prediccion-tabla">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Stock</th>
                        <th>Días estimados</th>
                        <th>Reabastecer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ia.prediccionesStock.map((p) => (
                        <tr key={p.productoId}>
                          <td>{p.productoCodigo} — {p.productoDescripcion}</td>
                          <td>{p.stockActual}</td>
                          <td>{p.diasEstimadosAgotamiento}</td>
                          <td>{p.cantidadSugeridaReabastecer ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>
          )}

          <section className="ia-chat-panel" aria-label="Chat con asistente de operaciones">
            <div className="ia-chat-cabecera">
              <div className="ia-avatar ia-avatar-chat" aria-hidden="true">✦</div>
              <div><strong>Asistente Arquitejas</strong><span>Inventario, rollos y abastecimiento</span></div>
              {ia.mensajes.length > 0 && <button className="ia-limpiar" type="button" onClick={ia.limpiarChat}>Nueva consulta</button>}
            </div>

            <div className="ia-chat-mensajes" aria-live="polite">
              {ia.mensajes.length === 0 ? (
                <div className="ia-bienvenida">
                  <div className="ia-bienvenida-icono" aria-hidden="true">✦</div>
                  <h2>¿Qué deseas revisar hoy?</h2>
                  <p>Puedo ayudarte a entender el inventario, los rollos disponibles y las prioridades de abastecimiento.</p>
                  <div className="ia-sugerencias">
                    {PREGUNTAS_SUGERIDAS.map((pregunta) => (
                      <button key={pregunta.titulo} className="ia-sugerencia-chip" onClick={() => ia.enviarSugerencia(pregunta.texto)} disabled={ia.enviandoChat}>
                        <span className="ia-sugerencia-icono" aria-hidden="true">{pregunta.icono}</span>
                        <span><strong>{pregunta.titulo}</strong><small>{pregunta.texto}</small></span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : ia.mensajes.map((mensaje) => (
                <article key={mensaje.id} className={`ia-mensaje ia-mensaje-${mensaje.rol}`}>
                  {mensaje.rol === "ia" && <div className="ia-avatar ia-avatar-mensaje" aria-hidden="true">✦</div>}
                  <div className="ia-mensaje-contenido">
                    <p>{mensaje.texto}</p>
                    <time dateTime={mensaje.fecha}>{mensaje.rol === "ia" ? "Asistente · " : "Tú · "}{horaMensaje(mensaje.fecha)}</time>
                  </div>
                </article>
              ))}
              {ia.enviandoChat && (
                <article className="ia-mensaje ia-mensaje-ia ia-mensaje-cargando">
                  <div className="ia-avatar ia-avatar-mensaje" aria-hidden="true">✦</div>
                  <div className="ia-typing"><span /><span /><span /></div>
                </article>
              )}
            </div>

            {ia.errorChat && <p className="ia-error" role="alert">No pude completar la consulta: {ia.errorChat}</p>}

            <form className="ia-chat-form" onSubmit={ia.enviarMensaje}>
              <input type="text" placeholder="Pregunta por el inventario, rollos o abastecimiento…" value={ia.textoChat} onChange={(e) => ia.setTextoChat(e.target.value)} disabled={ia.enviandoChat} />
              <button type="submit" className="ia-boton-enviar" disabled={ia.enviandoChat || !ia.textoChat.trim()} aria-label="Enviar pregunta">↑</button>
            </form>
            <p className="ia-nota">Las respuestas se generan con la información registrada en tu bodega.</p>
          </section>
        </div>
      </main>
    </div>
  );
}

export default IAPage;
