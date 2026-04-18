package rest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// AgentAdminHandler provides admin-only operations for the agent trust model.
type AgentAdminHandler struct {
	repo   *repository.AgentRepo
	signer *agenttoken.Signer
}

// NewAgentAdminHandler constructs an AgentAdminHandler.
func NewAgentAdminHandler(repo *repository.AgentRepo, signer *agenttoken.Signer) *AgentAdminHandler {
	return &AgentAdminHandler{repo: repo, signer: signer}
}

type mintRequest struct {
	OrganizationID string `json:"organization_id"`
	TTLSeconds     int    `json:"ttl_seconds"`
}

// MintBootstrap issues a single-use bootstrap token for an organization and
// returns the signed JWT together with a ready-to-run helm install command.
//
// Auth/permission checking is OUT OF SCOPE here — it will be added when the
// broader RBAC spec is implemented. The handler trusts X-User-ID for the
// audit field only; it does not enforce any authorization policy.
func (h *AgentAdminHandler) MintBootstrap(w http.ResponseWriter, r *http.Request) {
	var req mintRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAgentErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.OrganizationID == "" {
		req.OrganizationID = defaultOrgID
	}
	if req.TTLSeconds <= 0 {
		req.TTLSeconds = 24 * 3600
	}
	if req.TTLSeconds < 900 || req.TTLSeconds > 7*24*3600 {
		writeAgentErr(w, http.StatusBadRequest, "ttl_out_of_range", "ttl must be 900..604800 seconds")
		return
	}

	// X-User-ID is recorded for audit purposes only; no authorization is enforced here.
	createdBy := r.Header.Get("X-User-ID")
	if createdBy == "" {
		createdBy = "anonymous"
	}

	jti := uuid.NewString()
	ttl := time.Duration(req.TTLSeconds) * time.Second

	tok, err := h.signer.IssueBootstrap(agenttoken.BootstrapClaims{
		JTI:       jti,
		OrgID:     req.OrganizationID,
		CreatedBy: createdBy,
		TTL:       ttl,
	})
	if err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "sign_error", err.Error())
		return
	}

	if err := h.repo.InsertBootstrapToken(r.Context(), &models.BootstrapToken{
		JTI:            jti,
		OrganizationID: req.OrganizationID,
		CreatedBy:      createdBy,
		ExpiresAt:      time.Now().Add(ttl),
	}); err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	hubURL := os.Getenv("KUBILITICS_PUBLIC_HUB_URL")
	if hubURL == "" {
		hubURL = "https://<your-hub>"
	}
	helmCmd := fmt.Sprintf(
		"helm install kubilitics-agent kubilitics/kubilitics-agent "+
			"-n kubilitics-system --create-namespace "+
			"--set hub.url=%s --set hub.token=%s",
		hubURL, tok,
	)

	writeAgentJSON(w, http.StatusOK, map[string]any{
		"bootstrap_token": tok,
		"jti":             jti,
		"expires_at":      time.Now().Add(ttl).UTC().Format(time.RFC3339),
		"helm_command":    helmCmd,
	})
}
