// @ts-nocheck -- contrato de controlador pendiente de centralizar.
import { useState } from "react";
import { FAMILIA_PORCELANATO, FAMILIA_TEJA, normalizarFamilia } from "../Hooks/useProductosInventario";
import PanelAdminUnidadesFamilia from "./PanelAdminUnidadesFamilia";
import ModalConfirmacion from "./ModalConfirmacion";
import { anchoPorSeccion } from "../Utils/produccion";
import { esSegundaPorCodigo, longitudDesdeCodigo, calibrePantalla } from "../Utils/teja";

// Pestaña "Productos" de Inventario: buscador, formulario de alta/edición y
// tarjetas agrupadas por familia. Extraído de InventarioPage.tsx sin cambiar
// props ni comportamiento -- el estado que solo usaba esta pestaña
// (mostrarAdminUnidades, gruposFamiliaExpandidos, actualizarFamiliaFormulario)
// se movió aquí junto con la sección, ya que no se usaba en ningún otro lado.
function PanelProductosInventario({
  almacen,
  mostrarFormularioProducto,
  abrirFormularioNuevoProducto,
  busquedaProducto,
  cambiarBusquedaProducto,
  guardarProducto,
  editandoProductoId,
  formularioProducto,
  actualizarCampoProducto,
  cerrarFormularioProducto,
  errorProductos,
  guardandoProducto,
  cargandoProductos,
  gruposPorFamilia,
  abrirFormularioEdicionProducto,
  eliminarProducto,
  prepararEntradaProducto,
  setPestanaActiva,
}) {
  const [mostrarAdminUnidades, setMostrarAdminUnidades] = useState(false);
  const [gruposFamiliaExpandidos, setGruposFamiliaExpandidos] = useState({});
  const [productoAEliminar, setProductoAEliminar] = useState(null);

  function alternarGrupoFamilia(familia) {
    setGruposFamiliaExpandidos((actual) => ({ ...actual, [familia]: !actual[familia] }));
  }

  // El campo "m² por caja" solo tiene sentido para Porcelanato (ver el
  // condicional en el JSX del formulario, más abajo). Si la familia deja de
  // ser Porcelanato mientras se edita, también se limpia el valor ya
  // escrito -- de lo contrario quedaría oculto pero se seguiría guardando
  // al enviar el formulario, revirtiendo el arreglo de forma silenciosa.
  function actualizarFamiliaFormulario(valorNuevo) {
    const eraPorcelanato = normalizarFamilia(formularioProducto.familia) === FAMILIA_PORCELANATO;
    const esPorcelanato = normalizarFamilia(valorNuevo) === FAMILIA_PORCELANATO;
    actualizarCampoProducto("familia", valorNuevo);
    if (eraPorcelanato && !esPorcelanato) actualizarCampoProducto("metrosPorUnidad", "");
  }

  return (
    <div>
      <div className="inventario-header">
        <h1 className="inventario-titulo">Productos</h1>
        {!mostrarFormularioProducto && (
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              className="inventario-boton-cancelar"
              onClick={() => setMostrarAdminUnidades((actual) => !actual)}
            >
              {mostrarAdminUnidades ? "Ocultar" : "Administrar"} unidades por familia
            </button>
            <button className="inventario-boton" onClick={abrirFormularioNuevoProducto}>
              + Agregar producto
            </button>
          </div>
        )}
      </div>

      {mostrarAdminUnidades && !mostrarFormularioProducto && (
        <PanelAdminUnidadesFamilia
          unidadesFamilia={almacen?.unidadesFamilia || []}
          guardarUnidadFamilia={almacen?.guardarUnidadFamilia}
        />
      )}

      {!mostrarFormularioProducto && (
        <div className="inventario-buscador">
          <input
            type="text"
            placeholder="Buscar por código o descripción..."
            value={busquedaProducto}
            onChange={(e) => cambiarBusquedaProducto(e.target.value)}
          />
        </div>
      )}

      {mostrarFormularioProducto && (
        <form className="inventario-form" onSubmit={guardarProducto} noValidate>
          <h2 className="inventario-form-subtitulo">
            {editandoProductoId ? "Editar producto" : "Nuevo producto"}
          </h2>

          <div className="inventario-form-grid">
            <div>
              <label>Código</label>
              <input
                value={formularioProducto.codigo}
                onChange={(e) => actualizarCampoProducto("codigo", e.target.value)}
              />
            </div>
            <div>
              <label>Referencia</label>
              <input
                placeholder="Otro código de identificación (opcional)"
                value={formularioProducto.referencia}
                onChange={(e) => actualizarCampoProducto("referencia", e.target.value)}
              />
            </div>
            <div>
              <label>Descripción</label>
              <input
                value={formularioProducto.descripcion}
                onChange={(e) => actualizarCampoProducto("descripcion", e.target.value)}
              />
            </div>
            <div>
              <label>Familia</label>
              <input
                list="inventario-datalist-familias"
                placeholder="Ej. Tornillos"
                value={formularioProducto.familia}
                onChange={(e) => actualizarFamiliaFormulario(e.target.value)}
              />
            </div>
            <div>
              <label>Calibre</label>
              <input
                value={formularioProducto.calibre}
                onChange={(e) => actualizarCampoProducto("calibre", e.target.value)}
              />
            </div>
            <div>
              <label>Entrada</label>
              <input
                type="number"
                step={almacen?.decimalesPorFamilia?.[formularioProducto.familia] === false ? "1" : "any"}
                value={formularioProducto.entrada}
                onChange={(e) => actualizarCampoProducto("entrada", e.target.value)}
              />
            </div>
            <div>
              <label>Stock</label>
              <input
                type="number"
                step={almacen?.decimalesPorFamilia?.[formularioProducto.familia] === false ? "1" : "any"}
                value={formularioProducto.stock}
                onChange={(e) => actualizarCampoProducto("stock", e.target.value)}
              />
            </div>
            <div>
              <label>Stock mínimo (opcional)</label>
              <input
                type="number"
                min="0"
                step={almacen?.decimalesPorFamilia?.[formularioProducto.familia] === false ? "1" : "any"}
                placeholder="Sin alerta"
                value={formularioProducto.stockMinimo}
                onChange={(e) => actualizarCampoProducto("stockMinimo", e.target.value)}
              />
            </div>
            {normalizarFamilia(formularioProducto.familia) === FAMILIA_PORCELANATO && (
              <div>
                <label>m² por caja (opcional)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Ej. 1.44 — solo si se vende por caja con área fija"
                  value={formularioProducto.metrosPorUnidad}
                  onChange={(e) => actualizarCampoProducto("metrosPorUnidad", e.target.value)}
                />
              </div>
            )}
          </div>
          {normalizarFamilia(formularioProducto.familia) === FAMILIA_PORCELANATO && Number(formularioProducto.metrosPorUnidad) > 0 && (
            <p className="inventario-carga-ayuda" style={{ marginTop: "0.5rem" }}>
              El stock de este producto se controla por CAJAS. Con {formularioProducto.metrosPorUnidad} m² por
              caja configurados, en Movimientos podrás registrar una salida indicando los m² que pide el
              cliente — el sistema calcula solas las cajas a descontar (redondeando siempre hacia arriba).
            </p>
          )}
          {almacen?.decimalesPorFamilia?.[formularioProducto.familia] === false && (
            <p className="inventario-carga-ayuda" style={{ marginTop: "0.5rem" }}>
              La familia "{formularioProducto.familia}" se mide en {almacen?.unidadPorFamilia?.[formularioProducto.familia]} — solo se aceptan cantidades enteras.
            </p>
          )}

          {errorProductos && <p className="inventario-error">{errorProductos}</p>}

          <div className="inventario-form-botones">
            <button type="submit" className="inventario-boton" disabled={guardandoProducto}>
              {guardandoProducto
                ? "Guardando..."
                : editandoProductoId
                ? "Guardar cambios"
                : "Agregar producto"}
            </button>
            <button
              type="button"
              className="inventario-boton-cancelar"
              onClick={cerrarFormularioProducto}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {!mostrarFormularioProducto && (
        cargandoProductos ? (
          <p className="inventario-cargando">Cargando productos...</p>
        ) : gruposPorFamilia.length === 0 ? (
          <div className="inventario-tabla-contenedor">
            <p className="inventario-vacio" style={{ padding: "1.5rem" }}>
              {busquedaProducto
                ? "No se encontraron productos que coincidan con la búsqueda."
                : "No hay productos registrados."}
            </p>
          </div>
        ) : (
          <>
          {gruposPorFamilia.map((grupo) => {
            // La clave ya viene calculada del hook (familia, o
            // familia+longitud para caballetes/flanches, o
            // familia+descripción+calibre+longitud para productos por
            // conversión como Porcelanato) — no se recalcula aquí para
            // no arriesgar que dos tarjetas distintas colisionen en el
            // mismo estado de expandido/colapsado.
            const expandido = gruposFamiliaExpandidos[grupo.clave] ?? gruposPorFamilia.length === 1;
            const totalStock = Math.round(
              grupo.productos.reduce((suma, p) => suma + (Number(p.stock) || 0), 0) * 100
            ) / 100;
            const unidad = almacen?.unidadPorFamilia?.[grupo.familia] || "";
            const esConversion = grupo.tipoGrupo === "conversion";
            const esReferencia = grupo.tipoGrupo === "referencia";
            // Calidad/Longitud/Ancho rollo-sección/Rollo origen solo
            // aplican a TEJA (stock de Producción/rollos) — para
            // cualquier otra familia quedan casi siempre vacíos y no
            // deben ocupar espacio en la tarjeta.
            const esTeja = normalizarFamilia(grupo.familia) === FAMILIA_TEJA;
            const m2Equivalentes = esConversion ? Math.round(totalStock * grupo.longitud * 100) / 100 : null;
            return (
              <section key={grupo.clave} className="inventario-tarjeta">
                <button
                  className="inventario-grupo-header"
                  onClick={() => alternarGrupoFamilia(grupo.clave)}
                >
                  <div className="inventario-grupo-info">
                    <span className="inventario-grupo-familia">
                      {grupo.familia}
                      {esTeja && (grupo.referenciaGrupo ? ` ${grupo.referenciaGrupo}` : " (sin modelo)")}
                      {esConversion && (grupo.descripcion || grupo.calibre) && (
                        <span style={{ fontWeight: 400 }}>
                          {" — "}
                          {[grupo.descripcion, grupo.calibre].filter(Boolean).join(" ")}
                        </span>
                      )}
                    </span>
                  </div>
                  {esReferencia && (
                    <div className="inventario-grupo-cantidad">
                      <span className="numero">{grupo.referenciaGrupo}</span>
                      <span>{esTeja ? "modelo" : "referencia"}</span>
                    </div>
                  )}
                  {grupo.longitud != null && (
                    <div className="inventario-grupo-cantidad">
                      <span className="numero">{grupo.longitud} {esConversion ? "m²/caja" : "m"}</span>
                      <span>medida</span>
                    </div>
                  )}
                  <div className="inventario-grupo-cantidad">
                    <span className="numero">{grupo.productos.length}</span>
                    <span>producto{grupo.productos.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="inventario-grupo-cantidad">
                    <span className="numero">{totalStock}</span>
                    <span>{esConversion ? "cajas" : esReferencia ? (unidad || "unidades") : grupo.longitud != null ? "existencia" : unidad || "stock"}</span>
                  </div>
                  {esConversion && (
                    <div className="inventario-grupo-cantidad">
                      <span className="numero">{m2Equivalentes}</span>
                      <span>m² equivalentes</span>
                    </div>
                  )}
                  <span className="inventario-grupo-flecha">{expandido ? "▲" : "▼"}</span>
                </button>

                {expandido && (
                  <div className="inventario-tabla-contenedor">
                    <table className="inventario-tabla">
                      <thead>
                        <tr>
                          <th>Código</th>
                          <th>{esTeja ? "Modelo" : "Referencia"}</th>
                          <th>Descripción</th>
                          {esTeja && <th>Rollo origen</th>}
                          <th>Calibre</th>
                          {esTeja && <th>Calidad</th>}
                          {(esTeja || esConversion) && <th>{esConversion ? "m² por caja" : "Longitud"}</th>}
                          {esTeja && <th>Ancho rollo / sección</th>}
                          <th>Entrada</th>
                          <th>Stock</th>
                          <th>{esConversion ? "m² equivalentes" : "Unidad"}</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupo.productos.map((p) => (
                          <tr key={p.id}>
                            <td>{p.codigo}</td>
                            <td>{p.referencia || "—"}</td>
                            <td>{p.descripcion}</td>
                            {esTeja && <td>{p.codigoRolloOrigen || "—"}</td>}
                            <td>{calibrePantalla(p.calibre)}</td>
                            {esTeja && (
                              <td>
                                {p.calidad
                                  ? (p.calidad === "segunda" ? "Segunda" : "Primera")
                                  : (esSegundaPorCodigo(p.codigo) ? "Segunda" : "Primera")}
                              </td>
                            )}
                            {(esTeja || esConversion) && (
                              <td>
                                {p.metrosPorUnidad != null
                                  ? `${p.metrosPorUnidad} ${esConversion ? "m²" : "m"}`
                                  : (esTeja && longitudDesdeCodigo(p.codigo) != null
                                    ? `${longitudDesdeCodigo(p.codigo)} m`
                                    : "—")}
                              </td>
                            )}
                            {esTeja && (
                              <td>
                                {p.anchoRollo != null && anchoPorSeccion(p.anchoRollo, p.tipoProducto) != null
                                  ? `${p.anchoRollo} m / ${anchoPorSeccion(p.anchoRollo, p.tipoProducto)} m`
                                  : "—"}
                              </td>
                            )}
                            <td>{p.entrada}</td>
                            <td>{p.stock}</td>
                            <td>
                              {esConversion
                                ? (p.metrosPorUnidad != null ? Math.round(Number(p.stock) * p.metrosPorUnidad * 100) / 100 : "—")
                                : (almacen?.unidadPorFamilia?.[p.familia] || "—")}
                            </td>
                            <td className="inventario-acciones">
                              <button
                                className="inventario-boton"
                                onClick={() => { prepararEntradaProducto(p); setPestanaActiva("movimientos"); }}
                              >
                                Añadir
                              </button>
                              <button className="inventario-boton-cancelar" onClick={() => abrirFormularioEdicionProducto(p)}>
                                Editar
                              </button>
                              <button
                                className="inventario-boton-eliminar"
                                onClick={() => setProductoAEliminar(p)}
                              >
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
          </>
        )
      )}
      {productoAEliminar && (
        <ModalConfirmacion
          titulo="Eliminar producto"
          mensaje={`¿Estás seguro de que quieres eliminar "${productoAEliminar.codigo} — ${productoAEliminar.descripcion}"? Esta acción no se puede deshacer.`}
          textoConfirmar="Eliminar"
          textoCancelar="Cancelar"
          onConfirmar={() => { eliminarProducto(productoAEliminar.id); setProductoAEliminar(null); }}
          onCancelar={() => setProductoAEliminar(null)}
        />
      )}
    </div>
  );
}

export default PanelProductosInventario;
