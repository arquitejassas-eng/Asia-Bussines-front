export const CAMPOS_REQUERIDOS_RECEPCION = ["rollo", "espesor", "net_weight", "coil_meters"];
export const ETIQUETAS_CAMPOS_RECEPCION = {
  rollo: "Identificador único del rollo", espesor: "Espesor", ancho: "Ancho",
  net_weight: "Net Weight (MT)", gross_weight: "Gross Weight (MT)",
  coil_meters: "Coil Meters (reportado)", color_top: "Color TOP", color_back: "Color BACK",
  codigo_proveedor: "Código del proveedor", tipo_material: "Información del material / Tipo (opcional si solo manejas Lámina)",
  proveedor: "Proveedor", lote: "Lote",
  empresa: "Empresa receptora — dueña del material (recomendado; si no, se deduce de la referencia)",
};
export const TODOS_LOS_CAMPOS_RECEPCION = Object.keys(ETIQUETAS_CAMPOS_RECEPCION);

export function redondearRecepcion(numero: number, decimales = 2) {
  const factor = 10 ** decimales;
  return Math.round(numero * factor) / factor;
}

export function normalizarTextoRecepcion(texto: unknown) {
  return (texto ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function traducirRolloRecepcion(rollo: Record<string, any>, indice: number, toleranciaPorcentaje: number) {
  const diferencia = rollo.metros_calculados !== null && rollo.coil_meters !== null
    ? redondearRecepcion(rollo.metros_calculados - rollo.coil_meters) : null;
  let resultado = "faltan_datos";
  if (diferencia !== null) {
    const margen = (rollo.coil_meters || 0) * (toleranciaPorcentaje / 100);
    resultado = Math.abs(diferencia) <= margen ? "correcto" : diferencia > 0 ? "adicional" : "faltante";
  }
  return {
    id: indice + 1, rollo: rollo.rollo, codigoProveedor: rollo.codigo_proveedor, espesor: rollo.espesor,
    ancho: rollo.ancho, netWeight: rollo.net_weight, grossWeight: rollo.gross_weight,
    coilMeters: rollo.coil_meters, colorTop: rollo.color_top, colorBack: rollo.color_back,
    tipoMaterial: rollo.tipo_material, proveedor: rollo.proveedor, lote: rollo.lote, empresa: rollo.empresa || "",
    clasificado: rollo.clasificado, codigoClasificacion: rollo.codigo_clasificacion || "",
    colorNombre: rollo.color_nombre || "", tipoNombre: rollo.tipo_nombre || "",
    metrosCalculados: rollo.metros_calculados, diferencia, resultado, esMaterialNuevo: !rollo.clasificado,
  };
}
