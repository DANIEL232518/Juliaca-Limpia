# Juliaca Limpia

Plataforma de **gestión inteligente de residuos sólidos** para la Municipalidad Provincial
de San Román — Juliaca (Puno, Perú). Combina reportes ciudadanos georreferenciados, visión
artificial para estimar volumen, agrupación espacial con PostGIS y optimización de rutas
para camiones compactadores, con actualizaciones en tiempo real por SSE.

> **Estado: Fases 1, 2, 3 y 4 operativas.** Infraestructura dockerizada, PostGIS con datos
> semilla, API Go, microservicio Python de análisis/rutas, aplicación Angular 19 con los
> flujos ciudadano, conductor y administrador, mapa en vivo, SSE, panel estadístico
> (semanal/mensual/anual) y simulador de flota en vivo.

## Arquitectura

```
Angular 19 (4200) ──▶ api · Go 1.23 (8080) ──▶ PostgreSQL 16 + PostGIS (5432)
                           │        │
                    S3 (9000)       └──▶ ml-service · Python 3.12 + FastAPI (8000)
```

> **Almacenamiento de objetos:** MinIO dejó de publicar imágenes oficiales en septiembre de
> 2026. El proyecto usa **PGSTY Silo** (`pgsty/silo` + `pgsty/mc`), un fork comunitario
> mantenido del servidor MinIO con la misma API S3, variables `MINIO_*`, consola web y
> cliente `mc`. El servicio conserva el nombre `minio` en Compose y el cliente Go sigue
> usando `minio-go/v7`.

| Servicio | Tecnología | Puerto | Descripción |
|---|---|---|---|
| `db` | PostgreSQL 16 + PostGIS 3.4 | 5432 | Zonas, reportes, camiones, rutas, evidencias |
| `minio` | PGSTY Silo (S3, fork MinIO) | 9000 / 9001 | Fotos de reportes y evidencias |
| `api` | Go 1.23, chi, pgx/v5 | 8080 | REST + SSE |
| `ml-service` | Python 3.12, FastAPI, OpenCV | 8000 | `/analyze`, `/optimize-routes` |
| `frontend` | Angular 19 + nginx | 4200 | App ciudadano / conductor / admin |

## Inicio rápido

Requisitos: Docker Desktop con Compose v2 y ~4 GB libres.

**Todo el proyecto se levanta con un solo comando** (los valores por defecto ya están en
`docker-compose.yml`, no hace falta crear `.env`):

```bash
docker compose up --build
```

La primera vez descarga imágenes, compila Go/Angular y carga el esquema + datos semilla.
Cuando los healthchecks pasen:

- Aplicación web: <http://localhost:4200>
- API: <http://localhost:8080/health>
- ML Swagger: <http://localhost:8000/docs>
- Consola S3 (Silo/MinIO): <http://localhost:9001> (`juliaca_minio` / `juliaca_minio_2026`)
- PostgreSQL: `localhost:5432`, base `juliacalimpia`, usuario `juliaca`, clave `juliaca_dev_2026`

Si quieres cambiar puertos, credenciales o umbrales, copia `.env.example` a `.env` antes de
levantar; las variables con prefijo `VARIABLE:-valor` en Compose mantienen el valor por
defecto si no existe `.env`.

El esquema y los datos semilla se cargan solos la primera vez que se crea el volumen.
Para reiniciar todo desde cero (borra base y fotos):

```bash
docker compose down -v
docker compose up --build
```

## Datos semilla

- 1 administrador, 3 conductores/recolectores y 1 ciudadano.
- 4 camiones compactadores (`COMP-01` … `COMP-04`; 45 000 / 60 000 L) en el
  **Depósito Municipal Las Casuarinas** (`-15.4803, -70.1436`).
- 6 zonas y 12 reportes distribuidos en los últimos 12 meses:
  Plaza de Armas, Mercado Pedro Vilcapaza, Av. Ferial, Laguna Temporal,
  salida a Cusco y salida a Puno. Tres zonas `tratado` con evidencia y tres `pendiente`.
  Av. Ferial se trató hace un día y Mercado Pedro Vilcapaza tiene un reporte reciente para
  que el panel **Semanal** muestre actividad desde el primer arranque.
