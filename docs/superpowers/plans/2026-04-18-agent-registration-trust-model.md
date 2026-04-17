# Agent Registration & Trust Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement hub-and-spoke agent registration and trust: same-cluster auto-discovery via TokenReview, remote token bootstrap, refresh+access JWT pair for steady-state, with hub APIs, agent process, and Helm chart wiring.

**Architecture:** Hub is the existing Go backend (`kubilitics-backend`, gorilla/mux REST, SQLite repository, `internal/auth` for JWT). A new top-level Go module `kubilitics-agent` provides the agent binary and Helm chart. Agent → Hub is outbound HTTPS; hub mints HS256 bootstrap JWTs and issues refresh (opaque, argon2id-hashed) + access (JWT) credential pairs. Cluster identity = `kube-system` Namespace UID.

**Tech Stack:** Go 1.22, gorilla/mux, golang.org/x/time/rate, github.com/golang-jwt/jwt/v5, github.com/google/uuid, golang.org/x/crypto/argon2, k8s.io/client-go (TokenReview), SQLite (existing repository), Helm 3.

---

## Spec reference

`docs/superpowers/specs/2026-04-18-agent-registration-trust-model-design.md`

## File structure

| File | Responsibility |
|---|---|
| `kubilitics-backend/migrations/044_agent_registration.sql` | New tables: `organizations` (stub), `clusters`, `bootstrap_tokens`, `agent_credentials` and indexes. |
| `kubilitics-backend/internal/models/agent.go` | Plain structs: `Cluster`, `BootstrapToken`, `AgentCredential`. |
| `kubilitics-backend/internal/auth/agenttoken/signer.go` | Issue + verify HS256 bootstrap JWTs and access JWTs. |
| `kubilitics-backend/internal/auth/agenttoken/refresh.go` | Generate refresh tokens, argon2id hash + verify. |
| `kubilitics-backend/internal/auth/agenttoken/signer_test.go` | Unit tests for signer + refresh helpers. |
| `kubilitics-backend/internal/repository/agent_repo.go` | DB access for clusters, bootstrap_tokens, agent_credentials. |
| `kubilitics-backend/internal/repository/agent_repo_test.go` | Repository tests on in-memory SQLite. |
| `kubilitics-backend/internal/k8s/tokenreview.go` | Thin TokenReview wrapper over `client-go`. |
| `kubilitics-backend/internal/api/rest/agent_register.go` | POST `/api/v1/agent/register`. |
| `kubilitics-backend/internal/api/rest/agent_token.go` | POST `/api/v1/agent/token/refresh`. |
| `kubilitics-backend/internal/api/rest/agent_heartbeat.go` | POST `/api/v1/agent/heartbeat` + access-JWT middleware. |
| `kubilitics-backend/internal/api/rest/agent_*_test.go` | Handler tests with sqlmock + httptest. |
| `kubilitics-backend/internal/api/rest/agent_admin.go` | POST `/api/v1/admin/clusters/bootstrap-token` to mint a bootstrap token. |
| `kubilitics-backend/cmd/server/main.go` | Wire signer, repo, handlers into router; load signing secret. |
| `kubilitics-agent/go.mod`, `cmd/agent/main.go` | New Go module entry point. |
| `kubilitics-agent/internal/config/config.go` | Env-var config (HUB_URL, BOOTSTRAP_TOKEN, CA bundle, intervals). |
| `kubilitics-agent/internal/credstore/secret.go` | Read/write `kubilitics-agent-creds` Secret. |
| `kubilitics-agent/internal/hubclient/client.go` | Typed HTTP client: register, refresh, heartbeat. |
| `kubilitics-agent/internal/bootstrap/bootstrap.go` | Decide same-cluster vs remote, perform registration. |
| `kubilitics-agent/internal/heartbeat/loop.go` | Heartbeat ticker; reacts to 401/410. |
| `kubilitics-agent/internal/clusteruid/uid.go` | Read kube-system NS UID. |
| `kubilitics-agent/Dockerfile` | Build image. |
| `deploy/helm/kubilitics-agent/Chart.yaml`, `values.yaml`, `templates/*` | Agent chart: Deployment, ServiceAccount, RBAC, optional Secret for caBundle. |
| `deploy/helm/kubilitics/templates/agent-signing-secret.yaml` | Hub: signing-secret Secret (auto-generated on first install, kept on upgrade). |
| `deploy/helm/kubilitics/templates/_helpers.tpl` (modify) | Helper for in-cluster agent service DNS. |
| `kubilitics-backend/tests/e2e/agent_registration_kind_test.go` | End-to-end kind test (hub + same-cluster + remote agent). |

Each unit is independently testable. Hub units depend only on signer + repo + tokenreview wrapper; agent units depend only on hubclient + credstore.

---

## Task 1: DB migration + models

**Files:**
- Create: `kubilitics-backend/migrations/044_agent_registration.sql`
- Create: `kubilitics-backend/internal/models/agent.go`
- Test: `kubilitics-backend/internal/repository/agent_repo_test.go` (migration applied check only at this stage)

- [ ] **Step 1: Write the failing test**

Create `kubilitics-backend/internal/repository/agent_repo_test.go`:

```go
package repository

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestMigration044Applied(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil { t.Fatal(err) }
	defer db.Close()
	if err := ApplyMigrations(db, "../../migrations"); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organizations','clusters','bootstrap_tokens','agent_credentials')`)
	if err != nil { t.Fatal(err) }
	defer rows.Close()
	var names []string
	for rows.Next() { var n string; _ = rows.Scan(&n); names = append(names, n) }
	if len(names) != 4 {
		t.Fatalf("expected 4 tables, got %v", names)
	}
}
```

If `ApplyMigrations` does not exist yet, locate the existing migration runner used by the project (search `repository` package) and call it. If there is no in-package runner, use `internal/repository.New(...)` constructor and remove the migration-runner call — the test then asserts table existence after `New`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/repository -run TestMigration044Applied -v`
Expected: FAIL ("expected 4 tables, got [...]" missing the new ones).

- [ ] **Step 3: Create the migration**

Create `kubilitics-backend/migrations/044_agent_registration.sql`:

```sql
-- Agent registration & trust model (spec 2026-04-18).
CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default');

CREATE TABLE IF NOT EXISTS clusters (
    id                 TEXT PRIMARY KEY,
    organization_id    TEXT NOT NULL REFERENCES organizations(id),
    cluster_uid        TEXT NOT NULL,
    name               TEXT NOT NULL,
    k8s_version        TEXT NOT NULL DEFAULT '',
    agent_version      TEXT NOT NULL DEFAULT '',
    node_count         INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'registering',
    credential_epoch   INTEGER NOT NULL DEFAULT 1,
    registered_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_at  TIMESTAMP,
    UNIQUE (organization_id, cluster_uid)
);

CREATE TABLE IF NOT EXISTS bootstrap_tokens (
    jti              TEXT PRIMARY KEY,
    organization_id  TEXT NOT NULL REFERENCES organizations(id),
    created_by       TEXT NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at       TIMESTAMP NOT NULL,
    used_at          TIMESTAMP,
    used_by_cluster  TEXT REFERENCES clusters(id),
    revoked_at       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_credentials (
    id                  TEXT PRIMARY KEY,
    cluster_id          TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL,
    issued_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          TIMESTAMP NOT NULL,
    last_used_at        TIMESTAMP,
    revoked_at          TIMESTAMP,
    credential_epoch    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clusters_heartbeat ON clusters(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_creds_cluster_active
    ON agent_credentials(cluster_id) WHERE revoked_at IS NULL;
```

Create `kubilitics-backend/internal/models/agent.go`:

```go
package models

import "time"

type Cluster struct {
	ID               string
	OrganizationID   string
	ClusterUID       string
	Name             string
	K8sVersion       string
	AgentVersion     string
	NodeCount        int
	Status           string // registering|active|degraded|offline|superseded
	CredentialEpoch  int
	RegisteredAt     time.Time
	LastHeartbeatAt  *time.Time
}

type BootstrapToken struct {
	JTI             string
	OrganizationID  string
	CreatedBy       string
	CreatedAt       time.Time
	ExpiresAt       time.Time
	UsedAt          *time.Time
	UsedByCluster   *string
	RevokedAt       *time.Time
}

type AgentCredential struct {
	ID                string
	ClusterID         string
	RefreshTokenHash  string
	IssuedAt          time.Time
	ExpiresAt         time.Time
	LastUsedAt        *time.Time
	RevokedAt         *time.Time
	CredentialEpoch   int
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test ./internal/repository -run TestMigration044Applied -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/migrations/044_agent_registration.sql \
        kubilitics-backend/internal/models/agent.go \
        kubilitics-backend/internal/repository/agent_repo_test.go
git commit -m "feat(agent-trust): migration 044 + agent models"
```

---

## Task 2: Token signer (bootstrap + access JWT)

**Files:**
- Create: `kubilitics-backend/internal/auth/agenttoken/signer.go`
- Test: `kubilitics-backend/internal/auth/agenttoken/signer_test.go`

- [ ] **Step 1: Write the failing tests**

Create `kubilitics-backend/internal/auth/agenttoken/signer_test.go`:

```go
package agenttoken

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSignAndVerifyBootstrap(t *testing.T) {
	s := NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	jti := uuid.NewString()
	tok, err := s.IssueBootstrap(BootstrapClaims{
		JTI: jti, OrgID: "org1", CreatedBy: "user1", TTL: time.Hour,
	})
	if err != nil { t.Fatal(err) }
	got, err := s.VerifyBootstrap(tok)
	if err != nil { t.Fatalf("verify: %v", err) }
	if got.JTI != jti || got.OrgID != "org1" {
		t.Fatalf("claims mismatch: %+v", got)
	}
}

func TestVerifyBootstrap_Expired(t *testing.T) {
	s := NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	tok, _ := s.IssueBootstrap(BootstrapClaims{
		JTI: uuid.NewString(), OrgID: "o", CreatedBy: "u", TTL: -time.Second,
	})
	if _, err := s.VerifyBootstrap(tok); err == nil {
		t.Fatal("expected expired error")
	}
}

func TestVerifyBootstrap_BadSig(t *testing.T) {
	s1 := NewSigner([]byte("secret-A-padding-padding-padding"))
	s2 := NewSigner([]byte("secret-B-padding-padding-padding"))
	tok, _ := s1.IssueBootstrap(BootstrapClaims{
		JTI: uuid.NewString(), OrgID: "o", CreatedBy: "u", TTL: time.Hour,
	})
	if _, err := s2.VerifyBootstrap(tok); err == nil {
		t.Fatal("expected signature error")
	}
}

func TestSignAndVerifyAccess(t *testing.T) {
	s := NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	tok, err := s.IssueAccess(AccessClaims{
		ClusterID: "c1", OrgID: "o1", Epoch: 3, TTL: time.Hour,
	})
	if err != nil { t.Fatal(err) }
	got, err := s.VerifyAccess(tok)
	if err != nil { t.Fatal(err) }
	if got.ClusterID != "c1" || got.Epoch != 3 {
		t.Fatalf("got %+v", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd kubilitics-backend && go test ./internal/auth/agenttoken/ -v`
Expected: FAIL ("no Go files" or undefined symbols).

- [ ] **Step 3: Implement signer**

Create `kubilitics-backend/internal/auth/agenttoken/signer.go`:

```go
package agenttoken

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	issuer       = "kubilitics-hub"
	typBootstrap = "bootstrap"
	typAccess    = "access"
)

type Signer struct{ secret []byte }

func NewSigner(secret []byte) *Signer {
	if len(secret) < 32 {
		panic("agenttoken: signing secret must be >= 32 bytes")
	}
	return &Signer{secret: secret}
}

type BootstrapClaims struct {
	JTI       string
	OrgID     string
	CreatedBy string
	TTL       time.Duration
}

type AccessClaims struct {
	ClusterID string
	OrgID     string
	Epoch     int
	TTL       time.Duration
}

func (s *Signer) IssueBootstrap(c BootstrapClaims) (string, error) {
	now := time.Now()
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":        issuer,
		"typ":        typBootstrap,
		"jti":        c.JTI,
		"org_id":     c.OrgID,
		"created_by": c.CreatedBy,
		"iat":        now.Unix(),
		"exp":        now.Add(c.TTL).Unix(),
	})
	return t.SignedString(s.secret)
}

func (s *Signer) VerifyBootstrap(tok string) (*BootstrapClaims, error) {
	claims, err := s.parse(tok, typBootstrap)
	if err != nil { return nil, err }
	return &BootstrapClaims{
		JTI:       getString(claims, "jti"),
		OrgID:     getString(claims, "org_id"),
		CreatedBy: getString(claims, "created_by"),
	}, nil
}

func (s *Signer) IssueAccess(c AccessClaims) (string, error) {
	now := time.Now()
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":    issuer,
		"typ":    typAccess,
		"sub":    c.ClusterID,
		"org_id": c.OrgID,
		"epoch":  c.Epoch,
		"scope":  "agent",
		"iat":    now.Unix(),
		"exp":    now.Add(c.TTL).Unix(),
	})
	return t.SignedString(s.secret)
}

func (s *Signer) VerifyAccess(tok string) (*AccessClaims, error) {
	claims, err := s.parse(tok, typAccess)
	if err != nil { return nil, err }
	epoch, _ := claims["epoch"].(float64)
	return &AccessClaims{
		ClusterID: getString(claims, "sub"),
		OrgID:     getString(claims, "org_id"),
		Epoch:     int(epoch),
	}, nil
}

func (s *Signer) parse(tok, expectedTyp string) (jwt.MapClaims, error) {
	parsed, err := jwt.Parse(tok, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != "HS256" {
			return nil, fmt.Errorf("unexpected alg %s", t.Method.Alg())
		}
		return s.secret, nil
	})
	if err != nil { return nil, err }
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok || !parsed.Valid { return nil, errors.New("invalid token") }
	if getString(claims, "iss") != issuer { return nil, errors.New("bad issuer") }
	if getString(claims, "typ") != expectedTyp { return nil, errors.New("wrong token type") }
	return claims, nil
}

func getString(c jwt.MapClaims, k string) string {
	v, _ := c[k].(string)
	return v
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/auth/agenttoken/ -v`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/auth/agenttoken/
git commit -m "feat(agent-trust): bootstrap + access JWT signer"
```

---

## Task 3: Refresh token generator + argon2id hashing

**Files:**
- Create: `kubilitics-backend/internal/auth/agenttoken/refresh.go`
- Modify: `kubilitics-backend/internal/auth/agenttoken/signer_test.go` (add tests)

- [ ] **Step 1: Add failing tests**

Append to `kubilitics-backend/internal/auth/agenttoken/signer_test.go`:

```go
func TestNewRefreshTokenFormat(t *testing.T) {
	tok, err := NewRefreshToken()
	if err != nil { t.Fatal(err) }
	if len(tok) < 40 || tok[:8] != "rk_live_" {
		t.Fatalf("unexpected format: %s", tok)
	}
}

func TestHashAndVerifyRefresh(t *testing.T) {
	tok, _ := NewRefreshToken()
	h, err := HashRefreshToken(tok)
	if err != nil { t.Fatal(err) }
	if !VerifyRefreshToken(tok, h) {
		t.Fatal("verify failed for correct token")
	}
	if VerifyRefreshToken("rk_live_wrongtoken_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", h) {
		t.Fatal("verify succeeded for wrong token")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd kubilitics-backend && go test ./internal/auth/agenttoken/ -v`
Expected: 2 new tests FAIL with undefined symbols.

- [ ] **Step 3: Implement refresh helpers**

Create `kubilitics-backend/internal/auth/agenttoken/refresh.go`:

```go
package agenttoken

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const refreshPrefix = "rk_live_"

// argon2id parameters (interactive profile; refresh check is rare).
const (
	argonTime    = 2
	argonMemory  = 64 * 1024 // 64 MiB
	argonThreads = 2
	argonKeyLen  = 32
	saltLen      = 16
)

func NewRefreshToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil { return "", err }
	return refreshPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashRefreshToken returns "argon2id$<salt-hex>$<hash-hex>".
func HashRefreshToken(tok string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil { return "", err }
	h := argon2.IDKey([]byte(tok), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("argon2id$%s$%s", hex.EncodeToString(salt), hex.EncodeToString(h)), nil
}

func VerifyRefreshToken(tok, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 || parts[0] != "argon2id" { return false }
	salt, err := hex.DecodeString(parts[1])
	if err != nil { return false }
	want, err := hex.DecodeString(parts[2])
	if err != nil { return false }
	got := argon2.IDKey([]byte(tok), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return subtle.ConstantTimeCompare(got, want) == 1
}

var ErrRefreshFormat = errors.New("invalid refresh token format")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/auth/agenttoken/ -v`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/auth/agenttoken/refresh.go \
        kubilitics-backend/internal/auth/agenttoken/signer_test.go
git commit -m "feat(agent-trust): refresh token + argon2id hashing"
```

---

## Task 4: Repository for clusters / bootstrap_tokens / agent_credentials

**Files:**
- Create: `kubilitics-backend/internal/repository/agent_repo.go`
- Modify: `kubilitics-backend/internal/repository/agent_repo_test.go`

- [ ] **Step 1: Add failing tests**

Append to `kubilitics-backend/internal/repository/agent_repo_test.go`:

```go
func TestUpsertClusterAndGetByUID(t *testing.T) {
	r := newTestRepo(t)
	c := models.Cluster{
		ID: "c1", OrganizationID: "00000000-0000-0000-0000-000000000001",
		ClusterUID: "uid-1", Name: "k1", Status: "active", CredentialEpoch: 1,
	}
	if err := r.UpsertCluster(context.Background(), &c); err != nil { t.Fatal(err) }
	got, err := r.GetClusterByUID(context.Background(), c.OrganizationID, "uid-1")
	if err != nil { t.Fatal(err) }
	if got.ID != "c1" || got.Name != "k1" {
		t.Fatalf("got %+v", got)
	}
}

func TestBootstrapTokenLifecycle(t *testing.T) {
	r := newTestRepo(t)
	bt := models.BootstrapToken{
		JTI: "j1", OrganizationID: "00000000-0000-0000-0000-000000000001",
		CreatedBy: "admin", ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := r.InsertBootstrapToken(context.Background(), &bt); err != nil { t.Fatal(err) }
	got, err := r.GetBootstrapToken(context.Background(), "j1")
	if err != nil { t.Fatal(err) }
	if got.UsedAt != nil { t.Fatal("expected unused") }
	if err := r.MarkBootstrapTokenUsed(context.Background(), "j1", "c1"); err != nil { t.Fatal(err) }
	got, _ = r.GetBootstrapToken(context.Background(), "j1")
	if got.UsedAt == nil { t.Fatal("expected used_at set") }
}

func TestAgentCredentialActiveLookup(t *testing.T) {
	r := newTestRepo(t)
	// Need a cluster first.
	_ = r.UpsertCluster(context.Background(), &models.Cluster{
		ID: "c1", OrganizationID: "00000000-0000-0000-0000-000000000001",
		ClusterUID: "u1", Name: "k", Status: "active", CredentialEpoch: 1,
	})
	cred := models.AgentCredential{
		ID: "cr1", ClusterID: "c1",
		RefreshTokenHash: "argon2id$00$00",
		ExpiresAt:        time.Now().Add(365 * 24 * time.Hour),
		CredentialEpoch:  1,
	}
	if err := r.InsertAgentCredential(context.Background(), &cred); err != nil { t.Fatal(err) }
	got, err := r.ListActiveCredentialsByCluster(context.Background(), "c1")
	if err != nil { t.Fatal(err) }
	if len(got) != 1 { t.Fatalf("got %d", len(got)) }
	if err := r.RevokeAgentCredential(context.Background(), "cr1"); err != nil { t.Fatal(err) }
	got, _ = r.ListActiveCredentialsByCluster(context.Background(), "c1")
	if len(got) != 0 { t.Fatalf("expected 0 active, got %d", len(got)) }
}
```

Add a small helper in the same file:

```go
func newTestRepo(t *testing.T) *AgentRepo {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil { t.Fatal(err) }
	if err := ApplyMigrations(db, "../../migrations"); err != nil { t.Fatal(err) }
	return NewAgentRepo(db)
}
```

Add imports `context`, `time`, and `models "github.com/kubilitics/kubilitics-backend/internal/models"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd kubilitics-backend && go test ./internal/repository -run "TestUpsert|TestBootstrap|TestAgentCredential" -v`
Expected: FAIL (undefined `AgentRepo`, methods).

- [ ] **Step 3: Implement repository**

Create `kubilitics-backend/internal/repository/agent_repo.go`:

```go
package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

type AgentRepo struct{ db *sql.DB }

func NewAgentRepo(db *sql.DB) *AgentRepo { return &AgentRepo{db: db} }

var ErrNotFound = errors.New("not found")

// UpsertCluster inserts a new cluster or updates name/version/status
// while preserving credential_epoch and registered_at.
func (r *AgentRepo) UpsertCluster(ctx context.Context, c *models.Cluster) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO clusters (id, organization_id, cluster_uid, name, k8s_version, agent_version,
                      node_count, status, credential_epoch)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(organization_id, cluster_uid) DO UPDATE SET
  name = excluded.name,
  k8s_version = excluded.k8s_version,
  agent_version = excluded.agent_version,
  node_count = excluded.node_count,
  status = excluded.status
`, c.ID, c.OrganizationID, c.ClusterUID, c.Name, c.K8sVersion, c.AgentVersion,
		c.NodeCount, c.Status, c.CredentialEpoch)
	return err
}

func (r *AgentRepo) GetClusterByUID(ctx context.Context, orgID, uid string) (*models.Cluster, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT id, organization_id, cluster_uid, name, k8s_version, agent_version,
       node_count, status, credential_epoch, registered_at, last_heartbeat_at
FROM clusters WHERE organization_id = ? AND cluster_uid = ?`, orgID, uid)
	return scanCluster(row)
}

func (r *AgentRepo) GetClusterByID(ctx context.Context, id string) (*models.Cluster, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT id, organization_id, cluster_uid, name, k8s_version, agent_version,
       node_count, status, credential_epoch, registered_at, last_heartbeat_at
FROM clusters WHERE id = ?`, id)
	return scanCluster(row)
}

func (r *AgentRepo) UpdateClusterHeartbeat(ctx context.Context, id, status, agentVersion, k8sVersion string, nodes int, ts time.Time) error {
	_, err := r.db.ExecContext(ctx, `
UPDATE clusters SET status=?, agent_version=?, k8s_version=?, node_count=?, last_heartbeat_at=?
WHERE id=?`, status, agentVersion, k8sVersion, nodes, ts, id)
	return err
}

func (r *AgentRepo) BumpClusterEpoch(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE clusters SET credential_epoch = credential_epoch + 1 WHERE id = ?`, id)
	return err
}

func (r *AgentRepo) MarkClusterSuperseded(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE clusters SET status='superseded' WHERE id=?`, id)
	return err
}

