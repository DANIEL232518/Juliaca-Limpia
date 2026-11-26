-- Migración 6: geometría real de calles en las rutas.
--
-- Las rutas se dibujan y se recorren siguiendo la traza de las calles de
-- Juliaca (OSRM/OpenStreetMap) en lugar de líneas rectas. La geometría se
-- guarda como JSONB con puntos [lat, lng] y es NULL cuando el servicio de
-- calles no respondió (en ese caso se conserva la línea recta como respaldo).
--
-- Idempotente: se puede ejecutar más de una vez.
-- Aplicar con:
--   docker compose exec -T db psql -U juliaca -d juliacalimpia \
--     -f /docker-entrypoint-initdb.d/migracion_v6_rutas_geometria.sql

ALTER TABLE rutas ADD COLUMN IF NOT EXISTS geometria JSONB;

COMMENT ON COLUMN rutas.geometria IS
    'Traza de calles [[lat,lng], ...] obtenida de OSRM. NULL = sin geometría.';
