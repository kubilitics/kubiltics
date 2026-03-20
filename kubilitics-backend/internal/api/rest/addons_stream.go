package rest

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

const (
	addonPingInterval = 30 * time.Second
	addonPongWait     = 75 * time.Second
)

// addonStreamUpgrader is no longer used — replaced by h.newWSUpgrader() for proper origin validation.

// StreamInstall handles GET /clusters/{clusterId}/addons/install/stream.
// WebSocket: client sends one JSON message (InstallRequest), server streams InstallProgressEvent as JSON messages.
// Message format: { "step": string, "message": string, "status": "pending"|"running"|"success"|"error"|"complete"|"failed", "timestamp": ISO8601 }
//
// Authentication: The JWT must be validated BEFORE the HTTP→WebSocket upgrade.
// Once upgraded, HTTP status codes (401, 403) can no longer be sent to the client.
// The token is read from the Authorization header ("Bearer <token>") or the
// "token" query parameter (for browser WebSocket clients that cannot set headers).
func (h *Handler) StreamInstall(w http.ResponseWriter, r *http.Request) {
	if h.addonService == nil {
		respondErrorWithRequestID(w, r, http.StatusNotImplemented, ErrCodeInternalError, "addon service not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, err := h.resolveClusterID(r.Context(), vars["clusterId"])
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	// Authenticate BEFORE upgrading to WebSocket.
	// After upgrade it is impossible to send HTTP 401/403 responses.
	// The auth middleware validates the Authorization header (or ?token= query param for
	// browser WebSocket clients that cannot set custom headers) and populates r.Context().
	//
	// When AuthMode == "" | "disabled" the Auth middleware passes through WITHOUT setting
	// claims — we must not reject the request in that case. Instead synthesize an anonymous
	// "system" principal so Actor is always set for audit logging.
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		authMode := strings.ToLower(strings.TrimSpace(h.cfg.AuthMode))
		if authMode != "" && authMode != "disabled" {
			respondErrorWithRequestID(w, r, http.StatusUnauthorized, ErrCodeUnauthorized, "authentication required")
			return
		}
		// Auth disabled — synthesise a system actor for audit logging
		claims = &auth.Claims{Username: "system"}
	}

	// Enforce per-cluster per-user WebSocket connection limit.
	wsRelease, wsErr := h.wsAcquire(r, clusterID)
	if wsErr != nil {
		respondError(w, http.StatusTooManyRequests, wsErr.Error())
		return
	}
	defer wsRelease()

	upgrader := h.newWSUpgrader(4096, 4096)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Ping-pong heartbeat: detect dead clients during long installs
	_ = conn.SetReadDeadline(time.Now().Add(addonPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(addonPongWait))
	})
	pingStop := make(chan struct{})
	defer close(pingStop)
	go func() {
		ticker := time.NewTicker(addonPingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-pingStop:
				return
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// Read first message: InstallRequest JSON
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return
	}
	var body addonInstallBody
	if err := json.Unmarshal(raw, &body); err != nil {
		_ = conn.WriteJSON(map[string]string{"status": "failed", "message": "invalid JSON body"})
		return
	}
	if body.AddonID == "" || body.Namespace == "" {
		_ = conn.WriteJSON(map[string]string{"status": "failed", "message": "addon_id and namespace required"})
		return
	}
	if body.ReleaseName == "" {
		body.ReleaseName = body.AddonID
	}
	req := service.InstallRequest{
		AddonID:         body.AddonID,
		ReleaseName:     body.ReleaseName,
		Namespace:       body.Namespace,
		Values:          body.Values,
		CreateNamespace: body.CreateNamespace,
		Actor:           claims.Username,
		// WebSocket clients pass the idempotency key in the initial JSON message.
		IdempotencyKey:  strings.TrimSpace(body.IdempotencyKey),
	}

	progressCh := make(chan service.InstallProgressEvent, 50)
	done := make(chan struct{})
	var installErr error
	go func() {
		defer close(done)
		_, installErr = h.addonService.ExecuteInstall(r.Context(), clusterID, req, progressCh)
		close(progressCh)
	}()

	for ev := range progressCh {
		msg := map[string]interface{}{
			"step":      ev.Step,
			"message":   ev.Message,
			"status":    ev.Status,
			"timestamp": ev.Timestamp.Format(time.RFC3339),
		}
		if err := conn.WriteJSON(msg); err != nil {
			return
		}
	}
	<-done

	if installErr != nil {
		_ = conn.WriteJSON(map[string]string{"status": "failed", "message": installErr.Error()})
		return
	}
	_ = conn.WriteJSON(map[string]string{"status": "complete"})
}
