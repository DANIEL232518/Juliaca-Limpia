import { Component, computed, inject } from '@angular/core';

import { DashboardStore } from './core/dashboard.store';
import { SessionService } from './core/session.service';
import { AdminPanelComponent } from './features/admin/admin-panel.component';
import { CitizenPanelComponent } from './features/citizen/citizen-panel.component';
import { DriverPanelComponent } from './features/driver/driver-panel.component';
import { LoginComponent } from './features/login/login.component';
import { MapaComponent } from './features/map/mapa.component';
import { HeaderComponent } from './shared/header.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    HeaderComponent,
    LoginComponent,
    MapaComponent,
    CitizenPanelComponent,
    DriverPanelComponent,
    AdminPanelComponent,
  ],
  template: `
    @if (!sesion.sesion()) {
      <app-login />
    } @else {
      <div class="flex min-h-dvh flex-col bg-fondo">
        <app-header />

        <main
          class="relative flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:overflow-hidden"
        >
          <section class="relative h-[46vh] min-h-[300px] shrink-0 lg:h-[calc(100dvh-76px)] lg:min-h-0">
            <app-mapa class="block h-full" />

            @if (store.error(); as mensaje) {
              <p
                class="absolute bottom-3 right-3 z-[600] max-w-xs rounded-xl bg-basura-critica px-3 py-2 text-[11px] font-semibold text-white shadow-card"
              >
                {{ mensaje }}
              </p>
            }
          </section>

          <aside
            class="flex-1 overflow-y-auto border-t border-slate-200 bg-fondo p-3 sm:p-4 lg:h-[calc(100dvh-76px)] lg:border-l lg:border-t-0"
          >
            @switch (sesion.sesion()?.rol) {
              @case ('ciudadano') {
                <app-citizen-panel />
              }
              @case ('conductor') {
                <app-driver-panel />
              }
              @default {
                <app-admin-panel />
              }
            }

            <footer
              class="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 text-[10px] text-slate-400 ring-1 ring-slate-100"
            >
              <span>
                Datos en vivo vía SSE · 20 m de agrupación · America/Lima
              </span>
              @if (store.actualizado(); as fecha) {
                <span>Actualizado {{ hora(fecha) }}</span>
              }
            </footer>
          </aside>
        </main>
      </div>
    }
  `,
})
export class AppComponent {
  readonly sesion = inject(SessionService);
  readonly store = inject(DashboardStore);

  readonly rol = computed(() => this.sesion.sesion()?.rol ?? null);

  hora(fecha: Date): string {
    return new Intl.DateTimeFormat('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(fecha);
  }
}
