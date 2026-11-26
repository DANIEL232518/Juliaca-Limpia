package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/juliacalimpia/api/internal/config"
	"github.com/juliacalimpia/api/internal/db"
	"github.com/juliacalimpia/api/internal/events"
	"github.com/juliacalimpia/api/internal/ml"
	"github.com/juliacalimpia/api/internal/models"
	"github.com/juliacalimpia/api/internal/osrm"
	"github.com/juliacalimpia/api/internal/simulator"
	"github.com/juliacalimpia/api/internal/storage"
)

type Handlers struct {
	cfg     config.Config
	repo    *db.Repo
	storage *storage.Client
	ml      *ml.Client
	hub     *events.Hub
	sim     *simulator.Simulator
	osrm    *osrm.Cliente
}

// ---------------------------------------------------------------------------
// POST /api/reportes
// ---------------------------------------------------------------------------
func (h *Handlers) CrearReporte(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "multipart_invalido",
			"No se pudo leer el formulario multipart: "+err.Error())
		return
	}

	imagen, err := readImageUpload(r, "foto", "imagen")
	if err != nil {
		writeError(w, http.StatusBadRequest, "foto_invalida", err.Error())
		return
	}

	lat, err := requiredFloat(r, "lat", "latitud")
	if err != nil {
		writeError(w, http.StatusBadRequest, "latitud_invalida", err.Error())
		return
	}
	lng, err := requiredFloat(r, "lng", "longitud")
	if err != nil {
		writeError(w, http.StatusBadRequest, "longitud_invalida", err.Error())
		return
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeError(w, http.StatusBadRequest, "coordenadas_invalidas",
			"La latitud debe estar entre -90 y 90 y la longitud entre -180 y 180.")
		return
	}
	// Geocerca: solo se aceptan reportes dentro del área de Juliaca. El punto
	// debe venir del GPS del ciudadano (no se permite marcar a mano).
	if !models.DentroDeJuliaca(lat, lng) {
		writeError(w, http.StatusBadRequest, "ubicacion_fuera_de_juliaca",
			"La ubicación debe estar dentro de Juliaca. Activa el GPS del dispositivo y vuelve a intentarlo.")
		return
	}

	direccion := firstValue(r, "direccion_referencia", "direccion")
	comentario := firstValue(r, "comentario")

	usuarioID, err := optionalInt64(r, "usuario_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "usuario_id_invalido", err.Error())
		return
	}
	if usuarioID != nil {
		existe, err := h.repo.UsuarioExiste(r.Context(), *usuarioID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "error_base_datos",
				"No se pudo validar el usuario.")
			return
		}
		if !existe {
			writeError(w, http.StatusBadRequest, "usuario_inexistente",
				"El usuario indicado no existe.")
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	analisis, err := h.ml.Analyze(ctx, imagen.Filename, imagen.Data, "reporte")
	if err != nil {
		h.respondMLError(w, err)
		return
	}

	volumen := analisis.VolumenLitros
	if override, ok, err := optionalFloat(r, "volumen_litros"); err != nil {
		writeError(w, http.StatusBadRequest, "volumen_invalido", err.Error())
		return
	} else if ok && override > 0 {
		volumen = override
	}
	volumen = clamp(volumen, 25, 600)
	nivel := models.NivelPorVolumen(volumen)

	objeto := fmt.Sprintf("reportes/%s/%s.%s",
		time.Now().Format("2006/01/02"), uuid.NewString(), imagen.Extension)
	fotoURL, err := h.storage.Upload(ctx, objeto, imagen.Data, imagen.ContentType)
	if err != nil {
		writeError(w, http.StatusBadGateway, "storage_no_disponible",
			"No se pudo guardar la fotografía del reporte.")
		return
	}

	zona, reporte, nueva, err := h.repo.CrearReporte(ctx, models.CrearReporteInput{
		Lat:        lat,
		Lng:        lng,
		Direccion:  direccion,
		Volumen:    volumen,
		Nivel:      nivel,
		FotoURL:    fotoURL,
		UsuarioID:  usuarioID,
		Comentario: comentario,
	})
	if err != nil {
		borrarObjeto(h.storage, objeto)
		log.Printf("[reportes] error al guardar: %v", err)
		writeError(w, http.StatusInternalServerError, "error_guardando_reporte",
			"No se pudo guardar el reporte.")
		return
	}

	h.hub.Publish("reporte_creado", map[string]any{
		"zona":       zona,
		"reporte":    reporte,
		"zona_nueva": nueva,
		"analisis":   analisis,
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"zona":       zona,
		"reporte":    reporte,
		"analisis":   analisis,
		"zona_nueva": nueva,
		"mensaje":    mensajeZona(nueva, zona),
	})
}

