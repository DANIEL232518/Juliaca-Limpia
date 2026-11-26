import { Injectable, signal } from '@angular/core';

import { Punto, Rol, Sesion } from './models';

const CLAVE = 'juliaca-limpia.sesion';

const DEMO: Record<Rol, Sesion> = {
  ciudadano: {
    rol: 'ciudadano',
    nombre: 'Lucía Ticona Flores',
    usuarioId: 2,
  },
  conductor: {
    rol: 'conductor',
    nombre: 'Julio César Apaza',
    usuarioId: 3,
    conductorId: 3,
  },
  admin: {
    rol: 'admin',
    nombre: 'Rosa Quispe Mamani',
    usuarioId: 1,
  },
};

export const ETIQUETA_ROL: Record<Rol, string> = {
  ciudadano: 'Vista Ciudadano',
  conductor: 'Vista Conductor',
  admin: 'Panel Administrador',
};

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly sesion = signal<Sesion | null>(this.leer());

  login(rol: Rol): void {
    const sesion: Sesion = { ...DEMO[rol] };
    this.sesion.set(sesion);
    localStorage.setItem(CLAVE, JSON.stringify(sesion));
  }

  cambiarRol(rol: Rol): void {
    this.login(rol);
  }

  salir(): void {
    this.sesion.set(null);
    localStorage.removeItem(CLAVE);
  }

  private leer(): Sesion | null {
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) {
        return null;
      }
      const sesion = JSON.parse(crudo) as Sesion;
      if (!sesion || !['ciudadano', 'conductor', 'admin'].includes(sesion.rol)) {
        return null;
      }
      return sesion;
    } catch {
      return null;
    }
  }
}

@Injectable({ providedIn: 'root' })
export class UiService {
  /** Punto elegido por el usuario en el mapa (reporte ciudadano). */
  readonly punto = signal<Punto | null>(null);
  /**
   * Origen del punto: 'gps' cuando vino del GPS del dispositivo y 'mapa'
   * cuando el ciudadano lo ajustó tocando el mapa. Solo se permite enviar
   * reportes si el punto tiene base GPS (no se acepta marcar a mano).
   */
  readonly origen = signal<'gps' | 'mapa' | null>(null);
  /** true cuando el dispositivo ya devolvió una ubicación GPS válida. */
  readonly gpsConfirmado = signal(false);
  /** Aviso mostrado cuando el ciudadano toca el mapa sin tener GPS activo. */
  readonly puntoAviso = signal<string | null>(null);
  readonly panelAbierto = signal(true);
  /** Camión que el conductor tiene seleccionado; el mapa lo enfoca. */
  readonly camionEnfocado = signal<number | null>(null);

  seleccionar(punto: Punto, origen: 'gps' | 'mapa' = 'mapa'): void {
    this.punto.set(punto);
    this.origen.set(origen);
    if (origen === 'gps') {
      this.gpsConfirmado.set(true);
      this.puntoAviso.set(null);
    }
  }

  /** Informa que tocar el mapa sin GPS no es válido para un reporte. */
  avisarSinGps(): void {
    this.puntoAviso.set('La ubicación del reporte se toma del GPS del dispositivo. Activa tu GPS y luego ajusta el pin si hace falta.');
  }

  /** Quita el punto y el estado GPS (p. ej. al enviar el reporte). */
  limpiarPunto(): void {
    this.punto.set(null);
    this.origen.set(null);
    this.gpsConfirmado.set(false);
    this.puntoAviso.set(null);
  }

  enfocarCamion(id: number | null): void {
    this.camionEnfocado.set(id);
  }
}
