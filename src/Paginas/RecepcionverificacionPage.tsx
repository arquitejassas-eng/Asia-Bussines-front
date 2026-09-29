// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useState } from "react";
import BarraLateral from "../Componentes/BarraLateral";
import { formatearFechaColombia } from "../Utils/fechas";
import { useControladorRecepcion } from "../Componentes/Recepcionverificacion";
import { contarNotificaciones } from "../Utils/notificaciones";
import PanelAdminEquivalencias from "../Componentes/PanelAdminEquivalencias";
import PanelMaterialEnCamino from "../Componentes/PanelMaterialEnCamino";
import { api, ErrorApi } from "../Componentes/Api";
import { nombreEmpresa } from "../Utils/empresas";
import "../Style/Recepcionverificacion.css";

const ETIQUETAS_PROBLEMA_REFERENCIA = {
  ya_existe: { texto: "Ya existe — se omitirá", ayuda: "Este rollo ya está registrado en esta bodega; no se volverá a crear." },
  repetida_en_archivo: { texto: "Repetido en el Excel", ayuda: "Esta referencia aparece en más de una fila del archivo." },
  sin_referencia: { texto: "Sin referencia", ayuda: "La fila no trae la referencia (identificador único) del rollo." },
};

const ETIQUETAS_RESULTADO = {
  correcto: "Correcto",
  faltante: "Falta material",
  adicional: "Material adicional",
  faltan_datos: "Faltan datos",
};

// Estos son los ÚNICOS 4 estados que realmente devuelve el controlador
// (useControladorRecepcion -> estadoRecepcion). Antes había etiquetas para
// estados que el hook nunca produce.
const ETIQUETAS_ESTADO = {
  pendiente_verificacion: "Pendiente de verificación",
  verificada_sin_diferencias: "Verificada sin diferencias",
  verificada_con_diferencias: "Verificada con diferencias",
  registrada_en_inventario: "Registrada en inventario",
};