func mensajeZona(nueva bool, zona models.Zona) string {
	if nueva {
		return "Se creó una nueva zona de reporte."
	}
	return fmt.Sprintf("El reporte se agrupó con una zona existente a menos de 20 m (%d reportes).",
		zona.TotalReportes)
}

// ---------------------------------------------------------------------------
// GET /api/mapa/estado
// ---------------------------------------------------------------------------
func (h *Handlers) MapaEstado(w http.ResponseWriter, r *http.Request) {
	mapa, err := h.repo.ListMapa(r.Context())
	if err != nil {
		log.Printf("[mapa] error: %v", err)
		writeError(w, http.StatusInternalServerError, "error_mapa",
			"No se pudo obtener el estado del mapa.")
		return
	}
	writeJSON(w, http.StatusOK, mapa)
}

// ---------------------------------------------------------------------------
// POST /api/rutas/generar
// ---------------------------------------------------------------------------
func (h *Handlers) GenerarRutas(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CamionIDs []int64 `json:"camion_ids"`
		ZonaIDs   []int64 `json:"zona_ids"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if err := decoder.Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "json_invalido",
				"El cuerpo debe ser JSON válido: {\"camion_ids\": [], \"zona_ids\": []}.")
			return
		}
	}

	camiones, err := h.repo.ListCamionesParaRuta(r.Context(), body.CamionIDs)
	if err != nil {
		log.Printf("[rutas] error listando camiones: %v", err)
		writeError(w, http.StatusInternalServerError, "error_camiones",
			"No se pudieron obtener los camiones.")
		return
	}
	zonas, err := h.repo.ListZonasPendientes(r.Context(), body.ZonaIDs)
	if err != nil {
		log.Printf("[rutas] error listando zonas: %v", err)
		writeError(w, http.StatusInternalServerError, "error_zonas",
			"No se pudieron obtener las zonas pendientes.")
		return
	}
	if len(camiones) == 0 {
		writeError(w, http.StatusConflict, "sin_camiones_disponibles",
			"No hay camiones operativos o en ruta para asignar.")
		return
	}
	if len(zonas) == 0 {
		writeError(w, http.StatusConflict, "sin_zonas_pendientes",
			"No hay zonas pendientes para planificar.")
		return
	}

	payload := ml.OptimizeRequest{
		Camiones: make([]ml.CamionOptimizar, 0, len(camiones)),
		Zonas:    make([]ml.ZonaOptimizar, 0, len(zonas)),
		Deposito: ml.Punto{Lat: models.DepositoLat, Lng: models.DepositoLng},
		Descarga: ml.Punto{Lat: models.DescargaLat, Lng: models.DescargaLng},
	}
	for _, camion := range camiones {
		payload.Camiones = append(payload.Camiones, ml.CamionOptimizar{
			ID:                camion.ID,
			CodigoUnidad:      camion.CodigoUnidad,
			CapacidadLitros:   float64(camion.CapacidadLitros),
			CargaActualLitros: camion.CargaActualLitros,
			Lat:               camion.Lat,
			Lng:               camion.Lng,
		})
	}
	for _, zona := range zonas {
		payload.Zonas = append(payload.Zonas, ml.ZonaOptimizar{
			ID:                    zona.ID,
			Lat:                   zona.Lat,
			Lng:                   zona.Lng,
			VolumenEstimadoLitros: zona.VolumenEstimadoLitros,
			Nivel:                 zona.Nivel,
			DireccionReferencia:   zona.DireccionReferencia,
		})
	}

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	plan, err := h.ml.OptimizeRoutes(ctx, payload)
	if err != nil {
		h.respondMLError(w, err)
		return
	}

	// Traza de calles real (OSRM/OpenStreetMap) por camión: depósito →
	// paradas en orden → descarga → depósito. Si el servicio de calles no
	// responde, la geometría queda vacía y la ruta se conserva en línea recta.
	geometria := h.geometriaPorCamion(ctx, plan)

	rutas, err := h.repo.GuardarRutas(ctx, plan, geometria)
	if err != nil {
		log.Printf("[rutas] error guardando plan: %v", err)
		writeError(w, http.StatusInternalServerError, "error_guardando_rutas",
			"No se pudo guardar la planificación de rutas.")
		return
	}

	h.hub.Publish("rutas_generadas", map[string]any{
		"rutas":       rutas,
		"metricas":    plan.Metricas,
		"sin_asignar": plan.SinAsignar,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"rutas":       rutas,
		"metricas":    plan.Metricas,
		"sin_asignar": plan.SinAsignar,
		"mensaje":     fmt.Sprintf("Se planificaron %d rutas con %d paradas.", len(rutas), contarParadas(rutas)),
	})
}

func contarParadas(rutas []models.Ruta) int {
	total := 0
	for _, ruta := range rutas {
		total += len(ruta.Paradas)
	}
	return total
}

// geometriaPorCamion calcula con OSRM la traza de calles de cada ruta
// (depósito → paradas ordenadas → descarga → depósito) y la indexa por
// camión. Solo se guardan las rutas con geometría; las demás quedan sin
// traza y se dibujarán en línea recta como respaldo.
func (h *Handlers) geometriaPorCamion(ctx context.Context, plan *ml.OptimizeResponse) map[int64][]models.Punto {
	geometria := make(map[int64][]models.Punto, len(plan.Rutas))

	for _, rutaPlan := range plan.Rutas {
		if len(rutaPlan.Paradas) == 0 {
			continue
		}

		paradas := append([]ml.ParadaPlan(nil), rutaPlan.Paradas...)
		sort.Slice(paradas, func(i, j int) bool { return paradas[i].Orden < paradas[j].Orden })

		puntos := make([]models.Punto, 0, len(paradas)+3)
		puntos = append(puntos, models.Punto{Lat: models.DepositoLat, Lng: models.DepositoLng})
		for _, parada := range paradas {
			puntos = append(puntos, models.Punto{Lat: parada.Lat, Lng: parada.Lng})
		}
		puntos = append(puntos,
			models.Punto{Lat: models.DescargaLat, Lng: models.DescargaLng},
			models.Punto{Lat: models.DepositoLat, Lng: models.DepositoLng},
		)

		if traza := h.osrm.Geometria(ctx, puntos); len(traza) > 0 {
			geometria[rutaPlan.CamionID] = traza
		}
	}

	return geometria
}

// ---------------------------------------------------------------------------
// POST /api/zonas/{id}/tratar
// ---------------------------------------------------------------------------
func (h *Handlers) TratarZona(w http.ResponseWriter, r *http.Request) {
	zonaID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || zonaID <= 0 {
		writeError(w, http.StatusBadRequest, "id_invalido", "El id de la zona no es válido.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "multipart_invalido",
			"No se pudo leer el formulario multipart: "+err.Error())
		return
	}

	imagen, err := readImageUpload(r, "foto_evidencia", "foto", "imagen")
	if err != nil {
		writeError(w, http.StatusBadRequest, "foto_invalida", err.Error())
		return
	}

	camionID, err := requiredInt64(r, "camion_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "camion_id_invalido", err.Error())
		return
	}
	conductorID, err := requiredInt64(r, "conductor_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "conductor_id_invalido", err.Error())
		return
	}
	observacion := firstValue(r, "observacion")

	existeCamion, err := h.repo.CamionExiste(r.Context(), camionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error_base_datos", "No se pudo validar el camión.")
		return
	}
	if !existeCamion {
		writeError(w, http.StatusBadRequest, "camion_inexistente", "El camión indicado no existe.")
		return
	}
	existeConductor, err := h.repo.UsuarioExiste(r.Context(), conductorID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error_base_datos", "No se pudo validar el conductor.")
		return
	}
	if !existeConductor {
		writeError(w, http.StatusBadRequest, "conductor_inexistente", "El conductor indicado no existe.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	// La validación de limpieza se hace en Python en modo "evidencia": una
	// escena limpia devuelve 25 L; un volumen mayor bloquea el cierre.
	analisis, err := h.ml.Analyze(ctx, imagen.Filename, imagen.Data, "evidencia")
	if err != nil {
		h.respondMLError(w, err)
		return
	}
	if analisis.VolumenLitros > models.VolumenMaximoL {
		writeErrorDetalle(w, http.StatusUnprocessableEntity, "volumen_restante_excede",
			fmt.Sprintf("La evidencia indica aproximadamente %.0f L restantes; el máximo permitido es %.0f L.",
				analisis.VolumenLitros, models.VolumenMaximoL),
			map[string]any{
				"volumen_restante_litros": analisis.VolumenLitros,
				"maximo_permitido_litros": models.VolumenMaximoL,
				"analisis":                analisis,
			})
		return
	}

	objeto := fmt.Sprintf("evidencias/%s/%s.%s",
		time.Now().Format("2006/01/02"), uuid.NewString(), imagen.Extension)
	fotoURL, err := h.storage.Upload(ctx, objeto, imagen.Data, imagen.ContentType)
	if err != nil {
		writeError(w, http.StatusBadGateway, "storage_no_disponible",
			"No se pudo guardar la foto de evidencia.")
		return
	}

	zona, evidencia, err := h.repo.TratarZona(ctx, models.TratarZonaInput{
		ZonaID:                zonaID,
		CamionID:              camionID,
		ConductorID:           conductorID,
		FotoURL:               fotoURL,
		VolumenRestanteLitros: analisis.VolumenLitros,
		Observacion:           observacion,
	})
	if err != nil {
		borrarObjeto(h.storage, objeto)
		switch {
		case errors.Is(err, db.ErrNotFound):
			writeError(w, http.StatusNotFound, "zona_inexistente", "La zona indicada no existe.")
		case errors.Is(err, db.ErrAlreadyTreated):
			writeError(w, http.StatusConflict, "zona_ya_tratada", "La zona ya fue marcada como tratada.")
		default:
			log.Printf("[tratamiento] error: %v", err)
			writeError(w, http.StatusInternalServerError, "error_tratando_zona",
				"No se pudo registrar el tratamiento de la zona.")
		}
		return
	}

	recolectado := zona.VolumenEstimadoLitros - analisis.VolumenLitros
	if recolectado < 0 {
		recolectado = 0
	}

	h.hub.Publish("zona_tratada", map[string]any{
		"zona":                       zona,
		"evidencia":                  evidencia,
		"analisis":                   analisis,
		"volumen_recolectado_litros": recolectado,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"zona":                       zona,
		"evidencia":                  evidencia,
		"analisis":                   analisis,
		"volumen_recolectado_litros": recolectado,
		"mensaje":                    "Zona marcada como tratada y parada completada.",
	})
}

// ---------------------------------------------------------------------------
// GET /api/estadisticas
// ---------------------------------------------------------------------------
func (h *Handlers) Estadisticas(w http.ResponseWriter, r *http.Request) {
	periodo := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("periodo")))
	if periodo == "" {
		periodo = "mensual"
	}
	switch periodo {
	case "semanal", "mensual", "anual":
	default:
		writeError(w, http.StatusBadRequest, "periodo_invalido",
			"El periodo debe ser semanal, mensual o anual.")
		return
	}

	estadisticas, err := h.repo.Estadisticas(r.Context(), periodo)
	if err != nil {
		log.Printf("[estadisticas] error: %v", err)
		writeError(w, http.StatusInternalServerError, "error_estadisticas",
			"No se pudieron calcular las estadísticas.")
		return
	}
	writeJSON(w, http.StatusOK, estadisticas)
}

// ---------------------------------------------------------------------------
// POST /api/simulacion y GET /api/simulacion
// ---------------------------------------------------------------------------
func (h *Handlers) ControlarSimulacion(w http.ResponseWriter, r *http.Request) {
	var entrada struct {
		Activa *bool `json:"activa"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&entrada); err != nil {
		writeError(w, http.StatusBadRequest, "cuerpo_invalido",
			"El cuerpo debe incluir el campo booleano activa.")
		return
	}
	if entrada.Activa == nil {
		writeError(w, http.StatusBadRequest, "activa_requerido",
			"El campo activa es obligatorio.")
		return
	}

	estado := h.sim.Controlar(r.Context(), *entrada.Activa)
	writeJSON(w, http.StatusOK, estado)
}

