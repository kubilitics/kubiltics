package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func decodeErrCode(t *testing.T, body []byte) string {
	t.Helper()
	var resp struct{ Code string `json:"code"` }
	if err := json.Unmarshal(body, &resp); err != nil { t.Fatalf("decode: %v", err) }
	return resp.Code
}

func TestRefresh_HappyPath(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))

	cluster := &models.AgentCluster{
		ID: uuid.NewString(), OrganizationID: defaultOrgID, ClusterUID: "u",
		Name: "c", Status: "active", CredentialEpoch: 1,
	}
	if err := repo.UpsertCluster(context.Background(), cluster); err != nil {
		t.Fatal(err)
	}
	tok, _ := agenttoken.NewRefreshToken()
	hash, _ := agenttoken.HashRefreshToken(tok)
	if err := repo.InsertAgentCredential(context.Background(), &models.AgentCredential{
		ID: uuid.NewString(), ClusterID: cluster.ID, RefreshTokenHash: hash,
		ExpiresAt: time.Now().Add(time.Hour), CredentialEpoch: 1,
	}); err != nil {
		t.Fatal(err)
	}

	h := NewAgentTokenHandler(repo, signer)
	body, _ := json.Marshal(map[string]string{"refresh_token": tok})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		AccessToken string `json:"access_token"`
		AccessTTLs  int    `json:"access_ttl_s"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.AccessToken == "" || resp.AccessTTLs == 0 {
		t.Fatalf("got %+v", resp)
	}
}

func TestRefresh_Unknown(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	h := NewAgentTokenHandler(repo, signer)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader([]byte(`{"refresh_token":"rk_live_nope"}`))))
	if rr.Code != 401 {
		t.Fatalf("got %d", rr.Code)
	}
	if c := decodeErrCode(t, rr.Body.Bytes()); c != "refresh_invalid" {
		t.Fatalf("expected refresh_invalid, got %q", c)
	}
}

func TestRefresh_EpochMismatch(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))

	cluster := &models.AgentCluster{
		ID: uuid.NewString(), OrganizationID: defaultOrgID, ClusterUID: "u2",
		Name: "c", Status: "active", CredentialEpoch: 5,
	}
	if err := repo.UpsertCluster(context.Background(), cluster); err != nil {
		t.Fatal(err)
	}
	tok, _ := agenttoken.NewRefreshToken()
	hash, _ := agenttoken.HashRefreshToken(tok)
	// Insert credential with stale epoch (3 vs cluster's 5).
	if err := repo.InsertAgentCredential(context.Background(), &models.AgentCredential{
		ID: uuid.NewString(), ClusterID: cluster.ID, RefreshTokenHash: hash,
		ExpiresAt: time.Now().Add(time.Hour), CredentialEpoch: 3,
	}); err != nil {
		t.Fatal(err)
	}

	h := NewAgentTokenHandler(repo, signer)
	body, _ := json.Marshal(map[string]string{"refresh_token": tok})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != 401 {
		t.Fatalf("expected 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	if c := decodeErrCode(t, rr.Body.Bytes()); c != "epoch_mismatch" {
		t.Fatalf("expected epoch_mismatch, got %q", c)
	}
}
