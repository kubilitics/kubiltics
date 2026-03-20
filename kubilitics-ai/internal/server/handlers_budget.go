package server

// A-CORE-014: Token budget enforcement REST handlers.
//
// Routes (all under /api/v1/budget/):
//   GET  /api/v1/budget/summary           → usage summary for a user (user_id query param, default "global")
//   GET  /api/v1/budget/details           → per-investigation usage breakdown
//   GET  /api/v1/budget/limits            → current budget limits for a user
//   POST /api/v1/budget/limits            → set a budget limit for a user
//   POST /api/v1/budget/record            → record token usage (from LLM call)
//   POST /api/v1/budget/check             → check if budget is available for estimated token count
//   POST /api/v1/budget/reset             → reset budget counters for a user
//   GET  /api/v1/budget/estimate          → estimate cost for token counts + provider

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// handleBudgetDispatch routes /api/v1/budget/* requests.
func (s *Server) handleBudgetDispatch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/budget")
	path = strings.TrimPrefix(path, "/")

	switch path {
	case "", "summary":
		s.handleBudgetSummary(w, r)
	case "details":
		s.handleBudgetDetails(w, r)
	case "limits":
		if r.Method == http.MethodPost {
			s.handleBudgetSetLimit(w, r)
		} else {
			s.handleBudgetGetLimits(w, r)
		}
	case "record":
		s.handleBudgetRecord(w, r)
	case "check":
		s.handleBudgetCheck(w, r)
	case "reset":
		s.handleBudgetReset(w, r)
	case "estimate":
		s.handleBudgetEstimate(w, r)
	default:
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// GET /api/v1/budget/summary?user_id=xxx
func (s *Server) handleBudgetSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "global"
	}

	summary, err := s.budgetTracker.GetUsageSummary(r.Context(), userID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(summary)
}

// GET /api/v1/budget/details?user_id=xxx&investigation_id=yyy
func (s *Server) handleBudgetDetails(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	q := r.URL.Query()
	userID := q.Get("user_id")
	if userID == "" {
		userID = "global"
	}
	investigationID := q.Get("investigation_id")

	details, err := s.budgetTracker.GetUsageDetails(r.Context(), userID, investigationID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"user_id":          userID,
		"investigation_id": investigationID,
		"entries":          details,
	})
}

// GET /api/v1/budget/limits?user_id=xxx
func (s *Server) handleBudgetGetLimits(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "global"
	}

	limits, err := s.budgetTracker.GetBudgetLimits(r.Context(), userID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(limits)
}

// POST /api/v1/budget/limits  body: { "user_id": "xxx", "limit_usd": 10.0 }
func (s *Server) handleBudgetSetLimit(w http.ResponseWriter, r *http.Request) {
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	var body struct {
		UserID   string  `json:"user_id"`
		LimitUSD float64 `json:"limit_usd"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if body.UserID == "" {
		body.UserID = "global"
	}
	if body.LimitUSD < 0 {
		http.Error(w, `{"error":"limit_usd must be >= 0 (0 = unlimited)"}`, http.StatusBadRequest)
		return
	}

	if err := s.budgetTracker.SetBudgetLimit(r.Context(), body.UserID, body.LimitUSD); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "updated",
		"user_id":   body.UserID,
		"limit_usd": body.LimitUSD,
	})
}

// POST /api/v1/budget/record  body: { "user_id":"", "investigation_id":"", "input_tokens":N, "output_tokens":N, "provider":"openai" }
func (s *Server) handleBudgetRecord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	var body struct {
		UserID          string `json:"user_id"`
		InvestigationID string `json:"investigation_id"`
		InputTokens     int    `json:"input_tokens"`
		OutputTokens    int    `json:"output_tokens"`
		Provider        string `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if body.InputTokens < 0 || body.OutputTokens < 0 {
		http.Error(w, `{"error":"token counts must be >= 0"}`, http.StatusBadRequest)
		return
	}
	if body.Provider == "" {
		body.Provider = "openai"
	}
	if body.UserID == "" {
		body.UserID = "global"
	}

	if err := s.budgetTracker.RecordTokenUsage(r.Context(),
		body.UserID, body.InvestigationID,
		body.InputTokens, body.OutputTokens, body.Provider); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	// Return updated cost estimate
	cost, _ := s.budgetTracker.GetEstimatedCost(r.Context(), body.InputTokens, body.OutputTokens, body.Provider)
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"status":       "recorded",
		"cost_usd":     cost,
		"total_tokens": body.InputTokens + body.OutputTokens,
	})
}

// POST /api/v1/budget/check  body: { "user_id": "xxx", "estimated_tokens": N }
func (s *Server) handleBudgetCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	var body struct {
		UserID          string `json:"user_id"`
		EstimatedTokens int    `json:"estimated_tokens"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if body.UserID == "" {
		body.UserID = "global"
	}

	available, warn := s.budgetTracker.CheckBudgetAvailable(r.Context(), body.UserID, body.EstimatedTokens)
	resp := map[string]any{
		"available": available,
		"user_id":   body.UserID,
	}
	if warn != nil {
		resp["warning"] = warn.Error()
	}
	if !available {
		w.WriteHeader(http.StatusPaymentRequired)
	}
	json.NewEncoder(w).Encode(resp)
}

// POST /api/v1/budget/reset  body: { "user_id": "xxx" }
func (s *Server) handleBudgetReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	var body struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if body.UserID == "" {
		body.UserID = "global"
	}

	if err := s.budgetTracker.ResetBudget(r.Context(), body.UserID); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "reset",
		"user_id": body.UserID,
	})
}

// GET /api/v1/budget/estimate?input_tokens=N&output_tokens=N&provider=openai
func (s *Server) handleBudgetEstimate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.budgetTracker == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "budget tracker not initialised"})
		return
	}

	q := r.URL.Query()
	inputTokens := parseIntParam(q.Get("input_tokens"), 0)
	outputTokens := parseIntParam(q.Get("output_tokens"), 0)
	provider := q.Get("provider")
	if provider == "" {
		provider = "openai"
	}

	// Validate provider from query params
	validProviders := []string{"openai", "anthropic", "ollama", "custom"}
	valid := false
	for _, vp := range validProviders {
		if provider == vp {
			valid = true
			break
		}
	}
	if !valid {
		provider = "openai"
	}

	// Validate token counts
	if s := q.Get("input_tokens"); s != "" {
		if v, err := strconv.Atoi(s); err != nil || v < 0 {
			http.Error(w, `{"error":"input_tokens must be a non-negative integer"}`, http.StatusBadRequest)
			return
		}
	}

	cost, err := s.budgetTracker.GetEstimatedCost(r.Context(), inputTokens, outputTokens, provider)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"provider":      provider,
		"input_tokens":  inputTokens,
		"output_tokens": outputTokens,
		"total_tokens":  inputTokens + outputTokens,
		"estimated_usd": cost,
	})
}