- Centro del mapa: **-15.4941, -70.1356**. Descarga Huanuyo: **-15.5680, -70.3150**.

## Aplicación web (Fase 2 + Fase 3)

Angular 19 standalone con signals y Tailwind. Al abrir <http://localhost:4200> se elige un
rol de demostración (la sesión se guarda en `localStorage`; no hay autenticación real aún):

| Rol | Usuario | `usuario_id` | Qué permite |
|---|---|---|---|
| Ciudadano | Lucía Ticona Flores | 2 | Reportar con foto + GPS y seguir "Mis Reportes" |
| Conductor | Julio César Apaza | 3 | Elegir unidad, ver ruta y subir evidencia obligatoria |
| Administrador | Rosa Quispe Mamani | 1 | Dashboard estadístico, generar rutas y simular la flota |

Mapa: **Leaflet** con teselas de **OpenStreetMap** (sin API key). Zonas en rojo/ámbar/verde
según nivel y estado, camiones animados y popup con el antes/después de cada zona.

### Flujo ciudadano

1. El panel pide la ubicación automáticamente (`navigator.geolocation`); si el navegador la
   bloquea, se puede ajustar el pin tocando el mapa o pulsar **Mi GPS**.
2. La foto se toma con la cámara trasera en móvil (`accept="image/*" capture="environment"`)
   o se elige un archivo en escritorio; se muestra vista previa y barra de progreso real.
3. Al enviar se muestra el volumen estimado, el nivel (`Bajo`/`Medio`/`Crítico`) y si el
   reporte creó un **Punto nuevo** o se **Fusionó** con una zona a menos de 20 m.
4. La sección **Mis Reportes / Estado en mi Zona** sigue el ciclo
   `Pendiente → En ruta → Tratado` en vivo por SSE e incluye la foto de limpieza del
   conductor cuando la zona se cierra.

### Flujo conductor

1. Selecciona su unidad (por ejemplo `COMP-01`); el mapa se acerca a esa compactadora y
   atenúa las rutas de las demás.
2. Ve la ruta optimizada con paradas ordenadas, distancia, dirección de referencia y litros.
3. Cada parada exige **Reportar punto limpio**: el modal no permite confirmar sin foto de
   evidencia. Al confirmar se emite `zona_tratada` y la zona pasa a verde para todos.
4. La carga del camión se acumula con el volumen recolectado; al superar el **85 %** de su
   capacidad aparece la alerta para retornar a descargar en Huanuyo.

## API

### `POST /api/reportes`

`multipart/form-data`:

| Campo | Obligatorio | Descripción |
|---|---|---|
| `foto` | sí | JPG/PNG/WebP, máx. 15 MB |
| `lat`, `lng` | sí | Coordenadas WGS84 |
| `direccion_referencia` | no | Texto de referencia |
| `comentario` | no | Comentario ciudadano |
| `usuario_id` | no | Usuario existente |
| `volumen_litros` | no | Fuerza el volumen (el análisis igual se ejecuta) |

Flujo: sube la foto al bucket S3 (Silo/MinIO) → llama a `/analyze` → agrupa con PostGIS
(`ST_DWithin` de 20 m sobre `geography`) o crea zona → guarda reporte → emite
`reporte_creado` por SSE.

```bash
curl -X POST http://localhost:8080/api/reportes \
  -F "foto=@basura.jpg" \
  -F "lat=-15.4972" \
  -F "lng=-70.1362" \
  -F "direccion_referencia=Mercado Pedro Vilcapaza" \
  -F "comentario=Basura acumulada junto al contenedor"
```

### `GET /api/reportes?usuario_id={id}`

Devuelve los reportes del ciudadano ordenados del más reciente al más antiguo, con el estado
actual de su zona (`pendiente`, `en_ruta`, `tratado`), el volumen acumulado de la zona y la
foto de evidencia de limpieza cuando ya fue tratada. Alimenta **Mis Reportes**.

