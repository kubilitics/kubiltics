package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// configRequest is the body for POST /api/v1/ai/config and /validate.
// All fields except Provider are optional; the brain treats blanks as
// "leave at current value".
type configRequest struct {
	Provider string `json:"provider"`
	Model    string `json:"model,omitempty"`
	APIKey   string `json:"api_key,omitempty"`
	BaseURL  string `json:"base_url,omitempty"`
}

// configResponse is the JSON shape for both endpoints.
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

// configWriteMu serializes overrides-file writes so concurrent saves
// don't interleave.
var configWriteMu sync.Mutex

// PostConfig serves POST /api/v1/ai/config. It validates the candidate
// configuration shape and persists it to the local AI overrides file
// at ~/.kubilitics/ai-overrides.yaml. The kubilitics-ai brain reloads
// config on SIGHUP or on next process start. In-cluster persistence to
// a Secret/ConfigMap is TODO once the brain exposes a reload endpoint.
func (h *Handlers) PostConfig(w http.ResponseWriter, r *http.Request) {
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
	if err := writeOverrides(req); err != nil {
		writeConfigErr(w, fmt.Sprintf("persist overrides: %v", err), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(configResponse{
		OK:              true,
		AppliedProvider: req.Provider,
		AppliedModel:    req.Model,
	})
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

// writeOverrides persists the candidate config to the local overrides
// file. Keys are emitted in a stable order so the file diffs cleanly.
// Mode 0600 because it contains an API key.
func writeOverrides(req *configRequest) error {
	configWriteMu.Lock()
	defer configWriteMu.Unlock()
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".kubilitics")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(dir, "ai-overrides.yaml")
	body := renderOverrides(req)
	return os.WriteFile(path, []byte(body), 0o600)
}

func renderOverrides(req *configRequest) string {
	var b strings.Builder
	b.WriteString("# Managed by kubilitics-backend AI settings UI.\n")
	b.WriteString("# kubilitics-ai reloads this file on SIGHUP or restart.\n")
	b.WriteString("provider: " + req.Provider + "\n")
	if req.Model != "" {
		b.WriteString("model: " + req.Model + "\n")
	}
	if req.BaseURL != "" {
		b.WriteString("base_url: " + req.BaseURL + "\n")
	}
	if req.APIKey != "" {
		b.WriteString("api_key: " + req.APIKey + "\n")
	}
	return b.String()
}

func writeConfigErr(w http.ResponseWriter, msg string, code int) {
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(configResponse{OK: false, Error: msg})
}
