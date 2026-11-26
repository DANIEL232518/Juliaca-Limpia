package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/juliacalimpia/api/internal/ml"
	"github.com/juliacalimpia/api/internal/models"
)

var (
	ErrNotFound       = errors.New("recurso no encontrado")
	ErrAlreadyTreated = errors.New("la zona ya fue tratada")
)

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

func (r *Repo) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

func (r *Repo) Close() {
	r.pool.Close()
}

type rowScanner interface {
	Scan(dest ...any) error
}

const zoneColumns = `id, ST_Y(ubicacion), ST_X(ubicacion),
	COALESCE(direccion_referencia, ''), volumen_estimado_litros, nivel, estado,
	total_reportes, creado_en, tratado_en`

func scanZona(row rowScanner) (models.Zona, error) {
	var zona models.Zona
	err := row.Scan(
		&zona.ID, &zona.Lat, &zona.Lng, &zona.DireccionReferencia,
		&zona.VolumenEstimadoLitros, &zona.Nivel, &zona.Estado,
		&zona.TotalReportes, &zona.CreadoEn, &zona.TratadoEn,
	)
	return zona, err
}

// CrearReporte agrupa el reporte en una zona abierta a menos de 20 m o crea una
// nueva. El advisory lock serializa la creación para evitar zonas duplicadas.
func (r *Repo) CrearReporte(
	ctx context.Context,
	in models.CrearReporteInput,
) (models.Zona, models.Reporte, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return models.Zona{}, models.Reporte{}, false, fmt.Errorf("iniciar transacción: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('juliaca_limpa_zonas'))`); err != nil {
		return models.Zona{}, models.Reporte{}, false, fmt.Errorf("advisory lock: %w", err)
	}

	nivelReporte := models.NivelPorVolumen(in.Volumen)

	var (
		zonaID      int64
		volumenBase float64
		nueva       bool
	)

	err = tx.QueryRow(ctx, `
		SELECT id, volumen_estimado_litros
		FROM zonas_reporte
		WHERE estado <> 'tratado'
		  AND ST_DWithin(
		        ubicacion::geography,
		        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
		        $3
		      )
		ORDER BY ST_Distance(
		           ubicacion::geography,
		           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
		         ), id
		LIMIT 1
		FOR UPDATE`,
		in.Lng, in.Lat, models.RadioAgrupacionM,
	).Scan(&zonaID, &volumenBase)

	var zona models.Zona
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		nueva = true
		zona, err = scanZona(tx.QueryRow(ctx, `
			INSERT INTO zonas_reporte (
				ubicacion, direccion_referencia, volumen_estimado_litros,
				nivel, estado, total_reportes, creado_en
			) VALUES (
				ST_SetSRID(ST_MakePoint($1, $2), 4326),
				NULLIF($3::text, ''), $4, $5, 'pendiente', 1, now()
			)
			RETURNING `+zoneColumns,
			in.Lng, in.Lat, in.Direccion, in.Volumen, nivelReporte,
		))
	case err != nil:
		return models.Zona{}, models.Reporte{}, false, fmt.Errorf("buscar zona cercana: %w", err)
	default:
		nuevoVolumen := volumenBase + in.Volumen
		nivelZona := models.NivelPorVolumen(nuevoVolumen)
		zona, err = scanZona(tx.QueryRow(ctx, `
			UPDATE zonas_reporte
			SET volumen_estimado_litros = $1,
			    nivel = $2,
			    total_reportes = total_reportes + 1
			WHERE id = $3
			RETURNING `+zoneColumns,
			nuevoVolumen, nivelZona, zonaID,
		))
	}
	if err != nil {
		return models.Zona{}, models.Reporte{}, false, fmt.Errorf("guardar zona: %w", err)
	}

	var reporte models.Reporte
	err = tx.QueryRow(ctx, `
		INSERT INTO reportes_ciudadanos (
			zona_id, usuario_id, foto_url, volumen_litros, nivel, comentario, creado_en
		) VALUES ($1, $2, NULLIF($3::text, ''), $4, $5, NULLIF($6::text, ''), now())
		RETURNING id, zona_id, usuario_id, foto_url, volumen_litros, nivel, comentario, creado_en`,
		zona.ID, in.UsuarioID, in.FotoURL, in.Volumen, nivelReporte, in.Comentario,
	).Scan(
		&reporte.ID, &reporte.ZonaID, &reporte.UsuarioID, &reporte.FotoURL,
		&reporte.VolumenLitros, &reporte.Nivel, &reporte.Comentario, &reporte.CreadoEn,
	)
	if err != nil {
		return models.Zona{}, models.Reporte{}, false, fmt.Errorf("guardar reporte: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return models.Zona{}, models.Reporte{}, false, fmt.Errorf("commit reporte: %w", err)
	}
	return zona, reporte, nueva, nil
}