func (h *Handlers) EstadoSimulacion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, h.sim.Estado())
}

// ---------------------------------------------------------------------------
// GET /api/zonas y GET /api/camiones
// ---------------------------------------------------------------------------
func (h *Handlers) ListarZonas(w http.ResponseWriter, r *http.Request) {
	estado := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("estado")))
	if estado != "" && estado != "pendiente" && estado != "en_ruta" && estado != "tratado" {
		writeError(w, http.StatusBadRequest, "estado_invalido",
			"El estado debe ser pendiente, en_ruta o tratado.")
		return
	}
	zonas, err := h.repo.ListZonas(r.Context(), estado)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error_zonas", "No se pudieron obtener las zonas.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"zonas": zonas, "total": len(zonas)})
}

func (h *Handlers) ListarCamiones(w http.ResponseWriter, r *http.Request) {
	camiones, err := h.repo.ListCamiones(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error_camiones", "No se pudieron obtener los camiones.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"camiones": camiones, "total": len(camiones)})
}

// ---------------------------------------------------------------------------
// GET /api/reportes?usuario_id=
// ---------------------------------------------------------------------------
func (h *Handlers) ListarReportesUsuario(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("usuario_id"))
	usuarioID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || usuarioID <= 0 {
		writeError(w, http.StatusBadRequest, "usuario_id_invalido",
			"El parámetro usuario_id debe ser un entero positivo.")
		return
	}

	reportes, err := h.repo.ListarReportesUsuario(r.Context(), usuarioID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error_reportes",
			"No se pudieron obtener los reportes del ciudadano.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reportes": reportes, "total": len(reportes)})
}

