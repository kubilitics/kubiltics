package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// configRequest is the body for POST /api/v1/ai/validate.
// All fields except Provider are optional; the brain treats blanks as
// "leave at current value".
type configRequest struct {
	Provider string `json:"provider"`
	Model    string `json:"model,omitempty"`
	APIKey   string `json:"api_key,omitempty"`
	BaseURL  string `json:"base_url,omitempty"`
}

// configResponse is the JSON shape for validate and related endpoints.
type configResponse struct {
	OK              bool   `json:"ok"`
	AppliedProvider string `json:"applied_provider,omitempty"`
	AppliedModel    string `json:"applied_model,omitempty"`
	LatencyMs       int64  `json:"latency_ms,omitempty"`
	Error           string `json:"error,omitempty"`
}

var supportedProviders = map[string]bool{
	"openai":    true,
	"anthropic": true,
	"ollama":    true,
	"custom":    true,
}

// PostValidate serves POST /api/v1/ai/validate. It performs a shape check
// and, when the brain is reachable, asks the runtime for a status ping.
// It does NOT persist the configuration. The deeper "send a real prompt"
// validation is left to the frontend smoke-test path; doing it here would
// require a brain-side test endpoint that does not yet exist.
func (h *Handlers) PostValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if !h.cfg.Enabled {
		writeConfigErr(w, types.DisabledReasonAIDisabled, http.StatusServiceUnavailable)
		return
	}

	req, err := decodeConfigRequest(r)
	if err != nil {
		writeConfigErr(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateConfigShape(req); err != nil {
		writeConfigErr(w, err.Error(), http.StatusBadRequest)
		return
	}

	start := time.Now()
	// Probe the brain — if it's reachable, treat shape-validation as success.
	// The brain itself owns the actual provider key check on next reload.
	_, statusErr := h.pxy.Status(r.Context())
	latency := time.Since(start).Milliseconds()
	if statusErr != nil {
		_ = json.NewEncoder(w).Encode(configResponse{
			OK:    false,
			Error: fmt.Sprintf("brain unreachable: %v", statusErr),
		})
		return
	}
	_ = json.NewEncoder(w).Encode(configResponse{
		OK:              true,
		AppliedProvider: req.Provider,
		AppliedModel:    req.Model,
		LatencyMs:       latency,
	})
}

func decodeConfigRequest(r *http.Request) (*configRequest, error) {
	var req configRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		return nil, fmt.Errorf("invalid json: %w", err)
	}
	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	req.Model = strings.TrimSpace(req.Model)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	return &req, nil
}

func validateConfigShape(req *configRequest) error {
	if !supportedProviders[req.Provider] {
		return fmt.Errorf("unsupported provider %q (want openai|anthropic|ollama|custom)", req.Provider)
	}
	switch req.Provider {
	case "openai", "anthropic":
		if req.APIKey == "" {
			return errors.New("api_key is required for hosted providers")
		}
		if req.Model == "" {
			return errors.New("model is required")
		}
	case "ollama":
		if req.BaseURL == "" {
			return errors.New("base_url is required for ollama")
		}
		if req.Model == "" {
			return errors.New("model is required")
		}
	case "custom":
		if req.BaseURL == "" {
			return errors.New("base_url is required for custom provider")
		}
		if req.Model == "" {
			return errors.New("model is required")
		}
	}
	return nil
}

func writeConfigErr(w http.ResponseWriter, msg string, code int) {
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(configResponse{OK: false, Error: msg})
}