func (r *Repo) ListMapa(ctx context.Context) (models.MapaEstado, error) {
	mapa := models.MapaEstado{
		Centro:   models.Punto{Lat: models.CentroJuliacaLat, Lng: models.CentroJuliacaLng},
		Zonas:    make([]models.Zona, 0),
		Camiones: make([]models.Camion, 0),
	}

	rows, err := r.pool.Query(ctx, `
		SELECT `+zoneColumns+`
		FROM zonas_reporte
		ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'en_ruta' THEN 1 ELSE 2 END,
		         creado_en DESC`)
	if err != nil {
		return mapa, fmt.Errorf("listar zonas: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		zona, err := scanZona(rows)
		if err != nil {
			return mapa, fmt.Errorf("leer zona: %w", err)
		}
		mapa.Zonas = append(mapa.Zonas, zona)
	}
	if err := rows.Err(); err != nil {
		return mapa, fmt.Errorf("recorrer zonas: %w", err)
	}

	camiones, err := r.ListCamiones(ctx)
	if err != nil {
		return mapa, err
	}
	mapa.Camiones = camiones
	return mapa, nil
}

func (r *Repo) ListZonas(ctx context.Context, estado string) ([]models.Zona, error) {
	query := `SELECT ` + zoneColumns + ` FROM zonas_reporte`
	args := make([]any, 0, 1)
	if estado != "" {
		query += ` WHERE estado = $1`
		args = append(args, estado)
	}
	query += ` ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'en_ruta' THEN 1 ELSE 2 END,
	           creado_en DESC`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listar zonas: %w", err)
	}
	defer rows.Close()

	zonas := make([]models.Zona, 0)
	for rows.Next() {
		zona, err := scanZona(rows)
		if err != nil {
			return nil, fmt.Errorf("leer zona: %w", err)
		}
		zonas = append(zonas, zona)
	}
	return zonas, rows.Err()
}

