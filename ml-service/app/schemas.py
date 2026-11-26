"""Contratos Pydantic del microservicio."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Nivel = Literal["bajo", "medio", "critico"]


# ---------------------------------------------------------------------------
# Análisis de imágenes
# ---------------------------------------------------------------------------
class Deteccion(BaseModel):
    etiqueta: str
    confianza: float = Field(ge=0, le=1)
    area_relativa: float = Field(ge=0, le=1)
    bbox: list[float] = Field(default_factory=list)


class AnalisisResponse(BaseModel):
    volumen_litros: float = Field(ge=25, le=600)
    nivel: Nivel
    confianza: float = Field(ge=0, le=1)
    nitidez: float
    nitido: bool
    metodo: str
    recomendacion: str
    detalles: dict[str, Any] = Field(default_factory=dict)
    detecciones: list[Deteccion] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Optimización de rutas
# ---------------------------------------------------------------------------
class Punto(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class CamionEntrada(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    codigo_unidad: str = ""
    capacidad_litros: float = Field(gt=0)
    carga_actual_litros: float = Field(default=0, ge=0)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class ZonaEntrada(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    volumen_estimado_litros: float = Field(default=0, ge=0)
    nivel: Nivel = "medio"
    direccion_referencia: str = ""


class OptimizeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    camiones: list[CamionEntrada] = Field(default_factory=list)
    zonas: list[ZonaEntrada] = Field(default_factory=list)
    deposito: Punto = Field(
        default_factory=lambda: Punto(lat=-15.4803, lng=-70.1436)
    )
    descarga: Punto = Field(
        default_factory=lambda: Punto(lat=-15.5680, lng=-70.3150)
    )


class ParadaSalida(BaseModel):
    zona_id: int
    orden: int
    distancia_metros: float
    lat: float
    lng: float
    direccion_referencia: str = ""
    volumen_estimado_litros: float


class RutaSalida(BaseModel):
    camion_id: int
    codigo_unidad: str
    paradas: list[ParadaSalida] = Field(default_factory=list)
    distancia_total_metros: float = 0
    volumen_total_litros: float = 0
    capacidad_litros: float
    utilizacion_pct: float = 0


class OptimizeResponse(BaseModel):
    rutas: list[RutaSalida] = Field(default_factory=list)
    sin_asignar: list[int] = Field(default_factory=list)
    metricas: dict[str, float | int] = Field(default_factory=dict)
