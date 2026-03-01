package websocket

import (
	"context"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// Handler handles WebSocket connections
type Handler struct {
	hub            *Hub
	informerMgr    *k8s.InformerManager
	ctx            context.Context
	cfg            *config.Config
	repo           *repository.SQLiteRepository
	upgrader       websocket.Upgrader
}

// NewHandler creates a new WebSocket handler
func NewHandler(ctx context.Context, hub *Hub, informerMgr *k8s.InformerManager, cfg *config.Config, repo *repository.SQLiteRepository) *Handler {
	allowedOrigins := cfg.AllowedOrigins
	if len(allowedOrigins) == 0 {
		allowedOrigins = []string{"http://localhost:5173", "http://localhost:819"}
	}
	
	originMap := make(map[string]bool)
	for _, origin := range allowedOrigins {
		originMap[strings.ToLower(origin)] = true
	}

	return &Handler{
		hub:         hub,
		informerMgr: informerMgr,
		ctx:         ctx,
		cfg:         cfg,
		repo:        repo,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				if origin == "" {
					// Some clients don't send Origin header (e.g., native apps)
					// Allow if auth is disabled or if token is provided
					return true
				}
				originLower := strings.ToLower(origin)
				allowed := originMap[originLower]
				if !allowed {
					log.Printf("WebSocket connection rejected from unauthorized origin: %s", origin)
				}
				return allowed
			},
		},
	}
}

// ServeWS handles websocket requests from clients
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	// Authenticate before upgrading connection
	var claims *auth.Claims
	mode := strings.ToLower(strings.TrimSpace(h.cfg.AuthMode))
	if mode == "" {
		mode = "disabled"
	}

	if mode != "disabled" {
		// Try API key first
		apiKey := r.Header.Get("X-API-Key")
		if apiKey != "" && h.repo != nil {
			var err error
			claims, err = h.validateAPIKey(r.Context(), apiKey)
			if err != nil {
				if mode == "required" {
					h.rejectConnection(w, "Invalid or expired API key")
					return
				}
				// optional mode: continue without auth
			}
		}

		// Try Bearer token if API key didn't work
		if claims == nil {
			token := h.extractBearer(r)
			if token != "" {
				var err error
				claims, err = auth.ValidateToken(h.cfg.AuthJWTSecret, token)
				if err != nil {
					if mode == "required" {
						h.rejectConnection(w, "Invalid or expired token")
						return
					}
					// optional mode: continue without auth
				} else if claims.Refresh {
					if mode == "required" {
						h.rejectConnection(w, "Use access token for this request")
						return
					}
					claims = nil // Don't use refresh token
				}
			} else if mode == "required" {
				h.rejectConnection(w, "Authentication required")
				return
			}
		}
	}

	// Upgrade connection
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := uuid.New().String()
	client := NewClient(h.ctx, h.hub, conn, clientID, claims)

	// Register client
	h.hub.register <- client

	// Start client goroutines
	go client.WritePump()
	go client.ReadPump()

	if claims != nil {
		log.Printf("New authenticated WebSocket client connected: %s (user: %s)", clientID, claims.Username)
	} else {
		log.Printf("New WebSocket client connected: %s (unauthenticated)", clientID)
	}
}

// rejectConnection sends an HTTP error response and closes the connection
func (h *Handler) rejectConnection(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"` + message + `"}`))
}

// validateAPIKey validates an API key and returns claims
func (h *Handler) validateAPIKey(ctx context.Context, plaintextKey string) (*auth.Claims, error) {
	apiKey, err := h.repo.FindAPIKeyByPlaintext(ctx, plaintextKey)
	if err != nil || apiKey == nil {
		return nil, err
	}

	// Check if expired
	if apiKey.IsExpired() {
		return nil, auth.ErrExpiredToken
	}

	// Get user to build claims
	user, err := h.repo.GetUserByID(ctx, apiKey.UserID)
	if err != nil || user == nil {
		return nil, err
	}

	// Update last used
	_ = h.repo.UpdateAPIKeyLastUsed(ctx, apiKey.ID)

	// Build claims
	claims := &auth.Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		Refresh:  false,
	}
	return claims, nil
}

// extractBearer extracts Bearer token from request.
// Falls back to ?token= query parameter (DEPRECATED — will be removed in a future version).
func (h *Handler) extractBearer(r *http.Request) string {
	s := r.Header.Get("Authorization")
	if s == "" {
		token := r.URL.Query().Get("token")
		if token != "" {
			log.Printf("[ws-auth] DEPRECATED: ?token= query parameter used from %s for WebSocket %s — migrate to Authorization header",
				r.RemoteAddr, r.URL.Path)
			metrics.AuthDeprecatedTokenQueryTotal.Inc()
		}
		return token
	}
	const prefix = "Bearer "
	if len(s) > len(prefix) && strings.EqualFold(s[:len(prefix)], prefix) {
		return strings.TrimSpace(s[len(prefix):])
	}
	return ""
}

// SetupInformerHandlers connects K8s informers to WebSocket broadcasts
func (h *Handler) SetupInformerHandlers() {
	// Register handlers for all resource types
	resourceTypes := []string{
		"Pod", "Service", "Deployment", "ReplicaSet", "StatefulSet", "DaemonSet",
		"ConfigMap", "Secret", "Node", "Namespace",
		"PersistentVolume", "PersistentVolumeClaim",
		"Job", "CronJob",
		"Ingress", "IngressClass", "NetworkPolicy",
		"Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding",
		"ServiceAccount", "Endpoints", "Event",
		"StorageClass", "HorizontalPodAutoscaler", "PodDisruptionBudget",
	}

	for _, resourceType := range resourceTypes {
		rt := resourceType // Capture for closure
		h.informerMgr.RegisterHandler(rt, func(eventType string, obj interface{}) {
			// clusterID/namespace can be passed when informers are per-cluster (invokes topology cache invalidation)
			if err := h.hub.BroadcastResourceEvent("", "", eventType, rt, obj); err != nil {
				log.Printf("Failed to broadcast %s event for %s: %v", eventType, rt, err)
			}
		})
	}
}
