package db

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool crea el pool y reintenta hasta que PostgreSQL esté listo.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parsear DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 12
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 15 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("crear pool PostgreSQL: %w", err)
	}

	var lastErr error
	for intento := 1; intento <= 40; intento++ {
		pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		lastErr = pool.Ping(pingCtx)
		cancel()
		if lastErr == nil {
			log.Printf("[db] conexión establecida (intento %d)", intento)
			return pool, nil
		}
		log.Printf("[db] esperando PostgreSQL... intento %d/40: %v", intento, lastErr)
		select {
		case <-ctx.Done():
			pool.Close()
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	pool.Close()
	return nil, fmt.Errorf("PostgreSQL no disponible: %w", lastErr)
}