func (r *Repo) ListCamiones(ctx context.Context) ([]models.Camion, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, placa, codigo_unidad, capacidad_litros, carga_actual_litros,
		       estado, ST_Y(ubicacion_actual), ST_X(ubicacion_actual),
		       rumbo_grados, velocidad_kmh, actualizado_en
		FROM camiones
		ORDER BY codigo_unidad`)
	if err != nil {
		return nil, fmt.Errorf("listar camiones: %w", err)
	}
	defer rows.Close()

	camiones := make([]models.Camion, 0)
	for rows.Next() {
		var camion models.Camion
		if err := rows.Scan(
			&camion.ID, &camion.Placa, &camion.CodigoUnidad, &camion.CapacidadLitros,
			&camion.CargaActualLitros, &camion.Estado, &camion.Lat, &camion.Lng,
			&camion.RumboGrados, &camion.VelocidadKmh, &camion.ActualizadoEn,
		); err != nil {
			return nil, fmt.Errorf("leer camión: %w", err)
		}
		camiones = append(camiones, camion)
	}
	return camiones, rows.Err()
}

// ActualizarPosicionCamion mueve la compactadora en el mapa durante la
// simulación de flota y deja la marca de tiempo del último reporte GPS.
func (r *Repo) ActualizarPosicionCamion(
	ctx context.Context,
	id int64,
	lat, lng, rumbo, velocidad float64,
) error {
	if _, err := r.pool.Exec(ctx, `
		UPDATE camiones
		SET ubicacion_actual = ST_SetSRID(ST_MakePoint($2, $3), 4326),
		    rumbo_grados = $4,
		    velocidad_kmh = $5,
		    actualizado_en = now()
		WHERE id = $1`, id, lng, lat, rumbo, velocidad); err != nil {
		return fmt.Errorf("actualizar posición del camión %d: %w", id, err)
	}
	return nil
}

func (r *Repo) ListZonasPendientes(ctx context.Context, ids []int64) ([]models.Zona, error) {
	query := `SELECT ` + zoneColumns + ` FROM zonas_reporte WHERE estado = 'pendiente'`
	args := make([]any, 0, 1)
	if len(ids) > 0 {
		query += ` AND id = ANY($1)`
		args = append(args, ids)
	}
	query += ` ORDER BY CASE nivel WHEN 'critico' THEN 0 WHEN 'medio' THEN 1 ELSE 2 END,
	           creado_en ASC`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listar zonas pendientes: %w", err)
	}
	defer rows.Close()

	zonas := make([]models.Zona, 0)
	for rows.Next() {
		zona, err := scanZona(rows)
		if err != nil {
			return nil, fmt.Errorf("leer zona pendiente: %w", err)
		}
		zonas = append(zonas, zona)
	}
	return zonas, rows.Err()
}

func (r *Repo) ListCamionesParaRuta(ctx context.Context, ids []int64) ([]models.Camion, error) {
	query := `
		SELECT id, placa, codigo_unidad, capacidad_litros, carga_actual_litros,
		       estado, ST_Y(ubicacion_actual), ST_X(ubicacion_actual),
		       rumbo_grados, velocidad_kmh, actualizado_en
		FROM camiones
		WHERE estado IN ('operativo', 'en_ruta')`
	args := make([]any, 0, 1)
	if len(ids) > 0 {
		query += ` AND id = ANY($1)`
		args = append(args, ids)
	}
	query += ` ORDER BY codigo_unidad`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listar camiones disponibles: %w", err)
	}
	defer rows.Close()

	camiones := make([]models.Camion, 0)
	for rows.Next() {
		var camion models.Camion
		if err := rows.Scan(
			&camion.ID, &camion.Placa, &camion.CodigoUnidad, &camion.CapacidadLitros,
			&camion.CargaActualLitros, &camion.Estado, &camion.Lat, &camion.Lng,
			&camion.RumboGrados, &camion.VelocidadKmh, &camion.ActualizadoEn,
		); err != nil {
			return nil, fmt.Errorf("leer camión disponible: %w", err)
		}
		camiones = append(camiones, camion)
	}
	return camiones, rows.Err()
}

// GuardarRutas reemplaza las rutas activas de los camiones involucrados y
// persiste las paradas calculadas por ml-service. `geometria` guarda la traza
// de calles (OSRM) por camión; si falta para un camión, su ruta queda sin
// geometría (línea recta como respaldo).
func (r *Repo) GuardarRutas(
	ctx context.Context,
	plan *ml.OptimizeResponse,
	geometria map[int64][]models.Punto,
) ([]models.Ruta, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("iniciar transacción de rutas: %w", err)
	}
	defer tx.Rollback(ctx)

	camionIDs := make([]int64, 0, len(plan.Rutas))
	for _, ruta := range plan.Rutas {
		if len(ruta.Paradas) > 0 {
			camionIDs = append(camionIDs, ruta.CamionID)
		}
	}

	if len(camionIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE rutas SET estado = 'reemplazada'
			WHERE camion_id = ANY($1) AND estado = 'activa'`, camionIDs); err != nil {
			return nil, fmt.Errorf("reemplazar rutas anteriores: %w", err)
		}
	}

	for _, rutaPlan := range plan.Rutas {
		if len(rutaPlan.Paradas) == 0 {
			continue
		}

		var rutaID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO rutas (camion_id, estado, distancia_total_metros, volumen_total_litros, geometria)
			VALUES ($1, 'activa', $2, $3, $4)
			RETURNING id`,
			rutaPlan.CamionID, rutaPlan.DistanciaTotalMetros, rutaPlan.VolumenTotalLitros,
			geometriaJSON(geometria[rutaPlan.CamionID]),
		).Scan(&rutaID); err != nil {
			return nil, fmt.Errorf("crear ruta del camión %d: %w", rutaPlan.CamionID, err)
		}

		for _, parada := range rutaPlan.Paradas {
			if _, err := tx.Exec(ctx, `
				INSERT INTO ruta_paradas (ruta_id, zona_id, orden, estado_parada, distancia_metros)
				VALUES ($1, $2, $3, 'pendiente', $4)`,
				rutaID, parada.ZonaID, parada.Orden, parada.DistanciaMetros,
			); err != nil {
				return nil, fmt.Errorf("crear parada de la ruta %d: %w", rutaID, err)
			}
			if _, err := tx.Exec(ctx, `
				UPDATE zonas_reporte SET estado = 'en_ruta'
				WHERE id = $1 AND estado = 'pendiente'`, parada.ZonaID); err != nil {
				return nil, fmt.Errorf("marcar zona %d en ruta: %w", parada.ZonaID, err)
			}
		}

		if _, err := tx.Exec(ctx, `
			UPDATE camiones SET estado = 'en_ruta', actualizado_en = now()
			WHERE id = $1`, rutaPlan.CamionID); err != nil {
			return nil, fmt.Errorf("marcar camión %d en ruta: %w", rutaPlan.CamionID, err)
		}
	}

	// Si una zona quedó en ruta pero su ruta fue reemplazada y no está en la
	// nueva planificación, vuelve a estar pendiente.
	if len(camionIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE zonas_reporte z SET estado = 'pendiente'
			WHERE z.estado = 'en_ruta'
			  AND EXISTS (
			      SELECT 1 FROM ruta_paradas rp
			      JOIN rutas r ON r.id = rp.ruta_id
			      WHERE rp.zona_id = z.id AND r.camion_id = ANY($1)
			        AND r.estado = 'reemplazada'
			  )
			  AND NOT EXISTS (
			      SELECT 1 FROM ruta_paradas rp
			      JOIN rutas r ON r.id = rp.ruta_id
			      WHERE rp.zona_id = z.id AND r.estado = 'activa'
			  )`, camionIDs); err != nil {
			return nil, fmt.Errorf("liberar zonas sin ruta: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit de rutas: %w", err)
	}

	return r.ListRutasActivas(ctx)
}