// ---------------------------------------------------------------------------
// GET /api/rutas y GET /api/zonas/{id}/detalle
// ---------------------------------------------------------------------------
func (h *Handlers) ListarRutas(w http.ResponseWriter, r *http.Request) {
	rutas, err := h.repo.ListRutasActivas(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "error_rutas", "No se pudieron obtener las rutas activas.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rutas": rutas, "total": len(rutas)})
}

func (h *Handlers) DetalleZona(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "id_invalido", "El identificador de la zona debe ser un entero positivo.")
		return
	}

	detalle, err := h.repo.ObtenerZonaDetalle(r.Context(), id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "zona_no_encontrada", "La zona solicitada no existe.")
			return
		}
		writeError(w, http.StatusInternalServerError, "error_zona", "No se pudo obtener el detalle de la zona.")
		return
	}
	writeJSON(w, http.StatusOK, detalle)
}

// ---------------------------------------------------------------------------
// GET /api/events (SSE)
// ---------------------------------------------------------------------------
func (h *Handlers) Eventos(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "sse_no_soportado",
			"El servidor no soporta streaming SSE.")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if _, err := fmt.Fprint(w, ": conectado a Juliaca Limpia\n\n"); err != nil {
		return
	}
	flusher.Flush()

	canal := h.hub.Subscribe()
	defer h.hub.Unsubscribe(canal)

	latido := time.NewTicker(20 * time.Second)
	defer latido.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case mensaje, abierto := <-canal:
			if !abierto {
				return
			}
			if _, err := w.Write(mensaje); err != nil {
				return
			}
			flusher.Flush()
		case <-latido.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	dbErr := h.repo.Ping(ctx)
	mlErr := h.ml.Health(ctx)

	estado := "ok"
	codigo := http.StatusOK
	if dbErr != nil {
		estado = "degradado"
		codigo = http.StatusServiceUnavailable
	}

	checks := map[string]any{
		"base_datos": map[string]any{"ok": dbErr == nil, "error": errorONil(dbErr)},
		"ml_service": map[string]any{"ok": mlErr == nil, "error": errorONil(mlErr)},
	}
	if mlErr != nil {
		estado = "degradado"
	}

	writeJSON(w, codigo, map[string]any{
		"status":       estado,
		"servicio":     "juliaca-limpia-api",
		"version":      "1.0.0",
		"zona_horaria": "America/Lima",
		"clientes_sse": h.hub.Clientes(),
		"checks":       checks,
	})
}

