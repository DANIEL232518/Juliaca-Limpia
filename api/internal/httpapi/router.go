package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/juliacalimpia/api/internal/config"
	"github.com/juliacalimpia/api/internal/db"
	"github.com/juliacalimpia/api/internal/events"
	"github.com/juliacalimpia/api/internal/ml"
	"github.com/juliacalimpia/api/internal/osrm"
	"github.com/juliacalimpia/api/internal/simulator"
	"github.com/juliacalimpia/api/internal/storage"
)

func NewRouter(
	cfg config.Config,
	repo *db.Repo,
	store *storage.Client,
	mlClient *ml.Client,
	hub *events.Hub,
) http.Handler {
	simulador := simulator.Nuevo(repo, hub)

	handlers := &Handlers{
		cfg:     cfg,
		repo:    repo,
		storage: store,
		ml:      mlClient,
		hub:     hub,
		sim:     simulador,
		osrm:    osrm.New(),
	}

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           int((10 * time.Minute).Seconds()),
	}))

	router.Get("/health", handlers.Health)

	router.Route("/api", func(r chi.Router) {
		r.Post("/reportes", handlers.CrearReporte)
		r.Get("/reportes", handlers.ListarReportesUsuario)
		r.Get("/mapa/estado", handlers.MapaEstado)
		r.Post("/rutas/generar", handlers.GenerarRutas)
		r.Post("/zonas/{id}/tratar", handlers.TratarZona)
		r.Get("/estadisticas", handlers.Estadisticas)
		r.Post("/simulacion", handlers.ControlarSimulacion)
		r.Get("/simulacion", handlers.EstadoSimulacion)
		r.Get("/events", handlers.Eventos)
		r.Get("/zonas", handlers.ListarZonas)
		r.Get("/zonas/{id}/detalle", handlers.DetalleZona)
		r.Get("/camiones", handlers.ListarCamiones)
		r.Get("/rutas", handlers.ListarRutas)
	})

	router.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "no_encontrado", "La ruta solicitada no existe.")
	})
	router.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "metodo_no_permitido", "Método HTTP no permitido.")
	})

	return router
}
