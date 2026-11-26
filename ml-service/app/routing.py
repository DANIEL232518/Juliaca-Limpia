"""Optimización de rutas de recolección.

Algoritmo determinista:
1. Asignación greedy por prioridad (crítico → medio → bajo) y capacidad
   disponible, equilibrando la carga entre camiones.
2. Vecino Más Cercano (Nearest Neighbor) desde el depósito.
3. Mejora 2-opt sobre la secuencia de zonas.
4. Cierre del recorrido: zonas → descarga (Huanuyo) → depósito.

No usa servicios externos ni estado: recibe todo por request y devuelve el plan.
"""

from __future__ import annotations

import math

from .schemas import (
    CamionEntrada,
    OptimizeRequest,
    OptimizeResponse,
    ParadaSalida,
    RutaSalida,
    ZonaEntrada,
)

TIERRA_RADIO_M = 6_371_000.0
_PRIORIDAD_NIVEL = {"critico": 0, "medio": 1, "bajo": 2}


def haversine_metros(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distancia ortodrómica en metros entre dos pares (lat, lng)."""
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2.0) ** 2
    )
    return 2.0 * TIERRA_RADIO_M * math.asin(min(1.0, math.sqrt(h)))


def _punto(zona: ZonaEntrada) -> tuple[float, float]:
    return (zona.lat, zona.lng)


def _longitud(total: list[ZonaEntrada], deposito: tuple[float, float],
              descarga: tuple[float, float]) -> float:
    """Longitud del recorrido completo: depósito → zonas → descarga → depósito."""
    if not total:
        return haversine_metros(deposito, descarga) + haversine_metros(descarga, deposito)
    distance = 0.0
    previous = deposito
    for zona in total:
        distance += haversine_metros(previous, _punto(zona))
        previous = _punto(zona)
    distance += haversine_metros(previous, descarga)
    distance += haversine_metros(descarga, deposito)
    return distance


def _vecino_mas_cercano(
    zonas: list[ZonaEntrada], inicio: tuple[float, float]
) -> list[ZonaEntrada]:
    pendientes = list(zonas)
    ordenadas: list[ZonaEntrada] = []
    actual = inicio
    while pendientes:
        indice = min(
            range(len(pendientes)),
            key=lambda i: haversine_metros(actual, _punto(pendientes[i])),
        )
        elegida = pendientes.pop(indice)
        ordenadas.append(elegida)
        actual = _punto(elegida)
    return ordenadas


def _dos_opt(
    orden: list[ZonaEntrada],
    deposito: tuple[float, float],
    descarga: tuple[float, float],
    max_pasadas: int = 60,
) -> list[ZonaEntrada]:
    """Mejora 2-opt manteniendo fijos el depósito y la descarga."""
    if len(orden) < 3:
        return orden

    mejor = list(orden)
    mejor_longitud = _longitud(mejor, deposito, descarga)
    for _ in range(max_pasadas):
        mejorado = False
        for i in range(len(mejor) - 1):
            for j in range(i + 1, len(mejor)):
                candidato = mejor[:i] + list(reversed(mejor[i : j + 1])) + mejor[j + 1 :]
                longitud = _longitud(candidato, deposito, descarga)
                if longitud + 1e-6 < mejor_longitud:
                    mejor = candidato
                    mejor_longitud = longitud
                    mejorado = True
        if not mejorado:
            break
    return mejor


def _asignar(
    camiones: list[CamionEntrada], zonas: list[ZonaEntrada]
) -> tuple[dict[int, list[ZonaEntrada]], list[int]]:
    disponibles = {
        camion.id: max(camion.capacidad_litros - camion.carga_actual_litros, 0.0)
        for camion in camiones
    }
    asignadas: dict[int, list[ZonaEntrada]] = {camion.id: [] for camion in camiones}
    sin_asignar: list[int] = []

    ordenadas = sorted(
        zonas,
        key=lambda z: (_PRIORIDAD_NIVEL.get(z.nivel, 1), -z.volumen_estimado_litros, z.id),
    )

    for zona in ordenadas:
        candidatos = [
            camion
            for camion in camiones
            if disponibles[camion.id] + 1e-9 >= zona.volumen_estimado_litros
        ]
        if not candidatos:
            sin_asignar.append(zona.id)
            continue

        # Reparte la carga: menor utilización resultante (incluyendo lo ya
        # asignado en esta planificación) y, como desempate, el camión cuya
        # posición actual esté más cerca de la zona.
        def costo(camion: CamionEntrada) -> tuple[float, float]:
            carga_resultante = (
                camion.capacidad_litros - disponibles[camion.id]
            ) + zona.volumen_estimado_litros
            utilizacion = carga_resultante / max(camion.capacidad_litros, 1.0)
            return utilizacion, haversine_metros(
                (camion.lat, camion.lng), (zona.lat, zona.lng)
            )

        elegido = min(candidatos, key=costo)
        asignadas[elegido.id].append(zona)
        disponibles[elegido.id] -= zona.volumen_estimado_litros

    return asignadas, sin_asignar


def optimizar_rutas(payload: OptimizeRequest) -> OptimizeResponse:
    camiones = payload.camiones
    zonas = payload.zonas
    deposito = (payload.deposito.lat, payload.deposito.lng)
    descarga = (payload.descarga.lat, payload.descarga.lng)

    capacidad_total = sum(
        max(c.capacidad_litros - c.carga_actual_litros, 0.0) for c in camiones
    )

    if not camiones:
        return OptimizeResponse(
            rutas=[],
            sin_asignar=[z.id for z in zonas],
            metricas={
                "zonas_totales": len(zonas),
                "zonas_asignadas": 0,
                "zonas_sin_asignar": len(zonas),
                "camiones_utilizados": 0,
                "distancia_total_metros": 0.0,
                "volumen_asignado_litros": 0.0,
                "capacidad_total_disponible_litros": 0.0,
            },
        )

    asignadas, sin_asignar = _asignar(camiones, zonas)
    rutas: list[RutaSalida] = []

    for camion in camiones:
        zonas_camion = asignadas[camion.id]
        if not zonas_camion:
            continue

        orden = _vecino_mas_cercano(zonas_camion, deposito)
        orden = _dos_opt(orden, deposito, descarga)

        paradas: list[ParadaSalida] = []
        anterior = deposito
        distancia_zonas = 0.0
        volumen = 0.0
        for indice, zona in enumerate(orden, start=1):
            distancia = haversine_metros(anterior, _punto(zona))
            distancia_zonas += distancia
            volumen += zona.volumen_estimado_litros
            paradas.append(
                ParadaSalida(
                    zona_id=zona.id,
                    orden=indice,
                    distancia_metros=round(distancia, 1),
                    lat=zona.lat,
                    lng=zona.lng,
                    direccion_referencia=zona.direccion_referencia,
                    volumen_estimado_litros=zona.volumen_estimado_litros,
                )
            )
            anterior = _punto(zona)

        distancia_total = (
            distancia_zonas
            + haversine_metros(anterior, descarga)
            + haversine_metros(descarga, deposito)
        )

        carga_final = camion.carga_actual_litros + volumen
        utilizacion = min(100.0, 100.0 * carga_final / max(camion.capacidad_litros, 1.0))

        rutas.append(
            RutaSalida(
                camion_id=camion.id,
                codigo_unidad=camion.codigo_unidad,
                paradas=paradas,
                distancia_total_metros=round(distancia_total, 1),
                volumen_total_litros=round(volumen, 1),
                capacidad_litros=camion.capacidad_litros,
                utilizacion_pct=round(utilizacion, 1),
            )
        )

    zonas_asignadas = sum(len(ruta.paradas) for ruta in rutas)
    return OptimizeResponse(
        rutas=rutas,
        sin_asignar=sorted(sin_asignar),
        metricas={
            "zonas_totales": len(zonas),
            "zonas_asignadas": zonas_asignadas,
            "zonas_sin_asignar": len(sin_asignar),
            "camiones_utilizados": len(rutas),
            "distancia_total_metros": round(
                sum(ruta.distancia_total_metros for ruta in rutas), 1
            ),
            "volumen_asignado_litros": round(
                sum(ruta.volumen_total_litros for ruta in rutas), 1
            ),
            "capacidad_total_disponible_litros": round(capacidad_total, 1),
        },
    )
