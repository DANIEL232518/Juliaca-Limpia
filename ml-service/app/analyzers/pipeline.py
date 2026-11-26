"""Pipeline de análisis: heurístico obligatorio + YOLO-World opcional."""

from __future__ import annotations

import logging

import numpy as np

from ..config import nivel_por_volumen, settings
from .heuristic import HeuristicAnalyzer
from .yolo_world import YoloWorldAnalyzer

logger = logging.getLogger(__name__)


class AnalysisPipeline:
    def __init__(
        self,
        heuristic: HeuristicAnalyzer | None = None,
        yolo: YoloWorldAnalyzer | None = None,
    ) -> None:
        self.heuristic = heuristic or HeuristicAnalyzer()
        self.yolo = yolo

    def analyze(self, image_bgr: np.ndarray, modo: str = "reporte") -> dict:
        result = self.heuristic.analyze(image_bgr, modo)

        if self.yolo is not None and self.yolo.available:
            detections = self.yolo.analyze(image_bgr)
            if detections:
                result["detecciones"] = detections
                result["metodo"] = "yolo_world+heuristico"
                result["confianza"] = round(
                    min(0.97, max(result["confianza"], 0.55)
                        + 0.05 * min(len(detections), 5)),
                    2,
                )
                # Ajuste conservador: la heurística manda, YOLO aporta cobertura.
                coverage = min(sum(d["area_relativa"] for d in detections), 0.9)
                if modo == "reporte" and coverage > 0.02:
                    yolo_volume = settings.volumen_min_litros + coverage * (
                        settings.volumen_max_litros - settings.volumen_min_litros
                    )
                    blended = 0.65 * result["volumen_litros"] + 0.35 * yolo_volume
                    volume = float(
                        np.clip(
                            round(blended / 5.0) * 5.0,
                            settings.volumen_min_litros,
                            settings.volumen_max_litros,
                        )
                    )
                    result["volumen_litros"] = volume
                    result["nivel"] = nivel_por_volumen(volume)

        return result
