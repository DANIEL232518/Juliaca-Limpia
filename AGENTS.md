# AGENTS.md — Juliaca Limpia

Guía de trabajo para personas y agentes de IA que desarrollen este repositorio.

## 1. Contexto del producto

**Juliaca Limpia** es una plataforma de gestión inteligente de residuos sólidos para la
Municipalidad Provincial de San Román — Juliaca (Puno, Perú).

Ciudadanos reportan acumulación de basura con una foto y una ubicación. El backend agrupa
reportes cercanos (20 m) en zonas, estima el volumen con visión artificial y asigna rutas
óptimas a los camiones compactadores. Los conductores suben una foto de evidencia al
terminar la recolección. Un mapa y un panel de estadísticas muestran el estado en vivo.

La Fase 1 entrega infraestructura, base de datos, backend Go y microservicio de IA. La
Fase 2 agrega la aplicación Angular 19 (ciudadano, conductor, administrador y mapa) y la
Fase 3 los flujos operativos: seguimiento de "Mis Reportes", evidencia de limpieza
obligatoria por parada y alerta de carga del camión.

## 2. Arquitectura

```
                         ┌──────────────────────┐
  Angular 19 (4200) ───▶ │  api · Go 1.23        │──▶ PostgreSQL 16 + PostGIS (5432)
                         │  chi + pgx/v5 + SSE   │
                         └───────┬───────┬──────┘
                                 │       │
                   S3/Silo ◀─────┘       └────▶ ml-service · Python 3.12 + FastAPI
                   (9000/9001)                 OpenCV · rutas VMC + 2-opt (8000)
```

Todos los servicios corren en Docker Compose, en la red `juliaca-net`.

> **Nota sobre el almacenamiento de objetos.** MinIO, Inc. dejó de publicar imágenes
> oficiales en septiembre de 2026 (`minio/minio` y `minio/mc` ya no existen en Docker Hub).
> El proyecto usa **PGSTY Silo** (`pgsty/silo` + `pgsty/mc`), un fork comunitario mantenido
> del servidor MinIO que conserva la API S3, las variables `MINIO_*`, la consola web y el
> cliente `mc`. Por eso el código Go sigue usando `minio-go/v7` sin cambios y los servicios
> mantienen el nombre `minio`/`minio-init` en Compose. No cambiar a otra imagen sin verificar
> que respete esas variables y el comando `server /data --console-address ":9001"`.

## 3. Estructura del repositorio

```
.
├── AGENTS.md
├── README.md
├── docker-compose.yml
├── .env.example
├── db/
│   └── init.sql                # esquema PostGIS + seeds (solo corre con volumen vacío)
├── api/                        # backend Go
│   ├── cmd/api/main.go
│   ├── internal/config/
│   ├── internal/db/
│   ├── internal/events/        # hub SSE
│   ├── internal/httpapi/       # router, handlers, respuestas
│   ├── internal/ml/            # cliente del microservicio Python
│   ├── internal/models/
│   ├── internal/storage/       # cliente S3 (MinIO / PGSTY Silo)
│   ├── Dockerfile
│   └── go.mod
├── ml-service/                 # microservicio sin estado
│   ├── app/
│   │   ├── analyzers/          # heurístico + stub YOLO-World
│   │   ├── main.py
│   │   ├── routing.py
│   │   └── schemas.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                   # placeholder Fase 1 + Dockerfile listo para Angular 19
└── docs/
    └── openapi.yaml            # contrato HTTP de referencia
```

## 4. Servicios y puertos

| Servicio     | Imagen / runtime            | Puerto host | Healthcheck              |
|--------------|-----------------------------|-------------|--------------------------|
| `db`         | `postgis/postgis:16-3.4`    | 5432        | `pg_isready`             |
| `minio`      | `pgsty/silo:<tag fijo>` (fork MinIO) | 9000 / 9001 | `mc ready local` |
| `api`        | Go 1.23 + chi + pgx/v5      | 8080        | `GET /health`            |
| `ml-service` | Python 3.12 + FastAPI       | 8000        | `GET /health`            |
| `frontend`   | Angular 19 + nginx          | 4200        | —                        |

Rutas principales:

- `POST /api/reportes` — multipart: `foto`, `lat`, `lng`, `direccion_referencia`, `comentario`, `usuario_id`, `volumen_litros` (opcional).
- `GET  /api/reportes?usuario_id=` — reportes del ciudadano + estado de su zona + evidencia (alimenta "Mis Reportes").
- `GET  /api/mapa/estado` — zonas + camiones georreferenciados.
- `GET  /api/rutas` — rutas activas con paradas ordenadas.
- `POST /api/rutas/generar` — body opcional `{"camion_ids":[],"zona_ids":[]}`.
- `POST /api/zonas/{id}/tratar` — multipart: `foto_evidencia`, `camion_id`, `conductor_id`, `observacion`.
- `GET  /api/estadisticas?periodo=semanal|mensual|anual`.
- `GET  /api/events` — SSE (`reporte_creado`, `rutas_generadas`, `zona_tratada`).

