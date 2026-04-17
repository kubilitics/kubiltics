package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestRegister_RemoteBootstrapHappyPath(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	jti := uuid.NewString()
	_ = repo.InsertBootstrapToken(context.Background(), &models.BootstrapToken{
		JTI: jti, OrganizationID: defaultOrgID, CreatedBy: "admin",
		ExpiresAt: time.Now().Add(time.Hour),
	})
	tok, _ := signer.IssueBootstrap(agenttoken.BootstrapClaims{
		JTI: jti, OrgID: defaultOrgID, CreatedBy: "admin", TTL: time.Hour,
	})

	h := NewAgentRegisterHandler(repo, signer, nil, "different-hub-cluster-uid")
	body, _ := json.Marshal(map[string]any{
		"bootstrap_token": tok,
		"cluster_uid":     "remote-cluster-uid",
		"cluster_name":    "remote-1",
		"agent_version":   "0.4.0",
		"k8s_version":     "v1.29.3",
		"node_count":      3,
	})
	req := httptest.NewRequest("POST", "/api/v1/agent/register", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp registerResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.ClusterID == "" || resp.RefreshToken == "" || resp.AccessToken == "" {
		t.Fatalf("missing fields: %+v", resp)
	}
}

func TestRegister_RemoteReplayRejected(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	jti := uuid.NewString()
	_ = repo.InsertBootstrapToken(context.Background(), &models.BootstrapToken{
		JTI: jti, OrganizationID: defaultOrgID, CreatedBy: "admin",
		ExpiresAt: time.Now().Add(time.Hour),
	})
	tok, _ := signer.IssueBootstrap(agenttoken.BootstrapClaims{
		JTI: jti, OrgID: defaultOrgID, TTL: time.Hour,
	})
	h := NewAgentRegisterHandler(repo, signer, nil, "hub-uid")

	body := []byte(`{"bootstrap_token":"` + tok + `","cluster_uid":"u-1","cluster_name":"a","agent_version":"0.4.0","k8s_version":"v1.29","node_count":1}`)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != 200 {
		t.Fatalf("first call: %d %s", rr.Code, rr.Body.String())
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("replay should be 401, got %d", rr.Code)
	}
}

func TestRegister_SameClusterUIDMismatchRejected(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	rev := fakeReviewer{authed: true, username: "system:serviceaccount:kubilitics-system:agent"}
	h := NewAgentRegisterHandler(repo, signer, rev, "hub-uid-AAA")

	body := []byte(`{"sa_token":"any","cluster_uid":"DIFFERENT-uid","cluster_name":"a","agent_version":"0.4.0","k8s_version":"v1.29","node_count":1}`)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}
