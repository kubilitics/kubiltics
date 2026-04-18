package rest

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
)

func TestMintBootstrapToken(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	h := NewAgentAdminHandler(repo, signer)

	body := []byte(`{"organization_id":"00000000-0000-0000-0000-000000000001","ttl_seconds":3600}`)
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("X-User-ID", "admin-user")
	rr := httptest.NewRecorder()
	h.MintBootstrap(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Token       string `json:"bootstrap_token"`
		HelmCommand string `json:"helm_command"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Token == "" || resp.HelmCommand == "" {
		t.Fatalf("got %+v", resp)
	}
}