func (r *AgentRepo) InsertBootstrapToken(ctx context.Context, t *models.BootstrapToken) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO bootstrap_tokens (jti, organization_id, created_by, expires_at)
VALUES (?, ?, ?, ?)`, t.JTI, t.OrganizationID, t.CreatedBy, t.ExpiresAt)
	return err
}

func (r *AgentRepo) GetBootstrapToken(ctx context.Context, jti string) (*models.BootstrapToken, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT jti, organization_id, created_by, created_at, expires_at, used_at, used_by_cluster, revoked_at
FROM bootstrap_tokens WHERE jti=?`, jti)
	var b models.BootstrapToken
	var usedAt, revokedAt sql.NullTime
	var usedBy sql.NullString
	if err := row.Scan(&b.JTI, &b.OrganizationID, &b.CreatedBy, &b.CreatedAt, &b.ExpiresAt,
		&usedAt, &usedBy, &revokedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) { return nil, ErrNotFound }
		return nil, err
	}
	if usedAt.Valid { t := usedAt.Time; b.UsedAt = &t }
	if revokedAt.Valid { t := revokedAt.Time; b.RevokedAt = &t }
	if usedBy.Valid { s := usedBy.String; b.UsedByCluster = &s }
	return &b, nil
}

func (r *AgentRepo) MarkBootstrapTokenUsed(ctx context.Context, jti, clusterID string) error {
	res, err := r.db.ExecContext(ctx, `
UPDATE bootstrap_tokens SET used_at = CURRENT_TIMESTAMP, used_by_cluster = ?
WHERE jti = ? AND used_at IS NULL AND revoked_at IS NULL`, clusterID, jti)
	if err != nil { return err }
	n, _ := res.RowsAffected()
	if n == 0 { return ErrNotFound }
	return nil
}

func (r *AgentRepo) InsertAgentCredential(ctx context.Context, c *models.AgentCredential) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO agent_credentials (id, cluster_id, refresh_token_hash, expires_at, credential_epoch)
VALUES (?, ?, ?, ?, ?)`, c.ID, c.ClusterID, c.RefreshTokenHash, c.ExpiresAt, c.CredentialEpoch)
	return err
}

func (r *AgentRepo) ListActiveCredentialsByCluster(ctx context.Context, clusterID string) ([]models.AgentCredential, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, cluster_id, refresh_token_hash, issued_at, expires_at, last_used_at, revoked_at, credential_epoch
FROM agent_credentials WHERE cluster_id = ? AND revoked_at IS NULL`, clusterID)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []models.AgentCredential
	for rows.Next() {
		var c models.AgentCredential
		var lastUsed, revoked sql.NullTime
		if err := rows.Scan(&c.ID, &c.ClusterID, &c.RefreshTokenHash, &c.IssuedAt, &c.ExpiresAt,
			&lastUsed, &revoked, &c.CredentialEpoch); err != nil { return nil, err }
		if lastUsed.Valid { t := lastUsed.Time; c.LastUsedAt = &t }
		if revoked.Valid { t := revoked.Time; c.RevokedAt = &t }
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *AgentRepo) RevokeAgentCredential(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`, id)
	return err
}

func (r *AgentRepo) TouchAgentCredential(ctx context.Context, id string, ts time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE agent_credentials SET last_used_at = ? WHERE id = ?`, ts, id)
	return err
}

func scanCluster(row *sql.Row) (*models.Cluster, error) {
	var c models.Cluster
	var lastHB sql.NullTime
	if err := row.Scan(&c.ID, &c.OrganizationID, &c.ClusterUID, &c.Name, &c.K8sVersion,
		&c.AgentVersion, &c.NodeCount, &c.Status, &c.CredentialEpoch, &c.RegisteredAt, &lastHB); err != nil {
		if errors.Is(err, sql.ErrNoRows) { return nil, ErrNotFound }
		return nil, err
	}
	if lastHB.Valid { t := lastHB.Time; c.LastHeartbeatAt = &t }
	return &c, nil
}
```

If `ApplyMigrations` does not exist in the package, add a minimal implementation that reads `*.sql` files in lexical order from the given directory and executes each.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/repository -v -run "TestUpsert|TestBootstrap|TestAgentCredential|TestMigration044"`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/repository/agent_repo.go \
        kubilitics-backend/internal/repository/agent_repo_test.go
git commit -m "feat(agent-trust): repository for clusters, bootstrap tokens, credentials"
```

---

## Task 5: TokenReview wrapper

**Files:**
- Create: `kubilitics-backend/internal/k8s/tokenreview.go`
- Test: `kubilitics-backend/internal/k8s/tokenreview_test.go`

- [ ] **Step 1: Write the failing test**

Create `kubilitics-backend/internal/k8s/tokenreview_test.go`:

```go
package k8s

import (
	"context"
	"testing"

	authv1 "k8s.io/api/authentication/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestReviewSAToken_Authenticated(t *testing.T) {
	cs := fake.NewSimpleClientset()
	cs.PrependReactor("create", "tokenreviews", func(a ktesting.Action) (bool, any, error) {
		return true, &authv1.TokenReview{
			ObjectMeta: metav1.ObjectMeta{Name: "tr"},
			Status: authv1.TokenReviewStatus{
				Authenticated: true,
				User:          authv1.UserInfo{Username: "system:serviceaccount:kubilitics-system:agent"},
			},
		}, nil
	})
	rev := NewTokenReviewer(cs)
	got, err := rev.Review(context.Background(), "any-token")
	if err != nil { t.Fatal(err) }
	if !got.Authenticated || got.Username != "system:serviceaccount:kubilitics-system:agent" {
		t.Fatalf("got %+v", got)
	}
}

func TestReviewSAToken_Unauthenticated(t *testing.T) {
	cs := fake.NewSimpleClientset()
	cs.PrependReactor("create", "tokenreviews", func(a ktesting.Action) (bool, any, error) {
		return true, &authv1.TokenReview{Status: authv1.TokenReviewStatus{Authenticated: false}}, nil
	})
	rev := NewTokenReviewer(cs)
	got, _ := rev.Review(context.Background(), "bad")
	if got.Authenticated { t.Fatal("expected not authenticated") }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/k8s -run TestReviewSAToken -v`
Expected: FAIL (undefined `TokenReviewer`).

- [ ] **Step 3: Implement wrapper**

Create `kubilitics-backend/internal/k8s/tokenreview.go`:

```go
package k8s

import (
	"context"

	authv1 "k8s.io/api/authentication/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type TokenReviewer struct{ cs kubernetes.Interface }

func NewTokenReviewer(cs kubernetes.Interface) *TokenReviewer { return &TokenReviewer{cs: cs} }

type ReviewResult struct {
	Authenticated bool
	Username      string
	UID           string
	Groups        []string
}

func (r *TokenReviewer) Review(ctx context.Context, token string) (ReviewResult, error) {
	tr := &authv1.TokenReview{
		ObjectMeta: metav1.ObjectMeta{},
		Spec:       authv1.TokenReviewSpec{Token: token},
	}
	resp, err := r.cs.AuthenticationV1().TokenReviews().Create(ctx, tr, metav1.CreateOptions{})
	if err != nil { return ReviewResult{}, err }
	return ReviewResult{
		Authenticated: resp.Status.Authenticated,
		Username:      resp.Status.User.Username,
		UID:           resp.Status.User.UID,
		Groups:        resp.Status.User.Groups,
	}, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/k8s -run TestReviewSAToken -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/k8s/tokenreview.go \
        kubilitics-backend/internal/k8s/tokenreview_test.go
git commit -m "feat(agent-trust): TokenReview wrapper"
```

---

## Task 6: `/agent/register` handler (both flows)

**Files:**
- Create: `kubilitics-backend/internal/api/rest/agent_register.go`
- Create: `kubilitics-backend/internal/api/rest/agent_register_test.go`

- [ ] **Step 1: Write the failing tests**

Create `kubilitics-backend/internal/api/rest/agent_register_test.go`:

```go
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
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
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

	if rr.Code != 200 { t.Fatalf("status %d body=%s", rr.Code, rr.Body.String()) }
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
	if rr.Code != 200 { t.Fatalf("first call: %d %s", rr.Code, rr.Body.String()) }

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != http.StatusUnauthorized { t.Fatalf("replay should be 401, got %d", rr.Code) }
}

func TestRegister_SameClusterUIDMismatchRejected(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	rev := fakeReviewer{authed: true, username: "system:serviceaccount:kubilitics-system:agent"}
	h := NewAgentRegisterHandler(repo, signer, rev, "hub-uid-AAA")

	body := []byte(`{"sa_token":"any","cluster_uid":"DIFFERENT-uid","cluster_name":"a","agent_version":"0.4.0","k8s_version":"v1.29","node_count":1}`)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != http.StatusForbidden { t.Fatalf("expected 403, got %d", rr.Code) }
}
```

Create test helpers in a shared file `kubilitics-backend/internal/api/rest/agent_test_helpers.go`:

```go
package rest

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

const defaultOrgID = "00000000-0000-0000-0000-000000000001"

func newTestAgentRepo(t *testing.T) *repository.AgentRepo {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil { t.Fatal(err) }
	if err := repository.ApplyMigrations(db, "../../../migrations"); err != nil { t.Fatal(err) }
	return repository.NewAgentRepo(db)
}

type fakeReviewer struct {
	authed   bool
	username string
}

func (f fakeReviewer) Review(_ context.Context, _ string) (k8s.ReviewResult, error) {
	return k8s.ReviewResult{Authenticated: f.authed, Username: f.username}, nil
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestRegister -v`
Expected: FAIL (undefined `NewAgentRegisterHandler`).

- [ ] **Step 3: Implement handler**

Create `kubilitics-backend/internal/api/rest/agent_register.go`:

```go
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

type Reviewer interface {
	Review(ctx context.Context, token string) (k8s.ReviewResult, error)
}

type AgentRegisterHandler struct {
	repo         *repository.AgentRepo
	signer       *agenttoken.Signer
	reviewer     Reviewer // may be nil if hub doesn't expect same-cluster traffic
	hubClusterUID string
}

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
	if r.Method != http.MethodPost { http.Error(w, "method not allowed", 405); return }
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad_request", err.Error()); return
	}
	if req.ClusterUID == "" {
		writeErr(w, 400, "bad_request", "cluster_uid required"); return
	}

	var orgID, createdBy, jti string
	switch {
	case req.BootstrapToken != "":
		claims, err := h.signer.VerifyBootstrap(req.BootstrapToken)
		if err != nil { writeErr(w, 401, "token_invalid", err.Error()); return }
		// Check single-use + revocation in DB.
		bt, err := h.repo.GetBootstrapToken(r.Context(), claims.JTI)
		if err != nil { writeErr(w, 401, "token_unknown", "unknown jti"); return }
		if bt.UsedAt != nil { writeErr(w, 401, "token_used", "token already used"); return }
		if bt.RevokedAt != nil { writeErr(w, 401, "token_revoked", "token revoked"); return }
		if time.Now().After(bt.ExpiresAt) { writeErr(w, 401, "token_expired", "token expired"); return }
		orgID, createdBy, jti = claims.OrgID, claims.CreatedBy, claims.JTI

	case req.SAToken != "":
		if h.reviewer == nil { writeErr(w, 403, "no_local_authn", "same-cluster auth not enabled"); return }
		res, err := h.reviewer.Review(r.Context(), req.SAToken)
		if err != nil || !res.Authenticated {
			writeErr(w, 401, "sa_invalid", "TokenReview failed"); return
		}
		// Cluster UID must match the hub's own.
		if req.ClusterUID != h.hubClusterUID {
			writeErr(w, 403, "cluster_mismatch", "sa_token cannot be used from a different cluster"); return
		}
		orgID, createdBy = defaultOrgID, "sa:"+res.Username

	default:
		writeErr(w, 400, "bad_request", "either bootstrap_token or sa_token required"); return
	}

	// Resolve or create cluster (re-registration logic).
	cluster, err := h.repo.GetClusterByUID(r.Context(), orgID, req.ClusterUID)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		writeErr(w, 500, "db_error", err.Error()); return
	}
	name := req.ClusterName
	if name == "" {
		name = "cluster-" + req.ClusterUID[:min(6, len(req.ClusterUID))]
	}
	if cluster == nil {
		cluster = &models.Cluster{
			ID: uuid.NewString(), OrganizationID: orgID, ClusterUID: req.ClusterUID, Name: name,
			K8sVersion: req.K8sVersion, AgentVersion: req.AgentVersion, NodeCount: req.NodeCount,
			Status: "active", CredentialEpoch: 1,
		}
	} else {
		// Re-registration → bump epoch, status active.
		cluster.K8sVersion = req.K8sVersion
		cluster.AgentVersion = req.AgentVersion
		cluster.NodeCount = req.NodeCount
		cluster.Status = "active"
		cluster.CredentialEpoch++
	}
	if err := h.repo.UpsertCluster(r.Context(), cluster); err != nil {
		writeErr(w, 500, "db_error", err.Error()); return
	}

	if jti != "" {
		if err := h.repo.MarkBootstrapTokenUsed(r.Context(), jti, cluster.ID); err != nil {
			writeErr(w, 401, "token_used", "race: token used"); return
		}
	}

	refresh, _ := agenttoken.NewRefreshToken()
	hash, _ := agenttoken.HashRefreshToken(refresh)
	cred := &models.AgentCredential{
		ID: uuid.NewString(), ClusterID: cluster.ID, RefreshTokenHash: hash,
		ExpiresAt: time.Now().Add(refreshTTL), CredentialEpoch: cluster.CredentialEpoch,
	}
	if err := h.repo.InsertAgentCredential(r.Context(), cred); err != nil {
		writeErr(w, 500, "db_error", err.Error()); return
	}

	access, _ := h.signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID, OrgID: orgID, Epoch: cluster.CredentialEpoch, TTL: accessTTL,
	})

	_ = createdBy // reserved for audit log in later spec
	writeJSON(w, 200, registerResponse{
		ClusterID: cluster.ID, RefreshToken: refresh, AccessToken: access,
		AccessTTLs: int(accessTTL.Seconds()), HeartbeatIntervalS: heartbeatIntervalS,
	})
}

func writeErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, map[string]string{"code": errCode, "message": msg})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func min(a, b int) int { if a < b { return a }; return b }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestRegister -v`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/rest/agent_register.go \
        kubilitics-backend/internal/api/rest/agent_register_test.go \
        kubilitics-backend/internal/api/rest/agent_test_helpers.go
git commit -m "feat(agent-trust): /agent/register handler (bootstrap + SA paths)"
```

---

## Task 7: `/agent/token/refresh` handler

**Files:**
- Create: `kubilitics-backend/internal/api/rest/agent_token.go`
- Create: `kubilitics-backend/internal/api/rest/agent_token_test.go`

- [ ] **Step 1: Write the failing test**

```go
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

func TestRefresh_HappyPath(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))

	cluster := &models.Cluster{
		ID: uuid.NewString(), OrganizationID: defaultOrgID, ClusterUID: "u",
		Name: "c", Status: "active", CredentialEpoch: 1,
	}
	_ = repo.UpsertCluster(context.Background(), cluster)
	tok, _ := agenttoken.NewRefreshToken()
	hash, _ := agenttoken.HashRefreshToken(tok)
	_ = repo.InsertAgentCredential(context.Background(), &models.AgentCredential{
		ID: uuid.NewString(), ClusterID: cluster.ID, RefreshTokenHash: hash,
		ExpiresAt: time.Now().Add(time.Hour), CredentialEpoch: 1,
	})

	h := NewAgentTokenHandler(repo, signer)
	body, _ := json.Marshal(map[string]string{"refresh_token": tok})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(body)))
	if rr.Code != 200 { t.Fatalf("status %d body=%s", rr.Code, rr.Body.String()) }
	var resp struct{ AccessToken string `json:"access_token"`; AccessTTLs int `json:"access_ttl_s"` }
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.AccessToken == "" || resp.AccessTTLs == 0 { t.Fatalf("got %+v", resp) }
}

func TestRefresh_Unknown(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	h := NewAgentTokenHandler(repo, signer)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader([]byte(`{"refresh_token":"rk_live_nope"}`))))
	if rr.Code != 401 { t.Fatalf("got %d", rr.Code) }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestRefresh -v`
Expected: FAIL.

- [ ] **Step 3: Implement handler**

Create `kubilitics-backend/internal/api/rest/agent_token.go`:

```go
package rest

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

type AgentTokenHandler struct {
	repo   *repository.AgentRepo
	signer *agenttoken.Signer
}

func NewAgentTokenHandler(repo *repository.AgentRepo, signer *agenttoken.Signer) *AgentTokenHandler {
	return &AgentTokenHandler{repo: repo, signer: signer}
}

func (h *AgentTokenHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "method not allowed", 405); return }
	var req struct{ RefreshToken string `json:"refresh_token"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
		writeErr(w, 400, "bad_request", "refresh_token required"); return
	}

	// Linear scan acceptable: per-cluster active creds typically 1-2.
	// We don't know cluster_id from the token (opaque), so we scan all clusters
	// with an index on (cluster_id) WHERE revoked_at IS NULL — see Task 8 for
	// optimisation if needed. For now: load all active creds via repo helper.
	cred, cluster, err := h.findCredentialByToken(r, req.RefreshToken)
	if err != nil { writeErr(w, 401, "refresh_invalid", err.Error()); return }
	if cred.ExpiresAt.Before(time.Now()) {
		writeErr(w, 401, "refresh_expired", "refresh expired"); return
	}
	if cred.CredentialEpoch != cluster.CredentialEpoch {
		writeErr(w, 401, "epoch_mismatch", "credential epoch mismatch"); return
	}

	access, _ := h.signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID, OrgID: cluster.OrganizationID,
		Epoch: cluster.CredentialEpoch, TTL: accessTTL,
	})
	_ = h.repo.TouchAgentCredential(r.Context(), cred.ID, time.Now())

	writeJSON(w, 200, map[string]any{
		"access_token": access,
		"access_ttl_s": int(accessTTL.Seconds()),
	})
}

// findCredentialByToken locates the (cred, cluster) pair whose hash matches.
// Implementation note: this requires scanning active credentials. The repo
// must expose a helper. Add to AgentRepo in this task if not present.
func (h *AgentTokenHandler) findCredentialByToken(r *http.Request, token string) (*repository.CredentialWithCluster, *repository.ClusterRow, error) {
	return h.repo.FindActiveCredentialByToken(r.Context(), token, agenttoken.VerifyRefreshToken)
}
```

Add to `agent_repo.go`:

```go
type CredentialWithCluster = models.AgentCredential
type ClusterRow = models.Cluster

