package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/juliacalimpia/api/internal/config"
	"github.com/juliacalimpia/api/internal/db"
	"github.com/juliacalimpia/api/internal/events"
	"github.com/juliacalimpia/api/internal/httpapi"
	"github.com/juliacalimpia/api/internal/ml"
	"github.com/juliacalimpia/api/internal/storage"
)

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[api] no se pudo conectar a PostgreSQL: %v", err)
	}
	repo := db.NewRepo(pool)
	defer repo.Close()

	store, err := waitForStorage(ctx, cfg)
	if err != nil {
		log.Fatalf("[api] no se pudo inicializar MinIO: %v", err)
	}

	mlClient := ml.NewClient(cfg.MLServiceURL)
	hub := events.NewHub()

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.NewRouter(cfg, repo, store, mlClient, hub),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errores := make(chan error, 1)
	go func() {
		log.Printf("[api] escuchando en http://0.0.0.0:%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errores <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Println("[api] señal de apagado recibida")
	case err := <-errores:
		log.Printf("[api] error del servidor HTTP: %v", err)
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[api] apagado forzado: %v", err)
	}
	log.Println("[api] detenido")
}

// waitForStorage espera a que MinIO esté listo y crea el bucket si no existe.
func waitForStorage(ctx context.Context, cfg config.Config) (*storage.Client, error) {
	var lastErr error
	for intento := 1; intento <= 40; intento++ {
		store, err := storage.New(
			ctx,
			cfg.MinIOEndpoint,
			cfg.MinIOAccessKey,
			cfg.MinIOSecretKey,
			cfg.MinIOBucket,
			cfg.MinIOPublicEndpoint,
			cfg.MinIOUseSSL,
		)
		if err == nil {
			log.Printf("[storage] MinIO listo, bucket %q disponible", cfg.MinIOBucket)
			return store, nil
		}
		lastErr = err
		log.Printf("[storage] esperando MinIO... intento %d/40: %v", intento, err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, fmt.Errorf("MinIO no disponible: %w", lastErr)
}