```bash
curl "http://localhost:8080/api/reportes?usuario_id=2"
```

### `GET /api/mapa/estado`

Devuelve centro, todas las zonas (pendientes, en ruta y tratadas) y la posición/rumbo de
los camiones.

### `POST /api/rutas/generar`

Body opcional (`application/json`):

```json
{ "camion_ids": [], "zona_ids": [] }
```

Sin filtros toma todos los camiones `operativo`/`en_ruta` y todas las zonas `pendiente`.
El ML asigna por capacidad y prioridad, ordena con Vecino Más Cercano + 2-opt y cierra el
recorrido en Huanuyo y el depósito. Se guardan `rutas` + `ruta_paradas`, se marcan las
zonas `en_ruta` y se emite `rutas_generadas`.

### `POST /api/zonas/{id}/tratar`

`multipart/form-data`: `foto_evidencia`, `camion_id`, `conductor_id`, `observacion`.

El ML analiza en modo `evidencia`; si el volumen restante supera **25 L** responde `422`.
Si es válido: guarda evidencia, marca la zona `tratado`, completa la parada, acumula carga
en el camión y emite `zona_tratada`.

```bash
curl -X POST http://localhost:8080/api/zonas/2/tratar \
  -F "foto_evidencia=@limpio.jpg" \
  -F "camion_id=1" \
  -F "conductor_id=3" \
  -F "observacion=Recojo completo, área barrida"
```

### `GET /api/estadisticas?periodo=semanal|mensual|anual`

Series de reportes creados, zonas tratadas, litros recolectados y tiempo promedio de
atención (horas), más un resumen del periodo.

### `GET /api/events` (SSE)

Eventos: `reporte_creado`, `rutas_generadas`, `zona_tratada`. Cada mensaje incluye
`tipo`, `datos` y `emitido_en`. Heartbeat cada 20 s.

```bash
curl -N http://localhost:8080/api/events
```

### Endpoints auxiliares

- `GET /health` — estado de API, PostgreSQL y ML.
- `GET /api/zonas?estado=pendiente` y `GET /api/camiones`.
- `GET /api/zonas` / `GET /api/camiones` para depuración.

El contrato completo está en [`docs/openapi.yaml`](docs/openapi.yaml).

## Microservicio ML

### `POST /analyze`

`multipart/form-data` con `imagen` y `modo` (`reporte` | `evidencia`, default `reporte`).
Valida nitidez con la **varianza del Laplaciano**. Si la foto está borrosa responde `422`.

Respuesta:

```json
{
  "volumen_litros": 245.0,
  "nivel": "medio",
  "confianza": 0.78,
  "nitidez": 312.4,
  "nitido": true,
  "metodo": "heuristico_v1",
  "recomendacion": "Programar la recolección en las próximas 24 horas.",
  "detalles": { "ratio_oscuro": 0.31, "densidad_bordes": 0.08, "score_volumen": 0.38 },
  "detecciones": []
}
```

La heurística combina proporción de píxeles oscuros/saturados, densidad de bordes (Canny),
textura (Laplaciano), brillo y contraste. En modo `evidencia` la línea base es más estricta:
una escena limpia devuelve 25 L para permitir el cierre de la zona.

`app/analyzers/yolo_world.py` deja listo el adaptador YOLO-World. Se activa con
`ENABLE_YOLO_WORLD=true` cuando se instalen `ultralytics` y los pesos; el contrato de
`/analyze` no cambia.

### `POST /optimize-routes`

```json
{
  "camiones": [
    { "id": 1, "codigo_unidad": "COMP-01", "capacidad_litros": 45000,
      "carga_actual_litros": 0, "lat": -15.4803, "lng": -70.1436 }
  ],
  "zonas": [
    { "id": 2, "lat": -15.4972, "lng": -70.1362,
      "volumen_estimado_litros": 500, "nivel": "critico" }
  ],
  "deposito": { "lat": -15.4803, "lng": -70.1436 },
  "descarga": { "lat": -15.5680, "lng": -70.3150 }
}
```

