package rest

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// SecurityHandler handles /api/v1/security/* endpoints
type SecurityHandler struct {
	repo *repository.SQLiteRepository
	cfg  *config.Config
}

// NewSecurityHandler creates a new security handler
func NewSecurityHandler(repo *repository.SQLiteRepository, cfg *config.Config) *SecurityHandler {
	return &SecurityHandler{
		repo: repo,
		cfg:  cfg,
	}
}

// RegisterRoutes registers security routes
func (h *SecurityHandler) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/security/events", h.ListSecurityEvents).Methods("GET")
	router.HandleFunc("/security/events/stats", h.GetSecurityEventStats).Methods("GET")
	router.HandleFunc("/security/ip/{ipAddress}/unblock", h.UnblockIP).Methods("POST")
}

// ListSecurityEvents lists security events (admin only)
func (h *SecurityHandler) ListSecurityEvents(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	// Parse query parameters
	eventType := r.URL.Query().Get("event_type")
	ipAddress := r.URL.Query().Get("ip_address")
	sinceStr := r.URL.Query().Get("since")
	limitStr := r.URL.Query().Get("limit")

	var eventTypePtr *string
	if eventType != "" {
		eventTypePtr = &eventType
	}

	var ipAddressPtr *string
	if ipAddress != "" {
		ipAddressPtr = &ipAddress
	}

	var sincePtr *time.Time
	if sinceStr != "" {
		if since, err := time.Parse(time.RFC3339, sinceStr); err == nil {
			sincePtr = &since
		}
	}

	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	events, err := h.repo.ListSecurityEvents(r.Context(), eventTypePtr, ipAddressPtr, sincePtr, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list security events: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(events)
}

// SecurityEventStatsResponse is the response for GET /security/events/stats
type SecurityEventStatsResponse struct {
	TotalEvents        int                       `json:"total_events"`
	EventsByType       map[string]int            `json:"events_by_type"`
	HighRiskEvents     int                       `json:"high_risk_events"` // risk_score >= 80
	BlockedIPs         int                       `json:"blocked_ips"`
	RecentEvents       []*models.SecurityEvent   `json:"recent_events"`
}

// GetSecurityEventStats gets security event statistics
func (h *SecurityHandler) GetSecurityEventStats(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	// Get events from last 24 hours
	since := time.Now().Add(-24 * time.Hour)
	events, err := h.repo.ListSecurityEvents(r.Context(), nil, nil, &since, 1000)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to get security events: "+err.Error())
		return
	}

	stats := SecurityEventStatsResponse{
		TotalEvents:    len(events),
		EventsByType:   make(map[string]int),
		HighRiskEvents: 0,
		RecentEvents:   events,
	}

	// Count events by type and high-risk events
	for _, event := range events {
		stats.EventsByType[event.EventType]++
		if event.RiskScore >= 80 {
			stats.HighRiskEvents++
		}
	}

	// Count blocked IPs
	blockedIPs, _ := h.repo.ListBlockedIPs(r.Context())
	stats.BlockedIPs = len(blockedIPs)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(stats)
}

// UnblockIPRequest is the body for POST /security/ip/{ipAddress}/unblock
type UnblockIPRequest struct {
	Reason string `json:"reason,omitempty"`
}

// UnblockIP unblocks an IP address
func (h *SecurityHandler) UnblockIP(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	ipAddress := vars["ipAddress"]

	// Unblock by setting blocked_until to NULL
	if err := h.repo.UnblockIP(r.Context(), ipAddress); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to unblock IP: "+err.Error())
		return
	}

	// Log security event
	event := &models.SecurityEvent{
		EventType: "ip_unblocked",
		IPAddress:  ipAddress,
		Action:     "unblock",
		RiskScore:  0,
		Details:    `{"reason": "admin_unblock"}`,
		CreatedAt:  time.Now(),
	}
	_ = h.repo.CreateSecurityEvent(r.Context(), event)

	w.WriteHeader(http.StatusNoContent)
}
