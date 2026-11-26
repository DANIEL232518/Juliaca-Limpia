import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, forkJoin, of, tap } from 'rxjs';

import { ApiService } from './api.service';
import { EventsService } from './events.service';
import {
  Camion,
  CamionSimulado,
  EstadoSimulacion,
  GenerarRutasRespuesta,
  MapaEstado,
  Ruta,
  Zona,
} from './models';

const ORDEN_NIVEL: Record<string, number> = { critico: 0, medio: 1, bajo: 2 };

@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly api = inject(ApiService);
  private readonly eventos = inject(EventsService);

  readonly estado = signal<MapaEstado | null>(null);
  readonly rutas = signal<Ruta[]>([]);
  readonly cargando = signal(true);
  readonly generando = signal(false);
  readonly error = signal<string | null>(null);
  readonly actualizado = signal<Date | null>(null);
  readonly simulando = signal(false);
  readonly cambiandoSimulacion = signal(false);

  readonly zonas = computed<Zona[]>(() => this.estado()?.zonas ?? []);
  readonly camiones = computed<Camion[]>(() => this.estado()?.camiones ?? []);

  readonly zonasPendientes = computed(() =>
    this.zonas()
      .filter((zona) => zona.estado === 'pendiente')
      .sort(
        (a, b) =>
          (ORDEN_NIVEL[a.nivel] ?? 3) - (ORDEN_NIVEL[b.nivel] ?? 3) ||
          b.volumen_estimado_litros - a.volumen_estimado_litros,
      ),
  );

  readonly conteos = computed(() => {
    const zonas = this.zonas();
    return {
      total: zonas.length,
      pendientes: zonas.filter((z) => z.estado === 'pendiente').length,
      enRuta: zonas.filter((z) => z.estado === 'en_ruta').length,
      tratadas: zonas.filter((z) => z.estado === 'tratado').length,
      criticas: zonas.filter((z) => z.estado !== 'tratado' && z.nivel === 'critico').length,
    };
  });

  private readonly temporizador: number;

  constructor() {
    this.refrescar();

    // Sincroniza el estado del simulador si la página se recarga mientras la
    // demostración sigue encendida en el backend.
    this.api
      .simulacion()
      .pipe(catchError(() => of(null)))
      .subscribe((estado) => {
        if (estado) {
          this.simulando.set(estado.activa);
          this.aplicarPosiciones(estado.camiones);
        }
      });

    // Los eventos SSE refrescan el mapa casi en tiempo real; el sondeo es una
    // red de seguridad si el stream se cae (móvil en segundo plano, etc.).
    this.temporizador = window.setInterval(() => this.refrescar(true), 20000);

    effect(() => {
      const evento = this.eventos.ultimo();
      if (!evento) {
        return;
      }
      if (evento.tipo === 'flota_movida') {
        const datos = evento.datos as EstadoSimulacion | null;
        if (datos?.camiones) {
          this.simulando.set(Boolean(datos.activa));
          this.aplicarPosiciones(datos.camiones);
        }
        return;
      }
      this.refrescar(true);
    });
  }

  refrescar(silencioso = false): void {
    if (!silencioso) {
      this.cargando.set(true);
    }

    forkJoin({
      mapa: this.api.mapa().pipe(catchError(() => of(null))),
      rutas: this.api.rutas().pipe(catchError(() => of(null))),
    })
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe(({ mapa, rutas }) => {
        if (mapa) {
          this.estado.set(mapa);
          this.error.set(null);
        } else if (!this.estado()) {
          this.error.set('No se pudo conectar con la API de Juliaca Limpia.');
        }
        if (rutas) {
          this.rutas.set(rutas.rutas);
        }
        this.actualizado.set(new Date());
      });
  }

  generarRutas(camionIds?: number[]): Observable<GenerarRutasRespuesta> {
    this.generando.set(true);
    return this.api.generarRutas(camionIds).pipe(
      tap(() => this.refrescar(true)),
      finalize(() => this.generando.set(false)),
    );
  }

  /** Enciende o apaga el simulador de flota del backend. */
  alternarSimulacion(activa: boolean): Observable<EstadoSimulacion> {
    this.cambiandoSimulacion.set(true);
    return this.api.controlarSimulacion(activa).pipe(
      tap((estado) => {
        this.simulando.set(estado.activa);
        this.aplicarPosiciones(estado.camiones);
      }),
      finalize(() => this.cambiandoSimulacion.set(false)),
    );
  }

  /** Aplica por SSE las posiciones sin volver a pedir todo el mapa. */
  private aplicarPosiciones(camiones: CamionSimulado[]): void {
    const actual = this.estado();
    if (!actual || camiones.length === 0) {
      return;
    }
    const porId = new Map(camiones.map((camion) => [camion.id, camion]));
    const actualizados = actual.camiones.map((camion) => {
      const movido = porId.get(camion.id);
      if (!movido) {
        return camion;
      }
      return {
        ...camion,
        lat: movido.lat,
        lng: movido.lng,
        rumbo_grados: movido.rumbo_grados,
        velocidad_kmh: movido.velocidad_kmh,
      };
    });
    this.estado.set({ ...actual, camiones: actualizados });
    this.actualizado.set(new Date());
  }

  detener(): void {
    window.clearInterval(this.temporizador);
  }
}
