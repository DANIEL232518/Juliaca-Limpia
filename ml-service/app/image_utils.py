"""Utilidades de imagen compartidas."""

from __future__ import annotations

import cv2
import numpy as np


def decode_image(data: bytes) -> np.ndarray | None:
    """Decodifica bytes a BGR. Devuelve None si el archivo no es una imagen válida."""
    if not data:
        return None
    buffer = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        return None
    return image


def resize_max(image: np.ndarray, max_side: int) -> np.ndarray:
    """Redimensiona manteniendo aspecto para acotar el costo de CPU."""
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return image
    scale = max_side / float(longest)
    return cv2.resize(
        image,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def laplacian_variance(image: np.ndarray) -> float:
    """Varianza del Laplaciano: medida estándar de nitidez (enfoque)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())
