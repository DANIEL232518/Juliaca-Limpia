-- =============================================================================
-- Juliaca Limpia — Esquema inicial (PostgreSQL 16 + PostGIS)
-- Municipio Provincial de San Román — Juliaca, Puno, Perú
--
-- Este script se ejecuta automáticamente la PRIMERA vez que se crea el volumen
-- de PostgreSQL (docker-entrypoint-initdb.d). Para volver a ejecutarlo:
--   docker compose down -v && docker compose up -d --build
-- =============================================================================

SET TIME ZONE 'America/Lima';

CREATE EXTENSION IF NOT EXISTS postgis;

-- -----------------------------------------------------------------------------
-- Usuarios
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id          BIGSERIAL PRIMARY KEY,
    nombre      TEXT        NOT NULL,
    email       TEXT        NOT NULL UNIQUE,
    rol         TEXT        NOT NULL CHECK (rol IN ('ciudadano', 'recolector', 'admin')),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Camiones compactadores
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS camiones (
    id                  BIGSERIAL PRIMARY KEY,
    placa               TEXT             NOT NULL UNIQUE,
    codigo_unidad       TEXT             NOT NULL UNIQUE,
    capacidad_litros    INTEGER          NOT NULL CHECK (capacidad_litros > 0),
    carga_actual_litros DOUBLE PRECISION NOT NULL DEFAULT 0
                        CHECK (carga_actual_litros >= 0),
    estado              TEXT             NOT NULL DEFAULT 'operativo'
                        CHECK (estado IN ('operativo', 'en_ruta', 'mantenimiento')),
    ubicacion_actual    GEOMETRY(Point, 4326) NOT NULL,
    rumbo_grados        DOUBLE PRECISION NOT NULL DEFAULT 0
                        CHECK (rumbo_grados >= 0 AND rumbo_grados < 360),
    velocidad_kmh       DOUBLE PRECISION NOT NULL DEFAULT 0
                        CHECK (velocidad_kmh >= 0),
    actualizado_en      TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Zonas de reporte (agrupación espacial de reportes ciudadanos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zonas_reporte (
    id                        BIGSERIAL PRIMARY KEY,
    ubicacion                 GEOMETRY(Point, 4326) NOT NULL,
    direccion_referencia      TEXT,
    volumen_estimado_litros   DOUBLE PRECISION NOT NULL DEFAULT 0
                              CHECK (volumen_estimado_litros >= 0),
    nivel                     TEXT NOT NULL DEFAULT 'bajo'
                              CHECK (nivel IN ('bajo', 'medio', 'critico')),
    estado                    TEXT NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente', 'en_ruta', 'tratado')),
    total_reportes            INTEGER NOT NULL DEFAULT 0 CHECK (total_reportes >= 0),
    creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    tratado_en                TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- Reportes ciudadanos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reportes_ciudadanos (
    id             BIGSERIAL PRIMARY KEY,
    zona_id        BIGINT NOT NULL REFERENCES zonas_reporte(id) ON DELETE CASCADE,
    usuario_id     BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    foto_url       TEXT,
    volumen_litros DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (volumen_litros >= 0),
    nivel          TEXT NOT NULL DEFAULT 'bajo'
                   CHECK (nivel IN ('bajo', 'medio', 'critico')),
    comentario     TEXT,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Evidencias de limpieza (foto posterior al recojo)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidencias_limpieza (
    id                      BIGSERIAL PRIMARY KEY,
    zona_id                 BIGINT NOT NULL REFERENCES zonas_reporte(id) ON DELETE CASCADE,
    camion_id               BIGINT REFERENCES camiones(id) ON DELETE SET NULL,
    conductor_id            BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    foto_evidencia_url      TEXT,
    volumen_restante_litros DOUBLE PRECISION NOT NULL DEFAULT 0
                            CHECK (volumen_restante_litros >= 0),
    observacion             TEXT,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Rutas y paradas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rutas (
    id                    BIGSERIAL PRIMARY KEY,
    camion_id             BIGINT NOT NULL REFERENCES camiones(id) ON DELETE CASCADE,
    estado                TEXT NOT NULL DEFAULT 'activa'
                          CHECK (estado IN ('activa', 'completada', 'reemplazada')),
    distancia_total_metros DOUBLE PRECISION NOT NULL DEFAULT 0,
    volumen_total_litros   DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Geometría real de las calles (OSRM/OpenStreetMap): [[lat,lng], ...].
    geometria              JSONB,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ruta_paradas (
    id              BIGSERIAL PRIMARY KEY,
    ruta_id         BIGINT NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
    zona_id         BIGINT NOT NULL REFERENCES zonas_reporte(id) ON DELETE CASCADE,
    orden           INTEGER NOT NULL CHECK (orden > 0),
    estado_parada   TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado_parada IN ('pendiente', 'completada')),
    distancia_metros DOUBLE PRECISION NOT NULL DEFAULT 0,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ruta_id, orden),
    UNIQUE (ruta_id, zona_id)
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_usuarios_rol            ON usuarios (rol);
CREATE INDEX IF NOT EXISTS idx_camiones_estado         ON camiones (estado);
CREATE INDEX IF NOT EXISTS idx_zonas_ubicacion         ON zonas_reporte USING GIST (ubicacion);
CREATE INDEX IF NOT EXISTS idx_zonas_estado            ON zonas_reporte (estado);
CREATE INDEX IF NOT EXISTS idx_zonas_creado            ON zonas_reporte (creado_en);
CREATE INDEX IF NOT EXISTS idx_reportes_zona           ON reportes_ciudadanos (zona_id);
CREATE INDEX IF NOT EXISTS idx_reportes_creado         ON reportes_ciudadanos (creado_en);
CREATE INDEX IF NOT EXISTS idx_evidencias_zona         ON evidencias_limpieza (zona_id);
CREATE INDEX IF NOT EXISTS idx_evidencias_creado       ON evidencias_limpieza (creado_en);
CREATE INDEX IF NOT EXISTS idx_rutas_camion            ON rutas (camion_id);
CREATE INDEX IF NOT EXISTS idx_rutas_estado            ON rutas (estado);
CREATE INDEX IF NOT EXISTS idx_ruta_paradas_ruta       ON ruta_paradas (ruta_id, orden);
CREATE INDEX IF NOT EXISTS idx_ruta_paradas_zona       ON ruta_paradas (zona_id);

-- =============================================================================
-- Datos semilla
-- Coordenadas de referencia:
--   Centro de Juliaca ................ -15.4941, -70.1356
--   Depósito Las Casuarinas .......... -15.4803, -70.1436
--   Descarga / relleno Huanuyo ....... -15.5680, -70.3150
-- =============================================================================
DO $$
DECLARE
    v_admin        BIGINT;
    v_ciudadano    BIGINT;
    v_conductor1   BIGINT;
    v_conductor2   BIGINT;
    v_conductor3   BIGINT;
    v_camion1      BIGINT;
    v_camion2      BIGINT;
    v_camion3      BIGINT;
    v_camion4      BIGINT;
    v_zona         BIGINT;
BEGIN
    -- Idempotencia: si ya hay reportes, no volver a sembrar.
    IF EXISTS (SELECT 1 FROM reportes_ciudadanos) THEN
        RETURN;
    END IF;

    -- -------------------------------------------------------------------------
    -- Usuarios: 1 admin, 3 conductores/recolectores y 1 ciudadano de ejemplo
    -- -------------------------------------------------------------------------
    INSERT INTO usuarios (nombre, email, rol)
    VALUES ('Rosa Quispe Mamani', 'admin@juliacalimpia.gob.pe', 'admin')
    ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol
    RETURNING id INTO v_admin;

    INSERT INTO usuarios (nombre, email, rol)
    VALUES ('Lucía Ticona Flores', 'lucia.ticona@example.com', 'ciudadano')
    ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol
    RETURNING id INTO v_ciudadano;

    INSERT INTO usuarios (nombre, email, rol)
    VALUES ('Julio César Apaza', 'julio.apaza@juliacalimpia.gob.pe', 'recolector')
    ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol
    RETURNING id INTO v_conductor1;

    INSERT INTO usuarios (nombre, email, rol)
    VALUES ('María Elena Choque', 'maria.choque@juliacalimpia.gob.pe', 'recolector')
    ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol
    RETURNING id INTO v_conductor2;

    INSERT INTO usuarios (nombre, email, rol)
    VALUES ('Víctor Raúl Condori', 'victor.condori@juliacalimpia.gob.pe', 'recolector')
    ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol
    RETURNING id INTO v_conductor3;

    -- -------------------------------------------------------------------------
    -- 4 camiones compactadores en el Depósito Municipal Las Casuarinas
    -- -------------------------------------------------------------------------
    INSERT INTO camiones (placa, codigo_unidad, capacidad_litros, carga_actual_litros,
                          estado, ubicacion_actual, rumbo_grados, velocidad_kmh)
    VALUES ('V1A-812', 'COMP-01', 45000, 0, 'operativo',
            ST_SetSRID(ST_MakePoint(-70.1436, -15.4803), 4326), 45, 0)
    RETURNING id INTO v_camion1;

    INSERT INTO camiones (placa, codigo_unidad, capacidad_litros, carga_actual_litros,
                          estado, ubicacion_actual, rumbo_grados, velocidad_kmh)
    VALUES ('V1B-347', 'COMP-02', 60000, 0, 'operativo',
            ST_SetSRID(ST_MakePoint(-70.1436, -15.4803), 4326), 90, 0)
    RETURNING id INTO v_camion2;

    INSERT INTO camiones (placa, codigo_unidad, capacidad_litros, carga_actual_litros,
                          estado, ubicacion_actual, rumbo_grados, velocidad_kmh)
    VALUES ('V1C-569', 'COMP-03', 45000, 0, 'operativo',
            ST_SetSRID(ST_MakePoint(-70.1436, -15.4803), 4326), 135, 0)
    RETURNING id INTO v_camion3;

    INSERT INTO camiones (placa, codigo_unidad, capacidad_litros, carga_actual_litros,
                          estado, ubicacion_actual, rumbo_grados, velocidad_kmh)
    VALUES ('V1D-903', 'COMP-04', 60000, 0, 'operativo',
            ST_SetSRID(ST_MakePoint(-70.1436, -15.4803), 4326), 180, 0)
    RETURNING id INTO v_camion4;

    -- =========================================================================
    -- ZONA 1 · Plaza de Armas de Juliaca — tratada hace ~9 meses
    -- =========================================================================
    INSERT INTO zonas_reporte (ubicacion, direccion_referencia, volumen_estimado_litros,
                               nivel, estado, total_reportes, creado_en, tratado_en)
    VALUES (ST_SetSRID(ST_MakePoint(-70.1333, -15.4991), 4326),
            'Plaza de Armas de Juliaca, Jr. Lima cdra. 1',
            350, 'critico', 'tratado', 2,
            now() - interval '10 months',
            now() - interval '9 months 20 days')
    RETURNING id INTO v_zona;

    INSERT INTO reportes_ciudadanos (zona_id, usuario_id, foto_url, volumen_litros,
                                     nivel, comentario, creado_en)
    VALUES
        (v_zona, v_ciudadano, NULL, 170, 'medio',
         'Acumulación de bolsas frente al portal municipal.', now() - interval '10 months'),
        (v_zona, v_admin, NULL, 180, 'medio',
         'Los comerciantes dejaron cajas y restos orgánicos en la esquina.',
         now() - interval '9 months 25 days');

    INSERT INTO evidencias_limpieza (zona_id, camion_id, conductor_id, foto_evidencia_url,
                                     volumen_restante_litros, observacion, creado_en)
    VALUES (v_zona, v_camion1, v_conductor1, NULL, 20,
            'Recojo completo en turno nocturno; área barrida y desinfectada.',
            now() - interval '9 months 20 days');

    -- =========================================================================
    -- ZONA 2 · Mercado Pedro Vilcapaza — pendiente (reportes recientes)
    -- =========================================================================
    INSERT INTO zonas_reporte (ubicacion, direccion_referencia, volumen_estimado_litros,
                               nivel, estado, total_reportes, creado_en, tratado_en)
    VALUES (ST_SetSRID(ST_MakePoint(-70.1362, -15.4972), 4326),
            'Mercado Pedro Vilcapaza, Jr. Tumbes',
            500, 'critico', 'pendiente', 2,
            now() - interval '25 days', NULL)
    RETURNING id INTO v_zona;

    INSERT INTO reportes_ciudadanos (zona_id, usuario_id, foto_url, volumen_litros,
                                     nivel, comentario, creado_en)
    VALUES
        (v_zona, v_ciudadano, NULL, 240, 'critico',
         'Basura acumulada junto al contenedor del mercado, ya hay malos olores.',
         now() - interval '25 days'),
        (v_zona, v_admin, NULL, 260, 'critico',
         'Se suman restos de verduras y cajas; ocupa media vía.', now() - interval '2 days');

    -- =========================================================================
    -- ZONA 3 · Av. Ferial — tratada esta semana (dato reciente para el panel)
    -- =========================================================================
    INSERT INTO zonas_reporte (ubicacion, direccion_referencia, volumen_estimado_litros,
                               nivel, estado, total_reportes, creado_en, tratado_en)
    VALUES (ST_SetSRID(ST_MakePoint(-70.1260, -15.4910), 4326),
            'Av. Ferial, frente al campo ferial',
            200, 'medio', 'tratado', 2,
            now() - interval '5 days',
            now() - interval '1 day')
    RETURNING id INTO v_zona;

    INSERT INTO reportes_ciudadanos (zona_id, usuario_id, foto_url, volumen_litros,
                                     nivel, comentario, creado_en)
    VALUES
        (v_zona, v_ciudadano, NULL, 90, 'bajo',
         'Residuos de la feria sabatina en la berma.', now() - interval '5 days'),
        (v_zona, v_admin, NULL, 110, 'bajo',
         'Se acumulan más bolsas y envases plásticos.', now() - interval '4 days');

    INSERT INTO evidencias_limpieza (zona_id, camion_id, conductor_id, foto_evidencia_url,
                                     volumen_restante_litros, observacion, creado_en)
    VALUES (v_zona, v_camion2, v_conductor2, NULL, 15,
            'Retiro con compactador COMP-02; quedó libre la berma.',
            now() - interval '1 day');

    -- =========================================================================
    -- ZONA 4 · Laguna Temporal — pendiente (backlog de ~5 meses)
    -- =========================================================================
    INSERT INTO zonas_reporte (ubicacion, direccion_referencia, volumen_estimado_litros,
                               nivel, estado, total_reportes, creado_en, tratado_en)
    VALUES (ST_SetSRID(ST_MakePoint(-70.1290, -15.5120), 4326),
            'Laguna Temporal, margen del Jr. Loreto',
            270, 'medio', 'pendiente', 2,
            now() - interval '185 days', NULL)
    RETURNING id INTO v_zona;

    INSERT INTO reportes_ciudadanos (zona_id, usuario_id, foto_url, volumen_litros,
                                     nivel, comentario, creado_en)
    VALUES
        (v_zona, v_ciudadano, NULL, 130, 'bajo',
         'Desechos arrojados en la ribera de la laguna.', now() - interval '185 days'),
        (v_zona, v_ciudadano, NULL, 140, 'bajo',
         'El punto sigue sin atención; se acumula plástico.', now() - interval '150 days');

    -- =========================================================================
    -- ZONA 5 · Salida a Cusco — tratada hace ~5 meses
    -- =========================================================================
    INSERT INTO zonas_reporte (ubicacion, direccion_referencia, volumen_estimado_litros,
                               nivel, estado, total_reportes, creado_en, tratado_en)
    VALUES (ST_SetSRID(ST_MakePoint(-70.1150, -15.4700), 4326),
            'Carretera Juliaca–Cusco, km 3, sector Salida a Cusco',
            125, 'bajo', 'tratado', 2,
            now() - interval '160 days',
            now() - interval '147 days')
    RETURNING id INTO v_zona;

    INSERT INTO reportes_ciudadanos (zona_id, usuario_id, foto_url, volumen_litros,
                                     nivel, comentario, creado_en)
    VALUES
        (v_zona, v_ciudadano, NULL, 60, 'bajo',
         'Bolsas y escombros en la cuneta de la carretera.', now() - interval '160 days'),
        (v_zona, v_ciudadano, NULL, 65, 'bajo',
         'Se repite el arrojo de residuos de construcción.', now() - interval '148 days');

    INSERT INTO evidencias_limpieza (zona_id, camion_id, conductor_id, foto_evidencia_url,
                                     volumen_restante_litros, observacion, creado_en)
    VALUES (v_zona, v_camion3, v_conductor3, NULL, 10,
            'Limpieza de cuneta y retiro de escombros menores.',
            now() - interval '147 days');

    -- =========================================================================
    -- ZONA 6 · Salida a Puno — pendiente (backlog de ~8 meses)
    -- =========================================================================
    INSERT INTO zonas_reporte (ubicacion, direccion_referencia, volumen_estimado_litros,
                               nivel, estado, total_reportes, creado_en, tratado_en)
    VALUES (ST_SetSRID(ST_MakePoint(-70.1550, -15.5350), 4326),
            'Carretera Juliaca–Puno, km 4, sector Salida a Puno',
            100, 'bajo', 'pendiente', 2,
            now() - interval '245 days', NULL)
    RETURNING id INTO v_zona;

    INSERT INTO reportes_ciudadanos (zona_id, usuario_id, foto_url, volumen_litros,
                                     nivel, comentario, creado_en)
    VALUES
        (v_zona, v_ciudadano, NULL, 45, 'bajo',
         'Residuos dispersos junto al paradero de buses.', now() - interval '245 days'),
        (v_zona, v_ciudadano, NULL, 55, 'bajo',
         'Continúa el arrojo de basura en el borde de la pista.',
         now() - interval '225 days');
END $$;
