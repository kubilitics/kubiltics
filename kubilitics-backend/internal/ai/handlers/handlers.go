// Package handlers exposes the AI HTTP/WS surface area on the existing
// kubilitics-backend mux. All routes honor the ai.enabled feature flag.
package handlers

import (
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
	"github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
)

// Config controls feature-flag gating and per-request limits.
type Config struct {
	Enabled         bool
	ChatMaxDuration time.Duration
	PerMessageIdle  time.Duration
}

// Handlers bundles the dependencies needed by all AI HTTP endpoints.
type Handlers struct {
	sup supervisor.Supervisor
	pxy *proxy.Proxy
	cfg Config
}

// New constructs a Handlers with the given supervisor, proxy and config.
func New(sup supervisor.Supervisor, pxy *proxy.Proxy, cfg Config) *Handlers {
	return &Handlers{sup: sup, pxy: pxy, cfg: cfg}
}

// muxHandleFunc abstracts both stdlib *http.ServeMux and gorilla/mux.Router
// adapters that expose a HandleFunc(pattern, handler) method.
type muxHandleFunc interface {
	HandleFunc(pattern string, handler func(http.ResponseWriter, *http.Request))
}

// Register installs all four AI endpoints on the provided mux. Pass either
// *http.ServeMux directly (for tests) or a thin adapter around
// gorilla/mux.Router for production use.
func (h *Handlers) Register(mux muxHandleFunc) {
	mux.HandleFunc("/api/v1/ai/status", h.GetStatus)
	mux.HandleFunc("/api/v1/ai/refresh", h.PostRefresh)
	mux.HandleFunc("/api/v1/ai/capabilities", h.GetCapabilities)
	mux.HandleFunc("/api/v1/ai/chat", h.GetChat)
}

// GetChat is replaced by chat.go in T17. Stub returns 501 for now so the
// package compiles and the route is reserved.
func (h *Handlers) GetChat(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "not implemented (T17)", http.StatusNotImplemented)
}

// GetCapabilities is replaced by capabilities.go in T16. Stub kept here
// only for the brief window between T15 and T16 commits so the package
// compiles.
func (h *Handlers) GetCapabilities(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "not implemented (T16)", http.StatusNotImplemented)
}
