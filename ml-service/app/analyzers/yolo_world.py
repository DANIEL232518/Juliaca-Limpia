"""Adaptador opcional para YOLO-World.

En la Fase 1 no se descargan pesos: si `ultralytics` no está instalado o la
variable `ENABLE_YOLO_WORLD` está apagada, `available` es False y el pipeline
usa solo el analizador heurístico. La estructura queda lista para que en la
siguiente iteración se agregue `ultralytics` a requirements y se active.

Contrato de salida (compatible con `schemas.Deteccion`):
    [{"etiqueta": "bolsa de basura", "confianza": 0.83,
      "area_relativa": 0.12, "bbox": [x1, y1, x2, y2]}, ...]
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

# Clases abiertas de YOLO-World orientadas al dominio.
CLASES_RESIDUOS = [
    "bolsa de basura",
    "montón de basura",
    "botella plástica",
    "caja de cartón",
    "neumático",
    "escombro",
]


class YoloWorldAnalyzer:
    def __init__(self, model_path: str, enabled: bool = False) -> None:
        self.model_path = model_path
        self.enabled = enabled
        self._model = None
        self._error = ""
        self._loaded = False

    @property
    def available(self) -> bool:
        if not self.enabled:
            return False
        if not self._loaded:
            self._load()
        return self._model is not None

    @property
    def error(self) -> str:
        return self._error

    def _load(self) -> None:
        self._loaded = True
        try:
            from ultralytics import YOLOWorld  # type: ignore[import-not-found]

            self._model = YOLOWorld(self.model_path)
            self._model.set_classes(CLASES_RESIDUOS)
            logger.info("YOLO-World cargado desde %s", self.model_path)
        except Exception as exc:  # pragma: no cover - depende de pesos externos
            self._error = str(exc)
            logger.warning(
                "YOLO-World no disponible (%s); se usará el analizador heurístico.",
                self._error,
            )

    def analyze(self, image_bgr: np.ndarray) -> list[dict] | None:
        if not self.available or self._model is None:
            return None
        try:
            results = self._model.predict(image_bgr, conf=0.25, verbose=False)
            height, width = image_bgr.shape[:2]
            total_area = float(max(height * width, 1))
            detections: list[dict] = []
            for result in results:
                names = result.names
                for box in result.boxes:
                    x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                    area = max(0.0, (x2 - x1) * (y2 - y1)) / total_area
                    detections.append(
                        {
                            "etiqueta": str(names.get(int(box.cls[0]), "residuo")),
                            "confianza": round(float(box.conf[0]), 4),
                            "area_relativa": round(area, 4),
                            "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                        }
                    )
            return detections
        except Exception as exc:  # pragma: no cover
            self._error = str(exc)
            logger.warning("Fallo al inferir con YOLO-World: %s", exc)
            return None
