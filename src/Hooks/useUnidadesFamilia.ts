import { useCallback, useState } from "react";
import { api, ErrorApi } from "../Componentes/Api";
import type { UnidadFamilia } from "../types/dominio";

type UnidadFamiliaApi = { id: number; familia: string; unidad: string; permite_decimales: boolean };

/**
 * Unidad de medida configurada por familia de producto (global, no por
 * bodega). No se auto-carga al montar: la instancia vive en AlmacenGlobal.ts
 * (una sola vez por sesión) y esta expone solo la lógica de carga/guardado
 * para que quien la llame decida cuándo (p. ej. solo si hay sesión activa).
 */
export function useUnidadesFamilia() {
  const [unidadesFamilia, setUnidadesFamilia] = useState<UnidadFamilia[]>([]);

  const cargarUnidadesFamilia = useCallback(async () => {
    try {
      const datos = await api.get<UnidadFamiliaApi[]>("/inventario/unidades-familia");
      setUnidadesFamilia((datos ?? []).map((item) => ({
        id: item.id, familia: item.familia, unidad: item.unidad, permiteDecimales: item.permite_decimales,
      })));
    } catch { /* El panel puede reintentarse sin interrumpir el resto de la página. */ }
  }, []);

  async function guardarUnidadFamilia(familia: string, unidad: string, permiteDecimales = true) {
    if (!familia || !unidad) return false;
    try {
      await api.post("/inventario/unidades-familia", { familia, unidad, permite_decimales: permiteDecimales });
      await cargarUnidadesFamilia();
      return true as const;
    } catch (err) {
      // El mensaje del servidor (antes solo false y un aviso genérico).
      return err instanceof ErrorApi ? err.message : "No se pudo guardar la unidad.";
    }
  }

  const unidadPorFamilia = Object.fromEntries(unidadesFamilia.map((u) => [u.familia, u.unidad]));
  // Familias sin configurar no restringen nada (mismo criterio que unidadPorFamilia).
  const decimalesPorFamilia = Object.fromEntries(unidadesFamilia.map((u) => [u.familia, u.permiteDecimales]));

  return { unidadesFamilia, unidadPorFamilia, decimalesPorFamilia, cargarUnidadesFamilia, guardarUnidadFamilia };
}
