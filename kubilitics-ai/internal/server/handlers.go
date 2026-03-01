package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/analytics"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	"github.com/kubilitics/kubilitics-ai/internal/safety"
)

// LLMCompleteRequest represents a request to the LLM complete endpoint
type LLMCompleteRequest struct {
	Messages []types.Message `json:"messages"`
	Tools    []types.Tool    `json:"tools,omitempty"`
}

// LLMCompleteResponse represents a response from the LLM complete endpoint
type LLMCompleteResponse struct {
	Content   string        `json:"content"`
	Tools     []interface{} `json:"tools,omitempty"`
	Timestamp time.Time     `json:"timestamp"`
}

// handleLLMComplete handles LLM completion requests (updated implementation)
func (s *Server) handleLLMComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request
	var req LLMCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.Messages) == 0 {
		http.Error(w, "Messages cannot be empty", http.StatusBadRequest)
		return
	}

	// Get LLM adapter — may be unconfigured when no API key has been provided yet.
	llmAdapter := s.GetLLMAdapter()
	if llmAdapter == nil || !s.config.LLM.Configured {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"error":"LLM not configured","code":"LLM_NOT_CONFIGURED","hint":"Add your API key in Settings \u2192 AI Configuration"}`))
		return
	}

	// Call LLM
	content, tools, err := llmAdapter.Complete(r.Context(), req.Messages, req.Tools)
	if err != nil {
		http.Error(w, fmt.Sprintf("LLM error: %v", err), http.StatusInternalServerError)
		return
	}

	// Return response
	resp := LLMCompleteResponse{
		Content:   content,
		Tools:     tools,
		Timestamp: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// handleLLMStream handles LLM streaming requests (placeholder - use WebSocket instead)
func (s *Server) handleLLMStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "redirect",
		"message": "Use WebSocket endpoint /ws/chat for streaming",
	})
}

// SafetyEvaluateRequest represents a request to evaluate an action's safety
type SafetyEvaluateRequest struct {
	Action safety.Action `json:"action"`
}

// SafetyEvaluateResponse represents a safety evaluation response
type SafetyEvaluateResponse struct {
	Result    *safety.SafetyResult `json:"result"`
	Timestamp time.Time            `json:"timestamp"`
}

// handleSafetyEvaluate handles safety evaluation requests (updated implementation)
func (s *Server) handleSafetyEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request
	var req SafetyEvaluateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Get safety engine
	safetyEngine := s.GetSafetyEngine()
	if safetyEngine == nil {
		http.Error(w, "Safety engine not initialized", http.StatusInternalServerError)
		return
	}

	// Evaluate action
	result, err := safetyEngine.EvaluateAction(r.Context(), &req.Action)
	if err != nil {
		http.Error(w, fmt.Sprintf("Safety evaluation error: %v", err), http.StatusInternalServerError)
		return
	}

	// Return response
	resp := SafetyEvaluateResponse{
		Result:    result,
		Timestamp: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// SafetyRulesResponse represents immutable safety rules response
type SafetyRulesResponse struct {
	Rules     []string  `json:"rules"`
	Timestamp time.Time `json:"timestamp"`
}

// handleSafetyRules handles safety rules requests (updated implementation)
func (s *Server) handleSafetyRules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Check if LLM is configured
	if !s.config.LLM.Configured {
		http.Error(w, "AI provider not configured", http.StatusServiceUnavailable)
		return
	}

	// Get safety engine
	safetyEngine := s.GetSafetyEngine()
	if safetyEngine == nil {
		http.Error(w, "Safety engine not initialized", http.StatusInternalServerError)
		return
	}

	// Get immutable rules
	rules, err := safetyEngine.GetImmutableRules(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get rules: %v", err), http.StatusInternalServerError)
		return
	}

	// Return response
	resp := SafetyRulesResponse{
		Rules:     rules,
		Timestamp: time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// SafetyPoliciesResponse represents configurable policies response
type SafetyPoliciesResponse struct {
	Policies  []interface{} `json:"policies"`
	Timestamp time.Time     `json:"timestamp"`
}

// handleSafetyPolicies handles safety policies requests (updated implementation)
func (s *Server) handleSafetyPolicies(w http.ResponseWriter, r *http.Request) {
	// Get safety engine
	safetyEngine := s.GetSafetyEngine()
	if safetyEngine == nil {
		http.Error(w, "Safety engine not initialized", http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Get all policies
		policies, err := safetyEngine.GetPolicies(r.Context())
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get policies: %v", err), http.StatusInternalServerError)
			return
		}

		resp := SafetyPoliciesResponse{
			Policies:  policies,
			Timestamp: time.Now(),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)

	case http.MethodPost:
		// Create policy
		var req map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
			return
		}

		name, _ := req["name"].(string)
		rule := req["rule"]

		if err := safetyEngine.CreatePolicy(r.Context(), name, rule); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create policy: %v", err), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"status": "created"})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// AnalyticsAnomaliesRequest represents anomaly detection request
type AnalyticsAnomaliesRequest struct {
	TimeSeries  analytics.TimeSeries `json:"time_series"`
	Sensitivity string               `json:"sensitivity"` // high, medium, low
}

// AnalyticsAnomaliesResponse represents anomaly detection response
type AnalyticsAnomaliesResponse struct {
	Anomalies []analytics.Anomaly `json:"anomalies"`
	Timestamp time.Time           `json:"timestamp"`
}

// handleAnalyticsAnomalies handles anomaly detection requests.
// GET  /api/v1/analytics/anomalies[?namespace=<ns>]  – returns cached/empty list (no body required).
// POST /api/v1/analytics/anomalies                   – runs detection on the supplied TimeSeries body.
func (s *Server) handleAnalyticsAnomalies(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// GET: return an empty (or engine-cached) anomaly list — no body required.
	// This is called by the frontend dashboard on startup to populate the anomaly feed.
	if r.Method == http.MethodGet {
		resp := AnalyticsAnomaliesResponse{
			Anomalies: []analytics.Anomaly{},
			Timestamp: time.Now(),
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request
	var req AnalyticsAnomaliesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Default sensitivity
	if req.Sensitivity == "" {
		req.Sensitivity = "medium"
	}

	// Get analytics engine
	analyticsEngine := s.GetAnalyticsEngine()
	if analyticsEngine == nil {
		http.Error(w, "Analytics engine not initialized", http.StatusInternalServerError)
		return
	}

	// Detect anomalies
	anomalies, err := analyticsEngine.DetectAnomalies(r.Context(), &req.TimeSeries, req.Sensitivity)
	if err != nil {
		http.Error(w, fmt.Sprintf("Anomaly detection error: %v", err), http.StatusInternalServerError)
		return
	}

	// Return response
	resp := AnalyticsAnomaliesResponse{
		Anomalies: anomalies,
		Timestamp: time.Now(),
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// AnalyticsTrendsRequest represents trend analysis request
type AnalyticsTrendsRequest struct {
	TimeSeries analytics.TimeSeries `json:"time_series"`
}

// AnalyticsTrendsResponse represents trend analysis response
type AnalyticsTrendsResponse struct {
	Trend     *analytics.Trend `json:"trend"`
	Timestamp time.Time        `json:"timestamp"`
}

// handleAnalyticsTrends handles trend analysis requests.
// GET  /api/v1/analytics/trends[?namespace=<ns>]  – returns empty trend (no body required).
// POST /api/v1/analytics/trends                   – runs analysis on the supplied TimeSeries body.
func (s *Server) handleAnalyticsTrends(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// GET: return an empty trend list — no body required.
	if r.Method == http.MethodGet {
		resp := AnalyticsTrendsResponse{
			Trend:     nil,
			Timestamp: time.Now(),
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request
	var req AnalyticsTrendsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Get analytics engine
	analyticsEngine := s.GetAnalyticsEngine()
	if analyticsEngine == nil {
		http.Error(w, "Analytics engine not initialized", http.StatusInternalServerError)
		return
	}

	// Analyze trend
	trend, err := analyticsEngine.AnalyzeTrend(r.Context(), &req.TimeSeries)
	if err != nil {
		http.Error(w, fmt.Sprintf("Trend analysis error: %v", err), http.StatusInternalServerError)
		return
	}

	// Return response
	resp := AnalyticsTrendsResponse{
		Trend:     trend,
		Timestamp: time.Now(),
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// AnalyticsRecommendationsRequest represents recommendations request
type AnalyticsRecommendationsRequest struct {
	ResourceType string               `json:"resource_type"`
	TimeSeries   analytics.TimeSeries `json:"time_series"`
}

// AnalyticsRecommendationsResponse represents recommendations response
type AnalyticsRecommendationsResponse struct {
	Recommendations []analytics.Recommendation `json:"recommendations"`
	Timestamp       time.Time                  `json:"timestamp"`
}

// handleAnalyticsRecommendations handles recommendation requests.
// GET  /api/v1/analytics/recommendations[?namespace=<ns>]  – returns empty list (no body required).
// POST /api/v1/analytics/recommendations                   – generates recommendations from body.
func (s *Server) handleAnalyticsRecommendations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// GET: return an empty recommendations list — no body required.
	if r.Method == http.MethodGet {
		resp := AnalyticsRecommendationsResponse{
			Recommendations: []analytics.Recommendation{},
			Timestamp:       time.Now(),
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request
	var req AnalyticsRecommendationsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Get analytics engine
	analyticsEngine := s.GetAnalyticsEngine()
	if analyticsEngine == nil {
		http.Error(w, "Analytics engine not initialized", http.StatusInternalServerError)
		return
	}

	// Generate recommendations
	recommendations, err := analyticsEngine.GenerateRecommendations(r.Context(), req.ResourceType, &req.TimeSeries)
	if err != nil {
		http.Error(w, fmt.Sprintf("Recommendation generation error: %v", err), http.StatusInternalServerError)
		return
	}

	// Return response
	resp := AnalyticsRecommendationsResponse{
		Recommendations: recommendations,
		Timestamp:       time.Now(),
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}
