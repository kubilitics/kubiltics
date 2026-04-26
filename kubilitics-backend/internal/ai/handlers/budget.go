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

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

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
			_, _ = fmt.Sscanf(v, "%f", &out.GlobalMonthlyBudget)
		case "per_user_monthly_budget":
			_, _ = fmt.Sscanf(v, "%f", &out.PerUserMonthlyBudget)
		case "per_investigation_limit":
			_, _ = fmt.Sscanf(v, "%d", &out.PerInvestigationLimit)
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