// FindActiveCredentialByToken scans all non-revoked, non-expired credentials and
// returns the one whose stored hash verifies against the supplied token.
func (r *AgentRepo) FindActiveCredentialByToken(
	ctx context.Context,
	token string,
	verify func(tok, hash string) bool,
) (*models.AgentCredential, *models.Cluster, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT ac.id, ac.cluster_id, ac.refresh_token_hash, ac.issued_at, ac.expires_at,
       ac.last_used_at, ac.revoked_at, ac.credential_epoch,
       c.id, c.organization_id, c.cluster_uid, c.name, c.k8s_version, c.agent_version,
       c.node_count, c.status, c.credential_epoch, c.registered_at, c.last_heartbeat_at
FROM agent_credentials ac
JOIN clusters c ON c.id = ac.cluster_id
WHERE ac.revoked_at IS NULL AND ac.expires_at > CURRENT_TIMESTAMP`)
	if err != nil { return nil, nil, err }
	defer rows.Close()
	for rows.Next() {
		var cred models.AgentCredential
		var cluster models.Cluster
		var lastUsed, revoked, lastHB sql.NullTime
		if err := rows.Scan(&cred.ID, &cred.ClusterID, &cred.RefreshTokenHash, &cred.IssuedAt,
			&cred.ExpiresAt, &lastUsed, &revoked, &cred.CredentialEpoch,
			&cluster.ID, &cluster.OrganizationID, &cluster.ClusterUID, &cluster.Name,
			&cluster.K8sVersion, &cluster.AgentVersion, &cluster.NodeCount, &cluster.Status,
			&cluster.CredentialEpoch, &cluster.RegisteredAt, &lastHB); err != nil {
			return nil, nil, err
		}
		if lastUsed.Valid { t := lastUsed.Time; cred.LastUsedAt = &t }
		if revoked.Valid { t := revoked.Time; cred.RevokedAt = &t }
		if lastHB.Valid { t := lastHB.Time; cluster.LastHeartbeatAt = &t }
		if verify(token, cred.RefreshTokenHash) {
			return &cred, &cluster, nil
		}
	}
	return nil, nil, ErrNotFound
}
```

(Linear scan is acceptable up to a few thousand active credentials; if scale demands it later, add a cheap lookup index of token-prefix → cluster.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestRefresh -v`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/rest/agent_token.go \
        kubilitics-backend/internal/api/rest/agent_token_test.go \
        kubilitics-backend/internal/repository/agent_repo.go
git commit -m "feat(agent-trust): /agent/token/refresh handler"
```

---

## Task 8: `/agent/heartbeat` handler + access middleware

**Files:**
- Create: `kubilitics-backend/internal/api/rest/agent_heartbeat.go`
- Create: `kubilitics-backend/internal/api/rest/agent_heartbeat_test.go`

- [ ] **Step 1: Write the failing tests**

```go
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
	cluster := &models.Cluster{
		ID: uuid.NewString(), OrganizationID: defaultOrgID, ClusterUID: "uid-x",
		Name: "c", Status: "active", CredentialEpoch: 1,
	}
	_ = repo.UpsertCluster(context.Background(), cluster)
	access, _ := signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID, OrgID: defaultOrgID, Epoch: 1, TTL: time.Hour,
	})
	return NewAgentHeartbeatHandler(repo, signer), cluster.ID, access
}

func TestHeartbeat_OK(t *testing.T) {
	h, clusterID, access := setupHeartbeat(t)
	body, _ := json.Marshal(map[string]any{
		"cluster_id":   clusterID,
		"cluster_uid":  "uid-x",
		"agent_version":"0.4.0",
		"k8s_version":  "v1.29",
		"status":       "healthy",
		"resource_counts": map[string]int{"nodes":3,"pods":50,"namespaces":4},
	})
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 { t.Fatalf("status %d body=%s", rr.Code, rr.Body.String()) }
}

func TestHeartbeat_BadToken(t *testing.T) {
	h, clusterID, _ := setupHeartbeat(t)
	body, _ := json.Marshal(map[string]string{"cluster_id": clusterID, "cluster_uid":"uid-x", "status":"healthy"})
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer not-a-jwt")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 401 { t.Fatalf("got %d", rr.Code) }
}

func TestHeartbeat_UIDMismatch_410(t *testing.T) {
	h, clusterID, access := setupHeartbeat(t)
	body, _ := json.Marshal(map[string]string{"cluster_id": clusterID, "cluster_uid":"DIFFERENT", "status":"healthy"})
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+access)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 410 { t.Fatalf("got %d", rr.Code) }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestHeartbeat -v`
Expected: FAIL.

- [ ] **Step 3: Implement handler**

Create `kubilitics-backend/internal/api/rest/agent_heartbeat.go`:

```go
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

type AgentHeartbeatHandler struct {
	repo   *repository.AgentRepo
	signer *agenttoken.Signer
}

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
	Ack                  bool       `json:"ack"`
	DesiredAgentVersion  string     `json:"desired_agent_version,omitempty"`
	Commands             []struct{} `json:"commands"`
}

func (h *AgentHeartbeatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "method not allowed", 405); return }
	tok := bearer(r)
	if tok == "" { writeErr(w, 401, "no_token", "missing bearer token"); return }
	claims, err := h.signer.VerifyAccess(tok)
	if err != nil { writeErr(w, 401, "access_invalid", err.Error()); return }

	var req heartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad_request", err.Error()); return
	}
	if req.ClusterID != claims.ClusterID {
		writeErr(w, 401, "cluster_mismatch", "cluster_id does not match token"); return
	}

	cluster, err := h.repo.GetClusterByID(r.Context(), claims.ClusterID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) { writeErr(w, 401, "cluster_unknown", "cluster gone"); return }
		writeErr(w, 500, "db_error", err.Error()); return
	}
	if claims.Epoch != cluster.CredentialEpoch {
		writeErr(w, 401, "epoch_mismatch", "credential rotated"); return
	}
	if req.ClusterUID != cluster.ClusterUID {
		// DB restored into a different cluster — force re-registration.
		_ = h.repo.MarkClusterSuperseded(r.Context(), cluster.ID)
		writeErr(w, http.StatusGone, "uid_mismatch", "cluster_uid changed; re-register")
		return
	}

	nodes := req.ResourceCounts["nodes"]
	if err := h.repo.UpdateClusterHeartbeat(r.Context(), cluster.ID, "active",
		req.AgentVersion, req.K8sVersion, nodes, time.Now()); err != nil {
		writeErr(w, 500, "db_error", err.Error()); return
	}
	writeJSON(w, 200, heartbeatResponse{Ack: true, Commands: []struct{}{}})
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") { return "" }
	return strings.TrimPrefix(h, "Bearer ")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestHeartbeat -v`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/rest/agent_heartbeat.go \
        kubilitics-backend/internal/api/rest/agent_heartbeat_test.go
git commit -m "feat(agent-trust): /agent/heartbeat handler + access verification"
```

---

## Task 9: Admin endpoint to mint a bootstrap token

**Files:**
- Create: `kubilitics-backend/internal/api/rest/agent_admin.go`
- Create: `kubilitics-backend/internal/api/rest/agent_admin_test.go`

- [ ] **Step 1: Write the failing test**

```go
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
	if rr.Code != 200 { t.Fatalf("status %d body=%s", rr.Code, rr.Body.String()) }
	var resp struct{ Token string `json:"bootstrap_token"`; HelmCommand string `json:"helm_command"` }
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Token == "" || resp.HelmCommand == "" { t.Fatalf("got %+v", resp) }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestMintBootstrap -v`
Expected: FAIL.

- [ ] **Step 3: Implement endpoint**

Create `kubilitics-backend/internal/api/rest/agent_admin.go`:

```go
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

type AgentAdminHandler struct {
	repo   *repository.AgentRepo
	signer *agenttoken.Signer
}

func NewAgentAdminHandler(repo *repository.AgentRepo, signer *agenttoken.Signer) *AgentAdminHandler {
	return &AgentAdminHandler{repo: repo, signer: signer}
}

type mintRequest struct {
	OrganizationID string `json:"organization_id"`
	TTLSeconds     int    `json:"ttl_seconds"`
}

func (h *AgentAdminHandler) MintBootstrap(w http.ResponseWriter, r *http.Request) {
	var req mintRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "bad_request", err.Error()); return
	}
	if req.OrganizationID == "" { req.OrganizationID = defaultOrgID }
	if req.TTLSeconds <= 0 { req.TTLSeconds = 24 * 3600 }
	if req.TTLSeconds < 900 || req.TTLSeconds > 7*24*3600 {
		writeErr(w, 400, "ttl_out_of_range", "ttl must be 900..604800 seconds"); return
	}
	createdBy := r.Header.Get("X-User-ID")
	if createdBy == "" { createdBy = "anonymous" }

	jti := uuid.NewString()
	ttl := time.Duration(req.TTLSeconds) * time.Second
	tok, err := h.signer.IssueBootstrap(agenttoken.BootstrapClaims{
		JTI: jti, OrgID: req.OrganizationID, CreatedBy: createdBy, TTL: ttl,
	})
	if err != nil { writeErr(w, 500, "sign_error", err.Error()); return }
	if err := h.repo.InsertBootstrapToken(r.Context(), &models.BootstrapToken{
		JTI: jti, OrganizationID: req.OrganizationID, CreatedBy: createdBy,
		ExpiresAt: time.Now().Add(ttl),
	}); err != nil { writeErr(w, 500, "db_error", err.Error()); return }

	hubURL := os.Getenv("KUBILITICS_PUBLIC_HUB_URL")
	if hubURL == "" { hubURL = "https://<your-hub>" }
	cmd := fmt.Sprintf("helm install kubilitics-agent kubilitics/kubilitics-agent "+
		"-n kubilitics-system --create-namespace "+
		"--set hub.url=%s --set hub.token=%s", hubURL, tok)

	writeJSON(w, 200, map[string]any{
		"bootstrap_token": tok,
		"jti":             jti,
		"expires_at":      time.Now().Add(ttl).UTC().Format(time.RFC3339),
		"helm_command":    cmd,
	})
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test ./internal/api/rest -run TestMintBootstrap -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/rest/agent_admin.go \
        kubilitics-backend/internal/api/rest/agent_admin_test.go
git commit -m "feat(agent-trust): admin endpoint to mint bootstrap tokens"
```

---

## Task 10: Wire handlers into the hub server

**Files:**
- Modify: `kubilitics-backend/cmd/server/main.go`

- [ ] **Step 1: Locate route registration**

Search for the existing router setup in `cmd/server/main.go` and identify where REST handlers are registered (look for `mux.NewRouter()` or `r.HandleFunc("/api/v1/...")`).

- [ ] **Step 2: Add wiring**

Add in `main.go`, after the existing repository / config setup:

```go
import (
	// existing imports …
	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	k8sclient "k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Signing secret loaded from env (see Task 13 for Helm wiring).
secret := []byte(os.Getenv("KUBILITICS_AGENT_SIGNING_SECRET"))
if len(secret) < 32 {
	log.Fatal("KUBILITICS_AGENT_SIGNING_SECRET must be >= 32 bytes")
}
signer := agenttoken.NewSigner(secret)
agentRepo := repository.NewAgentRepo(db) // db = existing *sql.DB

// Optional same-cluster reviewer + hub UID.
var reviewer rest.Reviewer
var hubUID string
if cfg, err := rest.InClusterConfig(); err == nil {
	cs, _ := k8sclient.NewForConfig(cfg)
	reviewer = k8s.NewTokenReviewer(cs)
	if ns, err := cs.CoreV1().Namespaces().Get(context.Background(), "kube-system", metav1.GetOptions{}); err == nil {
		hubUID = string(ns.UID)
	}
}

regH  := rest.NewAgentRegisterHandler(agentRepo, signer, reviewer, hubUID)
tokH  := rest.NewAgentTokenHandler(agentRepo, signer)
hbH   := rest.NewAgentHeartbeatHandler(agentRepo, signer)
admH  := rest.NewAgentAdminHandler(agentRepo, signer)

router.Handle("/api/v1/agent/register",       regH).Methods("POST")
router.Handle("/api/v1/agent/token/refresh",  tokH).Methods("POST")
router.Handle("/api/v1/agent/heartbeat",      hbH).Methods("POST")
router.HandleFunc("/api/v1/admin/clusters/bootstrap-token", admH.MintBootstrap).Methods("POST")
```

(`router` is the existing `*mux.Router`; rename if the existing variable differs.)

- [ ] **Step 3: Build**

Run: `cd kubilitics-backend && go build ./...`
Expected: clean build.

- [ ] **Step 4: Smoke run**

Run with a dummy secret:
```bash
cd kubilitics-backend && \
KUBILITICS_AGENT_SIGNING_SECRET=this-is-a-32-byte-test-secret-x \
go run ./cmd/server &
SERVER_PID=$!
sleep 2
curl -s -X POST http://localhost:8190/api/v1/admin/clusters/bootstrap-token \
  -H 'Content-Type: application/json' \
  -H 'X-User-ID: admin' \
  -d '{"ttl_seconds":3600}'
kill $SERVER_PID
```
Expected: JSON response with `bootstrap_token`, `helm_command`.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/cmd/server/main.go
git commit -m "feat(agent-trust): wire agent handlers into hub server"
```

---

## Task 11: Agent module skeleton + cluster UID + credstore

**Files:**
- Create: `kubilitics-agent/go.mod`, `kubilitics-agent/go.sum`
- Create: `kubilitics-agent/cmd/agent/main.go` (placeholder)
- Create: `kubilitics-agent/internal/config/config.go`
- Create: `kubilitics-agent/internal/clusteruid/uid.go`
- Create: `kubilitics-agent/internal/credstore/secret.go`
- Test: `kubilitics-agent/internal/credstore/secret_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p kubilitics-agent/cmd/agent kubilitics-agent/internal/{config,clusteruid,credstore,hubclient,bootstrap,heartbeat}
cd kubilitics-agent && go mod init github.com/kubilitics/kubilitics-agent
go get k8s.io/client-go@v0.29.3 k8s.io/api@v0.29.3 k8s.io/apimachinery@v0.29.3
```

Add it to `go.work` at the repo root:

```
use (
    ./kubilitics-backend
    ./kubilitics-agent
    // existing entries
)
```

- [ ] **Step 2: Write failing credstore test**

`kubilitics-agent/internal/credstore/secret_test.go`:

```go
package credstore

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestSaveAndLoad(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := New(cs, "kubilitics-system", "kubilitics-agent-creds")
	creds := Creds{ClusterID: "c1", RefreshToken: "rk_live_abc", AccessToken: "eyJ", AccessTTLs: 3600}
	if err := s.Save(context.Background(), creds); err != nil { t.Fatal(err) }
	got, err := s.Load(context.Background())
	if err != nil { t.Fatal(err) }
	if got != creds { t.Fatalf("got %+v", got) }

	// Confirm secret exists.
	if _, err := cs.CoreV1().Secrets("kubilitics-system").Get(context.Background(), "kubilitics-agent-creds", metav1.GetOptions{}); err != nil {
		t.Fatal(err)
	}
	_ = corev1.Secret{}
}

func TestLoadMissing(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := New(cs, "ns", "name")
	if _, err := s.Load(context.Background()); err == nil {
		t.Fatal("expected error")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd kubilitics-agent && go test ./internal/credstore -v`
Expected: FAIL.

- [ ] **Step 4: Implement**

`kubilitics-agent/internal/clusteruid/uid.go`:

```go
package clusteruid

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func Read(ctx context.Context, cs kubernetes.Interface) (string, error) {
	ns, err := cs.CoreV1().Namespaces().Get(ctx, "kube-system", metav1.GetOptions{})
	if err != nil { return "", err }
	return string(ns.UID), nil
}
```

`kubilitics-agent/internal/credstore/secret.go`:

```go
package credstore

import (
	"context"
	"fmt"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	apierr "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type Creds struct {
	ClusterID    string
	RefreshToken string
	AccessToken  string
	AccessTTLs   int
}

type Store struct {
	cs        kubernetes.Interface
	namespace string
	name      string
}

func New(cs kubernetes.Interface, namespace, name string) *Store {
	return &Store{cs: cs, namespace: namespace, name: name}
}

func (s *Store) Save(ctx context.Context, c Creds) error {
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: s.name, Namespace: s.namespace},
		Type:       corev1.SecretTypeOpaque,
		StringData: map[string]string{
			"cluster_id":    c.ClusterID,
			"refresh_token": c.RefreshToken,
			"access_token":  c.AccessToken,
			"access_ttl_s":  strconv.Itoa(c.AccessTTLs),
		},
	}
	_, err := s.cs.CoreV1().Secrets(s.namespace).Create(ctx, sec, metav1.CreateOptions{})
	if apierr.IsAlreadyExists(err) {
		_, err = s.cs.CoreV1().Secrets(s.namespace).Update(ctx, sec, metav1.UpdateOptions{})
	}
	return err
}

func (s *Store) Load(ctx context.Context) (Creds, error) {
	sec, err := s.cs.CoreV1().Secrets(s.namespace).Get(ctx, s.name, metav1.GetOptions{})
	if err != nil { return Creds{}, err }
	get := func(k string) string { return string(sec.Data[k]) }
	ttl, _ := strconv.Atoi(get("access_ttl_s"))
	if get("cluster_id") == "" || get("refresh_token") == "" {
		return Creds{}, fmt.Errorf("incomplete secret")
	}
	return Creds{
		ClusterID: get("cluster_id"), RefreshToken: get("refresh_token"),
		AccessToken: get("access_token"), AccessTTLs: ttl,
	}, nil
}
```

`kubilitics-agent/internal/config/config.go`:

```go
package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	HubURL              string
	BootstrapToken      string         // empty for same-cluster path
	CABundlePath        string         // optional PEM file
	InsecureSkipTLS     bool
	CredsNamespace      string
	CredsSecretName     string
	HeartbeatInterval   time.Duration
	AgentVersion        string
}

func FromEnv() (Config, error) {
	c := Config{
		HubURL:            os.Getenv("KUBILITICS_HUB_URL"),
		BootstrapToken:    os.Getenv("KUBILITICS_HUB_TOKEN"),
		CABundlePath:      os.Getenv("KUBILITICS_HUB_CA_BUNDLE"),
		InsecureSkipTLS:   strings.EqualFold(os.Getenv("KUBILITICS_HUB_INSECURE"), "true"),
		CredsNamespace:    envDefault("POD_NAMESPACE", "kubilitics-system"),
		CredsSecretName:   envDefault("KUBILITICS_CREDS_SECRET", "kubilitics-agent-creds"),
		HeartbeatInterval: 30 * time.Second,
		AgentVersion:      envDefault("KUBILITICS_AGENT_VERSION", "0.0.0-dev"),
	}
	if c.HubURL == "" { return c, errors.New("KUBILITICS_HUB_URL required") }
	if c.InsecureSkipTLS == false && strings.HasPrefix(c.HubURL, "http://") {
		return c, errors.New("plain HTTP refused; set KUBILITICS_HUB_URL to https or KUBILITICS_HUB_INSECURE=true (dev only)")
	}
	return c, nil
}

func envDefault(k, d string) string {
	if v := os.Getenv(k); v != "" { return v }
	return d
}
```

`kubilitics-agent/cmd/agent/main.go` (placeholder; filled in Task 13):

```go
package main

import (
	"log"

	"github.com/kubilitics/kubilitics-agent/internal/config"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil { log.Fatalf("config: %v", err) }
	log.Printf("kubilitics-agent starting; hub=%s ns=%s", cfg.HubURL, cfg.CredsNamespace)
	select {}
}
```

- [ ] **Step 5: Run tests + build**

```bash
cd kubilitics-agent && go test ./... -v && go build ./...
```
Expected: tests PASS, binary builds.

- [ ] **Step 6: Commit**

```bash
git add kubilitics-agent/ go.work
git commit -m "feat(agent): module skeleton, config, credstore, cluster-uid"
```

---

## Task 12: Hub HTTP client (register, refresh, heartbeat)

**Files:**
- Create: `kubilitics-agent/internal/hubclient/client.go`
- Test: `kubilitics-agent/internal/hubclient/client_test.go`

- [ ] **Step 1: Write the failing tests**

```go
package hubclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegisterAndHeartbeat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/agent/register":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"cluster_id":"c1","refresh_token":"rk_live_x","access_token":"eyJ",
				"access_ttl_s":3600,"heartbeat_interval_s":30,
			})
		case "/api/v1/agent/heartbeat":
			if r.Header.Get("Authorization") != "Bearer eyJ" { http.Error(w, "no", 401); return }
			_ = json.NewEncoder(w).Encode(map[string]any{"ack":true,"commands":[]any{}})
		case "/api/v1/agent/token/refresh":
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token":"eyJ2","access_ttl_s":3600})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "", false)
	resp, err := c.Register(context.Background(), RegisterRequest{ClusterUID: "u1", AgentVersion: "0.4.0", K8sVersion: "v1.29"})
	if err != nil { t.Fatal(err) }
	if resp.AccessToken != "eyJ" { t.Fatalf("got %+v", resp) }

	if _, err := c.Heartbeat(context.Background(), "eyJ", HeartbeatRequest{ClusterID: "c1", ClusterUID: "u1", Status: "healthy"}); err != nil {
		t.Fatal(err)
	}

	rt, err := c.Refresh(context.Background(), "rk_live_x")
	if err != nil { t.Fatal(err) }
	if rt.AccessToken != "eyJ2" { t.Fatalf("got %+v", rt) }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-agent && go test ./internal/hubclient -v`
Expected: FAIL.

- [ ] **Step 3: Implement client**

```go
package hubclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

type Client struct {
	base string
	hc   *http.Client
}

type RegisterRequest struct {
	BootstrapToken string `json:"bootstrap_token,omitempty"`
	SAToken        string `json:"sa_token,omitempty"`
	ClusterUID     string `json:"cluster_uid"`
	ClusterName    string `json:"cluster_name,omitempty"`
	AgentVersion   string `json:"agent_version"`
	K8sVersion     string `json:"k8s_version"`
	NodeCount      int    `json:"node_count"`
}

type RegisterResponse struct {
	ClusterID          string `json:"cluster_id"`
	RefreshToken       string `json:"refresh_token"`
	AccessToken        string `json:"access_token"`
	AccessTTLs         int    `json:"access_ttl_s"`
	HeartbeatIntervalS int    `json:"heartbeat_interval_s"`
}

type HeartbeatRequest struct {
	ClusterID      string         `json:"cluster_id"`
	ClusterUID     string         `json:"cluster_uid"`
	AgentVersion   string         `json:"agent_version"`
	K8sVersion     string         `json:"k8s_version"`
	Status         string         `json:"status"`
	ResourceCounts map[string]int `json:"resource_counts"`
}

type HeartbeatResponse struct {
	Ack                 bool        `json:"ack"`
	DesiredAgentVersion string      `json:"desired_agent_version,omitempty"`
	Commands            []any       `json:"commands"`
}

type RefreshResponse struct {
	AccessToken string `json:"access_token"`
	AccessTTLs  int    `json:"access_ttl_s"`
}

type APIError struct {
	Status int
	Code   string `json:"code"`
	Msg    string `json:"message"`
}
func (e *APIError) Error() string { return fmt.Sprintf("hub %d %s: %s", e.Status, e.Code, e.Msg) }

func New(baseURL, caBundlePath string, insecure bool) (*Client, error) {
	tlsCfg := &tls.Config{InsecureSkipVerify: insecure}
	if caBundlePath != "" {
		pem, err := os.ReadFile(caBundlePath)
		if err != nil { return nil, err }
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) { return nil, errors.New("invalid CA bundle") }
		tlsCfg.RootCAs = pool
	}
	return &Client{
		base: baseURL,
		hc: &http.Client{
			Timeout:   30 * time.Second,
			Transport: &http.Transport{TLSClientConfig: tlsCfg},
		},
	}, nil
}

func (c *Client) Register(ctx context.Context, req RegisterRequest) (RegisterResponse, error) {
	var out RegisterResponse
	return out, c.do(ctx, "POST", "/api/v1/agent/register", "", req, &out)
}

func (c *Client) Heartbeat(ctx context.Context, access string, req HeartbeatRequest) (HeartbeatResponse, error) {
	var out HeartbeatResponse
	return out, c.do(ctx, "POST", "/api/v1/agent/heartbeat", access, req, &out)
}

func (c *Client) Refresh(ctx context.Context, refresh string) (RefreshResponse, error) {
	var out RefreshResponse
	return out, c.do(ctx, "POST", "/api/v1/agent/token/refresh", "", map[string]string{"refresh_token": refresh}, &out)
}

func (c *Client) do(ctx context.Context, method, path, bearer string, body, out any) error {
	buf, _ := json.Marshal(body)
	r, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(buf))
	if err != nil { return err }
	r.Header.Set("Content-Type", "application/json")
	if bearer != "" { r.Header.Set("Authorization", "Bearer "+bearer) }
	resp, err := c.hc.Do(r)
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var e APIError
		_ = json.NewDecoder(resp.Body).Decode(&e)
		e.Status = resp.StatusCode
		return &e
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-agent && go test ./internal/hubclient -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-agent/internal/hubclient/
git commit -m "feat(agent): hub HTTP client with TLS pinning"
```

---

## Task 13: Bootstrap + heartbeat loop + main wiring

**Files:**
- Create: `kubilitics-agent/internal/bootstrap/bootstrap.go`
- Create: `kubilitics-agent/internal/heartbeat/loop.go`
- Modify: `kubilitics-agent/cmd/agent/main.go`
- Tests: per file

- [ ] **Step 1: Bootstrap test (failing)**

`kubilitics-agent/internal/bootstrap/bootstrap_test.go`:

```go
package bootstrap

import (
	"context"
	"errors"
	"testing"

	"github.com/kubilitics/kubilitics-agent/internal/credstore"
	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type fakeHub struct {
	registerOut hubclient.RegisterResponse
	registerErr error
	calls       int
}
func (f *fakeHub) Register(_ context.Context, _ hubclient.RegisterRequest) (hubclient.RegisterResponse, error) {
	f.calls++
	return f.registerOut, f.registerErr
}

type memStore struct{ c credstore.Creds; loadErr error }
func (m *memStore) Load(_ context.Context) (credstore.Creds, error) { return m.c, m.loadErr }
func (m *memStore) Save(_ context.Context, c credstore.Creds) error  { m.c = c; m.loadErr = nil; return nil }

func TestBootstrap_UsesExistingCreds(t *testing.T) {
	store := &memStore{c: credstore.Creds{ClusterID: "c1", RefreshToken: "rk_live_x", AccessToken: "eyJ", AccessTTLs: 3600}}
	hub := &fakeHub{}
	got, err := Run(context.Background(), Inputs{Store: store, Hub: hub, ClusterUID: "u", AgentVersion: "0.4.0", K8sVersion: "v"})
	if err != nil { t.Fatal(err) }
	if got.ClusterID != "c1" || hub.calls != 0 { t.Fatalf("did not reuse: %+v calls=%d", got, hub.calls) }
}

func TestBootstrap_RegistersWhenNoCreds(t *testing.T) {
	store := &memStore{loadErr: errors.New("missing")}
	hub := &fakeHub{registerOut: hubclient.RegisterResponse{ClusterID: "c2", RefreshToken: "rk_live_y", AccessToken: "eyJ", AccessTTLs: 3600}}
	got, err := Run(context.Background(), Inputs{Store: store, Hub: hub, BootstrapToken: "tok", ClusterUID: "u", AgentVersion: "0.4.0", K8sVersion: "v"})
	if err != nil { t.Fatal(err) }
	if got.ClusterID != "c2" || hub.calls != 1 { t.Fatal("did not register") }
	if store.c.ClusterID != "c2" { t.Fatal("did not save") }
}
```

- [ ] **Step 2: Implement bootstrap**

```go
package bootstrap

import (
	"context"

	"github.com/kubilitics/kubilitics-agent/internal/credstore"
	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type HubAPI interface {
	Register(ctx context.Context, req hubclient.RegisterRequest) (hubclient.RegisterResponse, error)
}

type Storage interface {
	Load(ctx context.Context) (credstore.Creds, error)
	Save(ctx context.Context, c credstore.Creds) error
}

type Inputs struct {
	Store           Storage
	Hub             HubAPI
	BootstrapToken  string // for remote
	SAToken         string // for same-cluster
	ClusterUID      string
	ClusterName     string
	AgentVersion    string
	K8sVersion      string
	NodeCount       int
}

func Run(ctx context.Context, in Inputs) (credstore.Creds, error) {
	if c, err := in.Store.Load(ctx); err == nil {
		return c, nil
	}
	resp, err := in.Hub.Register(ctx, hubclient.RegisterRequest{
		BootstrapToken: in.BootstrapToken, SAToken: in.SAToken,
		ClusterUID: in.ClusterUID, ClusterName: in.ClusterName,
		AgentVersion: in.AgentVersion, K8sVersion: in.K8sVersion, NodeCount: in.NodeCount,
	})
	if err != nil { return credstore.Creds{}, err }
	creds := credstore.Creds{
		ClusterID: resp.ClusterID, RefreshToken: resp.RefreshToken,
		AccessToken: resp.AccessToken, AccessTTLs: resp.AccessTTLs,
	}
	if err := in.Store.Save(ctx, creds); err != nil { return credstore.Creds{}, err }
	return creds, nil
}
```

- [ ] **Step 3: Heartbeat loop test (failing)**

`kubilitics-agent/internal/heartbeat/loop_test.go`:

```go
package heartbeat

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type fakeHub struct {
	hbCalls   atomic.Int32
	refCalls  atomic.Int32
	hbErr     error
	refOut    hubclient.RefreshResponse
}
func (f *fakeHub) Heartbeat(_ context.Context, _ string, _ hubclient.HeartbeatRequest) (hubclient.HeartbeatResponse, error) {
	f.hbCalls.Add(1); return hubclient.HeartbeatResponse{Ack: true}, f.hbErr
}
func (f *fakeHub) Refresh(_ context.Context, _ string) (hubclient.RefreshResponse, error) {
	f.refCalls.Add(1); return f.refOut, nil
}

func TestLoop_SendsHeartbeats(t *testing.T) {
	hub := &fakeHub{}
	l := New(Inputs{Hub: hub, Interval: 20 * time.Millisecond, ClusterID: "c", ClusterUID: "u"})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	l.RunWithCreds(ctx, "rk", "eyJ")
	if hub.hbCalls.Load() < 3 { t.Fatalf("only %d hb", hub.hbCalls.Load()) }
}

func TestLoop_RefreshesOnAccessExpired(t *testing.T) {
	hub := &fakeHub{
		hbErr:  &hubclient.APIError{Status: 401, Code: "access_expired"},
		refOut: hubclient.RefreshResponse{AccessToken: "new", AccessTTLs: 3600},
	}
	l := New(Inputs{Hub: hub, Interval: 10 * time.Millisecond, ClusterID: "c", ClusterUID: "u"})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	l.RunWithCreds(ctx, "rk", "eyJ")
	if hub.refCalls.Load() == 0 { t.Fatal("did not refresh") }
	_ = errors.New
}
```

- [ ] **Step 4: Implement heartbeat loop**

```go
package heartbeat

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type HubAPI interface {
	Heartbeat(ctx context.Context, access string, req hubclient.HeartbeatRequest) (hubclient.HeartbeatResponse, error)
	Refresh(ctx context.Context, refresh string) (hubclient.RefreshResponse, error)
}

type Inputs struct {
	Hub          HubAPI
	Interval     time.Duration
	ClusterID    string
	ClusterUID   string
	AgentVersion string
	K8sVersion   string
}

type Loop struct{ in Inputs }

func New(in Inputs) *Loop { return &Loop{in: in} }

func (l *Loop) RunWithCreds(ctx context.Context, refresh, access string) {
	t := time.NewTicker(l.in.Interval)
	defer t.Stop()
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		_, err := l.in.Hub.Heartbeat(ctx, access, hubclient.HeartbeatRequest{
			ClusterID: l.in.ClusterID, ClusterUID: l.in.ClusterUID,
			AgentVersion: l.in.AgentVersion, K8sVersion: l.in.K8sVersion,
			Status: "healthy",
		})
		if err == nil {
			backoff = time.Second
			continue
		}
		var apiErr *hubclient.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 && apiErr.Code == "access_expired" {
			rr, rerr := l.in.Hub.Refresh(ctx, refresh)
			if rerr == nil { access = rr.AccessToken; continue }
		}
		if errors.As(err, &apiErr) && apiErr.Status == 410 {
			log.Printf("hub returned 410 — re-registration required")
			return
		}
		// generic backoff
		log.Printf("heartbeat error: %v (backoff %s)", err, backoff)
		select {
		case <-ctx.Done(): return
		case <-time.After(backoff):
		}
		if backoff < 60*time.Second { backoff *= 2 }
	}
}
```

- [ ] **Step 5: Wire `cmd/agent/main.go`**

Replace placeholder with:

```go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	corev1clients "k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/kubilitics/kubilitics-agent/internal/bootstrap"
	"github.com/kubilitics/kubilitics-agent/internal/clusteruid"
	"github.com/kubilitics/kubilitics-agent/internal/config"
	"github.com/kubilitics/kubilitics-agent/internal/credstore"
	"github.com/kubilitics/kubilitics-agent/internal/heartbeat"
	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil { log.Fatal(err) }

	rcfg, err := rest.InClusterConfig()
	if err != nil { log.Fatalf("in-cluster config: %v", err) }
	cs, err := corev1clients.NewForConfig(rcfg)
	if err != nil { log.Fatal(err) }

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	uid, err := clusteruid.Read(ctx, cs)
	if err != nil { log.Fatalf("read kube-system UID: %v", err) }

	store := credstore.New(cs, cfg.CredsNamespace, cfg.CredsSecretName)
	hub, err := hubclient.New(cfg.HubURL, cfg.CABundlePath, cfg.InsecureSkipTLS)
	if err != nil { log.Fatal(err) }

	saToken := readSAToken()
	creds, err := bootstrap.Run(ctx, bootstrap.Inputs{
		Store: store, Hub: hub,
		BootstrapToken: cfg.BootstrapToken,
		SAToken:        saToken,
		ClusterUID:     uid,
		AgentVersion:   cfg.AgentVersion,
	})
	if err != nil { log.Fatalf("registration failed: %v", err) }

	go func() {
		c := make(chan os.Signal, 1)
		signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
		<-c; cancel()
	}()

	l := heartbeat.New(heartbeat.Inputs{
		Hub: hub, Interval: cfg.HeartbeatInterval,
		ClusterID: creds.ClusterID, ClusterUID: uid, AgentVersion: cfg.AgentVersion,
	})
	l.RunWithCreds(ctx, creds.RefreshToken, creds.AccessToken)
}

func readSAToken() string {
	b, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil { return "" }
	return string(b)
}
```

- [ ] **Step 6: Run all tests + build**

```bash
cd kubilitics-agent && go test ./... -v && go build ./...
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add kubilitics-agent/internal/bootstrap kubilitics-agent/internal/heartbeat kubilitics-agent/cmd/agent
git commit -m "feat(agent): bootstrap + heartbeat loop + main wiring"
```

---

## Task 14: Agent Dockerfile + Helm chart

**Files:**
- Create: `kubilitics-agent/Dockerfile`
- Create: `deploy/helm/kubilitics-agent/Chart.yaml`
- Create: `deploy/helm/kubilitics-agent/values.yaml`
- Create: `deploy/helm/kubilitics-agent/templates/deployment.yaml`
- Create: `deploy/helm/kubilitics-agent/templates/serviceaccount.yaml`
- Create: `deploy/helm/kubilitics-agent/templates/rbac.yaml`
- Create: `deploy/helm/kubilitics-agent/templates/secret-bootstrap.yaml`
- Create: `deploy/helm/kubilitics-agent/templates/_helpers.tpl`

- [ ] **Step 1: Dockerfile**

`kubilitics-agent/Dockerfile`:

```dockerfile
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.work go.work.sum ./
COPY kubilitics-backend ./kubilitics-backend
COPY kubilitics-agent ./kubilitics-agent
WORKDIR /src/kubilitics-agent
RUN CGO_ENABLED=0 go build -o /out/agent ./cmd/agent

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/agent /agent
USER nonroot:nonroot
ENTRYPOINT ["/agent"]
```

- [ ] **Step 2: Chart.yaml**

```yaml
apiVersion: v2
name: kubilitics-agent
description: Kubilitics agent — pushes cluster topology/events to a Kubilitics hub.
type: application
version: 0.1.0
appVersion: "0.4.0"
```

- [ ] **Step 3: values.yaml**

```yaml
image:
  repository: ghcr.io/kubilitics/kubilitics-agent
  tag: ""
  pullPolicy: IfNotPresent

# REQUIRED for remote clusters: hub URL the agent posts to.
# In same-cluster installs, use the in-cluster Service DNS:
#   http://kubilitics-hub.kubilitics-system.svc.cluster.local:8190
hub:
  url: ""
  token: ""             # bootstrap token for remote installs; leave empty for same-cluster.
  caBundle: ""          # optional PEM contents for private CA
  insecureSkipTLSVerify: false

namespace: kubilitics-system

resources:
  requests: { cpu: 50m, memory: 64Mi }
  limits:   { cpu: 200m, memory: 256Mi }
```

- [ ] **Step 4: templates**

`templates/_helpers.tpl`:

```tpl
{{- define "kubilitics-agent.fullname" -}}
{{ .Release.Name }}
{{- end -}}
```

`templates/serviceaccount.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "kubilitics-agent.fullname" . }}
  namespace: {{ .Values.namespace }}
```

`templates/rbac.yaml`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "kubilitics-agent.fullname" . }}
rules:
- apiGroups: [""]
  resources: ["namespaces"]
  verbs: ["get","list","watch"]