Devuelve rutas con paradas ordenadas, distancia desde la parada anterior, distancia total
(incluye descarga + retorno al depósito), volumen, utilización y zonas sin asignar.

## Estructura

```
db/init.sql              Esquema PostGIS + seeds
api/                     Backend Go (chi, pgx, S3/MinIO, SSE)
ml-service/              FastAPI + OpenCV + optimización de rutas
frontend/                Angular 19 (ciudadano, conductor, admin, mapa Leaflet + OSM)
docs/openapi.yaml        Contrato HTTP
AGENTS.md                Convenciones para personas y agentes
```

## Verificación

```bash
curl http://localhost:8080/health
curl http://localhost:8000/health
curl http://localhost:8080/api/mapa/estado
curl "http://localhost:8080/api/estadisticas?periodo=mensual"
```

Prueba de imagen:

```bash
curl -X POST http://localhost:8000/analyze -F "imagen=@foto.jpg" -F "modo=reporte"
```

En PowerShell usa `curl.exe` (el alias `curl` apunta a `Invoke-WebRequest`).

### Prueba manual del flujo completo

1. `docker compose up -d --build` y abrir <http://localhost:4200>.
2. **Ciudadano** → permitir ubicación → adjuntar una foto con residuos → **Enviar reporte**.
   Debe aparecer el volumen estimado, el nivel y "Punto nuevo" (o "Fusionado" si repites a
   menos de 20 m). El reporte aparece en **Mis Reportes** como `Pendiente`.
3. **Administrador** → **Generar rutas**. El mensaje confirma cuántas rutas y paradas se
   planificaron; el mapa dibuja los recorridos y la zona pasa a `En ruta`.
4. **Conductor** → elegir la unidad asignada → pulsar **Reportar punto limpio** en la parada
   que contiene tu dirección → adjuntar la foto de evidencia (sin foto el botón sigue
   deshabilitado) → **Confirmar limpieza**.
5. Verificar: la zona se pone verde en el mapa, el ciudadano ve `Tratado` con la foto del
   conductor y la carga del camión sube. Para probar la alerta del 85 %, repetir hasta
   acumular carga o ajustar `carga_actual_litros` en PostgreSQL.


## Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| `db` reinicia en bucle | Puerto 5432 ocupado o contraseña inválida. Revisa `docker compose logs db`. |
| No aparecen los seeds | El volumen ya existía. `docker compose down -v && docker compose up -d --build`. |
| `imagen_borrosa` | La varianza del Laplaciano es menor a `MIN_SHARPNESS` (15). Usa mejor luz/enfoque. |
| `volumen_restante_excede` | La foto de evidencia aún muestra residuo. Vuelve a tomarla con el área despejada. |
| Fotos no visibles | El bucket debe ser público de desarrollo; revisa `docker compose logs minio-init`. |
| `pull access denied` en `minio/*` | Las imágenes oficiales de MinIO ya no existen; el Compose usa `pgsty/silo` y `pgsty/mc` con tag fijo. |
| API sin respuesta | `docker compose logs api`; el arranque espera DB y ML con reintentos. |

## Seguridad (importante)

Esta fase es de desarrollo: no hay autenticación y el bucket es de lectura pública. Antes de
producción se debe agregar JWT/OIDC con roles, bucket privado con URLs prefirmadas,
validación de pertenencia conductor↔camión y límites de tasa.

## Roadmap

- **Fase 1:** infraestructura Docker, PostGIS + seeds, API Go, ML FastAPI, SSE. ✅
- **Fase 2:** frontend Angular 19 (mapa en vivo, formulario ciudadano, panel conductor,
  estadísticas y SSE). ✅
- **Fase 3:** flujos operativos (mis reportes, evidencia obligatoria, alerta de carga),
  panel administrativo, observabilidad y despliegue. 🔄
- **ML:** YOLO-World para detección de residuos y estimación más precisa.
