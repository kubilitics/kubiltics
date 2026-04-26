// Package handlers exposes the AI HTTP/WS surface area on the existing
// kubilitics-backend mux. All routes honor the ai.enabled feature flag.
package handlers

import (
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
)

// Config controls feature-flag gating and per-request limits.
type Config struct {
	Enabled         bool
	ChatMaxDuration time.Duration
	PerMessageIdle  time.Duration
}

// Handlers bundles the dependencies needed by all AI HTTP endpoints.
type Handlers struct {
	pxy *proxy.Proxy
	cfg Config
}

// New constructs a Handlers with the given proxy and config.
func New(pxy *proxy.Proxy, cfg Config) *Handlers {
	return &Handlers{pxy: pxy, cfg: cfg}
}

// muxHandleFunc abstracts both stdlib *http.ServeMux and gorilla/mux.Router
// adapters that expose a HandleFunc(pattern, handler) method.
type muxHandleFunc interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

// Register installs all AI endpoints on the provided mux. Pass either
// *http.ServeMux directly (for tests) or a thin adapter around
// gorilla/mux.Router for production use.
func (h *Handlers) Register(mux muxHandleFunc) {
	mux.HandleFunc("/ai/status", h.GetStatus)
	mux.HandleFunc("/ai/capabilities", h.GetCapabilities)
	mux.HandleFunc("/ai/chat", h.GetChat)
	mux.HandleFunc("/ai/sessions", h.PostCreateSession)
	mux.HandleFunc("/ai/active-profile", h.GetActiveProfile)
	mux.HandleFunc("/ai/validate", h.PostValidate)
	mux.HandleFunc("/ai/budget", h.HandleBudget)
}

// HandleBudget multiplexes GET (read current) and POST (persist new) for /ai/budget.
func (h *Handlers) HandleBudget(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.GetBudget(w, r)
	case http.MethodPost:
		h.PostBudget(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

