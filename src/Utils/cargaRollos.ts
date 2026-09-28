export const CAMPOS_REQUERIDOS_CARGA_ROLLOS = ["codigo_interno", "identificador_rollo", "metros_disponibles"];
export const ETIQUETAS_CAMPOS_CARGA_ROLLOS = {
  codigo_interno: "Código de clasificación", identificador_rollo: "Referencia / código único del rollo",
  metros_disponibles: "Metros disponibles",
  empresa: "Empresa receptora — dueña del material (recomendado; si no, se deduce de la referencia)",
  descripcion: "Descripción (opcional)",
  calibre: "Calibre (opcional)", peso_neto: "Peso neto (opcional)", color_material: "Color (opcional)",
  metros_consumidos: "Metros consumidos (opcional)", metros_totales: "Metros totales / entrada (opcional)",
  proveedor: "Proveedor (opcional)", lote: "Lote (opcional)",
  estado_origen: "Estado en tu Excel (opcional — filtra filas que no sigan vigentes)",
};
export const TODOS_LOS_CAMPOS_CARGA_ROLLOS = Object.keys(ETIQUETAS_CAMPOS_CARGA_ROLLOS);
