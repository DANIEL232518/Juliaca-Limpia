import { Component, inject } from '@angular/core';

import { EventsService } from '../core/events.service';
import { ETIQUETA_ROL, SessionService } from '../core/session.service';
import { Rol } from '../core/models';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="sticky top-0 z-[1200] bg-sanroman-azul text-white shadow-card">
      <div class="mx-auto flex max-w-[1700px] items-center gap-2 px-2.5 py-2 sm:gap-4 sm:px-5 sm:py-3">
        <div
          class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20 sm:h-12 sm:w-12 sm:rounded-2xl"
        >
          <svg viewBox="0 0 64 64" class="h-7 w-7 sm:h-8 sm:w-8" aria-hidden="true">
            <path d="M8 46h48" stroke="#00AEEF" stroke-width="4" stroke-linecap="round" />
            <path d="M18 46V29l11-8 11 8v17" fill="#F8FAFC" />
            <path d="M34 21l14 8v17H34z" fill="#DCEBFA" />
            <circle cx="48" cy="21" r="5" fill="#FDB913" />
            <path d="M25 46V35h7v11" fill="#00AEEF" />
            <path d="M37 35h7v4h-7zM37 42h7v4h-7z" fill="#004B93" />
          </svg>
        </div>

        <div class="min-w-0 leading-tight">
          <h1 class="whitespace-nowrap text-[15px] font-extrabold tracking-[0.07em] sm:text-2xl">
            JULIACA <span class="text-sanroman-dorado">LIMPIA</span>
          </h1>
          <p class="truncate text-[9px] text-sky-100/85 sm:text-xs">
            Municipalidad Provincial de San Román • Gestión de Residuos Sólidos
          </p>
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span
            class="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-sky-50 lg:flex"
            [title]="eventos.conectado() ? 'SSE conectado' : 'SSE reconectando'"
          >
            <span
              class="h-2 w-2 rounded-full"
              [class.bg-emerald-400]="eventos.conectado()"
              [class.animate-pulse]="eventos.conectado()"
              [class.bg-sanroman-dorado]="!eventos.conectado()"
            ></span>
            {{ eventos.conectado() ? 'En vivo' : 'Reconectando' }}
          </span>

          <label class="relative block">
            <span class="sr-only">Cambiar de rol</span>
            <select
              (change)="cambiarRol($event)"
              class="cursor-pointer appearance-none rounded-xl border border-white/20 bg-white/10 py-1.5 pl-2 pr-6 text-[10px] font-semibold text-white outline-none transition hover:bg-white/15 focus:border-sanroman-dorado sm:py-2 sm:pl-3 sm:pr-8 sm:text-sm"
            >
              @for (opcion of roles; track opcion.rol) {
                <option
                  class="text-slate-900"
                  [value]="opcion.rol"
                  [selected]="sesion.sesion()?.rol === opcion.rol"
                >
                  {{ opcion.etiqueta }}
                </option>
              }
            </select>
            <svg
              viewBox="0 0 20 20"
              class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-white/80"
              stroke-width="1.8"
            >
              <path d="M5 8l5 5 5-5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </label>

          <div class="hidden items-center gap-2 rounded-xl bg-white/10 py-1.5 pl-2 pr-2.5 md:flex">
            <div class="grid h-7 w-7 place-items-center rounded-full bg-sanroman-celeste text-[11px] font-bold">
              {{ iniciales() }}
            </div>
            <div class="leading-tight">
              <p class="max-w-[150px] truncate text-xs font-semibold">{{ sesion.sesion()?.nombre }}</p>
              <p class="text-[10px] uppercase tracking-wide text-sky-100/75">
                {{ sesion.sesion()?.rol }}
              </p>
            </div>
          </div>

          <button
            type="button"
            (click)="sesion.salir()"
            class="grid h-8 w-8 place-items-center rounded-xl border border-white/20 text-white/85 transition hover:border-white/40 hover:bg-white/10 hover:text-white sm:h-9 sm:w-9"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M15 17l5-5-5-5" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M20 12H9" stroke-linecap="round" />
              <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div class="h-1 w-full bg-gradient-to-r from-sanroman-celeste via-white/35 to-sanroman-dorado"></div>
    </header>
  `,
})
export class HeaderComponent {
  readonly sesion = inject(SessionService);
  readonly eventos = inject(EventsService);

  readonly roles: { rol: Rol; etiqueta: string }[] = [
    { rol: 'ciudadano', etiqueta: ETIQUETA_ROL.ciudadano },
    { rol: 'conductor', etiqueta: ETIQUETA_ROL.conductor },
    { rol: 'admin', etiqueta: ETIQUETA_ROL.admin },
  ];

  iniciales(): string {
    const nombre = this.sesion.sesion()?.nombre ?? '';
    return nombre
      .split(' ')
      .slice(0, 2)
      .map((parte) => parte.charAt(0))
      .join('')
      .toUpperCase();
  }

  cambiarRol(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as Rol;
    this.sesion.cambiarRol(valor);
  }
}
