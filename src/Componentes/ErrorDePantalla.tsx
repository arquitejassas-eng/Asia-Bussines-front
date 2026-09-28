import { Component, type ErrorInfo, type ReactNode } from "react";
import { esErrorDeArchivoDeVersionVieja, recargarPorVersionNueva } from "../Utils/nuevaVersion";

type Props = { children: ReactNode };
type Estado = { error: unknown };

/** Evita la pantalla en blanco cuando una pantalla falla al abrirse o al
 * mostrarse. Si el fallo es por un archivo de una versión vieja (se publicó
 * una nueva con la pestaña abierta), recarga sola para traer la nueva; si
 * no, muestra un aviso con un botón para recargar. En App.tsx lleva
 * `key={ruta}`: al ir a otra sección desde la barra lateral, se reinicia. */
export default class ErrorDePantalla extends Component<Props, Estado> {
  state: Estado = { error: null };

  static getDerivedStateFromError(error: unknown): Estado {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Error al mostrar la pantalla:", error, info.componentStack);
    if (esErrorDeArchivoDeVersionVieja(error)) recargarPorVersionNueva();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ padding: "3rem 1.5rem", maxWidth: 520, margin: "0 auto", textAlign: "center", fontFamily: "inherit" }}>
        <h1 style={{ fontSize: "1.3rem", marginBottom: "0.75rem" }}>No se pudo abrir esta pantalla</h1>
        <p style={{ marginBottom: "1.5rem", color: "#555" }}>
          Puede que la aplicación se haya actualizado mientras la tenías abierta, o que se haya
          cortado el internet. Recarga para continuar.
        </p>
        <button type="button" className="inventario-boton" onClick={() => window.location.reload()}>
          Recargar
        </button>
      </main>
    );
  }
}
