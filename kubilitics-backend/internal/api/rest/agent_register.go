package rest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

const (
	accessTTL          = time.Hour
	refreshTTL         = 365 * 24 * time.Hour
	heartbeatIntervalS = 30
)

// Reviewer is the minimal interface this handler needs from the
// k8s TokenReview wrapper. Tests inject a fake.
type Reviewer interface {
	Review(ctx context.Context, token string) (k8s.ReviewResult, error)
}

// AgentRegisterHandler handles POST /api/v1/agent/register for both
// remote (bootstrap token) and same-cluster (SA token) flows.
type AgentRegisterHandler struct {
	repo          *repository.AgentRepo
	signer        *agenttoken.Signer
	reviewer      Reviewer // may be nil if hub doesn't expect same-cluster traffic
	hubClusterUID string
}

// NewAgentRegisterHandler constructs an AgentRegisterHandler.
func NewAgentRegisterHandler(repo *repository.AgentRepo, signer *agenttoken.Signer, reviewer Reviewer, hubClusterUID string) *AgentRegisterHandler {
	return &AgentRegisterHandler{repo: repo, signer: signer, reviewer: reviewer, hubClusterUID: hubClusterUID}
}

type registerRequest struct {
	BootstrapToken string `json:"bootstrap_token,omitempty"`
	SAToken        string `json:"sa_token,omitempty"`
	ClusterUID     string `json:"cluster_uid"`
	ClusterName    string `json:"cluster_name,omitempty"`
	AgentVersion   string `json:"agent_version"`
	K8sVersion     string `json:"k8s_version"`
	NodeCount      int    `json:"node_count"`
}

type registerResponse struct {
	ClusterID          string `json:"cluster_id"`
	RefreshToken       string `json:"refresh_token"`
	AccessToken        string `json:"access_token"`
	AccessTTLs         int    `json:"access_ttl_s"`
	HeartbeatIntervalS int    `json:"heartbeat_interval_s"`
}

func (h *AgentRegisterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAgentErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAgentErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.ClusterUID == "" {
		writeAgentErr(w, http.StatusBadRequest, "bad_request", "cluster_uid required")
		return
	}

	var orgID, createdBy, jti string
	switch {
	case req.BootstrapToken != "":
		claims, err := h.signer.VerifyBootstrap(req.BootstrapToken)
		if err != nil {
			writeAgentErr(w, http.StatusUnauthorized, "token_invalid", err.Error())
			return
		}
		bt, err := h.repo.GetBootstrapToken(r.Context(), claims.JTI)
		if err != nil {
			writeAgentErr(w, http.StatusUnauthorized, "token_unknown", "unknown jti")
			return
		}
		if bt.UsedAt != nil {
			writeAgentErr(w, http.StatusUnauthorized, "token_used", "token already used")
			return
		}
		if bt.RevokedAt != nil {
			writeAgentErr(w, http.StatusUnauthorized, "token_revoked", "token revoked")
			return
		}
		if time.Now().After(bt.ExpiresAt) {
			writeAgentErr(w, http.StatusUnauthorized, "token_expired", "token expired")
			return
		}
		orgID, createdBy, jti = claims.OrgID, claims.CreatedBy, claims.JTI

	case req.SAToken != "":
		if h.reviewer == nil {
			writeAgentErr(w, http.StatusForbidden, "no_local_authn", "same-cluster auth not enabled")
			return
		}
		res, err := h.reviewer.Review(r.Context(), req.SAToken)
		if err != nil || !res.Authenticated {
			writeAgentErr(w, http.StatusUnauthorized, "sa_invalid", "TokenReview failed")
			return
		}
		if req.ClusterUID != h.hubClusterUID {
			writeAgentErr(w, http.StatusForbidden, "cluster_mismatch", "sa_token cannot be used from a different cluster")
			return
		}
		orgID, createdBy = defaultOrgID, "sa:"+res.Username

	default:
		writeAgentErr(w, http.StatusBadRequest, "bad_request", "either bootstrap_token or sa_token required")
		return
	}

	// NOTE: Spec §7.1 lists 409 Conflict for "same cluster_uid presented with
	// proof that doesn't match the existing cluster's ownership". This handler
	// currently treats every valid bootstrap as legitimate re-registration
	// (epoch bump). Hardening to 409 is deferred to a follow-up spec; the
	// admin "Reset cluster" UI flow (not yet built) is the intended remediation.
	cluster, err := h.repo.GetClusterByUID(r.Context(), orgID, req.ClusterUID)
	if err != nil && !errors.Is(err, repository.ErrAgentNotFound) {
		writeAgentErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	name := req.ClusterName
	if name == "" {
		name = "cluster-" + req.ClusterUID[:min(6, len(req.ClusterUID))]
	}
	if cluster == nil {
		cluster = &models.AgentCluster{
			ID:              uuid.NewString(),
			OrganizationID:  orgID,
			ClusterUID:      req.ClusterUID,
			Name:            name,
			K8sVersion:      req.K8sVersion,
			AgentVersion:    req.AgentVersion,
			NodeCount:       req.NodeCount,
			Status:          "active",
			CredentialEpoch: 1,
		}
	} else {
		cluster.K8sVersion = req.K8sVersion
		cluster.AgentVersion = req.AgentVersion
		cluster.NodeCount = req.NodeCount
		cluster.Status = "active"
		cluster.CredentialEpoch++
	}
	if err := h.repo.UpsertCluster(r.Context(), cluster); err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// MarkBootstrapTokenUsed runs AFTER UpsertCluster so that concurrent
	// replays race-fail here on the atomic WHERE used_at IS NULL guard
	// rather than racing in the cluster upsert. Order matters.
	if jti != "" {
		if err := h.repo.MarkBootstrapTokenUsed(r.Context(), jti, cluster.ID); err != nil {
			writeAgentErr(w, http.StatusUnauthorized, "token_used", "race: token used")
			return
		}
	}

	refresh, err := agenttoken.NewRefreshToken()
	if err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "token_mint_failed", "failed to generate refresh token")
		return
	}
	hash, err := agenttoken.HashRefreshToken(refresh)
	if err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "token_mint_failed", "failed to hash refresh token")
		return
	}
	cred := &models.AgentCredential{
		ID:               uuid.NewString(),
		ClusterID:        cluster.ID,
		RefreshTokenHash: hash,
		ExpiresAt:        time.Now().Add(refreshTTL),
		CredentialEpoch:  cluster.CredentialEpoch,
	}
	if err := h.repo.InsertAgentCredential(r.Context(), cred); err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	access, err := h.signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID, OrgID: orgID, Epoch: cluster.CredentialEpoch, TTL: accessTTL,
	})
	if err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "token_mint_failed", "failed to issue access token")
		return
	}

	_ = createdBy // reserved for audit log in later spec
	writeAgentJSON(w, http.StatusOK, registerResponse{
		ClusterID:          cluster.ID,
		RefreshToken:       refresh,
		AccessToken:        access,
		AccessTTLs:         int(accessTTL.Seconds()),
		HeartbeatIntervalS: heartbeatIntervalS,
	})
}

// writeAgentErr writes a structured JSON error response.
// Uses the "Agent" prefix to avoid colliding with the package-level
// respondStructuredError / respondErrorWithCode helpers.
func writeAgentErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeAgentJSON(w, code, map[string]string{"code": errCode, "message": msg})
}

// writeAgentJSON serialises v as JSON and writes it with the given HTTP status.
func writeAgentJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