## 5. Variables de entorno

Copiar `.env.example` a `.env`. Nunca commitear `.env` ni secretos reales.

| Variable | Uso |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | credenciales de PostgreSQL |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | credenciales S3 (Silo/MinIO) |
| `MINIO_BUCKET` | bucket de fotos (`juliaca-limpia-fotos`) |
| `MINIO_PUBLIC_ENDPOINT` | URL pública del bucket para el navegador (`http://localhost:9000`) |
| `ML_SERVICE_URL` | URL interna del servicio Python |
| `CORS_ORIGINS` | orígenes permitidos, separados por coma; `*` en desarrollo |
| `MIN_SHARPNESS` | umbral de varianza del Laplaciano para rechazar fotos borrosas (default 15) |

## 6. Convenciones de código

### Generales

- Nombres de dominio, tablas, columnas, JSON y mensajes de usuario **en español**.
- Código (variables, funciones, tipos) en inglés salvo términos de dominio inevitables.
- IDs numéricos `BIGSERIAL`; fechas `TIMESTAMPTZ` en UTC, mostradas en `America/Lima`.
- No agregar dependencias sin justificar el peso o la alternativa estándar.
- Formatear Go con `gofmt`; Python con estilo PEP 8 (4 espacios, tipos explícitos).

### Go (`api/`)

- Layout estándar `cmd/` + `internal/`; paquetes pequeños y con una responsabilidad.
- Errores: envolver con `fmt.Errorf("contexto: %w", err)`; no ignorar errores de escritura.
- HTTP: `chi`; respuestas JSON con `snake_case`; errores con forma
  `{"error":"codigo","mensaje":"texto"}`.
- SQL: siempre consultas parametrizadas (`$1`, `$2`); nunca concatenar entrada de usuario.
- PostGIS: distancias en metros con cast a `geography` (`ST_DWithin(ubicacion::geography, ...)`).
- SSE: publicar a través de `internal/events.Hub`; no bloquear el handler si no hay clientes.
- Contexto: usar `r.Context()` y timeouts en llamadas externas (ML, S3/MinIO).

### Python (`ml-service/`)

- FastAPI + Pydantic v2; modelos en `schemas.py`.
- El servicio es **sin estado**: no escribir archivos ni guardar imágenes entre requests.
- El analizador heurístico debe funcionar sin modelos externos. YOLO-World es opcional y se
  activa por configuración; nunca descargar pesos en tiempo de request.
- Devolver `float()` nativos, no tipos de NumPy, para serializar correctamente.
- Los umbrales de volumen/nivel viven en `app/config.py` y deben coincidir con Go/DB.

### SQL (`db/`)

- `db/init.sql` es idempotente (`CREATE TABLE IF NOT EXISTS`) y solo se ejecuta al crear el
  volumen. Para recrear datos: `docker compose down -v && docker compose up -d --build`.
- Enums del dominio con `CHECK`, no tipos `ENUM` (más simples de evolucionar).
- Índices GIST para geometrías y B-Tree para columnas de filtro (`estado`, `creado_en`).
- Semillas deterministas y realistas de Juliaca; no usar `random()`.
- Toda migración futura va en un archivo nuevo dentro de `db/` y se documenta aquí.

### Angular (Fase 2 y 3)

- Standalone components, signals, `HttpClient`, tipado estricto.
- Consumir la API por rutas relativas `/api` (nginx hace proxy al servicio `api`).
- SSE con `EventSource('/api/events')`; cerrar la conexión al destruir el componente.
- Mapa con **Leaflet** y teselas de **OpenStreetMap** (sin API key). No commitear claves de
  proveedores de mapas.
- Paleta institucional en `tailwind.config.js`: `sanroman-azul #004B93`,
  `sanroman-celeste #00AEEF`, `sanroman-dorado #FDB913`, `basura-critica #D32F2F`,
  `zona-tratada #16A34A`, fondo `#F8FAFC`. No introducir colores fuera de esa paleta.
- La sesión de demostración vive en `localStorage` (`juliaca-limpia.sesion`); los IDs de
  usuario son los de los seeds. En la Fase 3 real se reemplaza por JWT/OIDC.
- Subidas con progreso: `HttpClient` con `observe: 'events', reportProgress: true`.
- El modal de evidencia del conductor **no** permite confirmar sin foto ni observación.
- El selector de unidad del conductor lista **todas** las compactadoras (no solo las que
  tienen ruta) para que la carga y la alerta del 85 % sigan visibles al terminar la ruta.
