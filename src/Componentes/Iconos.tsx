// Íconos de los botones (SVG, no emojis: se ven igual en todos los equipos y
// toman el color del texto del botón). Decorativos: el texto del botón ya dice qué hace.

type Props = { tamano?: number };

const base = (tamano: number) => ({
  width: tamano, height: tamano, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true, focusable: false,
});

/** Subir un archivo (Cargar desde Excel). */
export function IconoSubir({ tamano = 16 }: Props) {
  return (
    <svg {...base(tamano)}>
      <path d="M12 15V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  );
}

/** Bajar un archivo (Exportar a Excel). */
export function IconoDescargar({ tamano = 16 }: Props) {
  return (
    <svg {...base(tamano)}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
