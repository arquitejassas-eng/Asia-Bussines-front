export type Sesion = { correo: string; bodegaId: number | null; bodegaNombre: string; rol: string };
export type Bodega = { id: number; nombre: string };
export type SolicitudApi = {
  id: number; estado: string; tipo_operacion: string; cantidad: number; producto_codigo: string;
  producto_descripcion: string; rollo_id: number | null; bodega_solicitante_id: number; bodega_propietaria_id: number;
  solicitado_por: string; observaciones: string; fecha: string;
};
export type Producto = {
  // null = material de Admin Inventario, sin repartir a ninguna sede todavía.
  id: number; bodegaId: number | null; codigoImportacion: string; codigo: string; referencia: string; descripcion: string;
  familia: string; calibre: string; entrada: number; stock: number; stockMinimo: number | null; pesoNeto: number | null;
  rolloId: number | null; identificadorRollo: string; bodegaNombre?: string;
};
export type EnvioItemApi = {
  id: number; rollo_id: number | null; producto_codigo: string | null; descripcion: string; cantidad: number | null;
};
export type EnvioApi = {
  id: number; bodega_destino_id: number; estado: string; enviado_por: string; fecha_envio: string;
  respondido_por: string; fecha_respuesta: string | null; observaciones: string; items: EnvioItemApi[];
};
export type EnvioItem = {
  id: number; rolloId: number | null; productoCodigo: string | null; descripcion: string; cantidad: number | null;
};
export type Envio = {
  id: number; bodegaDestinoId: number; estado: string; enviadoPor: string; fechaEnvio: string;
  respondidoPor: string; fechaRespuesta: string | null; observaciones: string; items: EnvioItem[];
  bodegaDestinoNombre?: string;
};
export type Solicitud = {
  id: number; estado: string; tipoOperacion: string; cantidad: number; productoCodigo: string;
  productoDescripcion: string; rolloId: number | null; bodegaSolicitanteId: number; bodegaSolicitanteNombre: string;
  bodegaPropietariaId: number; bodegaPropietariaNombre: string; solicitadoPor: string;
  observaciones: string; fecha: string;
};
export type UnidadFamilia = { id: number; familia: string; unidad: string; permiteDecimales: boolean };
export type UsuarioApi = { id: number; correo: string; rol: string; bodega_id: number | null; activo: boolean };
export type Usuario = { id: number; correo: string; rol: string; bodegaId: number | null; activo: boolean };
export type AlmacenGlobal = {
  bodegas: Bodega[]; solicitudes: Solicitud[]; envios: Envio[]; unidadesFamilia: UnidadFamilia[];
  unidadPorFamilia: Record<string, string>; decimalesPorFamilia: Record<string, boolean>;
  cargarBodegas: () => Promise<void>; refrescarSolicitudesPendientes: () => Promise<void>;
  refrescarEnviosPendientes: () => Promise<void>; cargarUnidadesFamilia: () => Promise<void>;
  guardarUnidadFamilia: (familia: string, unidad: string, permiteDecimales?: boolean) => Promise<boolean>;
  mostrarFormularioBodega: boolean; setMostrarFormularioBodega: (valor: boolean) => void;
  nombreBodegaNueva: string; setNombreBodegaNueva: (valor: string) => void;
  guardandoBodega: boolean; errorBodega: string;
  crearBodega: (evento: { preventDefault: () => void }) => Promise<void>;
  produccionPendienteCount: number; refrescarProduccionPendiente: () => Promise<void>;
  apartadosPorEnviarCount: number; refrescarApartadosPorEnviar: () => Promise<void>;
};
