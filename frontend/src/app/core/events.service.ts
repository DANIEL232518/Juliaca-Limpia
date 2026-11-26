import { Injectable, OnDestroy, signal } from '@angular/core';

import { EventoSSE } from './models';

const TIPOS = ['reporte_creado', 'rutas_generadas', 'zona_tratada', 'flota_movida'] as const;

@Injectable({ providedIn: 'root' })
export class EventsService implements OnDestroy {
  readonly conectado = signal(false);
  readonly ultimo = signal<EventoSSE | null>(null);

  private fuente: EventSource | null = null;
  private reconexion: number | null = null;
  private cerrado = false;

  constructor() {
    this.conectar();
  }

  ngOnDestroy(): void {
    this.cerrado = true;
    this.cerrar();
    if (this.reconexion !== null) {
      window.clearTimeout(this.reconexion);
    }
  }

  private conectar(): void {
    if (this.cerrado) {
      return;
    }
    this.cerrar();

    const fuente = new EventSource('/api/events');
    this.fuente = fuente;

    fuente.onopen = () => this.conectado.set(true);
    fuente.onerror = () => {
      this.conectado.set(false);
      if (fuente.readyState === EventSource.CLOSED && !this.cerrado) {
        this.reconexion = window.setTimeout(() => this.conectar(), 4000);
      }
    };

    for (const tipo of TIPOS) {
      fuente.addEventListener(tipo, (evento) => {
        const mensaje = evento as MessageEvent<string>;
        try {
          this.ultimo.set(JSON.parse(mensaje.data) as EventoSSE);
        } catch {
          // Un evento mal formado no debe romper el panel.
        }
      });
    }
  }

  private cerrar(): void {
    this.fuente?.close();
    this.fuente = null;
  }
}
