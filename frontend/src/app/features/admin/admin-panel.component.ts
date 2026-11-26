import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Chart } from 'chart.js/auto';
import { catchError, of } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { DashboardStore } from '../../core/dashboard.store';
import { Estadisticas, PeriodoEstadisticas, Serie } from '../../core/models';

const AZUL = '#004B93';
const CELESTE = '#00AEEF';
const DORADO = '#FDB913';
const VERDE = '#16A34A';
const ROJO = '#D32F2F';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="animate-fade-up space-y-4">
      <header class="flex items-start gap-3">
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sanroman-azul">
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 19V5M4 19h16" stroke-linecap="round" />
            <path d="M8 15v-4M12 15V7M16 15v-6M20 15V9" stroke-linecap="round" />
          </svg>
        </div>
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-sanroman-celeste">
            Panel administrador
          </p>
          <h2 class="text-lg font-bold leading-tight text-slate-900">Centro de control</h2>
          <p class="mt-0.5 text-xs leading-relaxed text-slate-500">
            Estadísticas de gestión, rutas y simulación de flota en vivo.
          </p>
        </div>
      </header>

      <!-- Conteos operativos -->
      <section class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-xl bg-white p-3 shadow-soft ring-1 ring-slate-100">
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Pendientes</p>
          <p class="mt-0.5 text-xl font-black text-amber-600">{{ store.conteos().pendientes }}</p>
        </div>
        <div class="rounded-xl bg-white p-3 shadow-soft ring-1 ring-slate-100">
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">En ruta</p>
          <p class="mt-0.5 text-xl font-black text-sanroman-celeste">{{ store.conteos().enRuta }}</p>
        </div>
        <div class="rounded-xl bg-white p-3 shadow-soft ring-1 ring-slate-100">
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Críticas</p>
          <p class="mt-0.5 text-xl font-black text-basura-critica">{{ store.conteos().criticas }}</p>
        </div>
        <div class="rounded-xl bg-white p-3 shadow-soft ring-1 ring-slate-100">
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tratadas</p>
          <p class="mt-0.5 text-xl font-black text-zona-tratada">{{ store.conteos().tratadas }}</p>
        </div>
      </section>

      <!-- ==================== Dashboard estadístico ==================== -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Dashboard estadístico</p>
            <p class="mt-0.5 text-[11px] text-slate-500">
              Reportes, cobertura, volumen recolectado y tiempo de atención.
            </p>
          </div>
          <button
            type="button"
            (click)="exportarCsv()"
            [disabled]="!stats()"
            class="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sanroman-azul px-3 py-2 text-[11px] font-bold text-white shadow-soft transition hover:bg-[#003a73] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none sm:w-auto"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M12 4v11m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M5 19h14" stroke-linecap="round" />
            </svg>
            Exportar Reporte CSV
          </button>
        </div>

        <!-- Pestañas de periodo -->
        <div class="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Periodo de las estadísticas">
          @for (opcion of periodos; track opcion) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="periodo() === opcion"
              (click)="cambiarPeriodo(opcion)"
              class="rounded-xl px-2 py-2 text-xs font-bold capitalize transition"
              [class.bg-white]="periodo() === opcion"
              [class.text-sanroman-azul]="periodo() === opcion"
              [class.shadow-soft]="periodo() === opcion"
              [class.text-slate-500]="periodo() !== opcion"
            >
              {{ opcion }}
            </button>
          }
        </div>

        @if (stats(); as datos) {
          <!-- KPIs -->
          <div class="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <article class="rounded-xl bg-gradient-to-br from-sanroman-azul to-[#0067c9] p-3 text-white">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-sky-100/85">
                Reportes ciudadanos
              </p>
              <p class="mt-0.5 text-2xl font-black leading-tight">
                {{ datos.resumen.reportes_creados | number: '1.0-0' }}
              </p>
              <p class="mt-1 text-[10px] font-medium text-sky-50/80">
                {{ datos.resumen.zonas_creadas }} zona{{ datos.resumen.zonas_creadas === 1 ? '' : 's' }} agrupada{{ datos.resumen.zonas_creadas === 1 ? '' : 's' }}
              </p>
            </article>

            <article class="rounded-xl bg-gradient-to-br from-zona-tratada to-emerald-600 p-3 text-white">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-emerald-50/85">
                Puntos tratados
              </p>
              <p class="mt-0.5 text-2xl font-black leading-tight">
                {{ datos.resumen.zonas_tratadas | number: '1.0-0' }}
              </p>
              <p class="mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-bold">
                {{ datos.resumen.efectividad_pct | number: '1.1-1' }}% efectividad
              </p>
            </article>

            <article class="rounded-xl bg-gradient-to-br from-sanroman-celeste to-sky-500 p-3 text-white">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-sky-50/90">
                Volumen recolectado
              </p>
              <p class="mt-0.5 text-2xl font-black leading-tight">
                {{ datos.resumen.litros_recolectados | number: '1.0-0' }}
                <span class="text-sm font-bold">L</span>
              </p>
              <p class="mt-1 text-[10px] font-medium text-sky-50/85">
                {{ datos.resumen.volumen_m3 | number: '1.2-2' }} m³ ·
                {{ datos.resumen.toneladas | number: '1.2-2' }} t
              </p>
            </article>

            <article class="rounded-xl bg-gradient-to-br from-sanroman-dorado to-amber-500 p-3 text-white">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-amber-50/95">
                Tiempo promedio de atención
              </p>
              <p class="mt-0.5 text-2xl font-black leading-tight">{{ tiempoAtencion() }}</p>
              <p class="mt-1 text-[10px] font-medium text-amber-50/90">
                reporte → foto de evidencia
              </p>
            </article>
          </div>

          <!-- Barras comparativas -->
          <div class="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
            <div class="flex items-center justify-between gap-2">
              <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Reportes vs. puntos tratados
              </p>
              <span class="text-[9px] font-semibold text-slate-400">{{ etiquetaPeriodo(datos) }}</span>
            </div>
            <div class="relative mt-1.5 h-52">
              <canvas #canvasReportes></canvas>
            </div>
          </div>

          <!-- Volumen + distribución -->
          <div class="mt-3 grid gap-3 lg:grid-cols-2">
            <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Volumen recolectado (m³)
                </p>
                <span class="text-[9px] font-semibold text-slate-400">litros / 1000</span>
              </div>
              <div class="relative mt-1.5 h-44">
                <canvas #canvasVolumen></canvas>
              </div>
            </div>

            <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
              <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Reportes por gravedad
              </p>
              <div class="grid grid-cols-[1fr_auto] items-center gap-2">
                <div class="relative h-40">
                  <canvas #canvasNiveles></canvas>
                </div>
                <ul class="space-y-1.5 pr-1 text-[10px] font-semibold">
                  @for (nivel of nivelesGravedad(); track nivel.etiqueta) {
                    <li class="flex items-center gap-1.5 text-slate-600">
                      <i class="h-2.5 w-2.5 rounded-full" [style.background]="nivel.color"></i>
                      <span>{{ nivel.etiqueta }}</span>
                      <span class="font-black text-slate-800">{{ nivel.valor }}</span>
                    </li>
                  }
                </ul>
              </div>
            </div>
          </div>

          <p class="mt-3 text-[10px] text-slate-400">
            Periodo {{ datos.periodo }} · {{ fechaCorta(datos.desde) }} → {{ fechaCorta(datos.hasta) }}
          </p>
        } @else if (cargandoStats()) {
          <div class="mt-6 flex items-center justify-center gap-2 py-10 text-[11px] font-semibold text-slate-400">
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-sanroman-azul border-t-transparent"></span>
            Calculando estadísticas…
          </div>
        } @else {
          <p class="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">
            No se pudieron cargar las estadísticas del periodo.
          </p>
        }
      </section>

      <!-- ==================== Simulador de flota ==================== -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-bold text-slate-800">Modo Simulación de Flota</p>
              <span
                class="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide"
                [class.bg-emerald-100]="store.simulando()"
                [class.text-emerald-700]="store.simulando()"
                [class.bg-slate-100]="!store.simulando()"
                [class.text-slate-500]="!store.simulando()"
              >
                {{ store.simulando() ? 'Activo' : 'Detenido' }}
              </span>
            </div>
            <p class="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Mueve las compactadoras por sus rutas cada 2 segundos y actualiza su GPS y rumbo
              en el mapa de todos los dispositivos.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            [attr.aria-checked]="store.simulando()"
            [attr.aria-label]="'Activar modo simulación de flota'"
            (click)="alternarSimulacion()"
            [disabled]="store.cambiandoSimulacion()"
            class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-60"
            [class.bg-emerald-500]="store.simulando()"
            [class.bg-slate-300]="!store.simulando()"
          >
            <span
              class="absolute h-5 w-5 rounded-full bg-white shadow transition-all"
              [class.left-6]="store.simulando()"
              [class.left-1]="!store.simulando()"
            ></span>
          </button>
        </div>

        <div class="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            (click)="generar()"
            [disabled]="store.generando() || store.conteos().pendientes === 0"
            class="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sanroman-azul px-3 py-2.5 text-[11px] font-bold text-white shadow-soft transition hover:bg-[#003a73] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none sm:flex-1"
          >
            @if (store.generando()) {
              <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
              Calculando rutas…
            } @else {
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.9">
                <path d="M4 18L9 7l4 7 3-4 4 8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              Optimizar y Despachar Camiones
            }
          </button>
        </div>

        @if (mensajeRutas(); as mensaje) {
          <p class="mt-2 rounded-lg bg-sky-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-sanroman-azul ring-1 ring-sky-100">
            {{ mensaje }}
          </p>
        }
        @if (mensajeSimulacion(); as mensaje) {
          <p class="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-slate-600 ring-1 ring-slate-100">
            {{ mensaje }}
          </p>
        }
        @if (store.conteos().pendientes === 0) {
          <p class="mt-2 text-[10px] text-slate-400">
            No hay zonas pendientes: genera nuevos reportes para recalcular rutas.
          </p>
        }
      </section>

      <!-- Rutas activas -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Rutas activas</p>
          <span class="text-[10px] font-semibold text-slate-400">{{ store.rutas().length }} en curso</span>
        </div>

        @if (store.rutas().length === 0) {
          <p class="rounded-xl bg-slate-50 px-3 py-3 text-center text-[11px] text-slate-500">
            Aún no hay rutas generadas. Usa “Optimizar y Despachar Camiones” para asignar las zonas pendientes.
          </p>
        } @else {
          <ul class="space-y-2">
            @for (ruta of store.rutas(); track ruta.id; let indice = $index) {
              <li class="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <i class="h-2.5 w-2.5 rounded-full" [style.background]="colorRuta(indice)"></i>
                    {{ ruta.codigo_unidad }}
                  </span>
                  <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {{ ruta.paradas.length }} parada{{ ruta.paradas.length === 1 ? '' : 's' }}
                  </span>
                </div>
                <div class="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
                  <span class="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">
                    {{ ruta.distancia_total_metros / 1000 | number: '1.1-1' }} km
                  </span>
                  <span class="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">
                    {{ ruta.volumen_total_litros | number: '1.0-0' }} L
                  </span>
                  <span class="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">
                    {{ ruta.estado }}
                  </span>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <!-- Zonas críticas -->
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Zonas por atender</p>
          <span class="text-[10px] font-semibold text-slate-400">
            {{ store.zonasPendientes().length }} pendientes
          </span>
        </div>

        @if (store.zonasPendientes().length === 0) {
          <p class="rounded-xl bg-emerald-50 px-3 py-3 text-center text-[11px] font-semibold text-zona-tratada">
            Sin zonas pendientes. Juliaca está al día.
          </p>
        } @else {
          <ul class="space-y-1.5">
            @for (zona of store.zonasPendientes().slice(0, 6); track zona.id) {
              <li class="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2">
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  [class.bg-basura-critica]="zona.nivel === 'critico'"
                  [class.bg-sanroman-dorado]="zona.nivel === 'medio'"
                  [class.bg-sanroman-celeste]="zona.nivel === 'bajo'"
                ></span>
                <span class="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">
                  {{ zona.direccion_referencia || 'Zona sin referencia' }}
                </span>
                <span class="shrink-0 text-[10px] font-bold text-slate-500">
                  {{ zona.volumen_estimado_litros | number: '1.0-0' }} L
                </span>
                <span class="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                  {{ zona.total_reportes }} rep.
                </span>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class AdminPanelComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(DashboardStore);

  readonly periodos: PeriodoEstadisticas[] = ['semanal', 'mensual', 'anual'];
  readonly periodo = signal<PeriodoEstadisticas>('semanal');
  readonly stats = signal<Estadisticas | null>(null);
  readonly cargandoStats = signal(true);
  readonly mensajeRutas = signal<string | null>(null);
  readonly mensajeSimulacion = signal<string | null>(null);

  @ViewChild('canvasReportes') private canvasReportes?: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasVolumen') private canvasVolumen?: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasNiveles') private canvasNiveles?: ElementRef<HTMLCanvasElement>;

  private readonly api = inject(ApiService);
  private readonly colores = ['#004B93', '#00AEEF', '#FDB913', '#7C3AED', '#0E7490', '#D32F2F'];

  private graficoReportes: Chart | null = null;
  private graficoVolumen: Chart | null = null;
  private graficoNiveles: Chart | null = null;

  constructor() {
    this.cargarStats();
  }

  readonly series = computed(() => this.stats()?.series ?? []);

  readonly nivelesGravedad = computed(() => {
    const distribucion = this.stats()?.distribucion_niveles;
    return [
      { etiqueta: 'Bajo', valor: distribucion?.bajo ?? 0, color: CELESTE },
      { etiqueta: 'Medio', valor: distribucion?.medio ?? 0, color: DORADO },
      { etiqueta: 'Crítico', valor: distribucion?.critico ?? 0, color: ROJO },
    ];
  });

  ngAfterViewInit(): void {
    if (this.stats()) {
      this.renderizarGraficos();
    }
  }

  ngOnDestroy(): void {
    this.graficoReportes?.destroy();
    this.graficoVolumen?.destroy();
    this.graficoNiveles?.destroy();
  }

  colorRuta(indice: number): string {
    return this.colores[indice % this.colores.length];
  }

  cambiarPeriodo(periodo: PeriodoEstadisticas): void {
    if (this.periodo() === periodo) {
      return;
    }
    this.periodo.set(periodo);
    this.cargarStats();
  }

  cargarStats(): void {
    this.cargandoStats.set(true);
    this.api
      .estadisticas(this.periodo())
      .pipe(catchError(() => of(null)))
      .subscribe((datos) => {
        this.stats.set(datos);
        this.cargandoStats.set(false);
        if (datos) {
          // Espera al ciclo de render para que los lienzos tengan tamaño.
          window.setTimeout(() => this.renderizarGraficos(), 0);
        }
      });
  }

  generar(): void {
    this.mensajeRutas.set(null);
    this.mensajeSimulacion.set(null);
    this.store.generarRutas().subscribe({
      next: (resultado) => {
        const detalle = resultado.sin_asignar.length
          ? ` · ${resultado.sin_asignar.length} zona(s) sin asignar`
          : '';
        this.mensajeRutas.set(`${resultado.mensaje}${detalle}`);
        this.cargarStats();
        if (resultado.rutas.length > 0) {
          this.store.alternarSimulacion(true).subscribe({
            next: () =>
              this.mensajeSimulacion.set(
                'Compactadoras despachadas: la simulación está activa y el mapa se actualiza cada 2 segundos.',
              ),
            error: () => this.mensajeSimulacion.set('No se pudo activar la simulación de flota.'),
          });
        }
      },
      error: (respuesta: { error?: { mensaje?: string } }) => {
        this.mensajeRutas.set(respuesta?.error?.mensaje ?? 'No se pudieron generar las rutas.');
      },
    });
  }

  alternarSimulacion(): void {
    const activa = !this.store.simulando();
    this.mensajeSimulacion.set(null);
    this.store.alternarSimulacion(activa).subscribe({
      next: (estado) =>
        this.mensajeSimulacion.set(
          estado.activa
            ? 'Simulación activa: las compactadoras avanzan cada 2 segundos sobre sus rutas asignadas.'
            : 'Simulación detenida: las unidades permanecen en su última posición.',
        ),
      error: () => this.mensajeSimulacion.set('No se pudo cambiar el modo simulación.'),
    });
  }

  tiempoAtencion(): string {
    const horas = this.stats()?.resumen.tiempo_promedio_horas ?? 0;
    if (horas <= 0) {
      return '—';
    }
    return horas >= 24 ? `${(horas / 24).toFixed(1)} d` : `${horas.toFixed(1)} h`;
  }

  etiquetaPeriodo(datos: Estadisticas): string {
    if (datos.periodo === 'semanal') {
      return 'últimos 7 días';
    }
    if (datos.periodo === 'mensual') {
      return 'últimos 30 días';
    }
    return 'últimos 12 meses';
  }

  fechaCorta(iso: string): string {
    if (!iso) {
      return '—';
    }
    const fecha = new Date(`${iso}T12:00:00`);
    return fecha.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  exportarCsv(): void {
    const datos = this.stats();
    if (!datos) {
      return;
    }

    const filas: (string | number)[][] = [
      ['Juliaca Limpia - Reporte estadístico'],
      ['Periodo', datos.periodo],
      ['Desde', datos.desde],
      ['Hasta', datos.hasta],
      [],
      ['Indicador', 'Valor'],
      ['Reportes ciudadanos', datos.resumen.reportes_creados],
      ['Zonas creadas', datos.resumen.zonas_creadas],
      ['Puntos tratados', datos.resumen.zonas_tratadas],
      ['Efectividad (%)', datos.resumen.efectividad_pct],
      ['Volumen recolectado (L)', datos.resumen.litros_recolectados],
      ['Volumen recolectado (m3)', datos.resumen.volumen_m3],
      ['Toneladas estimadas', datos.resumen.toneladas],
      ['Tiempo promedio de atención (h)', datos.resumen.tiempo_promedio_horas],
      [],
      ['Distribución por gravedad', 'Reportes'],
      ['Bajo', datos.distribucion_niveles.bajo],
      ['Medio', datos.distribucion_niveles.medio],
      ['Crítico', datos.distribucion_niveles.critico],
      [],
      ['Periodo', 'Reportes creados', 'Zonas creadas', 'Zonas tratadas', 'Litros recolectados', 'Volumen (m3)', 'Tiempo promedio (h)'],
    ];

    for (const punto of datos.series) {
      filas.push([
        punto.periodo,
        punto.reportes_creados,
        punto.zonas_creadas,
        punto.zonas_tratadas,
        punto.litros_recolectados,
        Number((punto.litros_recolectados / 1000).toFixed(3)),
        punto.tiempo_promedio_horas,
      ]);
    }

    const csv =
      '\uFEFF' +
      filas
        .map((fila) =>
          fila
            .map((valor) => `"${String(valor).replace(/"/g, '""')}"`)
            .join(';'),
        )
        .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `juliaca-limpia-${datos.periodo}-${datos.hasta}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------------------------
  // Gráficos
  // -------------------------------------------------------------------------
  private renderizarGraficos(): void {
    const datos = this.stats();
    if (!datos || !this.canvasReportes || !this.canvasVolumen || !this.canvasNiveles) {
      return;
    }

    const etiquetas = datos.series.map((punto) => this.etiqueta(punto));

    this.graficoReportes?.destroy();
    this.graficoReportes = new Chart(this.canvasReportes.nativeElement, {
      type: 'bar',
      data: {
        labels: etiquetas,
        datasets: [
          {
            label: 'Reportes recibidos',
            data: datos.series.map((punto) => punto.reportes_creados),
            backgroundColor: AZUL,
            borderRadius: 6,
            maxBarThickness: 22,
          },
          {
            label: 'Puntos tratados',
            data: datos.series.map((punto) => punto.zonas_tratadas),
            backgroundColor: VERDE,
            borderRadius: 6,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#475569',
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              font: { size: 10, weight: 'bold' },
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.92)',
            padding: 8,
            titleFont: { size: 11 },
            bodyFont: { size: 11 },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94A3B8', font: { size: 9 }, maxRotation: 0, autoSkipPadding: 6 },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#94A3B8', font: { size: 9 }, precision: 0 },
            grid: { color: 'rgba(148,163,184,0.18)' },
          },
        },
      },
    });

    this.graficoVolumen?.destroy();
    this.graficoVolumen = new Chart(this.canvasVolumen.nativeElement, {
      type: 'line',
      data: {
        labels: etiquetas,
        datasets: [
          {
            label: 'Volumen (m³)',
            data: datos.series.map((punto) => Number((punto.litros_recolectados / 1000).toFixed(2))),
            borderColor: CELESTE,
            backgroundColor: 'rgba(0,174,239,0.16)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: AZUL,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.92)',
            padding: 8,
            titleFont: { size: 11 },
            bodyFont: { size: 11 },
            callbacks: {
              label: (contexto) => `${Number(contexto.parsed?.y ?? 0).toFixed(2)} m³ recolectados`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94A3B8', font: { size: 9 }, maxRotation: 0, autoSkipPadding: 6 },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#94A3B8', font: { size: 9 } },
            grid: { color: 'rgba(148,163,184,0.18)' },
          },
        },
      },
    });

    this.graficoNiveles?.destroy();
    this.graficoNiveles = new Chart(this.canvasNiveles.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['Bajo', 'Medio', 'Crítico'],
        datasets: [
          {
            data: [
              datos.distribucion_niveles.bajo,
              datos.distribucion_niveles.medio,
              datos.distribucion_niveles.critico,
            ],
            backgroundColor: [CELESTE, DORADO, ROJO],
            borderColor: '#ffffff',
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.92)',
            padding: 8,
            titleFont: { size: 11 },
            bodyFont: { size: 11 },
            callbacks: {
              label: (contexto) => `${contexto.label}: ${contexto.parsed} reporte(s)`,
            },
          },
        },
      },
    });
  }

  private etiqueta(punto: Serie): string {
    const fecha = new Date(`${punto.periodo}T12:00:00`);
    if (this.periodo() === 'anual') {
      return fecha.toLocaleDateString('es-PE', { month: 'short' });
    }
    if (this.periodo() === 'semanal') {
      return fecha.toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit' });
    }
    return fecha.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
  }
}
