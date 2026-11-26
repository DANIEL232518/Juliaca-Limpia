import { HttpClient, HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CrearReporteRespuesta,
  Estadisticas,
  EstadoSimulacion,
  GenerarRutasRespuesta,
  MapaEstado,
  MisReportesRespuesta,
  PeriodoEstadisticas,
  RutasRespuesta,
  TratarRespuesta,
  ZonaDetalle,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  mapa(): Observable<MapaEstado> {
    return this.http.get<MapaEstado>('/api/mapa/estado');
  }

  rutas(): Observable<RutasRespuesta> {
    return this.http.get<RutasRespuesta>('/api/rutas');
  }

  zonaDetalle(id: number): Observable<ZonaDetalle> {
    return this.http.get<ZonaDetalle>(`/api/zonas/${id}/detalle`);
  }

  estadisticas(periodo: PeriodoEstadisticas): Observable<Estadisticas> {
    return this.http.get<Estadisticas>('/api/estadisticas', { params: { periodo } });
  }

  simulacion(): Observable<EstadoSimulacion> {
    return this.http.get<EstadoSimulacion>('/api/simulacion');
  }

  controlarSimulacion(activa: boolean): Observable<EstadoSimulacion> {
    return this.http.post<EstadoSimulacion>('/api/simulacion', { activa });
  }

  misReportes(usuarioId: number): Observable<MisReportesRespuesta> {
    return this.http.get<MisReportesRespuesta>('/api/reportes', {
      params: { usuario_id: usuarioId },
    });
  }

  crearReporte(datos: FormData): Observable<CrearReporteRespuesta> {
    return this.http.post<CrearReporteRespuesta>('/api/reportes', datos);
  }

  /** Variante con eventos de progreso para mostrar el avance real de la subida. */
  crearReporteConProgreso(datos: FormData): Observable<HttpEvent<CrearReporteRespuesta>> {
    return this.http.post<CrearReporteRespuesta>('/api/reportes', datos, {
      reportProgress: true,
      observe: 'events',
    });
  }

  tratarZona(id: number, datos: FormData): Observable<TratarRespuesta> {
    return this.http.post<TratarRespuesta>(`/api/zonas/${id}/tratar`, datos);
  }

  generarRutas(camionIds?: number[]): Observable<GenerarRutasRespuesta> {
    return this.http.post<GenerarRutasRespuesta>('/api/rutas/generar', {
      camion_ids: camionIds ?? [],
    });
  }
}
