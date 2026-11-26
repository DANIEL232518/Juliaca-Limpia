package config

import (
	"os"
	"strconv"
	"strings"
)

// Config reúne la configuración del proceso, siempre desde variables de entorno.
type Config struct {
	Port                string
	DatabaseURL         string
	MLServiceURL        string
	MinIOEndpoint       string
	MinIOPublicEndpoint string
	MinIOAccessKey      string
	MinIOSecretKey      string
	MinIOBucket         string
	MinIOUseSSL         bool
	CORSOrigins         []string
}

func Load() Config {
	return Config{
		Port:                env("API_PORT", "8080"),
		DatabaseURL:         env("DATABASE_URL", "postgres://juliaca:juliaca_dev_2026@localhost:5432/juliacalimpia?sslmode=disable"),
		MLServiceURL:        strings.TrimRight(env("ML_SERVICE_URL", "http://localhost:8000"), "/"),
		MinIOEndpoint:       env("MINIO_ENDPOINT", "localhost:9000"),
		MinIOPublicEndpoint: strings.TrimRight(env("MINIO_PUBLIC_ENDPOINT", "http://localhost:9000"), "/"),
		MinIOAccessKey:      env("MINIO_ACCESS_KEY", "juliaca_minio"),
		MinIOSecretKey:      env("MINIO_SECRET_KEY", "juliaca_minio_2026"),
		MinIOBucket:         env("MINIO_BUCKET", "juliaca-limpia-fotos"),
		MinIOUseSSL:         envBool("MINIO_USE_SSL", false),
		CORSOrigins:         splitCSV(env("CORS_ORIGINS", "*")),
	}
}

func env(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	raw, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	value, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return value
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			values = append(values, trimmed)
		}
	}
	if len(values) == 0 {
		return []string{"*"}
	}
	return values
}
