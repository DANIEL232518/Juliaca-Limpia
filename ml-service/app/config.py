"""Configuración por entorno del microservicio (sin dependencias extra)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    """Umbrales compartidos con Go y PostgreSQL. No cambiar solo en una capa."""

    app_name: str = "Juliaca Limpia ML"
    version: str = "1.0.0"

    # Imagen
    min_sharpness: float = field(default_factory=lambda: _env_float("MIN_SHARPNESS", 15.0))
    max_upload_mb: int = field(default_factory=lambda: int(_env_float("MAX_UPLOAD_MB", 15)))
    max_image_side: int = 1024

    # Volumen y niveles
    volumen_min_litros: float = 25.0
    volumen_max_litros: float = 600.0
    nivel_bajo_max_litros: float = 150.0
    nivel_medio_max_litros: float = 350.0

    # YOLO-World (opcional, desactivado por defecto)
    enable_yolo_world: bool = field(default_factory=lambda: _env_bool("ENABLE_YOLO_WORLD", False))
    yolo_world_model: str = field(
        default_factory=lambda: os.getenv("YOLO_WORLD_MODEL", "yolov8s-worldv2.pt")
    )

    # Geografía de Juliaca
    deposito_lat: float = -15.4803
    deposito_lng: float = -70.1436
    descarga_lat: float = -15.5680
    descarga_lng: float = -70.3150

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()


def nivel_por_volumen(volumen_litros: float) -> str:
    """Clasificación única de nivel para todo el sistema."""
    if volumen_litros < settings.nivel_bajo_max_litros:
        return "bajo"
    if volumen_litros < settings.nivel_medio_max_litros:
        return "medio"
    return "critico"