// geometriaJSON serializa la traza de calles como JSONB; devuelve nil (NULL)
// cuando no hay geometría, para que la ruta se dibuje en línea recta.
func geometriaJSON(puntos []models.Punto) []byte {
	if len(puntos) == 0 {
		return nil
	}
	datos, err := json.Marshal(puntos)
	if err != nil {
		return nil
	}
	return datos
}

// deserializarGeometria lee la traza de calles guardada en la columna JSONB.
func deserializarGeometria(crudo []byte) []models.Punto {
	if len(crudo) == 0 {
		return nil
	}
	var puntos []models.Punto
	if err := json.Unmarshal(crudo, &puntos); err != nil || len(puntos) < 2 {
		return nil
	}
	return puntos
}

func (r *Repo) ListRutasActivas(ctx context.Context) ([]models.Ruta, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT r.id, r.camion_id, c.codigo_unidad, r.estado,
		       r.distancia_total_metros, r.volumen_total_litros, r.creado_en,
		       r.geometria,
		       rp.id, rp.zona_id, rp.orden, rp.estado_parada, rp.distancia_metros,
		       z.direccion_referencia, ST_Y(z.ubicacion), ST_X(z.ubicacion),
		       z.volumen_estimado_litros, z.nivel
		FROM rutas r
		JOIN camiones c ON c.id = r.camion_id
		LEFT JOIN ruta_paradas rp ON rp.ruta_id = r.id
		LEFT JOIN zonas_reporte z ON z.id = rp.zona_id
		WHERE r.estado = 'activa'
		ORDER BY r.camion_id, rp.orden`)
	if err != nil {
		return nil, fmt.Errorf("listar rutas activas: %w", err)
	}
	defer rows.Close()

	rutas := make([]models.Ruta, 0)
	indices := make(map[int64]int)

	for rows.Next() {
		var (
			rutaID       int64
			camionID     int64
			codigoUnidad string
			estado       string
			distancia    float64
			volumen      float64
			creadoEn     time.Time
			geometriaRaw []byte
			paradaID     *int64
			zonaID       *int64
			orden        *int
			estadoParada *string
			distanciaPar *float64
			direccion    *string
			lat          *float64
			lng          *float64
			volumenZona  *float64
			nivelZona    *string
		)
		if err := rows.Scan(
			&rutaID, &camionID, &codigoUnidad, &estado, &distancia, &volumen, &creadoEn,
			&geometriaRaw,
			&paradaID, &zonaID, &orden, &estadoParada, &distanciaPar,
			&direccion, &lat, &lng, &volumenZona, &nivelZona,
		); err != nil {
			return nil, fmt.Errorf("leer ruta activa: %w", err)
		}

		indice, existe := indices[rutaID]
		if !existe {
			rutas = append(rutas, models.Ruta{
				ID:                   rutaID,
				CamionID:             camionID,
				CodigoUnidad:         codigoUnidad,
				Estado:               estado,
				DistanciaTotalMetros: distancia,
				VolumenTotalLitros:   volumen,
				CreadoEn:             creadoEn,
				Geometria:            deserializarGeometria(geometriaRaw),
				Paradas:              make([]models.Parada, 0),
			})
			indice = len(rutas) - 1
			indices[rutaID] = indice
		}

		if paradaID != nil && zonaID != nil {
			parada := models.Parada{
				ID:           *paradaID,
				ZonaID:       *zonaID,
				EstadoParada: stringOr(estadoParada, "pendiente"),
			}
			if orden != nil {
				parada.Orden = *orden
			}
			if distanciaPar != nil {
				parada.DistanciaMetros = *distanciaPar
			}
			if direccion != nil {
				parada.DireccionReferencia = *direccion
			}
			if lat != nil {
				parada.Lat = *lat
			}
			if lng != nil {
				parada.Lng = *lng
			}
			if volumenZona != nil {
				parada.VolumenEstimadoLitros = *volumenZona
			}
			parada.Nivel = stringOr(nivelZona, "bajo")
			rutas[indice].Paradas = append(rutas[indice].Paradas, parada)
		}
	}
	return rutas, rows.Err()
}

// ObtenerZonaDetalle devuelve la zona, sus reportes y la evidencia más reciente
// para el popup del mapa (foto denunciada y foto de limpieza).
func (r *Repo) ObtenerZonaDetalle(ctx context.Context, id int64) (models.ZonaDetalle, error) {
	detalle := models.ZonaDetalle{
		Reportes: make([]models.ReporteResumen, 0),
	}

	zona, err := scanZona(r.pool.QueryRow(ctx, `
		SELECT `+zoneColumns+` FROM zonas_reporte WHERE id = $1`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return detalle, ErrNotFound
		}
		return detalle, fmt.Errorf("buscar zona %d: %w", id, err)
	}
	detalle.Zona = zona

	rows, err := r.pool.Query(ctx, `
		SELECT id, foto_url, volumen_litros, nivel, comentario, creado_en
		FROM reportes_ciudadanos
		WHERE zona_id = $1
		ORDER BY creado_en DESC`, id)
	if err != nil {
		return detalle, fmt.Errorf("listar reportes de la zona %d: %w", id, err)
	}
	defer rows.Close()
	for rows.Next() {
		var reporte models.ReporteResumen
		if err := rows.Scan(
			&reporte.ID, &reporte.FotoURL, &reporte.VolumenLitros,
			&reporte.Nivel, &reporte.Comentario, &reporte.CreadoEn,
		); err != nil {
			return detalle, fmt.Errorf("leer reporte de la zona %d: %w", id, err)
		}
		detalle.Reportes = append(detalle.Reportes, reporte)
	}
	if err := rows.Err(); err != nil {
		return detalle, fmt.Errorf("recorrer reportes de la zona %d: %w", id, err)
	}

	var evidencia models.Evidencia
	err = r.pool.QueryRow(ctx, `
		SELECT id, zona_id, camion_id, conductor_id, foto_evidencia_url,
		       volumen_restante_litros, observacion, creado_en
		FROM evidencias_limpieza
		WHERE zona_id = $1
		ORDER BY creado_en DESC
		LIMIT 1`, id).Scan(
		&evidencia.ID, &evidencia.ZonaID, &evidencia.CamionID, &evidencia.ConductorID,
		&evidencia.FotoEvidenciaURL, &evidencia.VolumenRestanteLitros,
		&evidencia.Observacion, &evidencia.CreadoEn,
	)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		detalle.Evidencia = nil
	case err != nil:
		return detalle, fmt.Errorf("buscar evidencia de la zona %d: %w", id, err)
	default:
		detalle.Evidencia = &evidencia
	}

	return detalle, nil
}

// ListarReportesUsuario devuelve los reportes de un ciudadano con el estado de
// su zona y la evidencia de limpieza más reciente.
func (r *Repo) ListarReportesUsuario(ctx context.Context, usuarioID int64) ([]models.ReporteUsuario, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT r.id, r.zona_id, r.foto_url, r.volumen_litros, r.nivel,
		       r.comentario, r.creado_en,
		       z.estado, z.direccion_referencia, z.nivel,
		       ST_Y(z.ubicacion), ST_X(z.ubicacion),
		       z.volumen_estimado_litros, z.total_reportes, z.tratado_en,
		       e.foto_evidencia_url, e.creado_en
		FROM reportes_ciudadanos r
		JOIN zonas_reporte z ON z.id = r.zona_id
		LEFT JOIN LATERAL (
			SELECT foto_evidencia_url, creado_en
			FROM evidencias_limpieza
			WHERE zona_id = z.id
			ORDER BY creado_en DESC
			LIMIT 1
		) e ON true
		WHERE r.usuario_id = $1
		ORDER BY r.creado_en DESC
		LIMIT 100`, usuarioID)
	if err != nil {
		return nil, fmt.Errorf("listar reportes del usuario %d: %w", usuarioID, err)
	}
	defer rows.Close()

	reportes := make([]models.ReporteUsuario, 0)
	for rows.Next() {
		var reporte models.ReporteUsuario
		if err := rows.Scan(
			&reporte.ID, &reporte.ZonaID, &reporte.FotoURL, &reporte.VolumenLitros,
			&reporte.Nivel, &reporte.Comentario, &reporte.CreadoEn,
			&reporte.ZonaEstado, &reporte.ZonaDireccion, &reporte.ZonaNivel,
			&reporte.ZonaLat, &reporte.ZonaLng, &reporte.ZonaVolumenEstimadoLitros,
			&reporte.ZonaTotalReportes, &reporte.TratadoEn,
			&reporte.EvidenciaFotoURL, &reporte.EvidenciaCreadoEn,
		); err != nil {
			return nil, fmt.Errorf("leer reporte del usuario %d: %w", usuarioID, err)
		}
		reportes = append(reportes, reporte)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("recorrer reportes del usuario %d: %w", usuarioID, err)
	}
	return reportes, nil
}

