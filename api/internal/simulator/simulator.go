// Package simulator mueve las compactadoras a lo largo de sus rutas activas
// para la demostración en vivo del panel administrador. No modifica el estado
// de las zonas ni de las rutas: solamente actualiza la posición GPS, el rumbo
// y la velocidad de los camiones, y publica el avance por SSE.
package simulator

import (
	"context"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/juliacalimpia/api/internal/db"
	"github.com/juliacalimpia/api/internal/events"
	"github.com/juliacalimpia/api/internal/models"
)

const (
	// intervalo entre actualizaciones de posición (2 s).
	intervalo = 2 * time.Second
	// velocidad mostrada en el mapa, en km/h.
	velocidadKmh = 42.0
	// factor de aceleración de la demo: la distancia real recorrida en un tick
	// se multiplica para que el desplazamiento sea visible en segundos.
	factorDemo = 12.0
)

// metrosPorTick es el avance de cada compactadora en un tick del simulador.
var metrosPorTick = velocidadKmh / 3.6 * intervalo.Seconds() * factorDemo

// CamionMovido es la posición que el mapa consume por SSE.
type CamionMovido struct {
	ID           int64   `json:"id"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	RumboGrados  float64 `json:"rumbo_grados"`
	VelocidadKmh float64 `json:"velocidad_kmh"`
}

// Estado es el cuerpo de GET/POST /api/simulacion y del evento flota_movida.
type Estado struct {
	Activa   bool           `json:"activa"`
	Camiones []CamionMovido `json:"camiones"`
}

type posicion struct {
	lat   float64
	lng   float64
	rumbo float64
}

// Simulator mantiene el estado de la demostración de flota.
type Simulator struct {
	repo *db.Repo
	hub  *events.Hub

	mu         sync.Mutex
	activa     bool
	posiciones map[int64]posicion
	ultimo     []CamionMovido
}

// Nuevo crea el simulador y arranca su bucle de avance.
func Nuevo(repo *db.Repo, hub *events.Hub) *Simulator {
	s := &Simulator{
		repo:       repo,
		hub:        hub,
		posiciones: make(map[int64]posicion),
		ultimo:     make([]CamionMovido, 0),
	}
	go s.bucle()
	return s
}

func (s *Simulator) bucle() {
	ticker := time.NewTicker(intervalo)
	defer ticker.Stop()

	for range ticker.C {
		if !s.Activa() {
			continue
		}
		if err := s.avanzar(context.Background()); err != nil {
			log.Printf("[simulador] no se pudo avanzar la flota: %v", err)
		}
	}
}

// Activa indica si la simulación está encendida.
func (s *Simulator) Activa() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activa
}

// Estado devuelve una copia del último avance conocido.
func (s *Simulator) Estado() Estado {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Estado{
		Activa:   s.activa,
		Camiones: append([]CamionMovido{}, s.ultimo...),
	}
}

// Controlar enciende o apaga la simulación y devuelve el estado resultante.
func (s *Simulator) Controlar(ctx context.Context, activa bool) Estado {
	s.mu.Lock()
	s.activa = activa
	s.mu.Unlock()

	if !activa {
		s.mu.Lock()
		for indice := range s.ultimo {
			s.ultimo[indice].VelocidadKmh = 0
		}
		estado := Estado{Activa: false, Camiones: append([]CamionMovido{}, s.ultimo...)}
		s.mu.Unlock()
		s.hub.Publish("flota_movida", estado)
		return estado
	}

	// Primer avance inmediato para que el panel y el mapa reaccionen al clic.
	if err := s.avanzar(ctx); err != nil {
		log.Printf("[simulador] avance inicial: %v", err)
	}
	return s.Estado()
}

// avanzar mueve cada camión hacia su siguiente parada pendiente siguiendo la
// traza de calles de su ruta activa (OSRM). Si la ruta no tiene geometría,
// respalda con línea recta hacia la parada.
func (s *Simulator) avanzar(ctx context.Context) error {
	rutas, err := s.repo.ListRutasActivas(ctx)
	if err != nil {
		return err
	}
	camiones, err := s.repo.ListCamiones(ctx)
	if err != nil {
		return err
	}

	// Siguiente parada pendiente y traza de calles por camión (las rutas
	// activas ya vienen con sus paradas, pero se ordenan por si llegan
	// desordenadas).
	objetivos := make(map[int64]models.Parada, len(rutas))
	trazas := make(map[int64][]models.Punto, len(rutas))
	for _, ruta := range rutas {
		if len(ruta.Geometria) > 1 {
			trazas[ruta.CamionID] = ruta.Geometria
		}
		paradas := append([]models.Parada(nil), ruta.Paradas...)
		sort.Slice(paradas, func(i, j int) bool { return paradas[i].Orden < paradas[j].Orden })
		for _, parada := range paradas {
			if parada.EstadoParada == "pendiente" {
				objetivos[ruta.CamionID] = parada
				break
			}
		}
	}

	movidos := make([]CamionMovido, 0, len(camiones))

	s.mu.Lock()
	for _, camion := range camiones {
		if camion.Estado == "mantenimiento" {
			continue
		}

		actual, conocido := s.posiciones[camion.ID]
		if !conocido {
			actual = posicion{lat: camion.Lat, lng: camion.Lng, rumbo: camion.RumboGrados}
		}

		objetivo, enRuta := objetivos[camion.ID]
		velocidad := 0.0
		traza, conTraza := trazas[camion.ID]

		switch {
		case conTraza:
			// Avanza sobre los vértices de la traza hasta la parada
			// pendiente; si ya no hay paradas, regresa al depósito.
			destino := len(traza) - 1
			if enRuta {
				destino = indiceMasCercano(traza, objetivo.Lat, objetivo.Lng)
			}
			avanzado, llego := avanzarPorTraza(actual, traza, destino, metrosPorTick)
			actual = avanzado
			if !llego {
				velocidad = velocidadKmh
			}
		case enRuta:
			// Respaldo sin geometría: línea recta hacia la parada.
			velocidad = velocidadKmh
			actual.rumbo = rumboHacia(actual.lat, actual.lng, objetivo.Lat, objetivo.Lng)

			distancia := distanciaMetros(actual.lat, actual.lng, objetivo.Lat, objetivo.Lng)
			if distancia <= metrosPorTick {
				actual.lat = objetivo.Lat
				actual.lng = objetivo.Lng
			} else {
				proporcion := metrosPorTick / distancia
				actual.lat += (objetivo.Lat - actual.lat) * proporcion
				actual.lng += (objetivo.Lng - actual.lng) * proporcion
			}
		}

		s.posiciones[camion.ID] = actual
		movidos = append(movidos, CamionMovido{
			ID:           camion.ID,
			Lat:          actual.lat,
			Lng:          actual.lng,
			RumboGrados:  actual.rumbo,
			VelocidadKmh: velocidad,
		})
	}
	s.ultimo = append([]CamionMovido{}, movidos...)
	s.mu.Unlock()

	for _, camion := range movidos {
		if err := s.repo.ActualizarPosicionCamion(
			ctx, camion.ID, camion.Lat, camion.Lng, camion.RumboGrados, camion.VelocidadKmh,
		); err != nil {
			log.Printf("[simulador] camión %d: %v", camion.ID, err)
		}
	}

	s.hub.Publish("flota_movida", Estado{Activa: true, Camiones: movidos})
	return nil
}

// indiceMasCercano devuelve el índice del vértice de la traza más cercano a
// las coordenadas dadas.
func indiceMasCercano(traza []models.Punto, lat, lng float64) int {
	mejor := 0
	mejorDist := math.MaxFloat64
	for indice, punto := range traza {
		distancia := distanciaMetros(lat, lng, punto.Lat, punto.Lng)
		if distancia < mejorDist {
			mejorDist = distancia
			mejor = indice
		}
	}
	return mejor
}

// avanzarPorTraza mueve el camión `metros` sobre la traza de calles hasta el
// vértice `destino`. Devuelve la posición resultante y si llegó al destino.
func avanzarPorTraza(actual posicion, traza []models.Punto, destino int, metros float64) (posicion, bool) {
	indice := indiceMasCercano(traza, actual.lat, actual.lng)
	llego := false

	if indice >= destino {
		// Ya está en o más allá del destino: se sitúa sobre el vértice.
		llego = true
		actual.lat = traza[destino].Lat
		actual.lng = traza[destino].Lng
		indice = destino
	} else {
		resto := metros
		for indice < destino && resto > 0 {
			siguiente := indice + 1
			seg := distanciaMetros(
				traza[indice].Lat, traza[indice].Lng,
				traza[siguiente].Lat, traza[siguiente].Lng,
			)
			if seg <= 0 {
				indice = siguiente
				actual.lat = traza[indice].Lat
				actual.lng = traza[indice].Lng
				continue
			}
			if resto < seg {
				proporcion := resto / seg
				actual.lat = traza[indice].Lat + (traza[siguiente].Lat-traza[indice].Lat)*proporcion
				actual.lng = traza[indice].Lng + (traza[siguiente].Lng-traza[indice].Lng)*proporcion
				resto = 0
			} else {
				resto -= seg
				indice = siguiente
				actual.lat = traza[indice].Lat
				actual.lng = traza[indice].Lng
			}
		}
		llego = indice >= destino
	}

	// El rumbo apunta al siguiente vértice real de la calle.
	if indice < len(traza)-1 {
		actual.rumbo = rumboHacia(actual.lat, actual.lng, traza[indice+1].Lat, traza[indice+1].Lng)
	}
	return actual, llego
}

// distanciaMetros calcula la distancia geodésica entre dos puntos (haversine).
func distanciaMetros(lat1, lng1, lat2, lng2 float64) float64 {
	const radioTierra = 6371000.0
	const radianes = math.Pi / 180

	deltaLat := (lat2 - lat1) * radianes
	deltaLng := (lng2 - lng1) * radianes
	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1*radianes)*math.Cos(lat2*radianes)*
			math.Sin(deltaLng/2)*math.Sin(deltaLng/2)
	return 2 * radioTierra * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// rumboHacia devuelve el rumbo inicial (0-360°, norte = 0) entre dos puntos.
func rumboHacia(lat1, lng1, lat2, lng2 float64) float64 {
	const radianes = math.Pi / 180

	deltaLng := (lng2 - lng1) * radianes
	y := math.Sin(deltaLng) * math.Cos(lat2*radianes)
	x := math.Cos(lat1*radianes)*math.Sin(lat2*radianes) -
		math.Sin(lat1*radianes)*math.Cos(lat2*radianes)*math.Cos(deltaLng)
	grados := math.Atan2(y, x) / radianes
	return math.Mod(grados+360, 360)
}
