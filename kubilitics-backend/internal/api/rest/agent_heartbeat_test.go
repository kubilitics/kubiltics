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

func setupHeartbeat(t *testing.T) (*AgentHeartbeatHandler, string, string) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	cluster := &models.AgentCluster{
		ID: uuid.NewString(), OrganizationID: defaultOrgID, ClusterUID: "uid-x",
		Name: "c", Status: "active", CredentialEpoch: 1,
	}
	if err := repo.UpsertCluster(context.Background(), cluster); err != nil {
		t.Fatal(err)
	}
	access, _ := signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID, OrgID: defaultOrgID, Epoch: 1, TTL: time.Hour,
	})
	return NewAgentHeartbeatHandler(repo, signer), cluster.ID, access
}

func TestHeartbeat_OK(t *testing.T) {
	h, clusterID, access := setupHeartbeat(t)
	body, _ := json.Marshal(map[string]any{
		"cluster_id":      clusterID,
		"cluster_uid":     "uid-x",
		"agent_version":   "0.4.0",
		"k8s_version":     "v1.29",
		"status":          "healthy",
		"resource_counts": map[string]int{"nodes": 3, "pods": 50, "namespaces": 4},
	})
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestHeartbeat_BadToken(t *testing.T) {
	h, clusterID, _ := setupHeartbeat(t)
	body, _ := json.Marshal(map[string]string{"cluster_id": clusterID, "cluster_uid": "uid-x", "status": "healthy"})
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer not-a-jwt")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("got %d", rr.Code)
	}
}

func TestHeartbeat_UIDMismatch_410(t *testing.T) {
	h, clusterID, access := setupHeartbeat(t)
	body, _ := json.Marshal(map[string]string{"cluster_id": clusterID, "cluster_uid": "DIFFERENT", "status": "healthy"})
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 410 {
		t.Fatalf("got %d", rr.Code)
	}
}

func TestHeartbeat_EpochMismatch_401(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	cluster := &models.AgentCluster{
		ID: uuid.NewString(), OrganizationID: defaultOrgID, ClusterUID: "uid-y",
		Name: "c", Status: "active", CredentialEpoch: 5,
	}
	if err := repo.UpsertCluster(context.Background(), cluster); err != nil {
		t.Fatal(err)
	}
	// Mint an access token with stale epoch (3 vs cluster's 5).
	access, _ := signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID, OrgID: defaultOrgID, Epoch: 3, TTL: time.Hour,
	})
	h := NewAgentHeartbeatHandler(repo, signer)
	body, _ := json.Marshal(map[string]string{"cluster_id": cluster.ID, "cluster_uid": "uid-y", "status": "healthy"})
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("expected 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct{ Code string `json:"code"` }
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Code != "epoch_mismatch" {
		t.Fatalf("expected epoch_mismatch, got %q", resp.Code)
	}
}