func errorONil(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// ---------------------------------------------------------------------------
// Utilidades de formularios y archivos
// ---------------------------------------------------------------------------
type uploadedImage struct {
	Data        []byte
	Filename    string
	ContentType string
	Extension   string
}

func readImageUpload(r *http.Request, campos ...string) (*uploadedImage, error) {
	var (
		archivo multipart.File
		header  *multipart.FileHeader
		err     error
	)
	for _, campo := range campos {
		archivo, header, err = r.FormFile(campo)
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("falta el archivo de imagen (campo %q)", campos[0])
	}
	defer archivo.Close()

	data, err := io.ReadAll(archivo)
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer la imagen: %w", err)
	}
	if len(data) == 0 {
		return nil, errors.New("el archivo de imagen está vacío")
	}

	contentType := http.DetectContentType(data)
	var extension string
	switch contentType {
	case "image/jpeg":
		extension = "jpg"
	case "image/png":
		extension = "png"
	case "image/webp":
		extension = "webp"
	default:
		return nil, fmt.Errorf("formato no soportado (%s); usa JPG, PNG o WebP", contentType)
	}

	nombre := "foto." + extension
	if header != nil && strings.TrimSpace(header.Filename) != "" {
		nombre = header.Filename
	}
	return &uploadedImage{
		Data:        data,
		Filename:    nombre,
		ContentType: contentType,
		Extension:   extension,
	}, nil
}

