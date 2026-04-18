package rest

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// AgentTokenHandler handles POST /agent/token/refresh.
type AgentTokenHandler struct {
	repo   *repository.AgentRepo
	signer *agenttoken.Signer
}

// NewAgentTokenHandler constructs an AgentTokenHandler.
func NewAgentTokenHandler(repo *repository.AgentRepo, signer *agenttoken.Signer) *AgentTokenHandler {
	return &AgentTokenHandler{repo: repo, signer: signer}
}

func (h *AgentTokenHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
		writeAgentErr(w, 400, "bad_request", "refresh_token required")
		return
	}

	cred, cluster, err := h.repo.FindActiveCredentialByToken(r.Context(), req.RefreshToken, agenttoken.VerifyRefreshToken)
	if err != nil {
		if errors.Is(err, repository.ErrAgentNotFound) {
			writeAgentErr(w, 401, "refresh_invalid", "no matching credential")
			return
		}
		writeAgentErr(w, 500, "db_error", err.Error())
		return
	}
	// Defense-in-depth: FindActiveCredentialByToken pre-filters expired
	// credentials in SQL (expires_at > CURRENT_TIMESTAMP), so under normal
	// operation this branch is unreachable. The check stays as a guard in
	// case the SQL filter is ever relaxed for analytics.
	if cred.ExpiresAt.Before(time.Now()) {
		writeAgentErr(w, 401, "refresh_expired", "refresh expired")
		return
	}
	if cred.CredentialEpoch != cluster.CredentialEpoch {
		writeAgentErr(w, 401, "epoch_mismatch", "credential epoch mismatch")
		return
	}

	access, err := h.signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID,
		OrgID:     cluster.OrganizationID,
		Epoch:     cluster.CredentialEpoch,
		TTL:       accessTTL,
	})
	if err != nil {
		writeAgentErr(w, 500, "token_mint_failed", err.Error())
		return
	}
	_ = h.repo.TouchAgentCredential(r.Context(), cred.ID, time.Now())

	writeAgentJSON(w, 200, map[string]any{
		"access_token": access,
		"access_ttl_s": int(accessTTL.Seconds()),
	})
}
