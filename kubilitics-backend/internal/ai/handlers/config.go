package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
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

// GetConfig serves GET /api/v1/ai/config. Returns the persisted overrides
// (provider, model, base_url) with the API key MASKED — only the last 4
// chars are returned so the frontend can render `sk-…XYZ9` while the real
// key stays server-side. Returns empty fields if no config has been saved.
func (h *Handlers) GetConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	cfg, err := readOverrides()
	if err != nil {
		writeConfigErr(w, fmt.Sprintf("read overrides: %v", err), http.StatusInternalServerError)
		return
	}
	masked := ""
	if len(cfg.APIKey) > 4 {
		masked = "••••" + cfg.APIKey[len(cfg.APIKey)-4:]
	} else if cfg.APIKey != "" {
		masked = "••••"
	}
	_ = json.NewEncoder(w).Encode(map[string]string{
		"provider":       cfg.Provider,
		"model":          cfg.Model,
		"base_url":       cfg.BaseURL,
		"api_key_masked": masked,
		"has_api_key":    fmt.Sprintf("%t", cfg.APIKey != ""),
	})
}

// readOverrides parses the ~/.kubilitics/ai-overrides.yaml file. Returns
// zero-value config if missing.
func readOverrides() (*configRequest, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(home, ".kubilitics", "ai-overrides.yaml")
	body, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &configRequest{}, nil
		}
		return nil, err
	}
	out := &configRequest{}
	for _, line := range strings.Split(string(body), "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok || strings.HasPrefix(k, "#") {
			continue
		}
		v = strings.TrimSpace(v)
		switch strings.TrimSpace(k) {
		case "provider":
			out.Provider = v
		case "model":
			out.Model = v
		case "base_url":
			out.BaseURL = v
		case "api_key":
			out.APIKey = v
		}
	}
	return out, nil
}

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
	// Merge with existing on disk: when the user re-saves with an empty API key
	// (e.g. they only changed the model), keep the previously stored key instead
	// of wiping it. The frontend never re-sends the masked value, so empty here
	// means "leave it alone" for hosted providers.
	if existing, _ := readOverrides(); existing != nil && req.APIKey == "" && existing.APIKey != "" {
		req.APIKey = existing.APIKey
	}
	if err := writeOverrides(req); err != nil {
		writeConfigErr(w, fmt.Sprintf("persist overrides: %v", err), http.StatusInternalServerError)
		return
	}
	// Best-effort: SIGHUP the brain so it re-reads the overrides without a
	// process restart. If the brain isn't running locally (or runs in-cluster)
	// this is a no-op — the next brain start will pick up the file.
	go reloadBrain()
	_ = json.NewEncoder(w).Encode(configResponse{
		OK:              true,
		AppliedProvider: req.Provider,
		AppliedModel:    req.Model,
	})
}

// reloadBrain sends SIGHUP to any local kubilitics-ai server process. The
// brain has a SIGHUP handler that reloads its config. Best-effort: errors
// are swallowed because the in-cluster (Helm-deployed) deployment doesn't
// have a discoverable PID and the next brain restart picks up the override
// file regardless.
func reloadBrain() {
	cmd := exec.Command("pkill", "-HUP", "-f", "kubilitics-ai.*/server$")
	_ = cmd.Run()
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
	// Same merge as PostConfig: when validating with empty api_key, fall back
	// to the saved key (if any) so "click Validate again" works after a reload
	// — the user shouldn't have to re-paste the key every time.
	if existing, _ := readOverrides(); existing != nil && req.APIKey == "" && existing.APIKey != "" {
		req.APIKey = existing.APIKey
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

// ─── Budget ────────────────────────────────────────────────────────────────

type budgetConfig struct {
	GlobalMonthlyBudget   float64 `json:"global_monthly_budget"`
	PerUserMonthlyBudget  float64 `json:"per_user_monthly_budget"`
	PerInvestigationLimit int     `json:"per_investigation_limit"`
}

var budgetWriteMu sync.Mutex

// GetBudget serves GET /api/v1/ai/budget. Returns the persisted budget
// caps from ~/.kubilitics/ai-budget.yaml (or zero values if unset).
func (h *Handlers) GetBudget(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	b, err := readBudget()
	if err != nil {
		writeConfigErr(w, fmt.Sprintf("read budget: %v", err), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(b)
}

// PostBudget serves POST /api/v1/ai/budget. Persists the candidate budget
// to ~/.kubilitics/ai-budget.yaml. The brain reads this on next launch /
// SIGHUP. Validation: non-negative values; per-investigation 0 means unlimited.
func (h *Handlers) PostBudget(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.cfg.Enabled {
		writeConfigErr(w, types.DisabledReasonAIDisabled, http.StatusServiceUnavailable)
		return
	}
	var req budgetConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeConfigErr(w, fmt.Sprintf("decode body: %v", err), http.StatusBadRequest)
		return
	}
	if req.GlobalMonthlyBudget < 0 || req.PerUserMonthlyBudget < 0 || req.PerInvestigationLimit < 0 {
		writeConfigErr(w, "budget values must be non-negative", http.StatusBadRequest)
		return
	}
	if err := writeBudget(req); err != nil {
		writeConfigErr(w, fmt.Sprintf("persist budget: %v", err), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "applied": req})
}

func budgetPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".kubilitics", "ai-budget.yaml"), nil
}

func readBudget() (budgetConfig, error) {
	path, err := budgetPath()
	if err != nil {
		return budgetConfig{}, err
	}
	body, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return budgetConfig{}, nil
		}
		return budgetConfig{}, err
	}
	out := budgetConfig{}
	for _, line := range strings.Split(string(body), "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok || strings.HasPrefix(k, "#") {
			continue
		}
		v = strings.TrimSpace(v)
		switch strings.TrimSpace(k) {
		case "global_monthly_budget":
			fmt.Sscanf(v, "%f", &out.GlobalMonthlyBudget)
		case "per_user_monthly_budget":
			fmt.Sscanf(v, "%f", &out.PerUserMonthlyBudget)
		case "per_investigation_limit":
			fmt.Sscanf(v, "%d", &out.PerInvestigationLimit)
		}
	}
	return out, nil
}

func writeBudget(b budgetConfig) error {
	budgetWriteMu.Lock()
	defer budgetWriteMu.Unlock()
	path, err := budgetPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	body := fmt.Sprintf(
		"# Managed by kubilitics-backend AI budget UI.\n# kubilitics-ai reads this on SIGHUP or restart.\nglobal_monthly_budget: %g\nper_user_monthly_budget: %g\nper_investigation_limit: %d\n",
		b.GlobalMonthlyBudget, b.PerUserMonthlyBudget, b.PerInvestigationLimit,
	)
	return os.WriteFile(path, []byte(body), 0o600)
}