func (r *Repo) TratarZona(
	ctx context.Context,
	in models.TratarZonaInput,
) (models.Zona, models.Evidencia, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("iniciar transacción: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		estadoActual string
		volumenZona  float64
	)
	err = tx.QueryRow(ctx, `
		SELECT estado, volumen_estimado_litros
		FROM zonas_reporte WHERE id = $1 FOR UPDATE`, in.ZonaID,
	).Scan(&estadoActual, &volumenZona)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Zona{}, models.Evidencia{}, ErrNotFound
	}
	if err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("bloquear zona: %w", err)
	}
	if estadoActual == "tratado" {
		return models.Zona{}, models.Evidencia{}, ErrAlreadyTreated
	}

	var evidencia models.Evidencia
	err = tx.QueryRow(ctx, `
		INSERT INTO evidencias_limpieza (
			zona_id, camion_id, conductor_id, foto_evidencia_url,
			volumen_restante_litros, observacion, creado_en
		) VALUES ($1, $2, $3, NULLIF($4::text, ''), $5, NULLIF($6::text, ''), now())
		RETURNING id, zona_id, camion_id, conductor_id, foto_evidencia_url,
		          volumen_restante_litros, observacion, creado_en`,
		in.ZonaID, in.CamionID, in.ConductorID, in.FotoURL,
		in.VolumenRestanteLitros, in.Observacion,
	).Scan(
		&evidencia.ID, &evidencia.ZonaID, &evidencia.CamionID,
		&evidencia.ConductorID, &evidencia.FotoEvidenciaURL,
		&evidencia.VolumenRestanteLitros, &evidencia.Observacion, &evidencia.CreadoEn,
	)
	if err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("guardar evidencia: %w", err)
	}

	zona, err := scanZona(tx.QueryRow(ctx, `
		UPDATE zonas_reporte
		SET estado = 'tratado', tratado_en = now()
		WHERE id = $1
		RETURNING `+zoneColumns, in.ZonaID))
	if err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("marcar zona tratada: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE ruta_paradas SET estado_parada = 'completada'
		WHERE zona_id = $1 AND estado_parada = 'pendiente'`, in.ZonaID); err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("completar parada: %w", err)
	}

	recolectado := math.Max(volumenZona-in.VolumenRestanteLitros, 0)
	if _, err := tx.Exec(ctx, `
		UPDATE camiones
		SET carga_actual_litros = LEAST(capacidad_litros, carga_actual_litros + $1),
		    actualizado_en = now()
		WHERE id = $2`, recolectado, in.CamionID); err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("actualizar carga del camión: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE rutas SET estado = 'completada'
		WHERE id IN (SELECT ruta_id FROM ruta_paradas WHERE zona_id = $1)
		  AND estado = 'activa'
		  AND NOT EXISTS (
		      SELECT 1 FROM ruta_paradas rp
		      WHERE rp.ruta_id = rutas.id AND rp.estado_parada = 'pendiente'
		  )`, in.ZonaID); err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("cerrar ruta completada: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE camiones c SET estado = 'operativo', actualizado_en = now()
		WHERE c.id = $1
		  AND NOT EXISTS (
		      SELECT 1 FROM ruta_paradas rp
		      JOIN rutas r ON r.id = rp.ruta_id
		      WHERE r.camion_id = c.id AND r.estado = 'activa'
		        AND rp.estado_parada = 'pendiente'
		  )`, in.CamionID); err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("liberar camión: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return models.Zona{}, models.Evidencia{}, fmt.Errorf("commit tratamiento: %w", err)
	}
	return zona, evidencia, nil
}

func (r *Repo) UsuarioExiste(ctx context.Context, id int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM usuarios WHERE id = $1)`, id).Scan(&exists)
	return exists, err
}

