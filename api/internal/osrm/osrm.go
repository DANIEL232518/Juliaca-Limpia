// Package osrm consulta el servidor público OSRM (basado en OpenStreetMap)
// para obtener la geometría real de las calles al planificar una ruta. No
// requiere clave de API. Si el servicio no responde o no devuelve una ruta,
// se devuelve nil y el sistema conserva la ruta en línea recta como respaldo.
package osrm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/juliacalimpia/api/internal/models"
)

const (
	// Servidor público de OSRM con el perfil de automóvil.
	urlPorDefecto = "https://router.project-osrm.org"
	// Máximo de puntos de paso por petición (el servidor público es limitado).
	maximoPuntos = 12
	// Tamaño máximo de la respuesta que se acepta.
	maximoRespuesta = 8 << 20
)

// Cliente mínimo contra el OSRM público.
type Cliente struct {
	baseURL string
	http    *http.Client
}

// New crea el cliente con la URL pública por defecto.
func New() *Cliente {
	return &Cliente{
		baseURL: urlPorDefecto,
		http:    &http.Client{Timeout: 25 * time.Second},
	}
}

type respuestaOSRM struct {
	Code   string `json:"code"`
	Routes []struct {
		Geometry struct {
			// [longitud, latitud] tal como lo devuelve OSRM.
			Coordinates [][2]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"routes"`
}

// Geometria devuelve los puntos [lat,lng] que siguen las calles entre los
// puntos dados (depósito → paradas → descarga → depósito). Devuelve nil si
// OSRM no está disponible, para que quien llame use la línea recta.
func (c *Cliente) Geometria(ctx context.Context, puntos []models.Punto) []models.Punto {
	if len(puntos) < 2 {
		return nil
	}

	geometria := make([]models.Punto, 0, 64)
	inicio := 0
	primero := true
	for inicio < len(puntos)-1 {
		fin := inicio + maximoPuntos - 1
		if fin > len(puntos)-1 {
			fin = len(puntos) - 1
		}

		trozo := c.geometriaTramo(ctx, puntos[inicio:fin+1])
		if len(trozo) == 0 {
			return nil
		}
		if !primero && len(trozo) > 0 {
			// El tramo anterior ya terminó en este vértice compartido.
			trozo = trozo[1:]
		}
		geometria = append(geometria, trozo...)
		primero = false
		inicio = fin
	}

	if len(geometria) < 2 {
		return nil
	}
	return geometria
}

func (c *Cliente) geometriaTramo(ctx context.Context, puntos []models.Punto) []models.Punto {
	coords := make([]string, 0, len(puntos))
	for _, punto := range puntos {
		coords = append(coords, fmt.Sprintf("%.6f,%.6f", punto.Lng, punto.Lat))
	}

	endpoint := fmt.Sprintf(
		"%s/route/v1/driving/%s?overview=full&geometries=geojson&steps=false",
		strings.TrimRight(c.baseURL, "/"),
		strings.Join(coords, ";"),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maximoRespuesta))
	if err != nil {
		return nil
	}

	var resultado respuestaOSRM
	if err := json.Unmarshal(body, &resultado); err != nil {
		return nil
	}
	if resultado.Code != "Ok" || len(resultado.Routes) == 0 {
		return nil
	}

	coordsOut := make([]models.Punto, 0, len(resultado.Routes[0].Geometry.Coordinates))
	for _, par := range resultado.Routes[0].Geometry.Coordinates {
		coordsOut = append(coordsOut, models.Punto{Lat: par[1], Lng: par[0]})
	}
	return coordsOut
}
