package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
)

const maxUploadBytes = 15 << 20 // 15 MB

type errorResponse struct {
	Error    string `json:"error"`
	Mensaje  string `json:"mensaje"`
	Detalles any    `json:"detalles,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("[http] no se pudo escribir la respuesta: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, codigo, mensaje string) {
	writeJSON(w, status, errorResponse{Error: codigo, Mensaje: mensaje})
}

func writeErrorDetalle(w http.ResponseWriter, status int, codigo, mensaje string, detalles any) {
	writeJSON(w, status, errorResponse{Error: codigo, Mensaje: mensaje, Detalles: detalles})
}