func (r *Repo) CamionExiste(ctx context.Context, id int64) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM camiones WHERE id = $1)`, id).Scan(&exists)
	return exists, err
}

const estadisticasSQL = `
WITH params AS (
    SELECT
        CASE $1::text WHEN 'anual' THEN 'month' ELSE 'day' END AS unidad,
        CASE $1::text WHEN 'anual' THEN interval '1 month' ELSE interval '1 day' END AS paso,
        CASE $1::text WHEN 'semanal' THEN 7
                WHEN 'anual'   THEN 12
                ELSE 30 END AS n
),
periodos AS (
    SELECT gs AS inicio, gs + p.paso AS fin
    FROM params p,
         generate_series(
             date_trunc(p.unidad, now()) - (p.n - 1) * p.paso,
             date_trunc(p.unidad, now()),
             p.paso
         ) AS gs
)
SELECT
    p.inicio::date AS periodo,
    (SELECT COUNT(*)::int
       FROM reportes_ciudadanos r
      WHERE r.creado_en >= p.inicio AND r.creado_en < p.fin) AS reportes_creados,
    (SELECT COUNT(*)::int
       FROM zonas_reporte z
      WHERE z.creado_en >= p.inicio AND z.creado_en < p.fin) AS zonas_creadas,
    (SELECT COUNT(*)::int
       FROM zonas_reporte z
      WHERE z.estado = 'tratado'
        AND z.tratado_en >= p.inicio AND z.tratado_en < p.fin) AS zonas_tratadas,
    (SELECT COALESCE(SUM(z.volumen_estimado_litros), 0)::float8
       FROM zonas_reporte z
      WHERE z.estado = 'tratado'
        AND z.tratado_en >= p.inicio AND z.tratado_en < p.fin) AS litros_recolectados,
    (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (z.tratado_en - z.creado_en)) / 3600.0), 0)::float8
       FROM zonas_reporte z
      WHERE z.estado = 'tratado'
        AND z.tratado_en >= p.inicio AND z.tratado_en < p.fin) AS tiempo_promedio_horas
