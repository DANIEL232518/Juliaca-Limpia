package models

import "time"

// Punto geográfico simple para respuestas JSON.
type Punto struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// Coordenadas de referencia del dominio.
const (
	CentroJuliacaLat = -15.4941
	CentroJuliacaLng = -70.1356
	DepositoLat      = -15.4803
	DepositoLng      = -70.1436
	DescargaLat      = -15.5680
	DescargaLng      = -70.3150
	RadioAgrupacionM = 20.0
	VolumenMaximoL   = 25.0
)

// Límites de Juliaca (provincia de San Román): los reportes solo se aceptan
// dentro de este área y con coordenadas GPS del dispositivo.
const (
	LimiteJuliacaSurLat   = -15.60
	LimiteJuliacaNorteLat = -15.40
	LimiteJuliacaOesteLng = -70.32
	LimiteJuliacaEsteLng  = -70.08
)

// DentroDeJuliaca indica si un punto cae dentro del área delimitada.
func DentroDeJuliaca(lat, lng float64) bool {
	return lat >= LimiteJuliacaSurLat && lat <= LimiteJuliacaNorteLat &&
		lng >= LimiteJuliacaOesteLng && lng <= LimiteJuliacaEsteLng
}

// NivelPorVolumen aplica los umbrales compartidos con ml-service y el esquema SQL.
func NivelPorVolumen(volumen float64) string {
	switch {
	case volumen < 150:
		return "bajo"
	case volumen < 350:
		return "medio"
	default:
		return "critico"
	}
}

type Zona struct {
	ID                    int64      `json:"id"`
	Lat                   float64    `json:"lat"`
	Lng                   float64    `json:"lng"`
	DireccionReferencia   string     `json:"direccion_referencia"`
	VolumenEstimadoLitros float64    `json:"volumen_estimado_litros"`
	Nivel                 string     `json:"nivel"`
	Estado                string     `json:"estado"`
	TotalReportes         int        `json:"total_reportes"`
	CreadoEn              time.Time  `json:"creado_en"`
	TratadoEn             *time.Time `json:"tratado_en,omitempty"`
}

type Reporte struct {
	ID            int64     `json:"id"`
	ZonaID        int64     `json:"zona_id"`
	UsuarioID     *int64    `json:"usuario_id,omitempty"`
	FotoURL       *string   `json:"foto_url,omitempty"`
	VolumenLitros float64   `json:"volumen_litros"`
	Nivel         string    `json:"nivel"`
	Comentario    *string   `json:"comentario,omitempty"`
	CreadoEn      time.Time `json:"creado_en"`
}

type Camion struct {
	ID                int64     `json:"id"`
	Placa             string    `json:"placa"`
	CodigoUnidad      string    `json:"codigo_unidad"`
	CapacidadLitros   int       `json:"capacidad_litros"`
	CargaActualLitros float64   `json:"carga_actual_litros"`
	Estado            string    `json:"estado"`
	Lat               float64   `json:"lat"`
	Lng               float64   `json:"lng"`
	RumboGrados       float64   `json:"rumbo_grados"`
	VelocidadKmh      float64   `json:"velocidad_kmh"`
	ActualizadoEn     time.Time `json:"actualizado_en"`
}

type Evidencia struct {
	ID                    int64     `json:"id"`
	ZonaID                int64     `json:"zona_id"`
	CamionID              *int64    `json:"camion_id,omitempty"`
	ConductorID           *int64    `json:"conductor_id,omitempty"`
	FotoEvidenciaURL      *string   `json:"foto_evidencia_url,omitempty"`
	VolumenRestanteLitros float64   `json:"volumen_restante_litros"`
	Observacion           *string   `json:"observacion,omitempty"`
	CreadoEn              time.Time `json:"creado_en"`
}

// ReporteResumen es la vista mínima de un reporte para el detalle de una zona.
type ReporteResumen struct {
	ID            int64     `json:"id"`
	FotoURL       *string   `json:"foto_url,omitempty"`
	VolumenLitros float64   `json:"volumen_litros"`
	Nivel         string    `json:"nivel"`
	Comentario    *string   `json:"comentario,omitempty"`
	CreadoEn      time.Time `json:"creado_en"`
}

// ZonaDetalle reúne la zona con sus reportes y la evidencia de limpieza más
// reciente, para el popup del mapa (antes / después).
type ZonaDetalle struct {
	Zona      Zona             `json:"zona"`
	Reportes  []ReporteResumen `json:"reportes"`
	Evidencia *Evidencia       `json:"evidencia"`
}