- apiGroups: [""]
  resources: ["nodes","pods","services","configmaps","events"]
  verbs: ["get","list","watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ include "kubilitics-agent.fullname" . }}
subjects:
- kind: ServiceAccount
  name: {{ include "kubilitics-agent.fullname" . }}
  namespace: {{ .Values.namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ include "kubilitics-agent.fullname" . }}
---
# Self-manage the credentials Secret in our own namespace.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ include "kubilitics-agent.fullname" . }}-creds
  namespace: {{ .Values.namespace }}
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get","create","update","patch"]
  resourceNames: ["kubilitics-agent-creds"]
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["create"]
- apiGroups: ["authentication.k8s.io"]
  resources: ["tokenreviews"]
  verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ include "kubilitics-agent.fullname" . }}-creds
  namespace: {{ .Values.namespace }}
subjects:
- kind: ServiceAccount
  name: {{ include "kubilitics-agent.fullname" . }}
  namespace: {{ .Values.namespace }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ include "kubilitics-agent.fullname" . }}-creds
```

`templates/secret-bootstrap.yaml`:

```yaml
{{- if or .Values.hub.token .Values.hub.caBundle -}}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "kubilitics-agent.fullname" . }}-hub
  namespace: {{ .Values.namespace }}
type: Opaque
stringData:
  {{- if .Values.hub.token }}
  token: {{ .Values.hub.token | quote }}
  {{- end }}
  {{- if .Values.hub.caBundle }}
  ca.crt: |
{{ .Values.hub.caBundle | indent 4 }}
  {{- end }}
{{- end }}
```

`templates/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "kubilitics-agent.fullname" . }}
  namespace: {{ .Values.namespace }}
