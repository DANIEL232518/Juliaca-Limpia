import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api.service';
import { DashboardStore } from '../../core/dashboard.store';
import { Camion, Parada, Ruta, TratarRespuesta } from '../../core/models';
import { SessionService, UiService } from '../../core/session.service';

const DESCARGA = 'Relleno Sanitario de Huanuyo · -15.5680, -70.3150';

@Component({
  selector: 'app-driver-panel',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="animate-fade-up space-y-4">
      <header class="flex items-start gap-3">
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 16V8h11l3 4h4v4" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="7" cy="18" r="2" />
            <circle cx="18" cy="18" r="2" />
          </svg>
        </div>
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600">Vista conductor</p>
          <h2 class="text-lg font-bold leading-tight text-slate-900">Mi ruta de hoy</h2>
          <p class="mt-0.5 text-xs leading-relaxed text-slate-500">
            Hola {{ sesion.sesion()?.nombre }}. Avanza por tus paradas y sube la foto del punto ya
            limpio para cerrar cada una.
          </p>
        </div>
      </header>

      @if (exito(); as resultado) {
        <section class="animate-fade-up rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4">
          <div class="flex items-start gap-2.5">
            <span class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
              <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 10.5l3.5 3.5L15 7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <div>
              <p class="text-sm font-bold text-emerald-800">{{ resultado.mensaje }}</p>
              <p class="mt-0.5 text-xs text-emerald-700">
                Zona #{{ resultado.zona.id }} tratada ·
                {{ resultado.volumen_recolectado_litros | number: '1.0-0' }} L recolectados
              </p>
              <p class="mt-1 text-[11px] text-emerald-700/90">
                La evidencia indica {{ resultado.analisis.volumen_litros | number: '1.0-0' }} L restantes
                (máximo permitido 25 L). El mapa ya muestra la zona en verde y la carga del camión fue
                actualizada.
              </p>
            </div>
          </div>
          <button
            type="button"
            (click)="exito.set(null)"
            class="mt-3 w-full rounded-xl bg-white px-3 py-2 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
          >
            Continuar con la ruta
          </button>
        </section>
      }

      @if (unidades().length === 0) {
        <section class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-soft">
          <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
            <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 6h9M4 12h6M4 18h13" stroke-linecap="round" />
              <circle cx="18" cy="7" r="2" />
            </svg>
          </div>
          <p class="mt-3 text-sm font-bold text-slate-700">Sin ruta activa asignada</p>
          <p class="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
            El panel administrador todavía no generó rutas para hoy. Cuando lo haga, tus paradas
            aparecerán aquí automáticamente.
          </p>
          <button
            type="button"
            (click)="store.refrescar()"
            class="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200"
          >
            Volver a consultar
          </button>
        </section>
      } @else {
        <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <label class="block">
            <span class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
              Unidad asignada
            </span>
            <select
              [value]="unidadSeleccionadaId()"
              (change)="seleccionarUnidad($event)"
              class="w-full cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-sanroman-celeste focus:bg-white focus:ring-2 focus:ring-sky-100"
            >
              @for (unidad of unidades(); track unidad.id) {
                <option [value]="unidad.id">
                  {{ unidad.codigo_unidad }} ·
                  @if (paradasDe(unidad.id).length === 0) {
                    sin ruta activa
                  } @else {
                    {{ paradasDe(unidad.id).length }} parada{{ paradasDe(unidad.id).length === 1 ? '' : 's' }}
                  }
                </option>
              }
            </select>
          </label>

          @if (ruta(); as actual) {
            <div class="mt-3 grid grid-cols-3 gap-2 text-center">
              <div class="rounded-xl bg-sky-50 px-2 py-2">
                <p class="text-base font-bold text-sanroman-azul">
                  {{ actual.distancia_total_metros / 1000 | number: '1.1-1' }}
                </p>
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">km totales</p>
              </div>
              <div class="rounded-xl bg-amber-50 px-2 py-2">
                <p class="text-base font-bold text-amber-700">
                  {{ actual.volumen_total_litros | number: '1.0-0' }}
                </p>
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">litros</p>
              </div>
              <div class="rounded-xl bg-emerald-50 px-2 py-2">
                <p class="text-base font-bold text-zona-tratada">{{ completadas() }}/{{ actual.paradas.length }}</p>
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">paradas</p>
              </div>
            </div>

            <div class="mt-3">
              <div class="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                <span>Avance de la ruta</span>
                <span>{{ porcentaje() }}%</span>
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  class="h-full rounded-full bg-gradient-to-r from-sanroman-celeste to-sanroman-azul transition-all duration-500"
                  [style.width.%]="porcentaje()"
                ></div>
              </div>
            </div>
          } @else {
            <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              @if (store.conteos().pendientes > 0) {
                <p class="text-xs font-bold text-slate-700">Sin ruta activa para esta unidad</p>
                <p class="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                  Hay {{ store.conteos().pendientes }}
                  {{ store.conteos().pendientes === 1 ? 'zona pendiente' : 'zonas pendientes' }} en la
                  ciudad. Al iniciar la ruta, el planificador asignará las que quepan en la capacidad
                  de {{ camion()?.codigo_unidad ?? 'esta unidad' }}.
                </p>

                @if (avisoRuta()) {
                  <p class="mt-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-[10px] font-medium leading-relaxed text-sanroman-azul">
                    {{ avisoRuta() }}
                  </p>
                }

                <button
                  type="button"
                  (click)="iniciarRuta()"
                  [disabled]="store.generando()"
                  class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-sanroman-azul px-4 py-2.5 text-xs font-bold text-white shadow-card transition hover:bg-[#003a73] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  @if (store.generando()) {
                    <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                    Planificando…
                  } @else {
                    <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M5 4l14 8-14 8V4z" stroke-linejoin="round" />
                    </svg>
                    Iniciar ruta
                  }
                </button>
              } @else {
                <p class="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                  <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M5 10.5l3.5 3.5L15 7" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  Ruta completada
                </p>
                <p class="mt-0.5 text-[10px] text-emerald-700/90">
                  No quedan zonas pendientes. Puedes revisar la carga de la unidad.
                </p>
              }
            </div>
          }

          @if (camion(); as unidad) {
            <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Carga de {{ unidad.codigo_unidad }}
                </p>
                <p
                  class="text-xs font-bold"
                  [class.text-zona-tratada]="!alertaDescarga()"
                  [class.text-basura-critica]="alertaDescarga()"
                >
                  {{ cargaPct() }}%
                </p>
              </div>
              <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  [class.bg-zona-tratada]="cargaPct() < 70"
                  [class.bg-amber-500]="cargaPct() >= 70 && !alertaDescarga()"
                  [class.bg-basura-critica]="alertaDescarga()"
                  [style.width.%]="cargaPct()"
                ></div>
              </div>
              <div class="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                <span>{{ unidad.carga_actual_litros | number: '1.0-0' }} L cargados</span>
                <span>Capacidad {{ unidad.capacidad_litros | number: '1.0-0' }} L</span>
              </div>
            </div>

            @if (alertaDescarga()) {
              <div class="mt-2 rounded-xl border border-red-200 bg-red-50 p-3">
                <p class="flex items-start gap-1.5 text-xs font-bold leading-snug text-basura-critica">
                  <svg viewBox="0 0 24 24" class="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 9v4M12 17h.01" stroke-linecap="round" />
                    <path d="M10.3 3.9 2.5 18a1.8 1.8 0 0 0 1.6 2.7h15.8A1.8 1.8 0 0 0 21.5 18L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" stroke-linejoin="round" />
                  </svg>
                  Carga al {{ cargaPct() }}%. Retorna a descargar en Huanuyo antes de continuar.
                </p>
                <p class="mt-1 pl-5 text-[10px] leading-relaxed text-red-700/90">
                  {{ descarga }}. La alerta se mantiene mientras la carga supere el 85% de la
                  capacidad.
                </p>
              </div>
            }
          }
        </section>

        @if (ruta(); as actual) {
          @if (actual.paradas.length > 0) {
            <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Paradas en orden</p>
                @if (siguiente(); as proxima) {
                  <span class="rounded-full bg-sanroman-azul/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sanroman-azul">
                    Siguiente · {{ proxima.orden }}
                  </span>
                }
              </div>

              <ol class="relative mt-2 space-y-2 border-l border-dashed border-slate-200 pl-4">
                @for (parada of paradas(); track parada.id) {
                  <li class="relative">
                    <span
                      class="absolute -left-[26px] top-2 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
                      [class.bg-sanroman-celeste]="parada.estado_parada === 'pendiente'"
                      [class.bg-zona-tratada]="parada.estado_parada === 'completada'"
                    >
                      @if (parada.estado_parada === 'completada') {
                        <svg viewBox="0 0 20 20" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="3">
                          <path d="M5 10.5l3.5 3.5L15 7" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      } @else {
                        {{ parada.orden }}
                      }
                    </span>

                    <div
                      class="rounded-xl border p-2.5 transition"
                      [class.border-slate-100]="parada.estado_parada === 'completada'"
                      [class.bg-slate-50]="parada.estado_parada === 'completada'"
                      [class.border-slate-200]="parada.estado_parada === 'pendiente'"
                      [class.border-sanroman-celeste]="siguiente()?.id === parada.id"
                      [class.bg-white]="parada.estado_parada === 'pendiente'"
                      [class.shadow-soft]="parada.estado_parada === 'pendiente'"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <p class="truncate text-xs font-bold text-slate-800">
                            {{ parada.direccion_referencia || 'Zona sin referencia' }}
                          </p>
                          <p class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                            <span
                              class="rounded-full px-1.5 py-0.5 font-bold uppercase"
                              [class.bg-red-100]="parada.nivel === 'critico'"
                              [class.text-basura-critica]="parada.nivel === 'critico'"
                              [class.bg-amber-100]="parada.nivel === 'medio'"
                              [class.text-amber-700]="parada.nivel === 'medio'"
                              [class.bg-sky-100]="parada.nivel === 'bajo'"
                              [class.text-sanroman-azul]="parada.nivel === 'bajo'"
                            >
                              {{ parada.nivel }}
                            </span>
                            <span>{{ parada.volumen_estimado_litros | number: '1.0-0' }} L</span>
                            <span>·</span>
                            <span>{{ parada.distancia_metros | number: '1.0-0' }} m</span>
                          </p>
                        </div>
                        @if (parada.estado_parada === 'pendiente') {
                          <button
                            type="button"
                            (click)="abrirTratamiento(parada)"
                            class="shrink-0 rounded-lg bg-sanroman-azul px-2.5 py-1.5 text-[10px] font-bold leading-tight text-white transition hover:bg-[#003a73]"
                            title="Reportar punto tratado / limpio"
                          >
                            Reportar<br />punto limpio
                          </button>
                        } @else {
                          <span class="shrink-0 text-[10px] font-bold uppercase tracking-wide text-zona-tratada">
                            Listo
                          </span>
                        }
                      </div>
                    </div>
                  </li>
                }
              </ol>
            </section>
          }
        }
      }

      @if (paradaActiva(); as parada) {
        <div
          class="fixed inset-0 z-[2000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          role="presentation"
          (click)="cerrarTratamiento()"
        >
          <div
            class="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white shadow-2xl animate-fade-up sm:max-h-[88dvh] sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-evidencia"
            (click)="$event.stopPropagation()"
          >
            <div class="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3">
              <div class="min-w-0">
                <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-zona-tratada">
                  Reportar punto tratado / limpio
                </p>
                <h3 id="titulo-evidencia" class="truncate text-sm font-bold leading-tight text-slate-900">
                  {{ parada.direccion_referencia || 'Zona sin referencia' }}
                </h3>
                <p class="mt-0.5 text-[10px] text-slate-500">
                  Parada {{ parada.orden }} · {{ parada.volumen_estimado_litros | number: '1.0-0' }} L estimados
                </p>
              </div>
              <button
                type="button"
                (click)="cerrarTratamiento()"
                [disabled]="enviando()"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-50"
                aria-label="Cerrar modal"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
                </svg>
              </button>
            </div>

            <div class="space-y-3 p-4">
              <div class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p class="text-[10px] font-semibold leading-relaxed text-amber-800">
                  La foto es obligatoria. La visión artificial validará que queden como máximo 25 L
                  en el punto antes de cerrarlo.
                </p>
              </div>

              @if (previewEvidencia()) {
                <div class="relative overflow-hidden rounded-xl border border-slate-200">
                  <img [src]="previewEvidencia()" alt="Evidencia de limpieza" class="h-44 w-full object-cover" />
                  <button
                    type="button"
                    (click)="quitarEvidencia()"
                    [disabled]="enviando()"
                    class="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-white transition hover:bg-slate-900 disabled:opacity-50"
                    aria-label="Quitar evidencia"
                  >
                    <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
                    </svg>
                  </button>
                  <span class="absolute bottom-2 left-2 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-bold text-white">
                    Evidencia lista
                  </span>
                </div>
              } @else {
                <label
                  class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-sanroman-celeste/60 bg-sky-50/40 px-4 py-7 text-center transition hover:border-sanroman-celeste hover:bg-sky-50"
                >
                  <svg viewBox="0 0 24 24" class="h-8 w-8 text-sanroman-celeste" fill="none" stroke="currentColor" stroke-width="1.7">
                    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" stroke-linejoin="round" />
                    <circle cx="12" cy="13" r="3.2" />
                  </svg>
                  <span class="text-xs font-bold text-slate-700">Tomar foto del punto limpio</span>
                  <span class="text-[10px] text-slate-400">Obligatoria · JPG, PNG o WebP · máx. 15 MB</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    class="sr-only"
                    (change)="onEvidencia($event)"
                  />
                </label>
              }

              <label class="block">
                <span class="mb-1 block text-xs font-semibold text-slate-600">Observación (opcional)</span>
                <textarea
                  rows="2"
                  [value]="observacion()"
                  (input)="observacion.set($any($event.target).value)"
                  maxlength="300"
                  placeholder="Ej. Se recogió todo, se barrió el perímetro…"
                  class="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-sanroman-celeste focus:bg-white focus:ring-2 focus:ring-sky-100"
                ></textarea>
              </label>

              @if (error()) {
                <p class="rounded-lg bg-red-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-basura-critica ring-1 ring-red-100">
                  {{ error() }}
                </p>
              }
            </div>

            <div class="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-4 py-3">
              <button
                type="button"
                (click)="cerrarTratamiento()"
                [disabled]="enviando()"
                class="flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="confirmarTratamiento()"
                [disabled]="!evidencia() || enviando()"
                class="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-zona-tratada px-3 py-2.5 text-xs font-bold text-white shadow-soft transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                @if (enviando()) {
                  <span class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                  Validando…
                } @else {
                  <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M5 10.5l3.5 3.5L15 7" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  Confirmar limpieza
                }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class DriverPanelComponent implements OnDestroy {
  readonly store = inject(DashboardStore);
  readonly sesion = inject(SessionService);
  readonly ui = inject(UiService);
  readonly descarga = DESCARGA;

  readonly exito = signal<TratarRespuesta | null>(null);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);
  readonly paradaActiva = signal<Parada | null>(null);
  readonly evidencia = signal<File | null>(null);
  readonly previewEvidencia = signal<string | null>(null);
  readonly observacion = signal('');
  readonly unidadSeleccionadaId = signal<number | null>(null);
  readonly avisoRuta = signal<string | null>(null);

  private readonly api = inject(ApiService);
  private objectUrl: string | null = null;

  readonly unidades = computed<Camion[]>(() =>
    [...this.store.camiones()].sort((a, b) => a.codigo_unidad.localeCompare(b.codigo_unidad)),
  );

  readonly ruta = computed<Ruta | null>(() => {
    const id = this.unidadSeleccionadaId();
    if (id === null) {
      return null;
    }
    return this.store.rutas().find((ruta) => ruta.camion_id === id) ?? null;
  });

  readonly camion = computed<Camion | null>(() => {
    const id = this.unidadSeleccionadaId();
    if (id === null) {
      return null;
    }
    return this.store.camiones().find((camion) => camion.id === id) ?? null;
  });

  readonly paradas = computed<Parada[]>(() =>
    [...(this.ruta()?.paradas ?? [])].sort((a, b) => a.orden - b.orden),
  );

  readonly completadas = computed(
    () => this.paradas().filter((parada) => parada.estado_parada === 'completada').length,
  );

  readonly porcentaje = computed(() => {
    const total = this.paradas().length;
    return total === 0 ? 0 : Math.round((this.completadas() / total) * 100);
  });

  readonly siguiente = computed<Parada | null>(
    () => this.paradas().find((parada) => parada.estado_parada === 'pendiente') ?? null,
  );

  readonly cargaPct = computed(() => {
    const camion = this.camion();
    if (!camion || camion.capacidad_litros <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((camion.carga_actual_litros / camion.capacidad_litros) * 100));
  });

  readonly alertaDescarga = computed(() => this.cargaPct() > 85);

  constructor() {
    // Al abrir el panel, sugiere la primera unidad con ruta (o la primera
    // unidad si aún no hay plan). La elección del usuario nunca se pisa.
    effect(() => {
      const rutas = this.store.rutas();
      const camiones = this.store.camiones();
      if (this.unidadSeleccionadaId() !== null || camiones.length === 0) {
        return;
      }
      const inicial = rutas[0]?.camion_id ?? camiones[0].id;
      this.unidadSeleccionadaId.set(inicial);
    });

    // El mapa enfoca la compactadora seleccionada y atenúa las demás rutas.
    effect(() => {
      this.ui.enfocarCamion(this.unidadSeleccionadaId());
    });
  }

  ngOnDestroy(): void {
    this.ui.enfocarCamion(null);
    this.liberarPreview();
  }

  paradasDe(camionId: number): Parada[] {
    return this.store.rutas().find((ruta) => ruta.camion_id === camionId)?.paradas ?? [];
  }

  seleccionarUnidad(evento: Event): void {
    const valor = Number((evento.target as HTMLSelectElement).value);
    this.unidadSeleccionadaId.set(valor);
    this.cerrarTratamiento();
    this.exito.set(null);
    this.avisoRuta.set(null);
  }

  /**
   * Genera la ruta de la unidad seleccionada. El planificador del backend
   * solo asigna las zonas que caben en la capacidad del camión, así que la
   * ruta refleja lo que esta unidad puede recoger.
   */
  iniciarRuta(): void {
    const id = this.unidadSeleccionadaId();
    if (id === null || this.store.generando()) {
      return;
    }
    this.avisoRuta.set(null);
    this.store.generarRutas([id]).subscribe({
      next: (respuesta) => {
        if (respuesta.rutas.length === 0) {
          this.avisoRuta.set('No hay zonas pendientes que quepan en la capacidad de esta unidad.');
        } else {
          this.avisoRuta.set(respuesta.mensaje);
        }
      },
      error: (respuesta: { error?: { mensaje?: string } }) => {
        this.avisoRuta.set(
          respuesta?.error?.mensaje ?? 'No se pudo generar la ruta. Intenta de nuevo.',
        );
      },
    });
  }

  abrirTratamiento(parada: Parada): void {
    this.paradaActiva.set(parada);
    this.error.set(null);
    this.exito.set(null);
  }

  cerrarTratamiento(): void {
    if (this.enviando()) {
      return;
    }
    this.paradaActiva.set(null);
    this.quitarEvidencia();
    this.observacion.set('');
    this.error.set(null);
  }

  onEvidencia(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type)) {
      this.error.set('La evidencia debe ser JPG, PNG o WebP.');
      return;
    }
    if (archivo.size > 15 * 1024 * 1024) {
      this.error.set('La foto supera los 15 MB permitidos.');
      return;
    }
    this.error.set(null);
    this.liberarPreview();
    this.evidencia.set(archivo);
    this.objectUrl = URL.createObjectURL(archivo);
    this.previewEvidencia.set(this.objectUrl);
  }

  quitarEvidencia(): void {
    this.liberarPreview();
    this.evidencia.set(null);
    this.previewEvidencia.set(null);
  }

  confirmarTratamiento(): void {
    const parada = this.paradaActiva();
    const archivo = this.evidencia();
    const camion = this.camion();

    if (!parada || !archivo || !camion) {
      this.error.set('Adjunta la foto de evidencia para continuar.');
      return;
    }

    const conductorId = this.sesion.sesion()?.conductorId ?? this.sesion.sesion()?.usuarioId;
    if (!conductorId) {
      this.error.set('La sesión no tiene un conductor asociado.');
      return;
    }

    const datos = new FormData();
    datos.append('foto_evidencia', archivo, archivo.name);
    datos.append('camion_id', String(camion.id));
    datos.append('conductor_id', String(conductorId));
    datos.append('observacion', this.observacion().trim());

    this.enviando.set(true);
    this.error.set(null);

    this.api.tratarZona(parada.zona_id, datos).subscribe({
      next: (resultado) => {
        this.enviando.set(false);
        this.exito.set(resultado);
        this.paradaActiva.set(null);
        this.quitarEvidencia();
        this.observacion.set('');
        this.error.set(null);
        this.store.refrescar(true);
      },
      error: (respuesta: { error?: { mensaje?: string } }) => {
        this.enviando.set(false);
        this.error.set(
          respuesta?.error?.mensaje ??
            'No se pudo validar la evidencia. Verifica que el área esté realmente limpia.',
        );
      },
    });
  }

  private liberarPreview(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
