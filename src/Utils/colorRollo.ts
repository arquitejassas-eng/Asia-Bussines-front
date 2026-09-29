// Sin imports a propósito: tests/color-rollo.unit.test.mjs carga este archivo
// directo con Node, que no resuelve imports sin extensión (por eso no usa
// normalizarTexto de ./texto, aunque hace lo mismo).
const colores: Record<string, string> = {
  azul: "azul", blanco: "blanco", negro: "negro", rojo: "rojo", verde: "verde",
  amarillo: "amarillo", gris: "gris", plata: "plata", natural: "natural",
};

export function claseColorMaterial(color: unknown): string {
  const normalizado = String(color || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return colores[normalizado] || "otro";
}
