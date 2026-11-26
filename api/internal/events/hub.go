package events

import (
	"encoding/json"
	"sync"
	"time"
)

// Hub distribuye eventos SSE a todos los clientes conectados sin bloquearse.
type Hub struct {
	mu      sync.RWMutex
	clients map[chan []byte]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[chan []byte]struct{})}
}

func (h *Hub) Subscribe() chan []byte {
	ch := make(chan []byte, 32)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *Hub) Unsubscribe(ch chan []byte) {
	h.mu.Lock()
	if _, ok := h.clients[ch]; ok {
		delete(h.clients, ch)
		close(ch)
	}
	h.mu.Unlock()
}

// Publish envía un evento con formato SSE. Si un cliente está lento se descarta
// el mensaje para ese cliente en lugar de bloquear el handler.
func (h *Hub) Publish(tipo string, datos any) {
	payload, err := json.Marshal(map[string]any{
		"tipo":       tipo,
		"datos":      datos,
		"emitido_en": time.Now().UTC(),
	})
	if err != nil {
		return
	}
	mensaje := []byte("event: " + tipo + "\ndata: " + string(payload) + "\n\n")

	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- mensaje:
		default:
		}
	}
}

func (h *Hub) Clientes() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
