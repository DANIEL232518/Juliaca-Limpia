"""Estimación heurística de volumen de residuos a partir de una fotografía.

No requiere pesos de red neuronal. Combina señales clásicas de visión por
computadora sobre la zona inferior de la imagen (donde suele estar el residuo):

* proporción de píxeles oscuros / saturados (bolsas, restos, sombras),
* densidad de bordes (Canny) en la mitad inferior,
* textura (desviación del Laplaciano),
* brillo y contraste globales,
* nitidez (varianza del Laplaciano) como control de calidad.

El resultado se expresa en litros (25–600) y en el nivel de dominio
(bajo / medio / crítico). Es deliberadamente conservador y determinista, y
sirve como línea base mientras se integra YOLO-World en la siguiente iteración.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..config import nivel_por_volumen, settings
from ..image_utils import laplacian_variance, resize_max

_RECOMENDACIONES = {
    "bajo": "Incluir la zona en la ruta regular de recolección.",
    "medio": "Programar la recolección en las próximas 24 horas.",
    "critico": "Priorizar la zona y enviar un camión compactador de inmediato.",
}


class HeuristicAnalyzer:
    name = "heuristico_v1"

    def analyze(self, image: np.ndarray, modo: str = "reporte") -> dict:
        if image is None or image.size == 0:
            raise ValueError("Imagen vacía o inválida")
        if modo not in {"reporte", "evidencia"}:
            raise ValueError(f"Modo de análisis desconocido: {modo}")

        original_h, original_w = image.shape[:2]

        # Nitidez sobre una versión acotada para que el costo sea estable.
        sharpness = laplacian_variance(resize_max(image, settings.max_image_side))

        work = resize_max(image, 640)
        height, width = work.shape[:2]

        hsv = cv2.cvtColor(work, cv2.COLOR_BGR2HSV)
        _, saturation, value = cv2.split(hsv)
        sat = saturation.astype(np.float32) / 255.0
        val = value.astype(np.float32) / 255.0

        # Máscara de candidatos: zonas oscuras o con color intenso.
        dark = val < 0.38
        colorful = (sat > 0.35) & (val >= 0.15) & (val < 0.85)
        mask = (dark | colorful).astype(np.float32)

        # El residuo suele estar en el suelo: pesamos menos el cielo superior.
        weights = np.ones_like(val, dtype=np.float32)
        weights[: max(1, int(height * 0.25)), :] = 0.35
        ratio_oscuro = float((mask * weights).sum() / max(float(weights.sum()), 1.0))
        ratio_oscuro = float(np.clip(ratio_oscuro, 0.0, 0.75))

        gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
        ground = gray[max(0, int(height * 0.35)) :, :]
        edges = cv2.Canny(ground, 60, 160)
        densidad_bordes = float(np.count_nonzero(edges)) / float(max(edges.size, 1))

        textura = float(cv2.Laplacian(gray, cv2.CV_64F).std())
        brillo = float(gray.mean() / 255.0)
        contraste = float(gray.std() / 128.0)

        # Score 0..1: cuánta "carga visual" de residuo hay en la escena.
        score = (
            0.55 * min(ratio_oscuro / 0.55, 1.0)
            + 0.25 * min(densidad_bordes / 0.16, 1.0)
            + 0.20 * min(textura / 70.0, 1.0)
        )
        score = float(np.clip(score, 0.0, 1.0))

        if modo == "evidencia":
            # Validación de limpieza: una escena sin residuo visible debe quedar
            # en 25 L (mínimo). Solo una carga visual alta supera el umbral de
            # cierre de 25 L. La línea base 0.55 tolera texturas de pavimento.
            exceso = float(np.clip((score - 0.55) / 0.45, 0.0, 1.0))
            volumen = settings.volumen_min_litros + exceso * (
                settings.volumen_max_litros - settings.volumen_min_litros
            )
        else:
            volumen = settings.volumen_min_litros + score * (
                settings.volumen_max_litros - settings.volumen_min_litros
            )
        volumen = round(volumen / 5.0) * 5.0
        volumen = float(
            np.clip(volumen, settings.volumen_min_litros, settings.volumen_max_litros)
        )

        nivel = nivel_por_volumen(volumen)
        nitido = sharpness >= settings.min_sharpness

        sharp_quality = min(sharpness / 250.0, 1.0)
        contrast_quality = min(max(contraste, 0.0), 1.0)
        separation = abs(score - 0.45) * 0.6
        confianza = 0.42 + 0.25 * sharp_quality + 0.18 * contrast_quality + 0.10 * separation
        confianza = round(float(np.clip(confianza, 0.30, 0.92)), 2)

        return {
            "volumen_litros": volumen,
            "nivel": nivel,
            "confianza": confianza,
            "nitidez": round(sharpness, 2),
            "nitido": bool(nitido),
            "metodo": self.name,
            "recomendacion": _RECOMENDACIONES[nivel],
            "detalles": {
                "ratio_oscuro": round(ratio_oscuro, 4),
                "densidad_bordes": round(densidad_bordes, 4),
                "textura": round(textura, 2),
                "brillo_medio": round(brillo, 4),
                "contraste": round(contraste, 4),
                "score_volumen": round(score, 4),
                "resolucion": [int(original_w), int(original_h)],
                "nitidez": round(sharpness, 2),
                "modo": modo,
            },
            "detecciones": [],
        }