// Pantalla del módulo de Recepción: dibuja los 3 pasos (cargar, mapear,
// verificar/clasificar/confirmar) usando la lógica de useControladorRecepcion.
function RecepcionVerificacionPage({ sesion, onCerrarSesion, almacen }) {
  const c = useControladorRecepcion(sesion, almacen);

  // Contador de solicitudes de otras bodegas pendientes por responder, para
  // el badge de la barra lateral (mismo criterio que en Inventario y Bodegas).
  const notificaciones = contarNotificaciones(almacen, sesion);

  // Estado puramente visual: mostrar/ocultar el panel de administración de
  // tablas de equivalencias (puntos 5 y 6 del requerimiento). No necesita
  // vivir en el controlador porque no afecta ningún cálculo.
  const [mostrarAdmin, setMostrarAdmin] = useState(false);

  // ---- Material en camino: el mismo Excel del proveedor, guardado ANTES de
  // que llegue para poder apartarlo (solo Admin Inventario lo guarda). ----
  const esAdminInventario = sesion?.rol === "admin_inventario";
  const [guardandoEnCamino, setGuardandoEnCamino] = useState(false);
  const [errorEnCamino, setErrorEnCamino] = useState("");
  const [avisoEnCamino, setAvisoEnCamino] = useState("");
  const [recargarEnCamino, setRecargarEnCamino] = useState(0);
  const puedeGuardarEnCamino = c.rollos.length > 0 && c.resumenVerificacion.pendientesDatos === 0
    && c.referenciasConProblema === 0 && !guardandoEnCamino;

  async function guardarEnCamino() {
    if (!puedeGuardarEnCamino) return;
    setGuardandoEnCamino(true); setErrorEnCamino(""); setAvisoEnCamino("");
    try {
      const proveedor = c.rollos.find((r) => r.proveedor)?.proveedor || "";
      const guardado = await api.post("/recepcion/en-camino", { proveedor_principal: proveedor });
      setAvisoEnCamino(`Guardado como material en camino: ${guardado.total_rollos} rollos, ${guardado.total_metros} m. Ya se puede apartar desde cualquier bodega.`);
      c.iniciarNuevaRecepcion();
      setRecargarEnCamino((n) => n + 1);
    } catch (err) {
      setErrorEnCamino(err instanceof ErrorApi ? err.message : "No se pudo guardar el material en camino.");
    } finally {
      setGuardandoEnCamino(false);
    }
  }
  // Mismos roles que ROLES_EDITAN_EQUIVALENCIAS en backend/app/api/routes/recepcion.py.
  const puedeEditarEquivalencias = ["admin_inventario", "superadmin"].includes(sesion?.rol);

  // ---- Detección de equivalencias faltantes (para guiar a la encargada) ----
  // El controlador ya marca esMaterialNuevo (tipo/color sin equivalencia) y
  // pesoPorMetro === null (espesor sin equivalencia). Aquí solo agrupamos esa
  // información para mostrar avisos accionables en vez de un simple "Nuevo".
  const tiposFaltantes = [
    ...new Set(
      c.rollos.filter((r) => r.esMaterialNuevo && r.tipoMaterial).map((r) => r.tipoMaterial)
    ),
  ].filter(
    (tipo) => !c.tablaTipos.some((t) => t.nombre.trim().toLowerCase() === tipo.trim().toLowerCase())
  );

  const coloresFaltantes = [
    ...new Set(
      c.rollos.filter((r) => r.esMaterialNuevo && r.colorTop).map((r) => r.colorTop)
    ),
  ].filter(
    (ral) =>
      !c.tablaColores.some(
        (col) => col.ral.replace(/\s+/g, "").toUpperCase() === ral.replace(/\s+/g, "").toUpperCase()
      )
  );

  const espesoresFaltantes = [
    ...new Set(
      c.rollos.filter((r) => r.pesoPorMetro === null && r.espesor !== null).map((r) => r.espesor)
    ),
  ];

  const hayEquivalenciasFaltantes =
    tiposFaltantes.length > 0 || coloresFaltantes.length > 0 || espesoresFaltantes.length > 0;

  return (
    <div className="layout-con-sidebar">
      <BarraLateral sesion={sesion} onCerrarSesion={onCerrarSesion} notificaciones={notificaciones} />

      <div className="layout-contenido">
        <div className="recepcion-page">
          <main className="recepcion-contenido">
            <h2 className="recepcion-titulo">Recepción y Verificación de material</h2>
            <p className="recepcion-subtitulo">
              Carga el Excel del proveedor y el sistema calculará automáticamente los
              metros de cada rollo, clasificará el material con la nomenclatura interna,
              los comparará con lo reportado y te mostrará las diferencias antes de
              afectar el inventario.
            </p>

            <div className="recepcion-pasos">
              <span className={`recepcion-paso ${c.paso === "carga" ? "activo" : ""}`}>
                1. Cargar archivo
              </span>
              <span className={`recepcion-paso ${c.paso === "mapeo" ? "activo" : ""}`}>
                2. Verificar columnas
              </span>
              <span className={`recepcion-paso ${c.paso === "verificacion" ? "activo" : ""}`}>
                3. Verificación, clasificación y confirmación
              </span>
            </div>

            <section className="recepcion-tarjeta">
              <button
                className="recepcion-boton-secundario"
                onClick={() => setMostrarAdmin((actual) => !actual)}
              >
                {mostrarAdmin ? "Ocultar" : puedeEditarEquivalencias ? "Administrar" : "Ver"} tablas de equivalencias
              </button>

              {mostrarAdmin && !puedeEditarEquivalencias && (
                <p className="recepcion-texto-ayuda">
                  Estas tablas son de toda la empresa: solo Admin Inventario puede cambiarlas.
                </p>
              )}
              {mostrarAdmin && (
                <PanelAdminEquivalencias
                  puedeEditar={puedeEditarEquivalencias}
                  tablaColores={c.tablaColores}
                  tablaTipos={c.tablaTipos}
                  tablaEspesor={c.tablaEspesor}
                  agregarEquivalenciaColor={c.agregarEquivalenciaColor}
                  agregarEquivalenciaTipo={c.agregarEquivalenciaTipo}
                  agregarEquivalenciaEspesor={c.agregarEquivalenciaEspesor}
                />
              )}
            </section>

            {c.paso === "carga" && (
              <section className="recepcion-tarjeta">
                <h3>Cargar archivo del proveedor</h3>
                <p className="recepcion-texto-ayuda">
                  Formatos aceptados: .xlsx, .xls. La bodega de destino será{" "}
                  <strong>{sesion?.bodegaNombre}</strong> (la de tu sesión), no es necesario
                  seleccionarla.
                </p>
                <label className="recepcion-boton-cargar">
                  {c.procesandoArchivo ? "Procesando..." : "Seleccionar archivo Excel"}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={c.cargarArchivo}
                    disabled={c.procesandoArchivo}
                    hidden
                  />
                </label>
                {c.errorArchivo && <p className="recepcion-error">{c.errorArchivo}</p>}
              </section>
            )}

            {c.paso === "mapeo" && (
              <section className="recepcion-tarjeta">
                <h3>Verifica las columnas detectadas</h3>
                <p className="recepcion-texto-ayuda">
                  Archivo: <strong>{c.nombreArchivo}</strong>. El sistema intentó identificar
                  automáticamente cada columna; ajusta las que no correspondan.
                </p>
                {c.notaImportacionEquivalencias && (
                  <p className="recepcion-texto-ayuda recepcion-nota-importacion">
                    {c.notaImportacionEquivalencias.includes("no se importaron") ? "⚠" : "✓"} {c.notaImportacionEquivalencias}
                  </p>
                )}

                {c.hojasDisponibles.length > 1 && (
                  <div className="recepcion-mapeo-campo" style={{ maxWidth: 320, marginBottom: "1rem" }}>
                    <label>Hoja del Excel</label>
                    <select
                      value={c.hojaActual}
                      disabled={c.cambiandoHoja}
                      onChange={(e) => c.cambiarHoja(e.target.value)}
                    >
                      {c.hojasDisponibles.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="recepcion-mapeo-grid">
                  {c.TODOS_LOS_CAMPOS.map((campo) => (
                    <div key={campo} className="recepcion-mapeo-campo">
                      <label>
                        {c.ETIQUETAS_CAMPOS[campo]}
                        {c.CAMPOS_REQUERIDOS.includes(campo) && (
                          <span className="recepcion-req">*</span>
                        )}
                      </label>
                      <select
                        value={c.mapeoColumnas[campo] || ""}
                        onChange={(e) => c.actualizarMapeoColumna(campo, e.target.value)}
                      >
                        <option value="">— No aplica —</option>
                        {c.encabezados.map((enc) => (
                          <option key={enc} value={enc}>
                            {enc}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {c.faltanCamposRequeridos && (
                  <p className="recepcion-error">
                    Debes asignar una columna a todos los campos obligatorios (*).
                  </p>
                )}

                <div className="recepcion-acciones">
                  <button className="recepcion-boton-secundario" onClick={c.iniciarNuevaRecepcion}>
                    Cancelar
                  </button>
                  <button
                    className="recepcion-boton-primario"
                    onClick={c.confirmarMapeo}
                    disabled={c.faltanCamposRequeridos}
                  >
                    Calcular y verificar
                  </button>
                </div>
              </section>
            )}

            {c.paso === "verificacion" && (
              <>
                <section className="recepcion-tarjeta">
                  <div className="recepcion-resumen-header">
                    <h3>Resultado de la verificación</h3>
                    <span className={`recepcion-estado-badge estado-${c.estadoRecepcion}`}>
                      {ETIQUETAS_ESTADO[c.estadoRecepcion]}
                    </span>
                  </div>

                  <div className="recepcion-tolerancia">
                    <label>Margen de tolerancia (%)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={c.toleranciaPorcentaje}
                      onChange={(e) => c.actualizarTolerancia(e.target.value)}
                    />
                  </div>

                  <div className="recepcion-resumen-grid">
                    <div className="recepcion-resumen-item">
                      <span className="numero">{c.resumenVerificacion.total}</span>
                      <span>Rollos</span>
                    </div>
                    <div className="recepcion-resumen-item ok">
                      <span className="numero">{c.resumenVerificacion.correctos}</span>
                      <span>Correctos</span>
                    </div>
                    <div className="recepcion-resumen-item warn">
                      <span className="numero">{c.resumenVerificacion.faltantes}</span>
                      <span>Faltantes</span>
                    </div>
                    <div className="recepcion-resumen-item info">
                      <span className="numero">{c.resumenVerificacion.adicionales}</span>
                      <span>Adicionales</span>
                    </div>
                    <div className="recepcion-resumen-item danger">
                      <span className="numero">{c.resumenVerificacion.pendientesDatos}</span>
                      <span>Faltan datos</span>
                    </div>
                    <div className="recepcion-resumen-item">
                      <span className="numero">{c.resumenVerificacion.materialesNuevos}</span>
                      <span>Sin clasificar</span>
                    </div>
                  </div>
                </section>

                {hayEquivalenciasFaltantes && (
                  <section className="recepcion-tarjeta recepcion-aviso-equivalencias">
                    <h4>Hay equivalencias que aún no están configuradas</h4>
                    <p className="recepcion-texto-ayuda">
                      {puedeEditarEquivalencias
                        ? "Estos rollos no se pudieron clasificar o calcular porque falta agregar su equivalencia. Agrégalas en el panel de administración (más abajo) y el sistema recalculará todo automáticamente."
                        : "Estos rollos no se pudieron clasificar o calcular porque falta su equivalencia. Pídele a Admin Inventario que la agregue y luego vuelve a verificar el archivo."}
                    </p>
                    <ul className="recepcion-lista-faltantes">
                      {tiposFaltantes.map((tipo) => (
                        <li key={`tipo-${tipo}`}>
                          Tipo de material sin código interno: <strong>{tipo}</strong>
                        </li>
                      ))}
                      {coloresFaltantes.map((ral) => (
                        <li key={`color-${ral}`}>
                          Color sin equivalencia: <strong>{ral}</strong>
                        </li>
                      ))}
                      {espesoresFaltantes.map((esp) => (
                        <li key={`espesor-${esp}`}>
                          Espesor sin tabla de metros por tonelada: <strong>{esp}</strong>
                        </li>
                      ))}
                    </ul>
                    {puedeEditarEquivalencias && (
                      <button
                        className="recepcion-boton-secundario"
                        onClick={() => setMostrarAdmin(true)}
                      >
                        Ir a administrar tablas de equivalencias
                      </button>
                    )}
                  </section>
                )}

                <section className="recepcion-tarjeta recepcion-tabla-wrap">
                  <div className="recepcion-busqueda">
                    <label>Buscar por código de clasificación o rollo</label>
                    <input
                      type="text"
                      placeholder="Ej. LA50170,25 o 6010905CX"
                      value={c.busquedaClasificacion}
                      onChange={(e) => c.setBusquedaClasificacion(e.target.value)}
                    />
                  </div>

                  <table className="recepcion-tabla">
                    <thead>
                      <tr>
                        <th>Rollo (ID único)</th>
                        <th>Empresa</th>
                        <th>Código interno</th>
                        <th>Tipo / Color</th>
                        <th>Espesor</th>
                        <th>Net Weight (Ton)</th>
                        <th>Reportado (m)</th>
                        <th>Calculado (m)</th>
                        <th>Diferencia</th>
                        <th>Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rollos.map((r) => (
                        <tr key={r.id} className={r.esMaterialNuevo ? "fila-nueva" : ""}>
                          <td>
                            {r.rollo || "—"}
                            {r.problemaReferencia && (
                              <span className="recepcion-tag-nuevo" title={ETIQUETAS_PROBLEMA_REFERENCIA[r.problemaReferencia]?.ayuda}>
                                {ETIQUETAS_PROBLEMA_REFERENCIA[r.problemaReferencia]?.texto || r.problemaReferencia}
                              </span>
                            )}
                          </td>
                          <td>
                            {r.empresa ? (
                              nombreEmpresa(r.empresa)
                            ) : (
                              <span className="recepcion-texto-secundario" title="Sin columna de empresa receptora: se deduce de la referencia al guardar.">
                                Por referencia
                              </span>
                            )}
                          </td>
                          <td>
                            {r.clasificado ? (
                              r.codigoClasificacion
                            ) : (
                              <span className="recepcion-tag-nuevo">Sin clasificar</span>
                            )}
                          </td>
                          <td>
                            {r.tipoMaterial || "—"}
                            <br />
                            <span className="recepcion-texto-secundario">
                              {r.colorTop || "—"}
                              {r.colorBack ? ` / ${r.colorBack}` : ""}
                            </span>
                          </td>
                          <td>{r.espesor ?? "—"}</td>
                          <td>{r.netWeight ?? "—"}</td>
                          <td>{r.coilMeters ?? "—"}</td>
                          <td>{r.metrosCalculados ?? "—"}</td>
                          <td>
                            {r.diferencia === null
                              ? "—"
                              : `${r.diferencia > 0 ? "+" : ""}${r.diferencia} m`}
                          </td>
                          <td>
                            <span className={`recepcion-resultado resultado-${r.resultado}`}>
                              {ETIQUETAS_RESULTADO[r.resultado]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {c.rollos.length === 0 && (
                    <p className="recepcion-texto-ayuda">
                      No hay rollos que coincidan con la búsqueda.
                    </p>
                  )}
                </section>

                {c.estadoRecepcion !== "registrada_en_inventario" && c.referenciasConProblema > 0 && (
                  <p className="recepcion-error">
                    Hay {c.referenciasConProblema} rollo{c.referenciasConProblema === 1 ? "" : "s"} sin referencia o con la
                    referencia repetida dentro del Excel. Deja una sola fila por rollo, corrige el archivo y vuelve a subirlo.
                  </p>
                )}
                {c.estadoRecepcion !== "registrada_en_inventario" && c.referenciasYaRegistradas > 0 && (
                  <p className="recepcion-texto-ayuda">
                    {c.hayRollosNuevos
                      ? `${c.referenciasYaRegistradas} rollo${c.referenciasYaRegistradas === 1 ? " ya está registrado" : "s ya están registrados"} en esta bodega (marcados "Ya existe") y se omitirán al confirmar.`
                      : "Todos los rollos de este archivo ya están registrados en esta bodega: no hay nada nuevo que confirmar."}
                  </p>
                )}
                {c.errorConfirmacion && <p className="recepcion-error">{c.errorConfirmacion}</p>}

                <div className="recepcion-acciones">
                  <button className="recepcion-boton-secundario" onClick={c.volverAMapeo}>
                    ← Ajustar columnas
                  </button>
                  {c.estadoRecepcion === "registrada_en_inventario" ? (
                    <button className="recepcion-boton-primario" onClick={c.iniciarNuevaRecepcion}>
                      Cargar otra recepción
                    </button>
                  ) : (
                    <button
                      className="recepcion-boton-primario"
                      onClick={c.confirmarRecepcion}
                      disabled={!c.puedeConfirmar}
                      title={
                        !c.puedeConfirmar
                          ? "Resuelve los rollos con 'Faltan datos' o con problemas de referencia antes de confirmar"
                          : ""
                      }
                    >
                      {c.confirmando ? "Confirmando..." : "Confirmar recepción"}
                    </button>
                  )}
                </div>

                {esAdminInventario && c.estadoRecepcion !== "registrada_en_inventario" && (
                  <section className="recepcion-tarjeta">
                    <h3>¿Este material todavía no ha llegado?</h3>
                    <p className="recepcion-texto-ayuda">
                      Si este Excel es el checklist de un pedido que viene en camino, guárdalo como
                      <strong> material en camino</strong>: no entra al inventario, pero ya se puede apartar desde
                      cualquier bodega. Cada vez que llegue una mula, subes sus rollos aquí, le das "Confirmar
                      recepción" y los marcas como llegados en la lista de abajo.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        className="recepcion-boton-secundario"
                        onClick={guardarEnCamino}
                        disabled={!puedeGuardarEnCamino}
                      >
                        {guardandoEnCamino ? "Guardando..." : "Guardar como material en camino"}
                      </button>
                    </div>
                    {errorEnCamino && <p className="recepcion-error">{errorEnCamino}</p>}
                  </section>
                )}

                {c.estadoRecepcion === "registrada_en_inventario" && (
                  <p className="recepcion-exito">
                    Recepción confirmada. El inventario de {sesion?.bodegaNombre} fue actualizado.
                  </p>
                )}
                {c.estadoRecepcion === "registrada_en_inventario" && c.avisoConfirmacion && (
                  <p className="recepcion-texto-ayuda">{c.avisoConfirmacion}</p>
                )}
              </>
            )}

            {avisoEnCamino && <p className="recepcion-exito">{avisoEnCamino}</p>}

            <PanelMaterialEnCamino puedeGestionar={esAdminInventario} recargar={recargarEnCamino} />

            {c.historialRecepciones.length > 0 && (
              <section className="recepcion-tarjeta">
                <h3>Historial de recepciones de esta sesión</h3>
                <table className="recepcion-tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Proveedor</th>
                      <th>Archivo</th>
                      <th>Rollos</th>
                      <th>Con diferencias</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.historialRecepciones.map((rec) => (
                      <tr key={rec.id}>
                        <td>{formatearFechaColombia(rec.fecha)}</td>
                        <td>{rec.proveedor}</td>
                        <td>{rec.archivoOrigen}</td>
                        <td>{rec.resumen.total}</td>
                        <td>{rec.resumen.faltantes + rec.resumen.adicionales}</td>
                        <td>{ETIQUETAS_ESTADO[rec.estado]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default RecepcionVerificacionPage;
