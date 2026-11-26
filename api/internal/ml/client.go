package ml

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// Client llama al microservicio Python.
type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("ml-service respondió %d (%s): %s", e.Status, e.Code, e.Message)
}

type AnalyzeResult struct {
	VolumenLitros float64        `json:"volumen_litros"`
	Nivel         string         `json:"nivel"`
	Confianza     float64        `json:"confianza"`
	Nitidez       float64        `json:"nitidez"`
	Nitido        bool           `json:"nitido"`
	Metodo        string         `json:"metodo"`
	Recomendacion string         `json:"recomendacion"`
	Detalles      map[string]any `json:"detalles"`
	Detecciones   []any          `json:"detecciones"`
}

func (c *Client) Analyze(
	ctx context.Context,
	filename string,
	data []byte,
	modo string,
) (*AnalyzeResult, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("imagen", filename)
	if err != nil {
		return nil, fmt.Errorf("preparar multipart: %w", err)
	}
	if _, err := part.Write(data); err != nil {
		return nil, fmt.Errorf("escribir imagen en multipart: %w", err)
	}
	if err := writer.WriteField("modo", modo); err != nil {
		return nil, fmt.Errorf("escribir modo en multipart: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("cerrar multipart: %w", err)
	}

	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+"/analyze", &body,
	)
	if err != nil {
		return nil, fmt.Errorf("crear request de análisis: %w", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())

	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("llamar a /analyze: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, parseAPIError(response)
	}

	var result AnalyzeResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decodificar /analyze: %w", err)
	}
	return &result, nil
}

type Punto struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type CamionOptimizar struct {
	ID                int64   `json:"id"`
	CodigoUnidad      string  `json:"codigo_unidad"`
	CapacidadLitros   float64 `json:"capacidad_litros"`
	CargaActualLitros float64 `json:"carga_actual_litros"`
	Lat               float64 `json:"lat"`
	Lng               float64 `json:"lng"`
}

type ZonaOptimizar struct {
	ID                    int64   `json:"id"`
	Lat                   float64 `json:"lat"`
	Lng                   float64 `json:"lng"`
	VolumenEstimadoLitros float64 `json:"volumen_estimado_litros"`
	Nivel                 string  `json:"nivel"`
	DireccionReferencia   string  `json:"direccion_referencia"`
}

type OptimizeRequest struct {
	Camiones []CamionOptimizar `json:"camiones"`
	Zonas    []ZonaOptimizar   `json:"zonas"`
	Deposito Punto             `json:"deposito"`
	Descarga Punto             `json:"descarga"`
}

type ParadaPlan struct {
	ZonaID                int64   `json:"zona_id"`
	Orden                 int     `json:"orden"`
	DistanciaMetros       float64 `json:"distancia_metros"`
	Lat                   float64 `json:"lat"`
	Lng                   float64 `json:"lng"`
	DireccionReferencia   string  `json:"direccion_referencia"`
	VolumenEstimadoLitros float64 `json:"volumen_estimado_litros"`
}

type RutaPlan struct {
	CamionID             int64        `json:"camion_id"`
	CodigoUnidad         string       `json:"codigo_unidad"`
	Paradas              []ParadaPlan `json:"paradas"`
	DistanciaTotalMetros float64      `json:"distancia_total_metros"`
	VolumenTotalLitros   float64      `json:"volumen_total_litros"`
	CapacidadLitros      float64      `json:"capacidad_litros"`
	UtilizacionPct       float64      `json:"utilizacion_pct"`
}

type OptimizeResponse struct {
	Rutas      []RutaPlan     `json:"rutas"`
	SinAsignar []int64        `json:"sin_asignar"`
	Metricas   map[string]any `json:"metricas"`
}

func (c *Client) OptimizeRoutes(
	ctx context.Context,
	payload OptimizeRequest,
) (*OptimizeResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("serializar rutas: %w", err)
	}

	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.baseURL+"/optimize-routes", bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("crear request de rutas: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("llamar a /optimize-routes: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, parseAPIError(response)
	}

	var result OptimizeResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decodificar /optimize-routes: %w", err)
	}
	return &result, nil
}

func (c *Client) Health(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("health status %d", response.StatusCode)
	}
	return nil
}

func parseAPIError(response *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))

	var envelope struct {
		Detail json.RawMessage `json:"detail"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil && len(envelope.Detail) > 0 {
		var detail struct {
			Codigo  string `json:"codigo"`
			Mensaje string `json:"mensaje"`
		}
		if err := json.Unmarshal(envelope.Detail, &detail); err == nil && detail.Mensaje != "" {
			code := detail.Codigo
			if code == "" {
				code = "error_ml"
			}
			return &APIError{
				Status:  response.StatusCode,
				Code:    code,
				Message: detail.Mensaje,
			}
		}
	}

	message := strings.TrimSpace(string(raw))
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	return &APIError{
		Status:  response.StatusCode,
		Code:    "error_ml",
		Message: message,
	}
}

func EsErrorDeCliente(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr)
}
