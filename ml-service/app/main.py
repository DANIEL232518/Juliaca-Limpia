"""API HTTP de Juliaca Limpia — análisis de imágenes y optimización de rutas."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .analyzers import AnalysisPipeline, YoloWorldAnalyzer
from .config import settings
from .image_utils import decode_image
from .routing import optimizar_rutas
from .schemas import AnalisisResponse, OptimizeRequest, OptimizeResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [ml-service] %(message)s",
)
logger = logging.getLogger(__name__)

pipeline = AnalysisPipeline(
    yolo=YoloWorldAnalyzer(
        model_path=settings.yolo_world_model,
        enabled=settings.enable_yolo_world,
    )
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info(
        "Iniciando %s v%s (heurístico=%s, yolo_world=%s)",
        settings.app_name,
        settings.version,
        pipeline.heuristic.name,
        settings.enable_yolo_world,
    )
    yield
    logger.info("Deteniendo %s", settings.app_name)


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Microservicio sin estado para estimar volumen de residuos con OpenCV "
        "y optimizar rutas de camiones compactadores de Juliaca."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict:
    return {
        "servicio": "juliaca-limpia-ml",
        "version": settings.version,
        "endpoints": ["/health", "/analyze", "/optimize-routes", "/docs"],
    }


@app.get("/health")
def health() -> dict:
    yolo = pipeline.yolo
    return {
        "status": "ok",
        "servicio": "ml-service",
        "version": settings.version,
        "analizador": pipeline.heuristic.name,
        "yolo_world": {
            "habilitado": bool(yolo and yolo.enabled),
            "disponible": bool(yolo and yolo.available),
            "error": (yolo.error if yolo else ""),
        },
        "umbrales": {
            "nitidez_minima": settings.min_sharpness,
            "volumen_min_litros": settings.volumen_min_litros,
            "volumen_max_litros": settings.volumen_max_litros,
            "nivel_bajo_max_litros": settings.nivel_bajo_max_litros,
            "nivel_medio_max_litros": settings.nivel_medio_max_litros,
        },
    }


@app.post("/analyze", response_model=AnalisisResponse)
async def analyze(
    imagen: UploadFile = File(..., description="Fotografía JPG/PNG/WebP"),
    modo: str = Form("reporte", description="reporte | evidencia"),
):
    if modo not in {"reporte", "evidencia"}:
        raise HTTPException(
            status_code=400,
            detail={
                "codigo": "modo_invalido",
                "mensaje": "El modo debe ser 'reporte' o 'evidencia'.",
            },
        )

    data = await imagen.read()
    if not data:
        raise HTTPException(
            status_code=400,
            detail={"codigo": "archivo_vacio", "mensaje": "La imagen está vacía."},
        )
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail={
                "codigo": "archivo_muy_grande",
                "mensaje": f"La imagen supera {settings.max_upload_mb} MB.",
            },
        )

    image = decode_image(data)
    if image is None:
        raise HTTPException(
            status_code=400,
            detail={
                "codigo": "imagen_invalida",
                "mensaje": "El archivo no es una imagen JPG/PNG/WebP válida.",
            },
        )

    result = await run_in_threadpool(pipeline.analyze, image, modo)

    if not result["nitido"]:
        raise HTTPException(
            status_code=422,
            detail={
                "codigo": "imagen_borrosa",
                "mensaje": "La foto está desenfocada; vuelve a tomarla con mejor luz y enfoque.",
                "nitidez": result["nitidez"],
                "minimo_requerido": settings.min_sharpness,
                "sugerencia": "Sostén el dispositivo firme y apunta al punto de acumulación.",
            },
        )

    return result


@app.post("/optimize-routes", response_model=OptimizeResponse)
async def optimize_routes(payload: OptimizeRequest):
    if not payload.zonas:
        return OptimizeResponse(
            rutas=[],
            sin_asignar=[],
            metricas={
                "zonas_totales": 0,
                "zonas_asignadas": 0,
                "zonas_sin_asignar": 0,
                "camiones_utilizados": 0,
                "distancia_total_metros": 0.0,
                "volumen_asignado_litros": 0.0,
                "capacidad_total_disponible_litros": round(
                    sum(
                        max(c.capacidad_litros - c.carga_actual_litros, 0.0)
                        for c in payload.camiones
                    ),
                    1,
                ),
            },
        )

    plan = await run_in_threadpool(optimizar_rutas, payload)
    logger.info(
        "Rutas calculadas: %s zonas asignadas, %s sin asignar, %.1f m",
        plan.metricas.get("zonas_asignadas", 0),
        plan.metricas.get("zonas_sin_asignar", 0),
        plan.metricas.get("distancia_total_metros", 0.0),
    )
    return plan