// ReporteUsuario es un reporte ciudadano con el estado actual de su zona y la
// evidencia de limpieza. Alimenta "Mis Reportes / Estado en mi Zona".
type ReporteUsuario struct {
	ID                        int64      `json:"id"`
	ZonaID                    int64      `json:"zona_id"`
	FotoURL                   *string    `json:"foto_url"`
	VolumenLitros             float64    `json:"volumen_litros"`
	Nivel                     string     `json:"nivel"`
	Comentario                *string    `json:"comentario"`
	CreadoEn                  time.Time  `json:"creado_en"`
	ZonaEstado                string     `json:"zona_estado"`
	ZonaDireccion             string     `json:"zona_direccion"`
	ZonaNivel                 string     `json:"zona_nivel"`
	ZonaLat                   float64    `json:"zona_lat"`
	ZonaLng                   float64    `json:"zona_lng"`
	ZonaVolumenEstimadoLitros float64    `json:"zona_volumen_estimado_litros"`
	ZonaTotalReportes         int        `json:"zona_total_reportes"`
	TratadoEn                 *time.Time `json:"tratado_en"`
	EvidenciaFotoURL          *string    `json:"evidencia_foto_url"`
	EvidenciaCreadoEn         *time.Time `json:"evidencia_creado_en"`
}

type Parada struct {
	ID                    int64   `json:"id"`
	ZonaID                int64   `json:"zona_id"`
	Orden                 int     `json:"orden"`
	EstadoParada          string  `json:"estado_parada"`
	DistanciaMetros       float64 `json:"distancia_metros"`
	DireccionReferencia   string  `json:"direccion_referencia"`
	Lat                   float64 `json:"lat"`
	Lng                   float64 `json:"lng"`
	VolumenEstimadoLitros float64 `json:"volumen_estimado_litros"`
	Nivel                 string  `json:"nivel"`
}

type Ruta struct {
	ID                   int64     `json:"id"`
	CamionID             int64     `json:"camion_id"`
	CodigoUnidad         string    `json:"codigo_unidad"`
	Estado               string    `json:"estado"`
	DistanciaTotalMetros float64   `json:"distancia_total_metros"`
	VolumenTotalLitros   float64   `json:"volumen_total_litros"`
	CreadoEn             time.Time `json:"creado_en"`
	// Geometria sigue las calles reales (OSRM/OpenStreetMap). Vacío si el
	// servicio de calles no respondió y la ruta queda en línea recta.
	Geometria []Punto  `json:"geometria,omitempty"`
	Paradas   []Parada `json:"paradas"`
}

type MapaEstado struct {
	Centro   Punto    `json:"centro"`
	Zonas    []Zona   `json:"zonas"`
	Camiones []Camion `json:"camiones"`
}

// CrearReporteInput es la entrada transaccional para agrupar/crear zonas.
type CrearReporteInput struct {
	Lat        float64
	Lng        float64
	Direccion  string
	Volumen    float64
	Nivel      string
	FotoURL    string
	UsuarioID  *int64
	Comentario string
}

type TratarZonaInput struct {
	ZonaID                int64
	CamionID              int64
	ConductorID           int64
	FotoURL               string
	VolumenRestanteLitros float64
	Observacion           string
}

type PuntoSerie struct {
	Periodo             string  `json:"periodo"`
	ReportesCreados     int     `json:"reportes_creados"`
	ZonasCreadas        int     `json:"zonas_creadas"`
	ZonasTratadas       int     `json:"zonas_tratadas"`
	LitrosRecolectados  float64 `json:"litros_recolectados"`
	TiempoPromedioHoras float64 `json:"tiempo_promedio_horas"`
}

// DistribucionNiveles reparte los reportes del periodo por gravedad para el
// gráfico de dona del panel administrador.
type DistribucionNiveles struct {
	Bajo    int `json:"bajo"`
	Medio   int `json:"medio"`
	Critico int `json:"critico"`
}

type ResumenEstadisticas struct {
	ReportesCreados     int     `json:"reportes_creados"`
	ZonasCreadas        int     `json:"zonas_creadas"`
	ZonasTratadas       int     `json:"zonas_tratadas"`
	EfectividadPct      float64 `json:"efectividad_pct"`
	LitrosRecolectados  float64 `json:"litros_recolectados"`
	VolumenM3           float64 `json:"volumen_m3"`
	Toneladas           float64 `json:"toneladas"`
	TiempoPromedioHoras float64 `json:"tiempo_promedio_horas"`
}

type Estadisticas struct {
	Periodo             string              `json:"periodo"`
	Desde               string              `json:"desde"`
	Hasta               string              `json:"hasta"`
	Resumen             ResumenEstadisticas `json:"resumen"`
	Series              []PuntoSerie        `json:"series"`
	DistribucionNiveles DistribucionNiveles `json:"distribucion_niveles"`
}