func firstValue(r *http.Request, campos ...string) string {
	for _, campo := range campos {
		if value := strings.TrimSpace(r.FormValue(campo)); value != "" {
			return value
		}
	}
	return ""
}

func requiredFloat(r *http.Request, campos ...string) (float64, error) {
	raw := firstValue(r, campos...)
	if raw == "" {
		return 0, fmt.Errorf("falta el campo %q", campos[0])
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("el campo %q debe ser numérico", campos[0])
	}
	return value, nil
}

func optionalFloat(r *http.Request, campos ...string) (float64, bool, error) {
	raw := firstValue(r, campos...)
	if raw == "" {
		return 0, false, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, false, fmt.Errorf("el campo %q debe ser numérico", campos[0])
	}
	return value, true, nil
}

func optionalInt64(r *http.Request, campos ...string) (*int64, error) {
	raw := firstValue(r, campos...)
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return nil, fmt.Errorf("el campo %q debe ser un id válido", campos[0])
	}
	return &value, nil
}

func requiredInt64(r *http.Request, campos ...string) (int64, error) {
	raw := firstValue(r, campos...)
	if raw == "" {
		return 0, fmt.Errorf("falta el campo %q", campos[0])
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("el campo %q debe ser un id válido", campos[0])
	}
	return value, nil
}

func clamp(value, minimo, maximo float64) float64 {
	if value < minimo {
		return minimo
	}
	if value > maximo {
		return maximo
	}
	return value
}

func (h *Handlers) respondMLError(w http.ResponseWriter, err error) {
	var apiErr *ml.APIError
	if errors.As(err, &apiErr) {
		codigo := apiErr.Code
		if codigo == "" {
			codigo = "error_ml"
		}
		writeError(w, apiErr.Status, codigo, apiErr.Message)
		return
	}
	log.Printf("[ml] error: %v", err)
	writeError(w, http.StatusBadGateway, "ml_no_disponible",
		"El servicio de análisis no está disponible; intenta nuevamente.")
}

func borrarObjeto(store *storage.Client, objeto string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := store.Remove(ctx, objeto); err != nil {
		log.Printf("[storage] no se pudo limpiar %q: %v", objeto, err)
	}
}