- La selección de unidad nunca se cambia automáticamente después de que el conductor elige;
  el mapa enfoca esa unidad (`UiService.camionEnfocado`) y atenúa las demás rutas.

## 7. Reglas de negocio

- Centro de Juliaca: `lat -15.4941`, `lng -70.1356`.
- Depósito Municipal Las Casuarinas: `-15.4803, -70.1436`.
- Punto de descarga/relleno Huanuyo: `-15.5680, -70.3150`.
- Agrupación de reportes: zona **abierta** (`estado <> 'tratado'`) a menos de **20 m**
  (geography). Si existe, se suma volumen y se incrementa `total_reportes`; si no, se crea.
  La creación se serializa con un advisory lock para evitar zonas duplicadas concurrentes.
- Volumen estimado: entre **25 L** y **600 L**.
- Nivel por volumen acumulado: `< 150 L` = `bajo`, `< 350 L` = `medio`, `>= 350 L` = `critico`.
- Una zona se marca `tratado` solo si la evidencia tiene volumen restante `<= 25 L`.
- Estados de zona: `pendiente` → `en_ruta` → `tratado`.
- Estados de camión: `operativo`, `en_ruta`, `mantenimiento`.
- Capacidades de camión: 45 000 L o 60 000 L.
- Al generar rutas se reemplazan las rutas activas anteriores de los camiones involucrados.
- La carga del camión se acumula al tratar cada zona (`LEAST(capacidad, carga + recolectado)`)
  y la alerta de descarga en Huanuyo se muestra al superar el **85 %** de la capacidad.
- Al completar la última parada la ruta queda `completada` y el camión vuelve a `operativo`.

## 8. Flujo de desarrollo

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f api ml-service
```

- Reset completo de base de datos y bucket local:
  `docker compose down -v && docker compose up -d --build`.
- Rebuild de un solo servicio: `docker compose up -d --build api`.
- El frontend de Fase 1 sirve un placeholder en `http://localhost:4200`.
- Consola S3 (Silo/MinIO): `http://localhost:9001`.

## 9. Pruebas y verificación

Antes de cerrar un cambio:

1. `docker compose config` sin errores.
2. `docker compose build` (o al menos `api` y `ml-service`).
3. `curl http://localhost:8080/health` → `status: ok`.
4. `curl http://localhost:8000/health` → `status: ok`.
5. Reporte real con foto → zona creada/agrupada, evento SSE, foto en el bucket S3.
6. `GET /api/mapa/estado` devuelve las 6 zonas semilla y 4 camiones.
7. Generar rutas con zonas pendientes y verificar paradas guardadas.
8. Tratar una zona con evidencia y verificar transición a `tratado`.
9. Estadísticas con los tres periodos.

No se considera terminado un cambio que no compile y no haya sido probado contra los
contenedores. Si Docker no está disponible, compilar/validar localmente y dejarlo dicho.

## 10. Seguridad

- El bucket es de lectura pública **solo para desarrollo** (permite ver fotos desde el
  navegador). En producción: bucket privado + URLs prefirmadas de corta duración.
- No hay autenticación todavía; `usuario_id`, `camion_id` y `conductor_id` llegan del cliente.
  La Fase 3 debe introducir JWT/OIDC y autorización por rol.
- Validar tipo y tamaño de archivos (máx. 15 MB) y no confiar en el nombre original.
- Nunca registrar credenciales ni contenido binario en logs.

## 11. Estado y roadmap

- **Fase 1:** infraestructura Docker, PostGIS + seeds, API Go, ML FastAPI, SSE. ✅
- **Fase 2:** frontend Angular 19 (mapa, reporte ciudadano, panel conductor, estadísticas). ✅
- **Fase 3 (actual):** flujos operativos (Mis Reportes, evidencia obligatoria, alerta de
  carga > 85 %), autenticación/roles reales, despliegue y observabilidad.
- **Mejora ML:** integrar pesos YOLO-World para detección de residuos y reemplazar la
  heurística sin cambiar el contrato de `/analyze`.

## 12. Reglas para agentes

- Leer este archivo antes de modificar el proyecto.
- No borrar ni reescribir trabajo existente sin inspeccionarlo primero.
- Mantener el contrato de API y los nombres de eventos SSE; si cambian, actualizar
  `docs/openapi.yaml`, README y este archivo en el mismo cambio.
- No cambiar los umbrales de negocio (20 m, 25 L, 150/350 L) sin actualizar todas las capas.
- No commitear secretos, volúmenes de Docker ni artefactos de build.
- Reportar siempre qué se ejecutó, qué pasó y qué quedó sin verificar.
