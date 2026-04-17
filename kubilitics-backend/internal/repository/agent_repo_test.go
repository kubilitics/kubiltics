package repository

import (
	"context"
	"testing"
	"time"

	models "github.com/kubilitics/kubilitics-backend/internal/models"
)

// newTestAgentRepo reuses the existing newTestRepo helper to open an in-memory
// SQLite DB with all migrations applied, then wraps the underlying *sql.DB in
// an AgentRepo.
func newTestAgentRepo(t *testing.T) *AgentRepo {
	t.Helper()
	repo := newTestRepo(t)
	// sqlx.DB embeds *sql.DB via .DB
	return NewAgentRepo(repo.db.DB)
}

func TestMigration051Applied(t *testing.T) {
	repo := newTestRepo(t)

	rows, err := repo.db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organizations','agent_clusters','bootstrap_tokens','agent_credentials')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		_ = rows.Scan(&n)
		names = append(names, n)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(names) != 4 {
		t.Fatalf("expected 4 agent-trust tables, got %v", names)
	}
}

func TestUpsertClusterAndGetByUID(t *testing.T) {
	r := newTestAgentRepo(t)
	c := models.AgentCluster{
		ID: "c1", OrganizationID: "00000000-0000-0000-0000-000000000001",
		ClusterUID: "uid-1", Name: "k1", Status: "active", CredentialEpoch: 1,
	}
	if err := r.UpsertCluster(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetClusterByUID(context.Background(), c.OrganizationID, "uid-1")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "c1" || got.Name != "k1" {
		t.Fatalf("got %+v", got)
	}
}

func TestBootstrapTokenLifecycle(t *testing.T) {
	r := newTestAgentRepo(t)
	bt := models.BootstrapToken{
		JTI: "j1", OrganizationID: "00000000-0000-0000-0000-000000000001",
		CreatedBy: "admin", ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := r.InsertBootstrapToken(context.Background(), &bt); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetBootstrapToken(context.Background(), "j1")
	if err != nil {
		t.Fatal(err)
	}
	if got.UsedAt != nil {
		t.Fatal("expected unused")
	}

	// Need a cluster to use the token against.
	_ = r.UpsertCluster(context.Background(), &models.AgentCluster{
		ID: "c1", OrganizationID: "00000000-0000-0000-0000-000000000001",
		ClusterUID: "u-c1", Name: "k", Status: "active", CredentialEpoch: 1,
	})
	if err := r.MarkBootstrapTokenUsed(context.Background(), "j1", "c1"); err != nil {
		t.Fatal(err)
	}
	got, _ = r.GetBootstrapToken(context.Background(), "j1")
	if got.UsedAt == nil {
		t.Fatal("expected used_at set")
	}
}

func TestAgentCredentialActiveLookup(t *testing.T) {
	r := newTestAgentRepo(t)
	_ = r.UpsertCluster(context.Background(), &models.AgentCluster{
		ID: "c1", OrganizationID: "00000000-0000-0000-0000-000000000001",
		ClusterUID: "u1", Name: "k", Status: "active", CredentialEpoch: 1,
	})
	cred := models.AgentCredential{
		ID: "cr1", ClusterID: "c1",
		RefreshTokenHash: "argon2id$00$00",
		ExpiresAt:        time.Now().Add(365 * 24 * time.Hour),
		CredentialEpoch:  1,
	}
	if err := r.InsertAgentCredential(context.Background(), &cred); err != nil {
		t.Fatal(err)
	}
	got, err := r.ListActiveCredentialsByCluster(context.Background(), "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d", len(got))
	}
	if err := r.RevokeAgentCredential(context.Background(), "cr1"); err != nil {
		t.Fatal(err)
	}
	got, _ = r.ListActiveCredentialsByCluster(context.Background(), "c1")
	if len(got) != 0 {
		t.Fatalf("expected 0 active, got %d", len(got))
	}
}
