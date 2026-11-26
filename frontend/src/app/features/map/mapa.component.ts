import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import * as L from 'leaflet';

import { ApiService } from '../../core/api.service';
import { DashboardStore } from '../../core/dashboard.store';
import { UiService } from '../../core/session.service';
import { Camion, Ruta, Zona, ZonaDetalle } from '../../core/models';

const DEPOSITO = L.latLng(-15.4803, -70.1436);
const DESCARGA = L.latLng(-15.568, -70.315);
const PALETA = ['#004B93', '#00AEEF', '#FDB913', '#7C3AED', '#0E7490', '#D32F2F'];

interface CamionVista {
  marker: L.Marker;
  rotor: HTMLElement | null;
  barra: HTMLElement | null;
  pct: HTMLElement | null;
  velocidad: HTMLElement | null;
  actual: L.LatLng;
  desde: L.LatLng;
  hasta: L.LatLng;
  rumboDesde: number;
  rumboHasta: number;
  inicio: number;
  duracion: number;
}

@Component({
  selector: 'app-mapa',
  standalone: true,
  template: `
    <div class="relative h-full min-h-[300px] w-full">
      <div #mapa class="h-full min-h-[300px] w-full"></div>

      <!-- Encabezado flotante -->
      <div class="pointer-events-none absolute left-3 top-3 z-[500] hidden max-w-[260px] sm:block">
        <div class="pointer-events-auto rounded-2xl border border-white/70 bg-white/90 p-3 shadow-card backdrop-blur">
          <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Mapa operativo</p>
          <p class="mt-0.5 text-sm font-bold leading-tight text-slate-800">Juliaca en vivo</p>
          <div class="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold">
            <span class="rounded-full bg-red-50 px-2 py-0.5 text-basura-critica">
              {{ store.conteos().criticas }} críticas
            </span>
            <span class="rounded-full bg-sky-50 px-2 py-0.5 text-sanroman-azul">
              {{ store.conteos().enRuta }} en ruta
            </span>
            <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-zona-tratada">
              {{ store.conteos().tratadas }} tratadas
            </span>
          </div>
        </div>
      </div>

      <!-- Estado de la simulación de flota (la controla el administrador) -->
      <div class="absolute right-3 top-3 z-[500]">
        <div
          class="flex items-center gap-2 rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-[11px] font-bold shadow-card backdrop-blur"
          [title]="
            store.simulando()
              ? 'El panel administrador está simulando el recorrido de las compactadoras'
              : 'Activa el Modo Simulación de Flota en el panel administrador'
          "
        >
          <span class="relative flex h-2.5 w-2.5">
            @if (store.simulando()) {
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            }
            <span
              class="relative inline-flex h-2.5 w-2.5 rounded-full"
              [class.bg-emerald-500]="store.simulando()"
              [class.bg-slate-300]="!store.simulando()"
            ></span>
          </span>
          <span class="text-slate-700">
            {{ store.simulando() ? 'Simulación activa' : 'Flota en vivo' }}
          </span>
        </div>
      </div>

      <!-- Leyenda -->
      <div class="absolute bottom-3 left-3 z-[500] rounded-2xl border border-white/70 bg-white/90 px-3 py-2.5 shadow-card backdrop-blur">
        <p class="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Referencias</p>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-medium text-slate-600">
          <span class="flex items-center gap-1.5"><i class="jl-dot" style="--d:#D32F2F"></i>Crítico</span>
          <span class="flex items-center gap-1.5"><i class="jl-dot" style="--d:#FDB913"></i>Medio</span>
          <span class="flex items-center gap-1.5"><i class="jl-dot" style="--d:#00AEEF"></i>Bajo</span>
          <span class="flex items-center gap-1.5"><i class="jl-dot" style="--d:#16A34A"></i>Tratado</span>
          <span class="col-span-2 flex items-center gap-1.5"><i class="jl-truck-mini"></i>Compactadora</span>
        </div>
      </div>

      @if (!store.estado() && store.cargando()) {
        <div class="absolute inset-0 z-[450] grid place-items-center bg-slate-50/70 backdrop-blur-sm">
          <div class="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-card">
            <span class="h-5 w-5 animate-spin rounded-full border-2 border-sanroman-azul border-t-transparent"></span>
            <span class="text-sm font-semibold text-slate-600">Cargando mapa de Juliaca…</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class MapaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapa', { static: true }) private contenedor!: ElementRef<HTMLDivElement>;

  readonly store = inject(DashboardStore);

  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);

  private map!: L.Map;
  private capaZonas!: L.LayerGroup;
  private capaCamiones!: L.LayerGroup;
  private capaRutas!: L.LayerGroup;
  private capaPunto!: L.LayerGroup;
  private puntoMarcador: L.CircleMarker | null = null;

  private readonly vistas = new Map<number, CamionVista>();

  private listo = false;
  private vistaAjustada = false;
  private firmaZonas = '';
  private firmaRutas = '';
  private camionEnfocado: number | null = null;
  private rutasActuales: Ruta[] = [];
  private raf = 0;
  private animando = false;

  constructor() {
    effect(() => {
      const estado = this.store.estado();
      if (!this.listo || !estado) {
        return;
      }
      this.pintarZonas(estado.zonas);
      this.pintarCamiones(estado.camiones);
      this.ajustarVista();
    });

    effect(() => {
      const rutas = this.store.rutas();
      this.rutasActuales = rutas;
      if (!this.listo) {
        return;
      }
      this.pintarRutas(rutas);
    });

    // El panel del conductor enfoca su compactadora: el mapa se acerca a ella
    // y atenúa las rutas del resto de unidades.
    effect(() => {
      const enfocado = this.ui.camionEnfocado();
      if (!this.listo || enfocado === this.camionEnfocado) {
        return;
      }
      this.camionEnfocado = enfocado;
      this.pintarRutas(this.rutasActuales);

      if (enfocado === null) {
        return;
      }
      this.acercarCamion(enfocado);
    });

    effect(() => {
      const punto = this.ui.punto();
      if (!this.listo) {
        return;
      }
      this.mostrarPunto(punto);
    });
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.contenedor.nativeElement, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
    }).setView([-15.4941, -70.1356], 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    this.capaRutas = L.layerGroup().addTo(this.map);
    this.capaZonas = L.layerGroup().addTo(this.map);
    this.capaCamiones = L.layerGroup().addTo(this.map);
    this.capaPunto = L.layerGroup().addTo(this.map);

    this.map.on('click', (evento: L.LeafletMouseEvent) => {
      // Sin GPS no se permite marcar a mano: el punto del reporte debe venir
      // del dispositivo. Con GPS, el toque solo ajusta el pin existente.
      if (!this.ui.gpsConfirmado()) {
        this.ui.avisarSinGps();
        return;
      }
      this.ui.seleccionar({ lat: evento.latlng.lat, lng: evento.latlng.lng }, 'mapa');
    });

    this.listo = true;
    this.camionEnfocado = this.ui.camionEnfocado();

    const estado = this.store.estado();
    if (estado) {
      this.pintarZonas(estado.zonas);
      this.pintarCamiones(estado.camiones);
    }
    this.pintarRutas(this.store.rutas());
    this.mostrarPunto(this.ui.punto());
    this.ajustarVista();

    // Si el panel del conductor ya enfocó una unidad antes de montar el mapa,
    // la vista general no debe pisar el encuadre de su ruta.
    const enfocadoInicial = this.camionEnfocado;
    if (enfocadoInicial !== null) {
      this.vistaAjustada = true;
      window.setTimeout(() => this.acercarCamion(enfocadoInicial), 260);
    }

    this.iniciarAnimacion();

    window.setTimeout(() => this.map.invalidateSize(), 160);
  }

  ngOnDestroy(): void {
    this.animando = false;
    cancelAnimationFrame(this.raf);
    this.map?.remove();
  }

  // -------------------------------------------------------------------------
  // Zonas
  // -------------------------------------------------------------------------
  private pintarZonas(zonas: Zona[]): void {
    const firma = zonas
      .map((z) => `${z.id}:${z.estado}:${z.nivel}:${z.volumen_estimado_litros}:${z.total_reportes}`)
      .join('|');
    if (firma === this.firmaZonas) {
      return;
    }
    this.firmaZonas = firma;
    this.capaZonas.clearLayers();

    for (const zona of zonas) {
      const marcador = L.marker([zona.lat, zona.lng], {
        icon: L.divIcon({
          className: '',
          html: this.htmlZona(zona),
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
        riseOnHover: true,
        zIndexOffset: zona.estado === 'tratado' ? 0 : 200,
      });

      marcador.on('click', () => this.abrirDetalle(zona));
      marcador.addTo(this.capaZonas);
    }
  }

  private htmlZona(zona: Zona): string {
    const icono =
      zona.estado === 'tratado'
        ? `<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12.5l4.5 4.5L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : `<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v5M14 11v5" stroke-linecap="round"/></svg>`;

    const pulso = zona.estado !== 'tratado' && zona.nivel === 'critico' ? ' jl-zone--pulse' : '';
    return `<div class="jl-zone jl-zone--${zona.nivel} jl-zone--${zona.estado}${pulso}" title="${this.esc(zona.direccion_referencia)}">
      ${icono}
      <span class="jl-zone__badge">${zona.total_reportes}</span>
    </div>`;
  }

  private abrirDetalle(zona: Zona): void {
    const popup = L.popup({
      maxWidth: 360,
      className: 'jl-popup',
      closeButton: true,
      autoPanPadding: [28, 28],
    })
      .setLatLng([zona.lat, zona.lng])
      .setContent(
        `<div class="jl-popup-loading"><span></span><p>Cargando detalle de la zona…</p></div>`,
      )
      .openOn(this.map);

    this.api.zonaDetalle(zona.id).subscribe({
      next: (detalle) => popup.setContent(this.htmlDetalle(detalle)),
      error: () =>
        popup.setContent(
          `<div class="jl-popup-loading"><p>No se pudo cargar el detalle de la zona.</p></div>`,
        ),
    });
  }

  private htmlDetalle(detalle: ZonaDetalle): string {
    const zona = detalle.zona;
    const reporteConFoto = detalle.reportes.find((reporte) => reporte.foto_url);
    const antes = this.urlFoto(reporteConFoto?.foto_url ?? null);
    const despues = this.urlFoto(detalle.evidencia?.foto_evidencia_url ?? null);
    const tratada = zona.estado === 'tratado';

    const fotoAntes = antes
      ? `<img src="${this.esc(antes)}" alt="Foto del reporte ciudadano" loading="lazy" />`
      : `<div class="jl-photo-empty"><span>Sin foto</span><small>dato semilla</small></div>`;
    const fotoDespues = despues
      ? `<img src="${this.esc(despues)}" alt="Foto de evidencia de limpieza" loading="lazy" />`
      : `<div class="jl-photo-empty jl-photo-empty--verde"><span>Sin foto</span><small>evidencia</small></div>`;

    const fotos = tratada
      ? `<div class="jl-photos">
           <figure>${fotoAntes}<figcaption>Antes · reporte</figcaption></figure>
           <figure>${fotoDespues}<figcaption>Después · evidencia</figcaption></figure>
         </div>`
      : `<div class="jl-photos jl-photos--single">
           <figure>${fotoAntes}<figcaption>Foto del reporte ciudadano</figcaption></figure>
         </div>`;

    const ultimoComentario = detalle.reportes.find((reporte) => reporte.comentario)?.comentario;
    const evidencia = detalle.evidencia;

    return `<div class="jl-popup-card">
      <div class="jl-popup-head">
        <span class="jl-chip jl-chip--${zona.estado}">${this.etiquetaEstado(zona.estado)}</span>
        <span class="jl-chip jl-chip--nivel-${zona.nivel}">Nivel ${zona.nivel}</span>
      </div>
      <h3>${this.esc(zona.direccion_referencia || 'Zona sin referencia')}</h3>
      <div class="jl-stats">
        <div><b>${Math.round(zona.volumen_estimado_litros)} L</b><span>volumen estimado</span></div>
        <div><b>${zona.total_reportes}</b><span>reportes fusionados</span></div>
        <div><b>20 m</b><span>radio de agrupación</span></div>
      </div>
      ${fotos}
      ${
        ultimoComentario
          ? `<p class="jl-comment">“${this.esc(ultimoComentario)}”</p>`
          : ''
      }
      ${
        tratada
          ? `<div class="jl-foot jl-foot--ok">
               <span>Zona tratada</span>
               <span>${this.fecha(zona.tratado_en ?? evidencia?.creado_en)}</span>
             </div>
             ${
               evidencia?.observacion
                 ? `<p class="jl-observe">${this.esc(evidencia.observacion)}</p>`
                 : ''
             }`
          : `<div class="jl-foot"><span>${zona.estado === 'en_ruta' ? 'En ruta · pendiente de recolección' : 'Pendiente de recolección'}</span><span>${this.fecha(zona.creado_en)}</span></div>`
      }
    </div>`;
  }

  // -------------------------------------------------------------------------
  // Camiones
  // -------------------------------------------------------------------------
  private pintarCamiones(camiones: Camion[]): void {
    const vistos = new Set<number>();

    for (const camion of camiones) {
      vistos.add(camion.id);
      const existente = this.vistas.get(camion.id);
      const destino = L.latLng(camion.lat, camion.lng);

      if (!existente) {
        const marcador = L.marker(destino, {
          icon: L.divIcon({
            className: '',
            html: this.htmlCamion(camion),
            iconSize: [92, 84],
            iconAnchor: [46, 42],
          }),
          zIndexOffset: 900,
          riseOnHover: true,
        }).addTo(this.capaCamiones);

        const elemento = marcador.getElement();
        const vista: CamionVista = {
          marker: marcador,
          rotor: elemento?.querySelector<HTMLElement>('.jl-truck__rotor') ?? null,
          barra: elemento?.querySelector<HTMLElement>('.jl-truck__bar > i') ?? null,
          pct: elemento?.querySelector<HTMLElement>('.jl-truck__pct') ?? null,
          velocidad: elemento?.querySelector<HTMLElement>('.jl-truck__vel') ?? null,
          actual: destino,
          desde: destino,
          hasta: destino,
          rumboDesde: camion.rumbo_grados,
          rumboHasta: camion.rumbo_grados,
          inicio: 0,
          duracion: 0,
        };
        this.aplicarRumbo(vista, camion.rumbo_grados);
        this.vistas.set(camion.id, vista);
        continue;
      }

      const carga = camion.capacidad_litros
        ? Math.min(100, (camion.carga_actual_litros / camion.capacidad_litros) * 100)
        : 0;
      if (existente.barra) {
        existente.barra.style.width = `${carga.toFixed(1)}%`;
      }
      if (existente.pct) {
        existente.pct.textContent = `${Math.round(carga)}%`;
      }
      if (existente.velocidad) {
        existente.velocidad.textContent = `${Math.round(camion.velocidad_kmh)} km/h`;
      }

      const distancia = existente.hasta.distanceTo(destino);
      if (distancia > 0.5) {
        existente.desde = existente.actual;
        existente.hasta = destino;
        existente.rumboDesde = this.rumboActual(existente);
        existente.rumboHasta =
          camion.rumbo_grados || this.rumbo(existente.actual, destino);
        existente.inicio = performance.now();
        existente.duracion = 1500;
      }
    }

    for (const [id, vista] of this.vistas) {
      if (!vistos.has(id)) {
        vista.marker.remove();
        this.vistas.delete(id);
      }
    }
  }

  private htmlCamion(camion: Camion): string {
    const carga = camion.capacidad_litros
      ? Math.min(100, (camion.carga_actual_litros / camion.capacidad_litros) * 100)
      : 0;
    const colorCarga = carga >= 85 ? '#D32F2F' : carga >= 60 ? '#FDB913' : '#16A34A';

    return `<div class="jl-truck">
      <div class="jl-truck__rotor">
        <svg viewBox="0 0 64 64" class="jl-truck__svg" aria-hidden="true">
          <rect x="13" y="5" width="38" height="54" rx="9" fill="#ffffff" stroke="#004B93" stroke-width="3"/>
          <rect x="18" y="9" width="28" height="14" rx="4" fill="#00AEEF"/>
          <rect x="21" y="12" width="22" height="7" rx="2" fill="#E0F4FE"/>
          <rect x="18" y="27" width="28" height="26" rx="4" fill="#EEF2F7" stroke="#CBD5E1" stroke-width="1"/>
          <path d="M21 33h22M21 39h22M21 45h22" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"/>
          <rect x="6" y="14" width="7" height="13" rx="2.5" fill="#1E293B"/>
          <rect x="51" y="14" width="7" height="13" rx="2.5" fill="#1E293B"/>
          <rect x="6" y="40" width="7" height="13" rx="2.5" fill="#1E293B"/>
          <rect x="51" y="40" width="7" height="13" rx="2.5" fill="#1E293B"/>
          <circle cx="32" cy="55" r="3.2" fill="#FDB913"/>
        </svg>
      </div>
      <div class="jl-truck__tag">${this.esc(camion.codigo_unidad)}</div>
      <div class="jl-truck__bar"><i style="width:${carga.toFixed(1)}%;background:${colorCarga}"></i></div>
      <div class="jl-truck__meta">
        <span class="jl-truck__pct">${Math.round(carga)}%</span>
        <span class="jl-truck__vel">${Math.round(camion.velocidad_kmh)} km/h</span>
      </div>
    </div>`;
  }

  private aplicarRumbo(vista: CamionVista, rumbo: number): void {
    if (vista.rotor) {
      vista.rotor.style.transform = `rotate(${rumbo.toFixed(1)}deg)`;
    }
  }

  private rumboActual(vista: CamionVista): number {
    const progreso =
      vista.duracion > 0
        ? Math.min(1, (performance.now() - vista.inicio) / vista.duracion)
        : 1;
    return this.interpolarRumbo(vista.rumboDesde, vista.rumboHasta, progreso);
  }

  // -------------------------------------------------------------------------
  // Rutas y simulación
  // -------------------------------------------------------------------------
  private pintarRutas(rutas: Ruta[]): void {
    const enfocado = this.camionEnfocado;
    const firma = `${enfocado ?? 'todas'}|` + rutas
      .map(
        (ruta) =>
          `${ruta.id}:${ruta.geometria?.length ?? 0}:` +
          ruta.paradas.map((p) => `${p.zona_id}${p.estado_parada[0]}`).join(','),
      )
      .join('|');
    if (firma === this.firmaRutas) {
      return;
    }
    this.firmaRutas = firma;
    this.capaRutas.clearLayers();

    this.marcadorBase(DEPOSITO, 'Depósito Las Casuarinas', 'jl-base--deposito');
    this.marcadorBase(DESCARGA, 'Descarga Huanuyo', 'jl-base--descarga');

    rutas.forEach((ruta, indice) => {
      const color = PALETA[indice % PALETA.length];
      const paradas = [...ruta.paradas].sort((a, b) => a.orden - b.orden);
      const pendientes = paradas.some((p) => p.estado_parada === 'pendiente');
      const atenuada = enfocado !== null && ruta.camion_id !== enfocado;
      const traza = this.trazaDe(ruta);

      if (traza) {
        // Traza real de calles (OSRM/OpenStreetMap): se divide en tramos
        // depósito → paradas → descarga → depósito manteniendo el estilo
        // punteado para lo que todavía falta.
        const indices = paradas.map((parada) =>
          this.indiceCercano(traza, L.latLng(parada.lat, parada.lng)),
        );
        let inicio = 0;
        paradas.forEach((parada, i) => {
          const fin = indices[i];
          this.tramoTraza(
            traza.slice(inicio, fin + 1),
            color,
            parada.estado_parada === 'pendiente',
            atenuada,
          );
          this.marcadorParada(L.latLng(parada.lat, parada.lng), parada.orden, color, atenuada);
          inicio = fin;
        });
        this.tramoTraza(traza.slice(inicio), color, pendientes, atenuada);
        return;
      }

      // Respaldo sin geometría: línea recta entre puntos.
      let desde = DEPOSITO;
      for (const parada of paradas) {
        const hasta = L.latLng(parada.lat, parada.lng);
        this.tramo(desde, hasta, color, parada.estado_parada === 'pendiente', atenuada);
        this.marcadorParada(hasta, parada.orden, color, atenuada);
        desde = hasta;
      }

      this.tramo(desde, DESCARGA, color, pendientes, atenuada);
      this.tramo(DESCARGA, DEPOSITO, color, pendientes, atenuada);
    });
  }

  /** Devuelve la traza de calles de la ruta como puntos de Leaflet. */
  private trazaDe(ruta: Ruta): L.LatLng[] | null {
    const geometria = ruta.geometria;
    if (!geometria || geometria.length < 2) {
      return null;
    }
    return geometria.map((punto) => L.latLng(punto.lat, punto.lng));
  }

  /** Índice del vértice de la traza más cercano al punto dado. */
  private indiceCercano(traza: L.LatLng[], punto: L.LatLng): number {
    let mejor = 0;
    let mejorDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < traza.length; i++) {
      const distancia = traza[i].distanceTo(punto);
      if (distancia < mejorDist) {
        mejorDist = distancia;
        mejor = i;
      }
    }
    return mejor;
  }

  private tramo(
    desde: L.LatLng,
    hasta: L.LatLng,
    color: string,
    punteado: boolean,
    atenuada = false,
  ): void {
    this.tramoTraza([desde, hasta], color, punteado, atenuada);
  }

  private tramoTraza(
    puntos: L.LatLng[],
    color: string,
    punteado: boolean,
    atenuada = false,
  ): void {
    if (puntos.length < 2) {
      return;
    }
    L.polyline(puntos, {
      color,
      weight: punteado ? 3.5 : 5,
      opacity: atenuada ? 0.18 : punteado ? 0.85 : 0.95,
      dashArray: punteado ? '9 9' : undefined,
      lineCap: 'round',
      interactive: false,
    }).addTo(this.capaRutas);
  }

  private marcadorParada(posicion: L.LatLng, orden: number, color: string, atenuada: boolean): void {
    L.marker(posicion, {
      icon: L.divIcon({
        className: '',
        html: `<div class="jl-stop${atenuada ? ' jl-stop--atenuada' : ''}" style="--c:${color}">${orden}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      interactive: false,
      zIndexOffset: 300,
    }).addTo(this.capaRutas);
  }

  private acercarCamion(id: number | null): void {
    if (id === null || !this.map) {
      return;
    }
    // El encuadre de la ruta enfocada tiene prioridad sobre la vista general.
    this.vistaAjustada = true;
    // Encuadra la ruta completa de la unidad enfocada (traza de calles si
    // existe) para que se vea de punta a punta; sin ruta, se acerca al camión.
    const vista = this.vistas.get(id);
    const ruta = this.rutasActuales.find((item) => item.camion_id === id);
    const puntos: L.LatLngExpression[] = [];

    const traza = ruta ? this.trazaDe(ruta) : null;
    if (traza) {
      puntos.push(...traza);
    } else if (ruta) {
      puntos.push([DEPOSITO.lat, DEPOSITO.lng]);
      puntos.push(...ruta.paradas.map((parada) => [parada.lat, parada.lng] as L.LatLngExpression));
      puntos.push([DESCARGA.lat, DESCARGA.lng]);
    }
    if (vista) {
      puntos.push(vista.marker.getLatLng());
    }

    if (puntos.length >= 2) {
      this.map.fitBounds(L.latLngBounds(puntos), {
        padding: [44, 44],
        maxZoom: 15,
        animate: true,
      });
      return;
    }
    if (!vista) {
      return;
    }
    const destino = vista.marker.getLatLng();
    const zoom = Math.max(this.map.getZoom(), 14);
    if (this.map.getZoom() < 14 || !this.map.getBounds().pad(-0.35).contains(destino)) {
      this.map.flyTo(destino, zoom, { duration: 0.8 });
    }
  }

  private marcadorBase(punto: L.LatLng, texto: string, clase: string): void {
    L.marker(punto, {
      icon: L.divIcon({
        className: '',
        html: `<div class="jl-base ${clase}">${this.esc(texto)}</div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
      interactive: false,
      zIndexOffset: 100,
    }).addTo(this.capaRutas);
  }

  private iniciarAnimacion(): void {
    this.animando = true;
    const paso = (tiempo: number) => {
      if (!this.animando) {
        return;
      }
      this.animar(tiempo);
      this.raf = requestAnimationFrame(paso);
    };
    this.raf = requestAnimationFrame(paso);
  }

  private animar(tiempo: number): void {
    for (const vista of this.vistas.values()) {
      if (vista.duracion <= 0) {
        continue;
      }
      const progreso = Math.min(1, (tiempo - vista.inicio) / vista.duracion);
      if (progreso >= 1) {
        vista.actual = vista.hasta;
        vista.marker.setLatLng(vista.hasta);
        this.aplicarRumbo(vista, vista.rumboHasta);
        vista.duracion = 0;
        continue;
      }

      const suave = progreso < 0.5 ? 2 * progreso * progreso : 1 - Math.pow(-2 * progreso + 2, 2) / 2;
      const lat = vista.desde.lat + (vista.hasta.lat - vista.desde.lat) * suave;
      const lng = vista.desde.lng + (vista.hasta.lng - vista.desde.lng) * suave;
      vista.actual = L.latLng(lat, lng);
      vista.marker.setLatLng(vista.actual);
      this.aplicarRumbo(
        vista,
        this.interpolarRumbo(vista.rumboDesde, vista.rumboHasta, suave),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Punto seleccionado y utilidades
  // -------------------------------------------------------------------------
  private mostrarPunto(punto: { lat: number; lng: number } | null): void {
    this.capaPunto.clearLayers();
    this.puntoMarcador = null;
    if (!punto) {
      return;
    }
    const posicion = L.latLng(punto.lat, punto.lng);
    this.puntoMarcador = L.circleMarker(posicion, {
      radius: 8,
      color: '#004B93',
      weight: 3,
      fillColor: '#00AEEF',
      fillOpacity: 0.5,
    }).addTo(this.capaPunto);

    if (!this.map.getBounds().pad(-0.2).contains(posicion)) {
      this.map.panTo(posicion);
    }
  }

  private ajustarVista(): void {
    if (this.vistaAjustada) {
      return;
    }
    // Si hay una unidad enfocada, el encuadre lo decide acercarCamion con la
    // ruta completa; este ajuste general solo aplica sin enfoque.
    if (this.camionEnfocado !== null) {
      return;
    }
    const estado = this.store.estado();
    if (!estado) {
      return;
    }
    const puntos: L.LatLngExpression[] = [
      ...estado.zonas.map((zona) => [zona.lat, zona.lng] as [number, number]),
      ...estado.camiones.map((camion) => [camion.lat, camion.lng] as [number, number]),
    ];
    if (puntos.length === 0) {
      return;
    }
    this.vistaAjustada = true;
    this.map.fitBounds(L.latLngBounds(puntos), { padding: [48, 48], maxZoom: 14 });
  }

  private rumbo(a: L.LatLng, b: L.LatLng): number {
    const aRad = (a.lat * Math.PI) / 180;
    const bRad = (b.lat * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(bRad);
    const x =
      Math.cos(aRad) * Math.sin(bRad) -
      Math.sin(aRad) * Math.cos(bRad) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  private interpolarRumbo(desde: number, hasta: number, factor: number): number {
    let delta = ((hasta - desde + 540) % 360) - 180;
    return (desde + delta * factor + 360) % 360;
  }

  private etiquetaEstado(estado: string): string {
    return estado === 'tratado' ? 'Tratada' : estado === 'en_ruta' ? 'En ruta' : 'Pendiente';
  }

  private fecha(valor?: string | null): string {
    if (!valor) {
      return '—';
    }
    try {
      return new Intl.DateTimeFormat('es-PE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(valor));
    } catch {
      return '—';
    }
  }

  private urlFoto(url: string | null): string | null {
    if (!url) {
      return null;
    }
    try {
      const destino = new URL(url, window.location.origin);
      // Las fotos viven en el puerto 9000 (S3). Si el panel se abre desde otra
      // máquina de la red local, apuntamos al mismo host del navegador.
      if (destino.port === '9000') {
        destino.hostname = window.location.hostname;
      }
      return destino.toString();
    } catch {
      return url;
    }
  }

  private esc(valor: unknown): string {
    const mapa: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return String(valor ?? '').replace(/[&<>"']/g, (caracter) => mapa[caracter] ?? caracter);
  }
}
