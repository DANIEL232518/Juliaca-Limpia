import { Component, inject, signal } from '@angular/core';

import { Rol } from '../../core/models';
import { SessionService } from '../../core/session.service';

interface OpcionRol {
  rol: Rol;
  titulo: string;
  descripcion: string;
  detalle: string;
}

@Component({
  selector: 'app-login',
  standalone: true,
  template: `
    <div class="grid min-h-dvh bg-fondo lg:grid-cols-[1.05fr_1fr]">
      <!-- Panel institucional -->
      <section
        class="relative hidden overflow-hidden bg-sanroman-azul p-10 text-white lg:flex lg:flex-col lg:justify-between"
      >
        <div class="absolute inset-0 opacity-25" aria-hidden="true">
          <svg viewBox="0 0 800 800" class="h-full w-full">
            <defs>
              <pattern id="grilla" width="46" height="46" patternUnits="userSpaceOnUse">
                <path d="M46 0H0v46" fill="none" stroke="#7dd3fc" stroke-width="0.7" />
              </pattern>
            </defs>
            <rect width="800" height="800" fill="url(#grilla)" />
            <circle cx="620" cy="180" r="160" fill="#00AEEF" opacity="0.35" />
            <circle cx="120" cy="650" r="240" fill="#FDB913" opacity="0.16" />
            <path d="M0 560c180-90 300 30 460-40s240-20 340-70" fill="none" stroke="#00AEEF" stroke-width="4" />
            <path d="M0 620c190-70 300 50 470-20s220-30 330-80" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.4" />
          </svg>
        </div>

        <div class="relative flex items-center gap-3">
          <div class="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/25">
            <svg viewBox="0 0 64 64" class="h-10 w-10" aria-hidden="true">
              <path d="M8 46h48" stroke="#00AEEF" stroke-width="4" stroke-linecap="round" />
              <path d="M18 46V29l11-8 11 8v17" fill="#F8FAFC" />
              <path d="M34 21l14 8v17H34z" fill="#DCEBFA" />
              <circle cx="48" cy="21" r="5" fill="#FDB913" />
              <path d="M25 46V35h7v11" fill="#00AEEF" />
              <path d="M37 35h7v4h-7zM37 42h7v4h-7z" fill="#004B93" />
            </svg>
          </div>
          <div class="leading-tight">
            <p class="text-xs uppercase tracking-[0.28em] text-sky-200">Municipalidad Provincial</p>
            <p class="text-sm font-semibold">de San Román — Juliaca</p>
          </div>
        </div>

        <div class="relative max-w-xl">
          <p class="mb-3 inline-flex rounded-full bg-sanroman-dorado/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sanroman-dorado ring-1 ring-sanroman-dorado/30">
            Fase 2 · Centro de control
          </p>
          <h1 class="text-5xl font-black leading-[1.02] tracking-tight">
            JULIACA<br /><span class="text-sanroman-dorado">LIMPIA</span>
          </h1>
          <p class="mt-5 max-w-md text-base leading-relaxed text-sky-100/90">
            Reportes ciudadanos georreferenciados, estimación de volumen con visión artificial y
            rutas optimizadas para las compactadoras de la ciudad, en un solo mapa en vivo.
          </p>

          <div class="mt-8 grid grid-cols-3 gap-3 text-center">
            <div class="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
              <p class="text-2xl font-bold">20 m</p>
              <p class="text-[11px] text-sky-100/80">radio de fusión</p>
            </div>
            <div class="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
              <p class="text-2xl font-bold">4</p>
              <p class="text-[11px] text-sky-100/80">compactadoras</p>
            </div>
            <div class="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15">
              <p class="text-2xl font-bold">SSE</p>
              <p class="text-[11px] text-sky-100/80">tiempo real</p>
            </div>
          </div>
        </div>

        <p class="relative text-xs text-sky-200/70">
          Centro de Juliaca · -15.4941, -70.1356 · Zona horaria America/Lima
        </p>
      </section>

      <!-- Formulario de acceso -->
      <section class="flex items-center justify-center px-4 py-10 sm:px-8">
        <div class="w-full max-w-md animate-fade-up">
          <div class="mb-8 flex items-center gap-3 lg:hidden">
            <div class="grid h-12 w-12 place-items-center rounded-2xl bg-sanroman-azul">
              <svg viewBox="0 0 64 64" class="h-8 w-8" aria-hidden="true">
                <path d="M8 46h48" stroke="#00AEEF" stroke-width="4" stroke-linecap="round" />
                <path d="M18 46V29l11-8 11 8v17" fill="#F8FAFC" />
                <path d="M34 21l14 8v17H34z" fill="#DCEBFA" />
                <circle cx="48" cy="21" r="5" fill="#FDB913" />
                <path d="M25 46V35h7v11" fill="#00AEEF" />
              </svg>
            </div>
            <div>
              <p class="text-2xl font-extrabold leading-none tracking-[0.06em] text-sanroman-azul">
                JULIACA <span class="text-sanroman-dorado">LIMPIA</span>
              </p>
              <p class="text-[11px] text-slate-500">Gestión de Residuos Sólidos</p>
            </div>
          </div>

          <h2 class="text-2xl font-bold text-slate-900">Bienvenido al centro de control</h2>
          <p class="mt-1 text-sm text-slate-500">
            Elige un perfil para explorar la plataforma. El acceso es de demostración: la
            autenticación real llega en la Fase 3.
          </p>

          <div class="mt-6 space-y-3">
            @for (opcion of opciones; track opcion.rol) {
              <button
                type="button"
                (click)="seleccionar(opcion.rol)"
                class="flex w-full items-start gap-4 rounded-2xl border bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
                [class.border-sanroman-azul]="rol() === opcion.rol"
                [class.ring-2]="rol() === opcion.rol"
                [class.ring-sanroman-celeste]="rol() === opcion.rol"
                [class.border-slate-200]="rol() !== opcion.rol"
              >
                <span
                  class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  [class.bg-sanroman-azul]="opcion.rol === 'admin'"
                  [class.text-white]="opcion.rol === 'admin'"
                  [class.bg-sky-100]="opcion.rol === 'ciudadano'"
                  [class.text-sanroman-azul]="opcion.rol === 'ciudadano'"
                  [class.bg-amber-100]="opcion.rol === 'conductor'"
                  [class.text-amber-700]="opcion.rol === 'conductor'"
                >
                  @if (opcion.rol === 'ciudadano') {
                    <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M12 21s-7-4.4-7-10a7 7 0 1 1 14 0c0 5.6-7 10-7 10z" stroke-linejoin="round" />
                      <circle cx="12" cy="11" r="2.5" />
                    </svg>
                  } @else if (opcion.rol === 'conductor') {
                    <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M3 16V8h11l3 4h4v4" stroke-linecap="round" stroke-linejoin="round" />
                      <circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" />
                    </svg>
                  } @else {
                    <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M4 19V5M4 19h16" stroke-linecap="round" />
                      <path d="M8 15v-4M12 15V7M16 15v-6M20 15V9" stroke-linecap="round" />
                    </svg>
                  }
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-bold text-slate-800">{{ opcion.titulo }}</span>
                  <span class="mt-0.5 block text-xs leading-relaxed text-slate-500">{{ opcion.descripcion }}</span>
                  <span class="mt-1.5 block text-[11px] font-semibold uppercase tracking-wide text-sanroman-celeste">{{ opcion.detalle }}</span>
                </span>
                <span
                  class="ml-auto mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border"
                  [class.border-sanroman-azul]="rol() === opcion.rol"
                  [class.bg-sanroman-azul]="rol() === opcion.rol"
                  [class.border-slate-300]="rol() !== opcion.rol"
                >
                  @if (rol() === opcion.rol) {
                    <svg viewBox="0 0 20 20" class="h-3 w-3 fill-none stroke-white" stroke-width="2.5">
                      <path d="M5 10l3.5 3.5L15 7" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  }
                </span>
              </button>
            }
          </div>

          <button
            type="button"
            (click)="ingresar()"
            class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-sanroman-azul px-4 py-3.5 text-sm font-bold text-white shadow-card transition hover:bg-[#003a73] active:scale-[0.99]"
          >
            Ingresar como {{ etiquetaSeleccionada() }}
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <p class="mt-4 text-center text-[11px] text-slate-400">
            Al continuar aceptas el uso de datos simulados para la demostración.
          </p>
        </div>
      </section>
    </div>
  `,
})
export class LoginComponent {
  private readonly sesion = inject(SessionService);

  readonly rol = signal<Rol>('ciudadano');

  readonly opciones: OpcionRol[] = [
    {
      rol: 'ciudadano',
      titulo: 'Vista Ciudadano',
      descripcion: 'Reporta acumulación de basura con foto y ubicación, y sigue el estado de la zona.',
      detalle: 'Reportar en 20 metros',
    },
    {
      rol: 'conductor',
      titulo: 'Vista Conductor',
      descripcion: 'Consulta tu ruta asignada y registra la foto de evidencia al terminar cada parada.',
      detalle: 'Ruta y evidencias',
    },
    {
      rol: 'admin',
      titulo: 'Panel Administrador',
      descripcion: 'Centro de control: zonas críticas, rutas de compactadoras y estadísticas de gestión.',
      detalle: 'Operación y estadísticas',
    },
  ];

  seleccionar(rol: Rol): void {
    this.rol.set(rol);
  }

  etiquetaSeleccionada(): string {
    return this.opciones.find((opcion) => opcion.rol === this.rol())?.titulo ?? 'Usuario';
  }

  ingresar(): void {
    this.sesion.login(this.rol());
  }
}