FROM periodos p
ORDER BY p.inicio`

const distribucionNivelesSQL = `
WITH params AS (
    SELECT
        CASE $1::text WHEN 'anual' THEN 'month' ELSE 'day' END AS unidad,
        CASE $1::text WHEN 'anual' THEN interval '1 month' ELSE interval '1 day' END AS paso,
        CASE $1::text WHEN 'semanal' THEN 7
                WHEN 'anual'   THEN 12
                ELSE 30 END AS n
),
rango AS (
    SELECT date_trunc(p.unidad, now()) - (p.n - 1) * p.paso AS inicio,
           date_trunc(p.unidad, now()) + p.paso AS fin
    FROM params p
)
SELECT
    COALESCE(SUM(CASE WHEN r.nivel = 'bajo' THEN 1 ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN r.nivel = 'medio' THEN 1 ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN r.nivel = 'critico' THEN 1 ELSE 0 END), 0)::int
FROM reportes_ciudadanos r, rango
WHERE r.creado_en >= rango.inicio AND r.creado_en < rango.fin`

func (r *Repo) Estadisticas(ctx context.Context, periodo string) (models.Estadisticas, error) {
	rows, err := r.pool.Query(ctx, estadisticasSQL, periodo)
	if err != nil {
		return models.Estadisticas{}, fmt.Errorf("consultar estadísticas: %w", err)
	}
	defer rows.Close()

	series := make([]models.PuntoSerie, 0, 30)
	for rows.Next() {
		var (
			inicio time.Time
			punto  models.PuntoSerie
		)
		if err := rows.Scan(
			&inicio, &punto.ReportesCreados, &punto.ZonasCreadas, &punto.ZonasTratadas,
			&punto.LitrosRecolectados, &punto.TiempoPromedioHoras,
		); err != nil {
			return models.Estadisticas{}, fmt.Errorf("leer estadística: %w", err)
		}
		punto.Periodo = inicio.Format("2006-01-02")
		series = append(series, punto)
	}
	if err := rows.Err(); err != nil {
		return models.Estadisticas{}, fmt.Errorf("recorrer estadísticas: %w", err)
	}

	var (
		resumen         models.ResumenEstadisticas
		horasPonderadas float64
	)
	for _, punto := range series {
		resumen.ReportesCreados += punto.ReportesCreados
		resumen.ZonasCreadas += punto.ZonasCreadas
		resumen.ZonasTratadas += punto.ZonasTratadas
		resumen.LitrosRecolectados += punto.LitrosRecolectados
		horasPonderadas += punto.TiempoPromedioHoras * float64(punto.ZonasTratadas)
	}
	if resumen.ZonasTratadas > 0 {
		resumen.TiempoPromedioHoras = redondear1(horasPonderadas / float64(resumen.ZonasTratadas))
	}
	resumen.LitrosRecolectados = redondear1(resumen.LitrosRecolectados)
	resumen.VolumenM3 = redondear1(resumen.LitrosRecolectados / 1000)
	resumen.Toneladas = redondear2(resumen.VolumenM3 * densidadJuliacaKgM3 / 1000)
	if resumen.ZonasCreadas > 0 {
		efectividad := float64(resumen.ZonasTratadas) / float64(resumen.ZonasCreadas) * 100
		resumen.EfectividadPct = redondear1(math.Min(efectividad, 100))
	}

	distribucion := models.DistribucionNiveles{}
	if err := r.pool.QueryRow(ctx, distribucionNivelesSQL, periodo).Scan(
		&distribucion.Bajo, &distribucion.Medio, &distribucion.Critico,
	); err != nil {
		return models.Estadisticas{}, fmt.Errorf("distribución de niveles: %w", err)
	}

	estadisticas := models.Estadisticas{
		Periodo:             periodo,
		Resumen:             resumen,
		Series:              series,
		DistribucionNiveles: distribucion,
	}
	if len(series) > 0 {
		estadisticas.Desde = series[0].Periodo
		estadisticas.Hasta = series[len(series)-1].Periodo
	}
	return estadisticas, nil
}

// Densidad aparente de los residuos sólidos de Juliaca (kg/m³), usada para
// expresar el volumen recolectado en toneladas estimadas.
const densidadJuliacaKgM3 = 112.66

func redondear1(valor float64) float64 {
	return math.Round(valor*10) / 10
}

func redondear2(valor float64) float64 {
	return math.Round(valor*100) / 100
}

func stringOr(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return *value
}
