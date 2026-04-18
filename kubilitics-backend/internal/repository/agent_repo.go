package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// AgentRepo provides data access for the agent trust model tables:
// agent_clusters, bootstrap_tokens, and agent_credentials.
type AgentRepo struct{ db *sql.DB }

// NewAgentRepo creates a new AgentRepo backed by the provided *sql.DB.
func NewAgentRepo(db *sql.DB) *AgentRepo { return &AgentRepo{db: db} }

// ErrAgentNotFound is returned when a requested row does not exist.
var ErrAgentNotFound = errors.New("agent: not found")

// UpsertCluster inserts a new cluster or updates name/version/status
// while preserving credential_epoch and registered_at.
func (r *AgentRepo) UpsertCluster(ctx context.Context, c *models.AgentCluster) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO agent_clusters (id, organization_id, cluster_uid, name, k8s_version, agent_version,
                            node_count, status, credential_epoch)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(organization_id, cluster_uid) DO UPDATE SET
  name = excluded.name,
  k8s_version = excluded.k8s_version,
  agent_version = excluded.agent_version,
  node_count = excluded.node_count,
  status = excluded.status,
  credential_epoch = excluded.credential_epoch
`, c.ID, c.OrganizationID, c.ClusterUID, c.Name, c.K8sVersion, c.AgentVersion,
		c.NodeCount, c.Status, c.CredentialEpoch)
	return err
}

// GetClusterByUID looks up a cluster by organization ID and cluster UID.
func (r *AgentRepo) GetClusterByUID(ctx context.Context, orgID, uid string) (*models.AgentCluster, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT id, organization_id, cluster_uid, name, k8s_version, agent_version,
       node_count, status, credential_epoch, registered_at, last_heartbeat_at
FROM agent_clusters WHERE organization_id = ? AND cluster_uid = ?`, orgID, uid)
	return scanAgentCluster(row)
}

// GetClusterByID looks up a cluster by its primary key ID.
func (r *AgentRepo) GetClusterByID(ctx context.Context, id string) (*models.AgentCluster, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT id, organization_id, cluster_uid, name, k8s_version, agent_version,
       node_count, status, credential_epoch, registered_at, last_heartbeat_at
FROM agent_clusters WHERE id = ?`, id)
	return scanAgentCluster(row)
}

// UpdateClusterHeartbeat updates live fields on a cluster after a heartbeat.
func (r *AgentRepo) UpdateClusterHeartbeat(ctx context.Context, id, status, agentVersion, k8sVersion string, nodes int, ts time.Time) error {
	_, err := r.db.ExecContext(ctx, `
UPDATE agent_clusters SET status=?, agent_version=?, k8s_version=?, node_count=?, last_heartbeat_at=?
WHERE id=?`, status, agentVersion, k8sVersion, nodes, ts, id)
	return err
}

// BumpClusterEpoch increments credential_epoch by 1, invalidating old credentials.
func (r *AgentRepo) BumpClusterEpoch(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE agent_clusters SET credential_epoch = credential_epoch + 1 WHERE id = ?`, id)
	return err
}

// MarkClusterSuperseded sets a cluster's status to 'superseded'.
func (r *AgentRepo) MarkClusterSuperseded(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE agent_clusters SET status='superseded' WHERE id=?`, id)
	return err
}

// InsertBootstrapToken stores a new bootstrap token.
func (r *AgentRepo) InsertBootstrapToken(ctx context.Context, t *models.BootstrapToken) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO bootstrap_tokens (jti, organization_id, created_by, expires_at)
VALUES (?, ?, ?, ?)`, t.JTI, t.OrganizationID, t.CreatedBy, t.ExpiresAt)
	return err
}

// GetBootstrapToken retrieves a bootstrap token by JTI.
func (r *AgentRepo) GetBootstrapToken(ctx context.Context, jti string) (*models.BootstrapToken, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT jti, organization_id, created_by, created_at, expires_at, used_at, used_by_cluster, revoked_at
FROM bootstrap_tokens WHERE jti=?`, jti)
	var b models.BootstrapToken
	var usedAt, revokedAt sql.NullTime
	var usedBy sql.NullString
	if err := row.Scan(&b.JTI, &b.OrganizationID, &b.CreatedBy, &b.CreatedAt, &b.ExpiresAt,
		&usedAt, &usedBy, &revokedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrAgentNotFound
		}
		return nil, err
	}
	if usedAt.Valid {
		t := usedAt.Time
		b.UsedAt = &t
	}
	if revokedAt.Valid {
		t := revokedAt.Time
		b.RevokedAt = &t
	}
	if usedBy.Valid {
		s := usedBy.String
		b.UsedByCluster = &s
	}
	return &b, nil
}

// MarkBootstrapTokenUsed atomically marks a token as used by a cluster.
// Returns ErrAgentNotFound if the token was already used, revoked, or does not exist.
func (r *AgentRepo) MarkBootstrapTokenUsed(ctx context.Context, jti, clusterID string) error {
	res, err := r.db.ExecContext(ctx, `
UPDATE bootstrap_tokens SET used_at = CURRENT_TIMESTAMP, used_by_cluster = ?
WHERE jti = ? AND used_at IS NULL AND revoked_at IS NULL`, clusterID, jti)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrAgentNotFound
	}
	return nil
}

// InsertAgentCredential stores a new agent credential (refresh token hash).
func (r *AgentRepo) InsertAgentCredential(ctx context.Context, c *models.AgentCredential) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO agent_credentials (id, cluster_id, refresh_token_hash, expires_at, credential_epoch)
VALUES (?, ?, ?, ?, ?)`, c.ID, c.ClusterID, c.RefreshTokenHash, c.ExpiresAt, c.CredentialEpoch)
	return err
}