spec:
  replicas: 1
  selector:
    matchLabels: { app: {{ include "kubilitics-agent.fullname" . }} }
  template:
    metadata:
      labels: { app: {{ include "kubilitics-agent.fullname" . }} }
    spec:
      serviceAccountName: {{ include "kubilitics-agent.fullname" . }}
      containers:
      - name: agent
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
        imagePullPolicy: {{ .Values.image.pullPolicy }}
        env:
        - name: POD_NAMESPACE
          valueFrom: { fieldRef: { fieldPath: metadata.namespace } }
        - name: KUBILITICS_HUB_URL
          value: {{ .Values.hub.url | quote }}
        - name: KUBILITICS_AGENT_VERSION
          value: {{ .Chart.AppVersion | quote }}
        {{- if .Values.hub.insecureSkipTLSVerify }}
        - name: KUBILITICS_HUB_INSECURE
          value: "true"
        {{- end }}
        {{- if .Values.hub.token }}
        - name: KUBILITICS_HUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: {{ include "kubilitics-agent.fullname" . }}-hub
              key: token
        {{- end }}
        {{- if .Values.hub.caBundle }}
        - name: KUBILITICS_HUB_CA_BUNDLE
          value: /etc/kubilitics/ca.crt
        volumeMounts:
        - name: hub-ca
          mountPath: /etc/kubilitics
          readOnly: true
        {{- end }}
        resources:
{{ toYaml .Values.resources | indent 10 }}
      {{- if .Values.hub.caBundle }}
      volumes:
      - name: hub-ca
        secret:
          secretName: {{ include "kubilitics-agent.fullname" . }}-hub
          items:
          - key: ca.crt
            path: ca.crt
      {{- end }}
