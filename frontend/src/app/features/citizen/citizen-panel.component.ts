import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpEventType } from '@angular/common/http';

import { ApiService } from '../../core/api.service';
import { DashboardStore } from '../../core/dashboard.store';
import { SessionService, UiService } from '../../core/session.service';
import {
  CrearReporteRespuesta,
  EstadoZona,
  Nivel,
  ReporteUsuario,
} from '../../core/models';

const PASOS: { estado: EstadoZona; etiqueta: string }[] = [
  { estado: 'pendiente', etiqueta: 'Pendiente' },
  { estado: 'en_ruta', etiqueta: 'En ruta' },
  { estado: 'tratado', etiqueta: 'Tratado' },
];

@Component({
  selector: 'app-citizen-panel',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="animate-fade-up space-y-4">
      <header class="flex items-start gap-3">
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sanroman-azul">
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 21s-7-4.4-7-10a7 7 0 1 1 14 0c0 5.6-7 10-7 10z" stroke-linejoin="round" />
            <circle cx="12" cy="11" r="2.5" />
          </svg>
        </div>
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-sanroman-celeste">Vista ciudadano</p>
          <h2 class="text-lg font-bold leading-tight text-slate-900">Reportar acumulación</h2>
          <p class="mt-0.5 text-xs leading-relaxed text-slate-500">
            Toma una foto, confirma tu ubicación y la Municipalidad agrupará tu reporte con los de
            tu zona.
          </p>
        </div>
      </header>

      @if (exito(); as resultado) {
        <section class="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 animate-fade-up">
          <div class="flex items-start gap-2.5">
            <span class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
              <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M5 10.5l3.5 3.5L15 7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <div class="min-w-0">
              <p class="text-sm font-bold text-emerald-800">{{ resultado.mensaje }}</p>
              <p class="mt-1 text-xs text-emerald-700">
                Zona #{{ resultado.zona.id }} · {{ resultado.zona.direccion_referencia }}
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span
                  class="rounded-full px-2 py-0.5"
                  [class.bg-sky-100]="resultado.zona_nueva"
                  [class.text-sanroman-azul]="resultado.zona_nueva"
                  [class.bg-amber-100]="!resultado.zona_nueva"
                  [class.text-amber-800]="!resultado.zona_nueva"
                >
                  {{ resultado.zona_nueva ? 'Punto nuevo' : 'Fusionado · menos de 20 m' }}
                </span>
                <span class="rounded-full bg-white px-2 py-0.5 text-slate-600">
                  {{ resultado.analisis.volumen_litros | number: '1.0-0' }} L estimados
                </span>
                <span class="rounded-full bg-white px-2 py-0.5 text-slate-600">
                  Nivel {{ etiquetaNivel(resultado.analisis.nivel) }}
                </span>
                <span class="rounded-full bg-white px-2 py-0.5 text-slate-600">
                  {{ resultado.zona.total_reportes }} reportes juntos
                </span>
              </div>
              <p class="mt-2 text-[11px] leading-relaxed text-emerald-700/90">
                {{ resultado.analisis.recomendacion }}
              </p>
            </div>
          </div>
          <button
            type="button"
            (click)="exito.set(null)"
            class="mt-3 w-full rounded-xl bg-white px-3 py-2 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
          >
            Enviar otro reporte
          </button>
        </section>
      }

      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Paso 1 · Ubicación</p>
            @if (ui.punto(); as punto) {
              <p class="mt-0.5 text-sm font-semibold text-slate-800">
                {{ punto.lat | number: '1.5-5' }}, {{ punto.lng | number: '1.5-5' }}
              </p>
              <p class="text-[11px] text-slate-500">
                @if (ui.gpsConfirmado()) {
                  Ubicación GPS lista · puedes ajustar el pin tocando el mapa
                } @else {
                  Falta confirmar la ubicación con tu GPS
                }
              </p>
            } @else {
              <p class="mt-0.5 text-sm font-semibold text-slate-800">
                {{ geolocalizando() ? 'Obteniendo tu ubicación GPS…' : 'Necesitamos tu ubicación GPS' }}
              </p>
              <p class="text-[11px] text-slate-500">
                Los reportes se toman con el GPS del dispositivo dentro del área de Juliaca.
              </p>
            }
          </div>
          <button
            type="button"
            (click)="usarUbicacion()"
            [disabled]="geolocalizando()"
            class="flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-50 px-2.5 py-2 text-[11px] font-bold text-sanroman-azul ring-1 ring-sky-200 transition hover:bg-sky-100 disabled:opacity-60"
          >
            @if (geolocalizando()) {
              <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sanroman-azul border-t-transparent"></span>
            } @else {
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke-linecap="round" />
              </svg>
            }
            {{ geolocalizando() ? 'Ubicando…' : 'Mi GPS' }}
          </button>
        </div>

        @if (geoMensaje()) {
          <p class="mt-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-[10px] font-medium leading-relaxed text-sanroman-azul">
            {{ geoMensaje() }}
          </p>
        }

        @if (ui.puntoAviso()) {
          <p class="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10px] font-medium leading-relaxed text-amber-700 ring-1 ring-amber-100">
            {{ ui.puntoAviso() }}
          </p>
        }

        @if (ui.punto()) {
          <button
            type="button"
            (click)="quitarPunto()"
            class="mt-2 text-[11px] font-semibold text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
          >
            Quitar punto seleccionado
          </button>
        }
      </section>

      <section class="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Paso 2 · Detalle y foto</p>

        <label class="block">
          <span class="mb-1 block text-xs font-semibold text-slate-600">Referencia del lugar</span>
          <input
            type="text"
            [value]="direccion()"
            (input)="direccion.set($any($event.target).value)"
            placeholder="Ej. Jr. Tumbes, frente al mercado"
            maxlength="160"
            class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-sanroman-celeste focus:bg-white focus:ring-2 focus:ring-sky-100"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-xs font-semibold text-slate-600">Comentario (opcional)</span>
          <textarea
            rows="2"
            [value]="comentario()"
            (input)="comentario.set($any($event.target).value)"
            placeholder="¿Qué observas? Olores, cantidad, riesgo…"
            maxlength="500"
            class="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-sanroman-celeste focus:bg-white focus:ring-2 focus:ring-sky-100"
          ></textarea>
        </label>

        <div>
          <span class="mb-1 block text-xs font-semibold text-slate-600">Fotografía</span>
          @if (preview()) {
            <div class="relative overflow-hidden rounded-xl border border-slate-200">
              <img [src]="preview()" alt="Vista previa del reporte" class="h-44 w-full object-cover" />
              <button
                type="button"
                (click)="quitarFoto()"
                class="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-white transition hover:bg-slate-900"
                aria-label="Quitar foto"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
                </svg>
              </button>
              <span
                class="absolute bottom-2 left-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-bold text-white"
              >
                Lista para enviar
              </span>
            </div>
          } @else {
            <label
              class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-7 text-center transition hover:border-sanroman-celeste hover:bg-sky-50/40"
            >
              <svg viewBox="0 0 24 24" class="h-8 w-8 text-sanroman-celeste" fill="none" stroke="currentColor" stroke-width="1.7">
                <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" stroke-linejoin="round" />
                <circle cx="12" cy="13" r="3.2" />
              </svg>
              <span class="text-xs font-bold text-slate-700">Tomar foto o elegir de la galería</span>
              <span class="text-[10px] text-slate-400">JPG, PNG o WebP · máx. 15 MB</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                class="sr-only"
                (change)="onArchivo($event)"
              />
            </label>
          }
        </div>

        @if (enviando()) {
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-[10px] font-semibold text-slate-500">
              <span>{{ progreso() >= 100 ? 'Analizando con visión artificial…' : 'Subiendo foto…' }}</span>
              <span>{{ progreso() }}%</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                class="h-full rounded-full bg-gradient-to-r from-sanroman-celeste to-sanroman-azul transition-all duration-300"
                [style.width.%]="progreso()"
              ></div>
            </div>
          </div>
        }

        @if (error()) {
          <p class="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-basura-critica ring-1 ring-red-100">
            {{ error() }}
          </p>
        }

        <button
          type="button"
          (click)="enviar()"
          [disabled]="!puedeEnviar()"
          class="flex w-full items-center justify-center gap-2 rounded-xl bg-sanroman-azul px-4 py-3 text-sm font-bold text-white shadow-card transition hover:bg-[#003a73] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
        >
          @if (enviando()) {
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
            Enviando…
          } @else {
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 12l16-7-6 16-2.5-6.5L4 12z" stroke-linejoin="round" />
            </svg>
            Enviar reporte
          }
        </button>

        <p class="flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-400">
          <svg viewBox="0 0 24 24" class="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" stroke-linecap="round" />
          </svg>
          La imagen se analiza con visión artificial para estimar el volumen y validar la nitidez.
          Los reportes a menos de 20 m se fusionan automáticamente en una sola zona.
        </p>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs font-bold uppercase tracking-wide text-slate-400">Mis reportes</p>
            <h3 class="text-sm font-bold leading-tight text-slate-900">Estado en mi zona</h3>
          </div>
          <button
            type="button"
            (click)="cargarMisReportes()"
            [disabled]="cargandoReportes()"
            class="grid h-8 w-8 place-items-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50"
            title="Actualizar mis reportes"
            aria-label="Actualizar mis reportes"
          >
            <svg
              viewBox="0 0 24 24"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              [class.animate-spin]="cargandoReportes()"
            >
              <path d="M20 11a8 8 0 1 0-2.3 5.7" stroke-linecap="round" />
              <path d="M20 4v7h-7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>

        @if (reportes().length === 0) {
          <div class="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-5 text-center">
            <p class="text-xs font-semibold text-slate-600">
              {{ cargandoReportes() ? 'Buscando tus reportes…' : 'Aún no tienes reportes' }}
            </p>
            <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
              Cuando envíes una foto, aquí verás el avance: Pendiente → En ruta → Tratado.
            </p>
          </div>
        } @else {
          <div class="mt-3 space-y-2.5">
            @for (reporte of reportes(); track reporte.id) {
              <article
                class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft transition hover:border-sky-200"
              >
                <div class="flex gap-2.5 p-2.5">
                  <div class="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    @if (fotoUrl(reporte.foto_url); as foto) {
                      <img [src]="foto" alt="Foto de mi reporte" class="h-full w-full object-cover" loading="lazy" />
                    } @else {
                      <div class="grid h-full w-full place-items-center text-[9px] font-semibold text-slate-400">
                        Sin foto
                      </div>
                    }
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <p class="truncate text-xs font-bold text-slate-800">
                        {{ reporte.zona_direccion || 'Zona sin referencia' }}
                      </p>
                      <span
                        class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1"
                        [class]="claseEstado(reporte.zona_estado)"
                      >
                        {{ etiquetaEstado(reporte.zona_estado) }}
                      </span>
                    </div>
                    <p class="mt-0.5 text-[10px] text-slate-500">
                      {{ reporte.volumen_litros | number: '1.0-0' }} L · Nivel
                      {{ etiquetaNivel(reporte.nivel) }} · {{ fecha(reporte.creado_en) }}
                    </p>
                    <p class="mt-0.5 text-[10px] text-slate-400">
                      Zona #{{ reporte.zona_id }} · {{ reporte.zona_total_reportes }} reporte{{
                        reporte.zona_total_reportes === 1 ? '' : 's'
                      }}
                      fusionado{{ reporte.zona_total_reportes === 1 ? '' : 's' }}
                    </p>

                    <div class="mt-1.5 flex items-center gap-1">
                      @for (paso of pasos; track paso.estado; let indice = $index) {
                        <span
                          class="rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ring-1"
                          [class]="clasePaso(reporte.zona_estado, indice)"
                        >
                          {{ paso.etiqueta }}
                        </span>
                        @if (indice < pasos.length - 1) {
                          <span class="h-px flex-1 bg-slate-200"></span>
                        }
                      }
                    </div>
                  </div>
                </div>

                @if (reporte.zona_estado === 'tratado') {
                  <div class="flex items-center gap-2 border-t border-emerald-100 bg-emerald-50/70 px-2.5 py-2">
                    <div class="h-10 w-14 shrink-0 overflow-hidden rounded-md bg-emerald-100">
                      @if (fotoUrl(reporte.evidencia_foto_url); as evidencia) {
                        <img
                          [src]="evidencia"
                          alt="Foto de limpieza del conductor"
                          class="h-full w-full object-cover"
                          loading="lazy"
                        />
                      } @else {
                        <div class="grid h-full w-full place-items-center text-[8px] font-semibold text-emerald-700">
                          Sin foto
                        </div>
                      }
                    </div>
                    <div class="min-w-0">
                      <p class="text-[10px] font-bold text-emerald-800">Limpieza confirmada por el conductor</p>
                      <p class="truncate text-[9px] text-emerald-700/80">
                        {{ fecha(reporte.evidencia_creado_en ?? reporte.tratado_en) }} ·
                        {{ reporte.zona_volumen_estimado_litros | number: '1.0-0' }} L recolectados
                      </p>
                    </div>
                  </div>
                } @else {
                  <div class="border-t border-slate-100 px-2.5 py-1.5">
                    <p class="text-[9px] leading-relaxed text-slate-400">
                      {{
                        reporte.zona_estado === 'en_ruta'
                          ? 'Una compactadora ya tiene tu zona en su ruta de hoy.'
                          : 'Tu reporte está en espera de ser incluido en una ruta.'
                      }}
                    </p>
                  </div>
                }
              </article>
            }
          </div>
        }
      </section>
    </div>
  `,
})
export class CitizenPanelComponent implements OnDestroy {
  readonly ui = inject(UiService);
  readonly store = inject(DashboardStore);
  readonly pasos = PASOS;

  readonly exito = signal<CrearReporteRespuesta | null>(null);
  readonly enviando = signal(false);
  readonly progreso = signal(0);
  readonly error = signal<string | null>(null);
  readonly geolocalizando = signal(false);
  readonly geoMensaje = signal<string | null>(null);
  readonly foto = signal<File | null>(null);
  readonly preview = signal<string | null>(null);
  readonly direccion = signal('');
  readonly comentario = signal('');
  readonly reportes = signal<ReporteUsuario[]>([]);
  readonly cargandoReportes = signal(false);

  private readonly api = inject(ApiService);
  private readonly sesion = inject(SessionService);
  private objectUrl: string | null = null;

  constructor() {
    // "Mis reportes" se recarga al crear un reporte, cuando llega un evento SSE
    // o cuando el sondeo de seguridad del store actualiza el mapa.
    effect(() => {
      this.store.actualizado();
      this.cargarMisReportes();
    });

    // Geolocalización automática al abrir el panel. Si el navegador la bloquea,
    // el ciudadano puede marcar el punto tocando el mapa.
    window.setTimeout(() => {
      if (!this.ui.punto()) {
        this.usarUbicacion(true);
      }
    }, 500);
  }

  ngOnDestroy(): void {
    this.liberarPreview();
  }

  puedeEnviar(): boolean {
    // Sin GPS no se puede enviar: la ubicación debe venir del dispositivo.
    return (
      !this.enviando() &&
      this.foto() !== null &&
      this.ui.punto() !== null &&
      this.ui.gpsConfirmado()
    );
  }

  onArchivo(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type)) {
      this.error.set('La foto debe ser JPG, PNG o WebP.');
      return;
    }
    if (archivo.size > 15 * 1024 * 1024) {
      this.error.set('La foto supera los 15 MB permitidos.');
      return;
    }
    this.error.set(null);
    this.liberarPreview();
    this.foto.set(archivo);
    this.objectUrl = URL.createObjectURL(archivo);
    this.preview.set(this.objectUrl);
  }

  quitarFoto(): void {
    this.liberarPreview();
    this.foto.set(null);
    this.preview.set(null);
  }

  quitarPunto(): void {
    this.ui.limpiarPunto();
    this.geoMensaje.set(null);
  }

  usarUbicacion(automatica = false): void {
    if (!navigator.geolocation) {
      if (!automatica) {
        this.error.set('Tu navegador no expone el GPS, necesario para enviar un reporte.');
      } else {
        this.geoMensaje.set('Tu navegador no expone el GPS: sin GPS no se puede enviar el reporte.');
      }
      return;
    }
    if (this.geolocalizando()) {
      return;
    }

    this.geolocalizando.set(true);
    if (!automatica) {
      this.error.set(null);
    }

    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        this.ui.seleccionar(
          { lat: posicion.coords.latitude, lng: posicion.coords.longitude },
          'gps',
        );
        this.geoMensaje.set('Ubicación GPS lista. Ajusta el pin tocando el mapa si hace falta.');
        this.geolocalizando.set(false);
      },
      () => {
        this.geolocalizando.set(false);
        if (automatica) {
          this.geoMensaje.set(
            'No pudimos leer tu GPS: sin GPS no se puede enviar el reporte. Toca "Mi GPS" para reintentar.',
          );
        } else {
          this.error.set('No se pudo obtener tu ubicación GPS. Sin GPS no se puede enviar el reporte.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  enviar(): void {
    const punto = this.ui.punto();
    const foto = this.foto();
    if (!punto || !foto) {
      this.error.set('Marca el punto en el mapa y adjunta una fotografía.');
      return;
    }
    if (!this.ui.gpsConfirmado()) {
      this.error.set('La ubicación debe venir del GPS del dispositivo. Activa tu GPS y vuelve a intentarlo.');
      return;
    }

    const datos = new FormData();
    datos.append('foto', foto, foto.name);
    datos.append('lat', punto.lat.toFixed(6));
    datos.append('lng', punto.lng.toFixed(6));
    datos.append('direccion_referencia', this.direccion().trim());
    datos.append('comentario', this.comentario().trim());
    const usuarioId = this.sesion.sesion()?.usuarioId;
    if (usuarioId) {
      datos.append('usuario_id', String(usuarioId));
    }

    this.enviando.set(true);
    this.progreso.set(0);
    this.error.set(null);

    this.api.crearReporteConProgreso(datos).subscribe({
      next: (evento) => {
        if (evento.type === HttpEventType.UploadProgress) {
          const total = evento.total ?? 0;
          if (total > 0) {
            this.progreso.set(Math.min(99, Math.round((evento.loaded / total) * 100)));
          }
        }

        if (evento.type !== HttpEventType.Response) {
          return;
        }

        this.progreso.set(100);
        this.enviando.set(false);
        const resultado = evento.body;
        if (!resultado) {
          this.error.set('La API no devolvió el resultado del análisis.');
          return;
        }

        this.exito.set(resultado);
        this.quitarFoto();
        this.comentario.set('');
        this.direccion.set('');
        this.geoMensaje.set(null);
        this.store.refrescar(true);
        this.cargarMisReportes();
      },
      error: (respuesta: { error?: { mensaje?: string } }) => {
        this.enviando.set(false);
        this.progreso.set(0);
        this.error.set(respuesta?.error?.mensaje ?? 'No se pudo enviar el reporte.');
      },
    });
  }

  cargarMisReportes(): void {
    const usuarioId = this.sesion.sesion()?.usuarioId;
    if (!usuarioId) {
      return;
    }
    this.cargandoReportes.set(true);
    this.api.misReportes(usuarioId).subscribe({
      next: (respuesta) => {
        this.reportes.set(respuesta.reportes);
        this.cargandoReportes.set(false);
      },
      error: () => this.cargandoReportes.set(false),
    });
  }

  etiquetaNivel(nivel: Nivel | string): string {
    return nivel === 'critico' ? 'Crítico' : nivel === 'medio' ? 'Medio' : 'Bajo';
  }

  etiquetaEstado(estado: EstadoZona): string {
    return estado === 'tratado' ? 'Tratado' : estado === 'en_ruta' ? 'En ruta' : 'Pendiente';
  }

  claseEstado(estado: EstadoZona): string {
    if (estado === 'tratado') {
      return 'bg-emerald-50 text-zona-tratada ring-emerald-100';
    }
    if (estado === 'en_ruta') {
      return 'bg-amber-50 text-amber-700 ring-amber-100';
    }
    return 'bg-sky-50 text-sanroman-azul ring-sky-100';
  }

  clasePaso(estado: EstadoZona, indice: number): string {
    const actual = estado === 'tratado' ? 2 : estado === 'en_ruta' ? 1 : 0;
    if (indice < actual) {
      return 'bg-emerald-50 text-zona-tratada ring-emerald-100';
    }
    if (indice === actual) {
      if (estado === 'tratado') {
        return 'bg-emerald-50 text-zona-tratada ring-emerald-100';
      }
      if (estado === 'en_ruta') {
        return 'bg-amber-50 text-amber-700 ring-amber-100';
      }
      return 'bg-sky-50 text-sanroman-azul ring-sky-100';
    }
    return 'bg-slate-50 text-slate-400 ring-slate-100';
  }

  fecha(valor?: string | null): string {
    if (!valor) {
      return '—';
    }
    try {
      return new Intl.DateTimeFormat('es-PE', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(valor));
    } catch {
      return '—';
    }
  }

  fotoUrl(url?: string | null): string | null {
    if (!url) {
      return null;
    }
    try {
      const destino = new URL(url, window.location.origin);
      if (destino.port === '9000') {
        destino.hostname = window.location.hostname;
      }
      return destino.toString();
    } catch {
      return url;
    }
  }

  private liberarPreview(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
