package rest

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// notificationChannelBody is the JSON body for POST and PATCH /addons/notification-channels
type notificationChannelBody struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"` // "slack" | "webhook"
	URL     string   `json:"url"`
	Events  []string `json:"events"`  // e.g. ["install","failed"]
	Enabled *bool    `json:"enabled"` // nil means keep existing on PATCH
}

// ListNotificationChannels handles GET /addons/notification-channels
func (h *Handler) ListNotificationChannels(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "repository not configured")
		return
	}
	channels, err := h.repo.ListNotificationChannels(r.Context())
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, channels)
}

// CreateNotificationChannel handles POST /addons/notification-channels
func (h *Handler) CreateNotificationChannel(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "repository not configured")
		return
	}
	var body notificationChannelBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.Name == "" || body.URL == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "name and url required")
		return
	}
	chanType := models.NotificationChannelType(body.Type)
	if chanType == "" {
		chanType = models.NotificationChannelWebhook
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	events := body.Events
	if len(events) == 0 {
		events = []string{"install", "upgrade", "uninstall", "failed"}
	}
	ch := &models.NotificationChannel{
		Name:    body.Name,
		Type:    chanType,
		URL:     body.URL,
		Events:  events,
		Enabled: enabled,
	}
	if err := h.repo.CreateNotificationChannel(r.Context(), ch); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, ch)
}

// UpdateNotificationChannel handles PATCH /addons/notification-channels/{channelId}
func (h *Handler) UpdateNotificationChannel(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "repository not configured")
		return
	}
	channelID := mux.Vars(r)["channelId"]
	if channelID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "channelId required")
		return
	}
	existing, err := h.repo.GetNotificationChannel(r.Context(), channelID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	var body notificationChannelBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "invalid JSON body")
		return
	}
	if body.Name != "" {
		existing.Name = body.Name
	}
	if body.URL != "" {
		existing.URL = body.URL
	}
	if body.Type != "" {
		existing.Type = models.NotificationChannelType(body.Type)
	}
	if len(body.Events) > 0 {
		existing.Events = body.Events
	}
	if body.Enabled != nil {
		existing.Enabled = *body.Enabled
	}
	if err := h.repo.UpdateNotificationChannel(r.Context(), existing); err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, existing)
}

// DeleteNotificationChannel handles DELETE /addons/notification-channels/{channelId}
func (h *Handler) DeleteNotificationChannel(w http.ResponseWriter, r *http.Request) {
	if h.repo == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "repository not configured")
		return
	}
	channelID := mux.Vars(r)["channelId"]
	if channelID == "" {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "channelId required")
		return
	}
	// Require admin for deletion.
	if h.cfg.AuthMode != "" && h.cfg.AuthMode != "disabled" {
		claims := auth.ClaimsFromContext(r.Context())
		if claims == nil || claims.Role != auth.RoleAdmin {
			respondErrorWithRequestID(w, r, http.StatusForbidden, ErrCodeInternalError, "admin required")
			return
		}
	}
	if err := h.repo.DeleteNotificationChannel(r.Context(), channelID); err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
