package rest

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// AgentHeartbeatHandler handles POST /api/v1/agent/heartbeat.
// It verifies the short-lived access token issued at registration/refresh,
// validates the cluster_uid against the stored record, and updates the
// cluster's heartbeat timestamp in the database.
type AgentHeartbeatHandler struct {
	repo   *repository.AgentRepo
	signer *agenttoken.Signer
}

// NewAgentHeartbeatHandler constructs an AgentHeartbeatHandler.
func NewAgentHeartbeatHandler(repo *repository.AgentRepo, signer *agenttoken.Signer) *AgentHeartbeatHandler {
	return &AgentHeartbeatHandler{repo: repo, signer: signer}
}

type heartbeatRequest struct {
	ClusterID      string         `json:"cluster_id"`
	ClusterUID     string         `json:"cluster_uid"`
	AgentVersion   string         `json:"agent_version"`
	K8sVersion     string         `json:"k8s_version"`
	Status         string         `json:"status"`
	ResourceCounts map[string]int `json:"resource_counts"`
}

type heartbeatResponse struct {
	Ack                 bool          `json:"ack"`
	DesiredAgentVersion string        `json:"desired_agent_version,omitempty"`
	Commands            []interface{} `json:"commands"`
}

func (h *AgentHeartbeatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAgentErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}

	tok := bearerToken(r)
	if tok == "" {
		writeAgentErr(w, http.StatusUnauthorized, "no_token", "missing bearer token")
		return
	}
	claims, err := h.signer.VerifyAccess(tok)
	if err != nil {
		writeAgentErr(w, http.StatusUnauthorized, "access_invalid", err.Error())
		return
	}

	var req heartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAgentErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.ClusterID != claims.ClusterID {
		writeAgentErr(w, http.StatusUnauthorized, "cluster_mismatch", "cluster_id does not match token")
		return
	}

	cluster, err := h.repo.GetClusterByID(r.Context(), claims.ClusterID)
	if err != nil {
		if errors.Is(err, repository.ErrAgentNotFound) {
			writeAgentErr(w, http.StatusUnauthorized, "cluster_unknown", "cluster gone")
			return
		}
		writeAgentErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if claims.Epoch != cluster.CredentialEpoch {
		writeAgentErr(w, http.StatusUnauthorized, "epoch_mismatch", "credential rotated")
		return
	}
	if req.ClusterUID != cluster.ClusterUID {
		// DB was restored into a different physical cluster — force re-registration.
		_ = h.repo.MarkClusterSuperseded(r.Context(), cluster.ID)
		writeAgentErr(w, http.StatusGone, "uid_mismatch", "cluster_uid changed; re-register")
		return
	}

	nodes := req.ResourceCounts["nodes"]
	if err := h.repo.UpdateClusterHeartbeat(r.Context(), cluster.ID, "active",
		req.AgentVersion, req.K8sVersion, nodes, time.Now()); err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	writeAgentJSON(w, http.StatusOK, heartbeatResponse{Ack: true, Commands: []interface{}{}})
}

// bearerToken extracts the token from the Authorization: Bearer <token> header.
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}
