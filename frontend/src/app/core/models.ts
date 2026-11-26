export type Rol = 'ciudadano' | 'conductor' | 'admin';
export type Nivel = 'bajo' | 'medio' | 'critico';
export type EstadoZona = 'pendiente' | 'en_ruta' | 'tratado';

export interface Punto {
  lat: number;
  lng: number;
}

export interface Zona {
  id: number;
  lat: number;
  lng: number;
  direccion_referencia: string;
  volumen_estimado_litros: number;
  nivel: Nivel;
  estado: EstadoZona;
  total_reportes: number;
  creado_en: string;
  tratado_en?: string | null;
}

export interface Camion {
  id: number;
  placa: string;
  codigo_unidad: string;
  capacidad_litros: number;
  carga_actual_litros: number;
  estado: 'operativo' | 'en_ruta' | 'mantenimiento';
  lat: number;
  lng: number;
  rumbo_grados: number;
  velocidad_kmh: number;
  actualizado_en: string;
}

export interface MapaEstado {
  centro: Punto;
  zonas: Zona[];
  camiones: Camion[];
}

export interface Parada {
  id: number;
  zona_id: number;
  orden: number;
  estado_parada: 'pendiente' | 'completada';
  distancia_metros: number;
  direccion_referencia: string;
  lat: number;
  lng: number;
  volumen_estimado_litros: number;
  nivel: Nivel;
}

export interface Ruta {
  id: number;
  camion_id: number;
  codigo_unidad: string;
  estado: string;
  distancia_total_metros: number;
  volumen_total_litros: number;
  creado_en: string;
  /** Traza de calles reales (OSRM/OpenStreetMap); ausente = línea recta. */
  geometria?: Punto[];
  paradas: Parada[];
}

export interface ReporteDetalle {
  id: number;
  foto_url?: string | null;
  volumen_litros: number;
  nivel: Nivel;
  comentario?: string | null;
  creado_en: string;
}

export interface Evidencia {
  id: number;
  zona_id: number;
  camion_id?: number | null;
  conductor_id?: number | null;
  foto_evidencia_url?: string | null;
  volumen_restante_litros: number;
  observacion?: string | null;
  creado_en: string;
}

export interface ZonaDetalle {
  zona: Zona;
  reportes: ReporteDetalle[];
  evidencia: Evidencia | null;
}

export interface ReporteUsuario {
  id: number;
  zona_id: number;
  foto_url?: string | null;
  volumen_litros: number;
  nivel: Nivel;
  comentario?: string | null;
  creado_en: string;
  zona_estado: EstadoZona;
  zona_direccion: string;
  zona_lat: number;
  zona_lng: number;
  zona_nivel: Nivel;
  zona_total_reportes: number;
  zona_volumen_estimado_litros: number;
  tratado_en?: string | null;
  evidencia_foto_url?: string | null;
  evidencia_creado_en?: string | null;
}

export interface MisReportesRespuesta {
  reportes: ReporteUsuario[];
  total: number;
}

export interface Serie {
  periodo: string;
  reportes_creados: number;
  zonas_creadas: number;
  zonas_tratadas: number;
  litros_recolectados: number;
  tiempo_promedio_horas: number;
}

export interface Resumen {
  reportes_creados: number;
  zonas_creadas: number;
  zonas_tratadas: number;
  efectividad_pct: number;
  litros_recolectados: number;
  volumen_m3: number;
  toneladas: number;
  tiempo_promedio_horas: number;
}

export interface DistribucionNiveles {
  bajo: number;
  medio: number;
  critico: number;
}

export type PeriodoEstadisticas = 'semanal' | 'mensual' | 'anual';

export interface Estadisticas {
  periodo: PeriodoEstadisticas;
  desde: string;
  hasta: string;
  resumen: Resumen;
  series: Serie[];
  distribucion_niveles: DistribucionNiveles;
}

// Posición que el backend envía cada 2 s durante la simulación de flota.
export interface CamionSimulado {
  id: number;
  lat: number;
  lng: number;
  rumbo_grados: number;
  velocidad_kmh: number;
}

export interface EstadoSimulacion {
  activa: boolean;
  camiones: CamionSimulado[];
}

export interface Sesion {
  rol: Rol;
  nombre: string;
  usuarioId: number;
  conductorId?: number;
  camionId?: number;
}

export interface EventoSSE {
  tipo: 'reporte_creado' | 'rutas_generadas' | 'zona_tratada' | 'flota_movida' | string;
  datos: unknown;
  emitido_en: string;
}

export interface Analisis {
  volumen_litros: number;
  nivel: Nivel;
  confianza: number;
  nitidez: number;
  nitido: boolean;
  recomendacion: string;
}

export interface CrearReporteRespuesta {
  zona: Zona;
  reporte: ReporteDetalle & { zona_id: number; usuario_id?: number | null };
  analisis: Analisis;
  zona_nueva: boolean;
  mensaje: string;
}

export interface TratarRespuesta {
  zona: Zona;
  evidencia: Evidencia;
  analisis: Analisis;
  volumen_recolectado_litros: number;
  mensaje: string;
}

export interface RutasRespuesta {
  rutas: Ruta[];
  total: number;
}

export interface GenerarRutasRespuesta {
  rutas: Ruta[];
  metricas: Record<string, number>;
  sin_asignar: number[];
  mensaje: string;
}
