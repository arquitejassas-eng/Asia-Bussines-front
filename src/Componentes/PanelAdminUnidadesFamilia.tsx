import { useState } from "react";
import "../Style/Inventario.css";
import type { UnidadFamilia } from "../types/dominio";

/**
 * Administra la tabla global familia -> unidad de medida. Se usa tanto en
 * Admin Inventario ("Inventario total", quien recibe el material entrante y
 * lo reparte a las sedes — el punto natural para definir la unidad de una
 * familia nueva) como en Inventario por bodega (para las familias que un
 * administrativo da de alta manualmente en su propia sede).
 */
function PanelAdminUnidadesFamilia({ unidadesFamilia, guardarUnidadFamilia }: {
  unidadesFamilia: UnidadFamilia[];
  guardarUnidadFamilia?: (familia: string, unidad: string, permiteDecimales?: boolean) => Promise<boolean> | void;
}) {
  const [form, setForm] = useState({ familia: "", unidad: "", permiteDecimales: true });
  const [error, setError] = useState("");

  // Solo se limpia si se guardó; antes se borraba aunque fallara, sin aviso.
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.familia.trim() || !form.unidad.trim()) return;
    setError("");
    const guardado = await guardarUnidadFamilia?.(form.familia.trim(), form.unidad.trim(), form.permiteDecimales);
    if (guardado === false) {
      setError("No se pudo guardar la unidad. Revisa los datos e intenta de nuevo.");
      return;
    }
    setForm({ familia: "", unidad: "", permiteDecimales: true });
  }

  return (
    <div className="inventario-admin-panel">
      <p className="inventario-carga-ayuda" style={{ margin: 0 }}>
        Define qué unidad mostrar junto al stock de cada familia (ej. Tornillos → unidades,
        Fibra de vidrio → metros, Amarres → paquetes). Los rollos de acero siempre se miden en
        metros y no usan esta tabla.
      </p>
      <p className="inventario-carga-ayuda" style={{ margin: "0.4rem 0 0" }}>
        "Solo enteros" además bloquea guardar cantidades con decimales para esa familia (ej. no
        deja registrar "3.5 tornillos"); una familia por metro sí admite decimales.
      </p>
      <table className="inventario-admin-tabla">
        <thead>
          <tr>
            <th>Familia</th>
            <th>Unidad</th>
            <th>Cantidades</th>
          </tr>
        </thead>
        <tbody>
          {unidadesFamilia.map((u) => (
            <tr key={u.familia}>
              <td>{u.familia}</td>
              <td>{u.unidad}</td>
              <td>{u.permiteDecimales ? "Con decimales" : "Solo enteros"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="inventario-admin-form" onSubmit={enviar}>
        <input
          placeholder="Familia (ej. Tornillos)"
          value={form.familia}
          onChange={(e) => setForm({ ...form, familia: e.target.value })}
        />
        <input
          placeholder="Unidad (ej. unidades)"
          value={form.unidad}
          onChange={(e) => setForm({ ...form, unidad: e.target.value })}
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: "1 1 100%", fontSize: "0.85rem" }}>
          <input
            type="checkbox"
            style={{ width: "auto", flex: "none" }}
            checked={form.permiteDecimales}
            onChange={(e) => setForm({ ...form, permiteDecimales: e.target.checked })}
          />
          Permite decimales (ej. metros, kg). Desmárcalo para familias que solo se cuentan por unidad entera.
        </label>
        <button className="inventario-boton-cancelar" type="submit">
          Agregar / actualizar
        </button>
      </form>
      {error && <p className="inventario-error">{error}</p>}
    </div>
  );
}

export default PanelAdminUnidadesFamilia;