```

- [ ] **Step 5: Lint chart**

```bash
helm lint deploy/helm/kubilitics-agent
helm template test deploy/helm/kubilitics-agent --set hub.url=http://hub.svc:8190 > /tmp/agent.yaml
grep -c "kind: Deployment" /tmp/agent.yaml
```
Expected: lint passes; manifest contains exactly one Deployment.

- [ ] **Step 6: Commit**

```bash
git add kubilitics-agent/Dockerfile deploy/helm/kubilitics-agent/
git commit -m "feat(agent): Dockerfile and Helm chart"
```

---

## Task 15: Hub-side signing-secret + service DNS in chart

**Files:**
- Create: `deploy/helm/kubilitics/templates/agent-signing-secret.yaml`
- Modify: `deploy/helm/kubilitics/templates/deployment.yaml` (add env var)

- [ ] **Step 1: Create the signing-secret template**

`deploy/helm/kubilitics/templates/agent-signing-secret.yaml`:

```yaml
{{- $secretName := printf "%s-agent-signing" .Release.Name -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $secretName -}}
{{- $value := "" -}}
{{- if $existing -}}
  {{- $value = index $existing.data "secret" -}}
{{- else -}}
  {{- $value = randAlphaNum 48 | b64enc -}}
{{- end -}}
apiVersion: v1
kind: Secret
metadata:
  name: {{ $secretName }}
  namespace: {{ .Release.Namespace }}
  annotations:
    "helm.sh/resource-policy": keep
type: Opaque
data:
  secret: {{ $value }}
```

The `keep` policy + `lookup` ensure the secret survives `helm uninstall`/`upgrade` and is generated only once.

- [ ] **Step 2: Inject into hub Deployment**

In `deploy/helm/kubilitics/templates/deployment.yaml`, add to the container `env:` block:

```yaml
- name: KUBILITICS_AGENT_SIGNING_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Release.Name }}-agent-signing
      key: secret
- name: KUBILITICS_PUBLIC_HUB_URL
  value: {{ .Values.publicHubURL | default (printf "http://%s.%s.svc:8190" .Release.Name .Release.Namespace) | quote }}
```

- [ ] **Step 3: Lint + render**

```bash
helm lint deploy/helm/kubilitics
helm template test deploy/helm/kubilitics > /tmp/hub.yaml
grep KUBILITICS_AGENT_SIGNING_SECRET /tmp/hub.yaml
grep agent-signing /tmp/hub.yaml
```
Expected: env var present; signing-secret rendered.

- [ ] **Step 4: Commit**

```bash
git add deploy/helm/kubilitics/templates/agent-signing-secret.yaml \
        deploy/helm/kubilitics/templates/deployment.yaml
git commit -m "feat(agent-trust): hub signing-secret + env wiring"
```

---

## Task 16: End-to-end kind test

**Files:**
- Create: `kubilitics-backend/tests/e2e/agent_registration_kind_test.go`
- Create: `scripts/e2e-agent-kind.sh`

- [ ] **Step 1: Write the e2e script**

`scripts/e2e-agent-kind.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
CLUSTER=kubilitics-e2e
kind delete cluster --name "$CLUSTER" 2>/dev/null || true
kind create cluster --name "$CLUSTER"

# Build images
docker build -t kubilitics-hub:e2e -f kubilitics-backend/Dockerfile .
docker build -t kubilitics-agent:e2e -f kubilitics-agent/Dockerfile .
kind load docker-image kubilitics-hub:e2e kubilitics-agent:e2e --name "$CLUSTER"

# Install hub
helm install kubilitics deploy/helm/kubilitics -n kubilitics-system --create-namespace \
  --set image.repository=kubilitics-hub --set image.tag=e2e

kubectl -n kubilitics-system rollout status deploy/kubilitics --timeout=180s

# Install agent in same cluster (no token needed)
helm install kubilitics-agent deploy/helm/kubilitics-agent -n kubilitics-system \
  --set image.repository=kubilitics-agent --set image.tag=e2e \
  --set hub.url=http://kubilitics.kubilitics-system.svc:8190

kubectl -n kubilitics-system rollout status deploy/kubilitics-agent --timeout=120s

# Wait for heartbeat
sleep 45
kubectl -n kubilitics-system exec deploy/kubilitics -- \
  sqlite3 /data/kubilitics.db "SELECT name,status FROM clusters;"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/e2e-agent-kind.sh
```

- [ ] **Step 3: Optional Go test wrapper**

`kubilitics-backend/tests/e2e/agent_registration_kind_test.go`:

```go
//go:build e2e

package e2e

import (
	"os/exec"
	"testing"
)

func TestAgentRegistrationKind(t *testing.T) {
	cmd := exec.Command("bash", "../../../scripts/e2e-agent-kind.sh")
	out, err := cmd.CombinedOutput()
	t.Log(string(out))
	if err != nil { t.Fatal(err) }
}
```

- [ ] **Step 4: Run e2e (manual; CI integration later)**

```bash
go test -tags=e2e ./kubilitics-backend/tests/e2e/... -v -timeout 10m
```
Expected: agent appears in `clusters` table with status `active`.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/tests/e2e/agent_registration_kind_test.go scripts/e2e-agent-kind.sh
git commit -m "test(agent-trust): kind-based e2e for same-cluster registration"
```

---

## Self-Review (performed)

**Spec coverage**

| Spec section | Task |
|---|---|
| 3.1 same-cluster flow | 5, 6, 13 |
| 3.2 remote token flow | 6, 9, 14 |
| 4 cluster identity (`cluster_uid`, `cluster_id`, name, re-register, 410) | 1, 6, 8, 11 |
| 5.1 bootstrap token format/TTL/single-use/revoke | 2, 4, 6, 9 |
| 5.2 refresh + access JWT pair | 2, 3, 6, 7 |
| 6 secure communication (TLS, CA pin, dev-only insecure, rate limit) | 12, 14 — **rate limit deferred to a follow-up task; flagged below** |
| 7 APIs | 6, 7, 8, 9 |
| 8 lifecycle | 13 (RunWithCreds), 8 (status update) |
| 9 failure handling table | 6, 7, 8, 13 |
| 10 persistence (3 tables + index) | 1, 4 |
| 11 unit boundaries | reflected in file structure table |
| 12 test strategy | unit tests in tasks 2-8, 11-13; e2e in task 16 |

**Gap: per-cluster rate limiting (spec §6).** Not implemented in any task. Add follow-up:

### Task 17: Per-cluster rate limiting on agent endpoints (follow-up)

**Files:** Create `kubilitics-backend/internal/api/rest/agent_ratelimit.go`, modify wiring in Task 10.

- [ ] Implement a `golang.org/x/time/rate.Limiter` per `cluster_id` (sync.Map of limiters, default 10 r/s burst 50). Apply as middleware around `/agent/heartbeat` and `/agent/token/refresh`. On excess: `429`. Add a unit test that fires 60 requests in <1s and asserts ≥10 of them get 429.
- [ ] Commit: `feat(agent-trust): per-cluster rate limit on agent endpoints`.

**Placeholder scan:** No "TODO/TBD/implement later" left in actionable steps. The `_ = createdBy // reserved for audit log in later spec` line in Task 6 is intentional and explicit about its deferred nature.

**Type consistency:** `Cluster`, `BootstrapToken`, `AgentCredential` field names match across migration, models, repo methods, handler payloads, and agent client. `accessTTL` / `refreshTTL` constants are defined once in `agent_register.go` and reused. `AccessClaims.Epoch` (int) matches `clusters.credential_epoch` (INTEGER) and `agent_credentials.credential_epoch`.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-18-agent-registration-trust-model.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task with two-stage review between tasks.
2. **Inline Execution** — I execute tasks here using `executing-plans`, with checkpoints for your review.

Which approach?