// ListActiveCredentialsByCluster returns all non-revoked credentials for a cluster.
func (r *AgentRepo) ListActiveCredentialsByCluster(ctx context.Context, clusterID string) ([]models.AgentCredential, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, cluster_id, refresh_token_hash, issued_at, expires_at, last_used_at, revoked_at, credential_epoch
FROM agent_credentials WHERE cluster_id = ? AND revoked_at IS NULL`, clusterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.AgentCredential
	for rows.Next() {
		var c models.AgentCredential
		var lastUsed, revoked sql.NullTime
		if err := rows.Scan(&c.ID, &c.ClusterID, &c.RefreshTokenHash, &c.IssuedAt, &c.ExpiresAt,
			&lastUsed, &revoked, &c.CredentialEpoch); err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			t := lastUsed.Time
			c.LastUsedAt = &t
		}
		if revoked.Valid {
			t := revoked.Time
			c.RevokedAt = &t
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// RevokeAgentCredential marks a credential as revoked by setting revoked_at.
func (r *AgentRepo) RevokeAgentCredential(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE agent_credentials SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`, id)
	return err
}

// TouchAgentCredential updates last_used_at on a credential.
func (r *AgentRepo) TouchAgentCredential(ctx context.Context, id string, ts time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE agent_credentials SET last_used_at = ? WHERE id = ?`, ts, id)
	return err
}

// FindActiveCredentialByToken scans all non-revoked, non-expired credentials and
// returns the (credential, cluster) pair whose stored hash verifies against the
// supplied refresh token. Linear scan is acceptable for typical fleets (one
// active credential per cluster). Returns ErrAgentNotFound if none match.
func (r *AgentRepo) FindActiveCredentialByToken(
	ctx context.Context,
	token string,
	verify func(tok, hash string) bool,
) (*models.AgentCredential, *models.AgentCluster, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT ac.id, ac.cluster_id, ac.refresh_token_hash, ac.issued_at, ac.expires_at,
       ac.last_used_at, ac.revoked_at, ac.credential_epoch,
       c.id, c.organization_id, c.cluster_uid, c.name, c.k8s_version, c.agent_version,
       c.node_count, c.status, c.credential_epoch, c.registered_at, c.last_heartbeat_at
FROM agent_credentials ac
JOIN agent_clusters c ON c.id = ac.cluster_id
WHERE ac.revoked_at IS NULL AND ac.expires_at > CURRENT_TIMESTAMP`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var cred models.AgentCredential
		var cluster models.AgentCluster
		var lastUsed, revoked, lastHB sql.NullTime
		if err := rows.Scan(
			&cred.ID, &cred.ClusterID, &cred.RefreshTokenHash, &cred.IssuedAt,
			&cred.ExpiresAt, &lastUsed, &revoked, &cred.CredentialEpoch,
			&cluster.ID, &cluster.OrganizationID, &cluster.ClusterUID, &cluster.Name,
			&cluster.K8sVersion, &cluster.AgentVersion, &cluster.NodeCount, &cluster.Status,
			&cluster.CredentialEpoch, &cluster.RegisteredAt, &lastHB,
		); err != nil {
			return nil, nil, err
		}
		if lastUsed.Valid {
			t := lastUsed.Time
			cred.LastUsedAt = &t
		}
		if revoked.Valid {
			t := revoked.Time
			cred.RevokedAt = &t
		}
		if lastHB.Valid {
			t := lastHB.Time
			cluster.LastHeartbeatAt = &t
		}
		if verify(token, cred.RefreshTokenHash) {
			return &cred, &cluster, nil
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return nil, nil, ErrAgentNotFound
}

// scanAgentCluster scans a single row into an AgentCluster.
func scanAgentCluster(row *sql.Row) (*models.AgentCluster, error) {
	var c models.AgentCluster
	var lastHB sql.NullTime
	// registered_at is NOT NULL DEFAULT CURRENT_TIMESTAMP per migration 051; safe to scan into time.Time.
	if err := row.Scan(&c.ID, &c.OrganizationID, &c.ClusterUID, &c.Name, &c.K8sVersion,
		&c.AgentVersion, &c.NodeCount, &c.Status, &c.CredentialEpoch, &c.RegisteredAt, &lastHB); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrAgentNotFound
		}
		return nil, err
	}
	if lastHB.Valid {
		t := lastHB.Time
		c.LastHeartbeatAt = &t
	}
	return &c, nil
}
