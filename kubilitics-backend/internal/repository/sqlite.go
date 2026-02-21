package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	mfa "github.com/kubilitics/kubilitics-backend/internal/auth/mfa"
	_ "modernc.org/sqlite" // pure-Go SQLite driver (no CGO required)
)

// SQLiteRepository implements repositories using SQLite
type SQLiteRepository struct {
	db *sqlx.DB
}

// NewSQLiteRepository creates a new SQLite repository
// BE-SCALE-001: Enables WAL mode for better concurrency and connection pooling.
func NewSQLiteRepository(dbPath string) (*SQLiteRepository, error) {
	// Use connection string with WAL mode and other optimizations
	dsn := dbPath + "?_journal_mode=WAL&_foreign_keys=ON&_busy_timeout=5000"
	db, err := sqlx.Connect("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to SQLite: %w", err)
	}

	// SQLite WAL mode supports concurrent readers but serializes writers.
	// Using a single connection prevents SQLITE_BUSY errors under concurrent
	// write load; the connection pool handles connection reuse efficiently.
	// BE-SCALE-001: MaxOpenConns=1 is the correct setting for SQLite regardless
	// of journal mode — multiple connections competing for the write lock cause
	// SQLITE_BUSY even with busy_timeout enabled.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Set busy timeout via PRAGMA as well (belt-and-suspenders with DSN param)
	if _, err := db.Exec("PRAGMA busy_timeout = 5000"); err != nil {
		return nil, fmt.Errorf("failed to set busy_timeout: %w", err)
	}

	// Enable foreign keys (also in DSN, but ensure it's set)
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	// Verify WAL mode is enabled
	var journalMode string
	if err := db.Get(&journalMode, "PRAGMA journal_mode"); err != nil {
		return nil, fmt.Errorf("failed to check journal mode: %w", err)
	}
	if journalMode != "wal" {
		// Try to enable WAL mode explicitly
		if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
			return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
		}
	}

	return &SQLiteRepository{db: db}, nil
}

// Close closes the database connection
func (r *SQLiteRepository) Close() error {
	return r.db.Close()
}

// Ping checks database connectivity
func (r *SQLiteRepository) Ping(ctx context.Context) error {
	return r.db.PingContext(ctx)
}

// RunMigrations runs database migrations
func (r *SQLiteRepository) RunMigrations(migrationSQL string) error {
	_, err := r.db.Exec(migrationSQL)
	return err
}

// ClusterRepository implementation (interface: Create, Get, List, Update, Delete)

func (r *SQLiteRepository) Create(ctx context.Context, cluster *models.Cluster) error {
	return r.createCluster(ctx, cluster)
}

func (r *SQLiteRepository) Get(ctx context.Context, id string) (*models.Cluster, error) {
	return r.getCluster(ctx, id)
}

func (r *SQLiteRepository) List(ctx context.Context) ([]*models.Cluster, error) {
	return r.listClusters(ctx)
}

func (r *SQLiteRepository) Update(ctx context.Context, cluster *models.Cluster) error {
	return r.updateCluster(ctx, cluster)
}

func (r *SQLiteRepository) Delete(ctx context.Context, id string) error {
	return r.deleteCluster(ctx, id)
}

func (r *SQLiteRepository) createCluster(ctx context.Context, cluster *models.Cluster) error {
	if cluster.ID == "" {
		cluster.ID = uuid.New().String()
	}
	if cluster.Provider == "" {
		cluster.Provider = "on-prem"
	}

	query := `
		INSERT INTO clusters (id, name, context, kubeconfig_path, server_url, version, status, provider, last_connected, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := r.db.ExecContext(ctx, query,
		cluster.ID,
		cluster.Name,
		cluster.Context,
		cluster.KubeconfigPath,
		cluster.ServerURL,
		cluster.Version,
		cluster.Status,
		cluster.Provider,
		cluster.LastConnected,
		time.Now(),
		time.Now(),
	)

	return err
}

func (r *SQLiteRepository) getCluster(ctx context.Context, id string) (*models.Cluster, error) {
	var cluster models.Cluster
	query := `SELECT * FROM clusters WHERE id = ?`

	err := r.db.GetContext(ctx, &cluster, query, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}

	return &cluster, err
}

func (r *SQLiteRepository) listClusters(ctx context.Context) ([]*models.Cluster, error) {
	var clusters []*models.Cluster
	query := `SELECT * FROM clusters ORDER BY created_at DESC`

	err := r.db.SelectContext(ctx, &clusters, query)
	return clusters, err
}

func (r *SQLiteRepository) updateCluster(ctx context.Context, cluster *models.Cluster) error {
	query := `
		UPDATE clusters
		SET name = ?, context = ?, kubeconfig_path = ?, server_url = ?, version = ?,
		    status = ?, provider = ?, last_connected = ?, updated_at = ?
		WHERE id = ?
	`

	_, err := r.db.ExecContext(ctx, query,
		cluster.Name,
		cluster.Context,
		cluster.KubeconfigPath,
		cluster.ServerURL,
		cluster.Version,
		cluster.Status,
		cluster.Provider,
		cluster.LastConnected,
		time.Now(),
		cluster.ID,
	)

	return err
}

func (r *SQLiteRepository) deleteCluster(ctx context.Context, id string) error {
	query := `DELETE FROM clusters WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// TopologyRepository implementation

func (r *SQLiteRepository) SaveTopologySnapshot(ctx context.Context, snapshot *models.TopologySnapshot) error {
	if snapshot.ID == "" {
		snapshot.ID = uuid.New().String()
	}

	query := `
		INSERT INTO topology_snapshots (id, cluster_id, namespace, data, node_count, edge_count, layout_seed, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`

	// Parse data to get counts
	var topology models.TopologyGraph
	if err := json.Unmarshal([]byte(snapshot.Data), &topology); err != nil {
		return fmt.Errorf("failed to parse topology data: %w", err)
	}

	_, err := r.db.ExecContext(ctx, query,
		snapshot.ID,
		snapshot.ClusterID,
		snapshot.Namespace,
		snapshot.Data,
		topology.Metadata.NodeCount,
		topology.Metadata.EdgeCount,
		topology.Metadata.LayoutSeed,
		snapshot.Timestamp,
	)

	return err
}

func (r *SQLiteRepository) GetTopologySnapshot(ctx context.Context, id string) (*models.TopologySnapshot, error) {
	var snapshot models.TopologySnapshot
	query := `SELECT * FROM topology_snapshots WHERE id = ?`

	err := r.db.GetContext(ctx, &snapshot, query, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("snapshot not found: %s", id)
	}

	return &snapshot, err
}

func (r *SQLiteRepository) ListTopologySnapshots(ctx context.Context, clusterID string, limit int) ([]*models.TopologySnapshot, error) {
	var snapshots []*models.TopologySnapshot
	query := `
		SELECT * FROM topology_snapshots
		WHERE cluster_id = ?
		ORDER BY timestamp DESC
		LIMIT ?
	`

	err := r.db.SelectContext(ctx, &snapshots, query, clusterID, limit)
	return snapshots, err
}

func (r *SQLiteRepository) GetLatestTopologySnapshot(ctx context.Context, clusterID, namespace string) (*models.TopologySnapshot, error) {
	var snapshot models.TopologySnapshot
	var query string
	var args []interface{}

	if namespace != "" {
		query = `
			SELECT * FROM topology_snapshots
			WHERE cluster_id = ? AND namespace = ?
			ORDER BY timestamp DESC
			LIMIT 1
		`
		args = []interface{}{clusterID, namespace}
	} else {
		query = `
			SELECT * FROM topology_snapshots
			WHERE cluster_id = ? AND namespace IS NULL
			ORDER BY timestamp DESC
			LIMIT 1
		`
		args = []interface{}{clusterID}
	}

	err := r.db.GetContext(ctx, &snapshot, query, args...)
	if err == sql.ErrNoRows {
		return nil, nil // No snapshot found
	}

	return &snapshot, err
}

func (r *SQLiteRepository) DeleteOldTopologySnapshots(ctx context.Context, clusterID string, olderThan time.Time) error {
	query := `DELETE FROM topology_snapshots WHERE cluster_id = ? AND timestamp < ?`
	_, err := r.db.ExecContext(ctx, query, clusterID, olderThan)
	return err
}

// HistoryRepository implementation

func (r *SQLiteRepository) CreateResourceHistory(ctx context.Context, history *models.ResourceHistory) error {
	if history.ID == "" {
		history.ID = uuid.New().String()
	}

	query := `
		INSERT INTO resource_history (id, cluster_id, resource_type, namespace, name, action, yaml, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := r.db.ExecContext(ctx, query,
		history.ID,
		"", // cluster_id - needs to be added to model
		history.ResourceType,
		history.Namespace,
		history.Name,
		history.Action,
		history.YAML,
		history.Timestamp,
	)

	return err
}

func (r *SQLiteRepository) ListResourceHistory(ctx context.Context, clusterID, resourceType, namespace, name string, limit int) ([]*models.ResourceHistory, error) {
	var history []*models.ResourceHistory
	query := `
		SELECT * FROM resource_history
		WHERE 1=1
	`
	args := []interface{}{}

	if clusterID != "" {
		query += " AND cluster_id = ?"
		args = append(args, clusterID)
	}

	if resourceType != "" {
		query += " AND resource_type = ?"
		args = append(args, resourceType)
	}

	if namespace != "" {
		query += " AND namespace = ?"
		args = append(args, namespace)
	}

	if name != "" {
		query += " AND name = ?"
		args = append(args, name)
	}

	query += " ORDER BY timestamp DESC LIMIT ?"
	args = append(args, limit)

	err := r.db.SelectContext(ctx, &history, query, args...)
	return history, err
}

// ProjectRepository implementation

func (r *SQLiteRepository) CreateProject(ctx context.Context, p *models.Project) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	query := `INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, p.ID, p.Name, p.Description, time.Now(), time.Now())
	return err
}

func (r *SQLiteRepository) GetProject(ctx context.Context, id string) (*models.Project, error) {
	var p models.Project
	err := r.db.GetContext(ctx, &p, `SELECT * FROM projects WHERE id = ?`, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("project not found: %s", id)
	}
	return &p, err
}

func (r *SQLiteRepository) ListProjects(ctx context.Context) ([]*models.ProjectListItem, error) {
	query := `SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
		(SELECT COUNT(*) FROM project_clusters WHERE project_id = p.id) AS cluster_count,
		(SELECT COUNT(*) FROM project_namespaces WHERE project_id = p.id) AS namespace_count
	FROM projects p ORDER BY p.name ASC`
	var list []*models.ProjectListItem
	err := r.db.SelectContext(ctx, &list, query)
	return list, err
}

func (r *SQLiteRepository) UpdateProject(ctx context.Context, p *models.Project) error {
	query := `UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, p.Name, p.Description, time.Now(), p.ID)
	return err
}

func (r *SQLiteRepository) DeleteProject(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, id)
	return err
}

func (r *SQLiteRepository) AddClusterToProject(ctx context.Context, pc *models.ProjectCluster) error {
	query := `INSERT INTO project_clusters (project_id, cluster_id, created_at) VALUES (?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, pc.ProjectID, pc.ClusterID, time.Now())
	return err
}

func (r *SQLiteRepository) RemoveClusterFromProject(ctx context.Context, projectID, clusterID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM project_clusters WHERE project_id = ? AND cluster_id = ?`, projectID, clusterID)
	return err
}

func (r *SQLiteRepository) ListProjectClusters(ctx context.Context, projectID string) ([]*models.ProjectCluster, error) {
	var list []*models.ProjectCluster
	err := r.db.SelectContext(ctx, &list, `SELECT project_id, cluster_id FROM project_clusters WHERE project_id = ? ORDER BY cluster_id`, projectID)
	return list, err
}

func (r *SQLiteRepository) AddNamespaceToProject(ctx context.Context, pn *models.ProjectNamespace) error {
	query := `INSERT INTO project_namespaces (project_id, cluster_id, namespace_name, team, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, pn.ProjectID, pn.ClusterID, pn.NamespaceName, pn.Team, time.Now())
	return err
}

func (r *SQLiteRepository) RemoveNamespaceFromProject(ctx context.Context, projectID, clusterID, namespaceName string) error {
	query := `DELETE FROM project_namespaces WHERE project_id = ? AND cluster_id = ? AND namespace_name = ?`
	_, err := r.db.ExecContext(ctx, query, projectID, clusterID, namespaceName)
	return err
}

func (r *SQLiteRepository) ListProjectNamespaces(ctx context.Context, projectID string) ([]*models.ProjectNamespace, error) {
	var list []*models.ProjectNamespace
	err := r.db.SelectContext(ctx, &list, `SELECT project_id, cluster_id, namespace_name, team FROM project_namespaces WHERE project_id = ? ORDER BY cluster_id, team, namespace_name`, projectID)
	return list, err
}

// User methods (BE-AUTH-001)

func (r *SQLiteRepository) CreateUser(ctx context.Context, u *models.User) error {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	query := `INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, u.ID, u.Username, u.PasswordHash, u.Role, u.CreatedAt)
	return err
}

func (r *SQLiteRepository) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	var u models.User
	err := r.db.GetContext(ctx, &u, `SELECT id, username, password_hash, role, created_at, last_login, locked_until, failed_login_count, last_failed_login, deleted_at FROM users WHERE username = ? AND deleted_at IS NULL`, username)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *SQLiteRepository) GetUserByID(ctx context.Context, id string) (*models.User, error) {
	var u models.User
	err := r.db.GetContext(ctx, &u, `SELECT id, username, password_hash, role, created_at, last_login, locked_until, failed_login_count, last_failed_login, deleted_at FROM users WHERE id = ? AND deleted_at IS NULL`, id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *SQLiteRepository) UpdateUserLastLogin(ctx context.Context, id string, t time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET last_login = ? WHERE id = ?`, t, id)
	return err
}

func (r *SQLiteRepository) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := r.db.GetContext(ctx, &n, `SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`)
	return n, err
}

func (r *SQLiteRepository) ListUsers(ctx context.Context) ([]*models.User, error) {
	var users []*models.User
	err := r.db.SelectContext(ctx, &users, `SELECT id, username, password_hash, role, created_at, last_login, locked_until, failed_login_count, last_failed_login, deleted_at FROM users WHERE deleted_at IS NULL ORDER BY username`)
	return users, err
}

func (r *SQLiteRepository) UpdateUserRole(ctx context.Context, userID, role string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, role, userID)
	return err
}

func (r *SQLiteRepository) DeleteUser(ctx context.Context, userID string) error {
	// BE-FUNC-004: Soft delete (set deleted_at) instead of hard delete
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE users SET deleted_at = ? WHERE id = ?`, now, userID)
	return err
}

// Auth security methods (BE-AUTH-002)

func (r *SQLiteRepository) IncrementFailedLogin(ctx context.Context, userID string) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE users SET failed_login_count = failed_login_count + 1, last_failed_login = ? WHERE id = ?`, now, userID)
	return err
}

func (r *SQLiteRepository) ResetFailedLogin(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET failed_login_count = 0, last_failed_login = NULL WHERE id = ?`, userID)
	return err
}

func (r *SQLiteRepository) LockUser(ctx context.Context, userID string, until time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET locked_until = ? WHERE id = ?`, until, userID)
	return err
}

func (r *SQLiteRepository) UnlockUser(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET locked_until = NULL, failed_login_count = 0, last_failed_login = NULL WHERE id = ?`, userID)
	return err
}

func (r *SQLiteRepository) UpdateUserPassword(ctx context.Context, userID, passwordHash string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID)
	return err
}

func (r *SQLiteRepository) CreateAuthEvent(ctx context.Context, e *models.AuthEvent) error {
	if e.ID == "" {
		e.ID = uuid.New().String()
	}
	query := `INSERT INTO auth_events (id, user_id, username, event_type, ip_address, user_agent, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, e.ID, e.UserID, e.Username, e.EventType, e.IPAddress, e.UserAgent, e.Timestamp, e.Details)
	return err
}

func (r *SQLiteRepository) ListAuthEvents(ctx context.Context, userID *string, eventType *string, limit int) ([]*models.AuthEvent, error) {
	query := `SELECT id, user_id, username, event_type, ip_address, user_agent, timestamp, details FROM auth_events WHERE 1=1`
	args := []interface{}{}
	if userID != nil {
		query += ` AND user_id = ?`
		args = append(args, *userID)
	}
	if eventType != nil {
		query += ` AND event_type = ?`
		args = append(args, *eventType)
	}
	query += ` ORDER BY timestamp DESC LIMIT ?`
	args = append(args, limit)
	var events []*models.AuthEvent
	err := r.db.SelectContext(ctx, &events, query, args...)
	return events, err
}

// Cluster permission methods (BE-AUTHZ-001)

func (r *SQLiteRepository) CreateClusterPermission(ctx context.Context, cp *models.ClusterPermission) error {
	if cp.ID == "" {
		cp.ID = uuid.New().String()
	}
	query := `INSERT INTO cluster_permissions (id, user_id, cluster_id, role, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, cp.ID, cp.UserID, cp.ClusterID, cp.Role, cp.CreatedAt)
	return err
}

func (r *SQLiteRepository) GetClusterPermission(ctx context.Context, userID, clusterID string) (*models.ClusterPermission, error) {
	var cp models.ClusterPermission
	err := r.db.GetContext(ctx, &cp, `SELECT id, user_id, cluster_id, role, created_at FROM cluster_permissions WHERE user_id = ? AND cluster_id = ?`, userID, clusterID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cp, nil
}

func (r *SQLiteRepository) UpdateClusterPermission(ctx context.Context, cp *models.ClusterPermission) error {
	_, err := r.db.ExecContext(ctx, `UPDATE cluster_permissions SET role = ? WHERE user_id = ? AND cluster_id = ?`, cp.Role, cp.UserID, cp.ClusterID)
	return err
}

func (r *SQLiteRepository) DeleteClusterPermission(ctx context.Context, userID, clusterID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM cluster_permissions WHERE user_id = ? AND cluster_id = ?`, userID, clusterID)
	return err
}

func (r *SQLiteRepository) ListClusterPermissionsByUser(ctx context.Context, userID string) ([]*models.ClusterPermission, error) {
	var perms []*models.ClusterPermission
	err := r.db.SelectContext(ctx, &perms, `SELECT id, user_id, cluster_id, role, created_at FROM cluster_permissions WHERE user_id = ?`, userID)
	return perms, err
}

func (r *SQLiteRepository) ListClusterPermissionsByCluster(ctx context.Context, clusterID string) ([]*models.ClusterPermission, error) {
	var perms []*models.ClusterPermission
	err := r.db.SelectContext(ctx, &perms, `SELECT id, user_id, cluster_id, role, created_at FROM cluster_permissions WHERE cluster_id = ?`, clusterID)
	return perms, err
}

// API key methods (BE-AUTH-003)

func (r *SQLiteRepository) CreateAPIKey(ctx context.Context, key *models.APIKey) error {
	if key.ID == "" {
		key.ID = uuid.New().String()
	}
	query := `INSERT INTO api_keys (id, user_id, key_hash, name, last_used, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, key.ID, key.UserID, key.KeyHash, key.Name, key.LastUsed, key.ExpiresAt, key.CreatedAt)
	return err
}

func (r *SQLiteRepository) GetAPIKeyByHash(ctx context.Context, keyHash string) (*models.APIKey, error) {
	var key models.APIKey
	err := r.db.GetContext(ctx, &key, `SELECT id, user_id, key_hash, name, last_used, expires_at, created_at FROM api_keys WHERE key_hash = ?`, keyHash)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *SQLiteRepository) ListAPIKeysByUser(ctx context.Context, userID string) ([]*models.APIKey, error) {
	var keys []*models.APIKey
	err := r.db.SelectContext(ctx, &keys, `SELECT id, user_id, key_hash, name, last_used, expires_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`, userID)
	return keys, err
}

func (r *SQLiteRepository) UpdateAPIKeyLastUsed(ctx context.Context, keyID string) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE api_keys SET last_used = ? WHERE id = ?`, now, keyID)
	return err
}

func (r *SQLiteRepository) DeleteAPIKey(ctx context.Context, keyID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM api_keys WHERE id = ?`, keyID)
	return err
}

// FindAPIKeyByPlaintext finds an API key by checking all stored hashes against the plaintext (BE-AUTH-003).
// This is inefficient but secure. In production, consider optimizing with a lookup table.
func (r *SQLiteRepository) FindAPIKeyByPlaintext(ctx context.Context, plaintextKey string) (*models.APIKey, error) {
	// Get all API keys (this is inefficient but works for MVP)
	// In production, we'd want a better lookup mechanism
	var allKeys []*models.APIKey
	err := r.db.SelectContext(ctx, &allKeys, `SELECT id, user_id, key_hash, name, last_used, expires_at, created_at FROM api_keys`)
	if err != nil {
		return nil, err
	}
	// Check each hash against the plaintext
	for _, key := range allKeys {
		if err := auth.CheckAPIKey(key.KeyHash, plaintextKey); err == nil {
			return key, nil
		}
	}
	return nil, sql.ErrNoRows
}

// Audit log methods (BE-SEC-002, append-only)

func (r *SQLiteRepository) CreateAuditLog(ctx context.Context, e *models.AuditLogEntry) error {
	if e.ID == "" {
		e.ID = uuid.New().String()
	}
	// Phase 6: Enhanced audit log with new fields
	query := `INSERT INTO audit_log (id, timestamp, user_id, username, cluster_id, action, resource_kind, resource_namespace, resource_name, status_code, request_ip, details, session_id, device_info, geolocation, risk_score, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query,
		e.ID, e.Timestamp, e.UserID, e.Username, e.ClusterID, e.Action,
		e.ResourceKind, e.ResourceNamespace, e.ResourceName, e.StatusCode, e.RequestIP, e.Details,
		e.SessionID, e.DeviceInfo, e.Geolocation, e.RiskScore, e.CorrelationID)
	return err
}

// ListAuditLog lists audit log entries with optional filters (BE-SEC-002).
// Phase 6: Enhanced with new fields
func (r *SQLiteRepository) ListAuditLog(ctx context.Context, userID *string, clusterID *string, action *string, since *time.Time, until *time.Time, limit int) ([]*models.AuditLogEntry, error) {
	query := `SELECT id, timestamp, user_id, username, cluster_id, action, resource_kind, resource_namespace, resource_name, status_code, request_ip, details, session_id, device_info, geolocation, risk_score, correlation_id FROM audit_log WHERE 1=1`
	args := []interface{}{}
	if userID != nil && *userID != "" {
		query += ` AND user_id = ?`
		args = append(args, *userID)
	}
	if clusterID != nil && *clusterID != "" {
		query += ` AND cluster_id = ?`
		args = append(args, *clusterID)
	}
	if action != nil && *action != "" {
		query += ` AND action = ?`
		args = append(args, *action)
	}
	if since != nil {
		query += ` AND timestamp >= ?`
		args = append(args, *since)
	}
	if until != nil {
		query += ` AND timestamp <= ?`
		args = append(args, *until)
	}
	query += ` ORDER BY timestamp DESC LIMIT ?`
	if limit <= 0 {
		limit = 100
	}
	args = append(args, limit)
	var entries []*models.AuditLogEntry
	err := r.db.SelectContext(ctx, &entries, query, args...)
	return entries, err
}

// Token blacklist methods (Phase 1: Token Revocation)

// CreateTokenBlacklistEntry adds a token to the blacklist
func (r *SQLiteRepository) CreateTokenBlacklistEntry(ctx context.Context, entry *models.TokenBlacklistEntry) error {
	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}
	query := `INSERT INTO token_blacklist (id, token_id, user_id, revoked_at, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, entry.ID, entry.TokenID, entry.UserID, entry.RevokedAt, entry.ExpiresAt, entry.Reason)
	return err
}

// IsTokenBlacklisted checks if a token ID is blacklisted
func (r *SQLiteRepository) IsTokenBlacklisted(ctx context.Context, tokenID string) (bool, error) {
	var count int
	err := r.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM token_blacklist WHERE token_id = ? AND expires_at > datetime('now')`, tokenID)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// DeleteExpiredTokens deletes expired tokens from the blacklist
func (r *SQLiteRepository) DeleteExpiredTokens(ctx context.Context, cutoffTime time.Time) (int64, error) {
	query := `DELETE FROM token_blacklist WHERE expires_at < ?`
	result, err := r.db.ExecContext(ctx, query, cutoffTime)
	if err != nil {
		return 0, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return rowsAffected, nil
}

// RevokeAllUserTokens revokes all tokens for a user by revoking refresh token families
// Note: Access tokens are stateless JWTs, so we can't revoke them directly without blacklisting.
// This revokes refresh token families, preventing new access tokens from being issued.
func (r *SQLiteRepository) RevokeAllUserTokens(ctx context.Context, userID string, reason string) error {
	return r.RevokeRefreshTokenFamily(ctx, userID, reason)
}

// Refresh token family methods (Phase 1: Refresh Token Rotation)

// CreateRefreshTokenFamily creates a new refresh token family
func (r *SQLiteRepository) CreateRefreshTokenFamily(ctx context.Context, family *models.RefreshTokenFamily) error {
	if family.ID == "" {
		family.ID = uuid.New().String()
	}
	query := `INSERT INTO refresh_token_families (id, family_id, user_id, token_id, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, family.ID, family.FamilyID, family.UserID, family.TokenID, family.CreatedAt)
	return err
}

// GetRefreshTokenFamilyByTokenID gets a refresh token family by token ID
func (r *SQLiteRepository) GetRefreshTokenFamilyByTokenID(ctx context.Context, tokenID string) (*models.RefreshTokenFamily, error) {
	var family models.RefreshTokenFamily
	err := r.db.GetContext(ctx, &family, `SELECT id, family_id, user_id, token_id, created_at, revoked_at FROM refresh_token_families WHERE token_id = ?`, tokenID)
	if err != nil {
		return nil, err
	}
	return &family, nil
}

// GetRefreshTokenFamilyByFamilyID gets the current active token for a family
func (r *SQLiteRepository) GetRefreshTokenFamilyByFamilyID(ctx context.Context, familyID string) (*models.RefreshTokenFamily, error) {
	var family models.RefreshTokenFamily
	err := r.db.GetContext(ctx, &family, `SELECT id, family_id, user_id, token_id, created_at, revoked_at FROM refresh_token_families WHERE family_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`, familyID)
	if err != nil {
		return nil, err
	}
	return &family, nil
}

// RevokeRefreshTokenFamily revokes a refresh token family (marks all tokens in family as revoked)
func (r *SQLiteRepository) RevokeRefreshTokenFamily(ctx context.Context, userID string, reason string) error {
	now := time.Now()
	query := `UPDATE refresh_token_families SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
	_, err := r.db.ExecContext(ctx, query, now, userID)
	return err
}

// RevokeRefreshTokenFamilyByFamilyID revokes a specific refresh token family
func (r *SQLiteRepository) RevokeRefreshTokenFamilyByFamilyID(ctx context.Context, familyID string) error {
	now := time.Now()
	query := `UPDATE refresh_token_families SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`
	_, err := r.db.ExecContext(ctx, query, now, familyID)
	return err
}

// UpdateRefreshTokenFamilyToken updates the current token ID for a family (rotation)
func (r *SQLiteRepository) UpdateRefreshTokenFamilyToken(ctx context.Context, familyID string, newTokenID string) error {
	// Create new entry for the rotated token
	family, err := r.GetRefreshTokenFamilyByFamilyID(ctx, familyID)
	if err != nil {
		return err
	}
	newFamily := &models.RefreshTokenFamily{
		FamilyID:  familyID,
		UserID:    family.UserID,
		TokenID:   newTokenID,
		CreatedAt: time.Now(),
	}
	return r.CreateRefreshTokenFamily(ctx, newFamily)
}

// Session management methods (Phase 4: Session Management)

// CreateSession creates a new session
func (r *SQLiteRepository) CreateSession(ctx context.Context, session *models.Session) error {
	if session.ID == "" {
		session.ID = uuid.New().String()
	}
	query := `INSERT INTO sessions (id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, session.ID, session.UserID, session.TokenID, session.DeviceInfo, session.IPAddress, session.UserAgent, session.CreatedAt, session.LastActivity, session.ExpiresAt)
	return err
}

// GetSessionByTokenID gets a session by token ID
func (r *SQLiteRepository) GetSessionByTokenID(ctx context.Context, tokenID string) (*models.Session, error) {
	var session models.Session
	err := r.db.GetContext(ctx, &session, `SELECT id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at FROM sessions WHERE token_id = ?`, tokenID)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// UpdateSessionActivity updates the last activity time for a session
func (r *SQLiteRepository) UpdateSessionActivity(ctx context.Context, sessionID string) error {
	query := `UPDATE sessions SET last_activity = datetime('now') WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, sessionID)
	return err
}

// ListUserSessions lists all active sessions for a user
func (r *SQLiteRepository) ListUserSessions(ctx context.Context, userID string) ([]*models.Session, error) {
	var sessions []*models.Session
	query := `SELECT id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at FROM sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY last_activity DESC`
	err := r.db.SelectContext(ctx, &sessions, query, userID)
	return sessions, err
}

// DeleteSession deletes a session
func (r *SQLiteRepository) DeleteSession(ctx context.Context, sessionID string) error {
	query := `DELETE FROM sessions WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, sessionID)
	return err
}

// DeleteUserSessions deletes all sessions for a user
func (r *SQLiteRepository) DeleteUserSessions(ctx context.Context, userID string) error {
	query := `DELETE FROM sessions WHERE user_id = ?`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// CountUserSessions counts active sessions for a user
func (r *SQLiteRepository) CountUserSessions(ctx context.Context, userID string) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > datetime('now')`
	err := r.db.GetContext(ctx, &count, query, userID)
	return count, err
}

// GetOldestUserSession gets the oldest active session for a user
func (r *SQLiteRepository) GetOldestUserSession(ctx context.Context, userID string) (*models.Session, error) {
	var session models.Session
	query := `SELECT id, user_id, token_id, device_info, ip_address, user_agent, created_at, last_activity, expires_at FROM sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at ASC LIMIT 1`
	err := r.db.GetContext(ctx, &session, query, userID)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// CleanupExpiredSessions removes expired sessions (should be called periodically)
func (r *SQLiteRepository) CleanupExpiredSessions(ctx context.Context) error {
	query := `DELETE FROM sessions WHERE expires_at < datetime('now')`
	_, err := r.db.ExecContext(ctx, query)
	return err
}

// Namespace permission methods (Phase 3: Advanced RBAC)

// CreateNamespacePermission creates a namespace-level permission
func (r *SQLiteRepository) CreateNamespacePermission(ctx context.Context, perm *models.NamespacePermission) error {
	if perm.ID == "" {
		perm.ID = uuid.New().String()
	}
	query := `INSERT INTO namespace_permissions (id, user_id, cluster_id, namespace, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, perm.ID, perm.UserID, perm.ClusterID, perm.Namespace, perm.Role, perm.CreatedAt)
	return err
}

// GetNamespacePermission gets a namespace permission
func (r *SQLiteRepository) GetNamespacePermission(ctx context.Context, userID, clusterID, namespace string) (*models.NamespacePermission, error) {
	var perm models.NamespacePermission
	query := `SELECT id, user_id, cluster_id, namespace, role, created_at FROM namespace_permissions WHERE user_id = ? AND cluster_id = ? AND namespace = ?`
	err := r.db.GetContext(ctx, &perm, query, userID, clusterID, namespace)
	if err != nil {
		return nil, err
	}
	return &perm, nil
}

// ListNamespacePermissionsByUser lists all namespace permissions for a user
func (r *SQLiteRepository) ListNamespacePermissionsByUser(ctx context.Context, userID string) ([]*models.NamespacePermission, error) {
	var perms []*models.NamespacePermission
	query := `SELECT id, user_id, cluster_id, namespace, role, created_at FROM namespace_permissions WHERE user_id = ?`
	err := r.db.SelectContext(ctx, &perms, query, userID)
	return perms, err
}

// ListNamespacePermissionsByCluster lists all namespace permissions for a cluster
func (r *SQLiteRepository) ListNamespacePermissionsByCluster(ctx context.Context, clusterID string) ([]*models.NamespacePermission, error) {
	var perms []*models.NamespacePermission
	query := `SELECT id, user_id, cluster_id, namespace, role, created_at FROM namespace_permissions WHERE cluster_id = ?`
	err := r.db.SelectContext(ctx, &perms, query, clusterID)
	return perms, err
}

// GetNamespacePermissionForResource gets the effective namespace permission for a user/cluster/namespace
// Checks both specific namespace permissions and wildcard permissions
func (r *SQLiteRepository) GetNamespacePermissionForResource(ctx context.Context, userID, clusterID, namespace string) (*models.NamespacePermission, error) {
	// First check specific namespace permission
	perm, err := r.GetNamespacePermission(ctx, userID, clusterID, namespace)
	if err == nil && perm != nil {
		return perm, nil
	}
	// Then check wildcard permission
	perm, err = r.GetNamespacePermission(ctx, userID, clusterID, "*")
	if err == nil && perm != nil {
		return perm, nil
	}
	return nil, sql.ErrNoRows
}

// DeleteNamespacePermission deletes a namespace permission
func (r *SQLiteRepository) DeleteNamespacePermission(ctx context.Context, permID string) error {
	query := `DELETE FROM namespace_permissions WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, permID)
	return err
}

// DeleteNamespacePermissionByUserClusterNamespace deletes a namespace permission by user/cluster/namespace
func (r *SQLiteRepository) DeleteNamespacePermissionByUserClusterNamespace(ctx context.Context, userID, clusterID, namespace string) error {
	query := `DELETE FROM namespace_permissions WHERE user_id = ? AND cluster_id = ? AND namespace = ?`
	_, err := r.db.ExecContext(ctx, query, userID, clusterID, namespace)
	return err
}

// Password history methods (Phase 5: Password Policy Enhancements)

// CreatePasswordHistory adds a password hash to user's password history
func (r *SQLiteRepository) CreatePasswordHistory(ctx context.Context, userID, passwordHash string) error {
	id := uuid.New().String()
	query := `INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))`
	_, err := r.db.ExecContext(ctx, query, id, userID, passwordHash)
	return err
}

// GetPasswordHistory gets recent password history for a user
func (r *SQLiteRepository) GetPasswordHistory(ctx context.Context, userID string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 5
	}
	var hashes []string
	query := `SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
	err := r.db.SelectContext(ctx, &hashes, query, userID, limit)
	return hashes, err
}

// CheckPasswordInHistory checks if password hash exists in user's recent history
func (r *SQLiteRepository) CheckPasswordInHistory(ctx context.Context, userID, passwordHash string, historyCount int) (bool, error) {
	hashes, err := r.GetPasswordHistory(ctx, userID, historyCount)
	if err != nil {
		return false, err
	}
	for _, hash := range hashes {
		if hash == passwordHash {
			return true, nil
		}
	}
	return false, nil
}

// CleanupOldPasswordHistory removes old password history entries (keep only recent N)
func (r *SQLiteRepository) CleanupOldPasswordHistory(ctx context.Context, userID string, keepCount int) error {
	query := `DELETE FROM password_history WHERE user_id = ? AND id NOT IN (
		SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
	)`
	_, err := r.db.ExecContext(ctx, query, userID, userID, keepCount)
	return err
}

// Password reset token methods (Phase 5: Account Recovery)

// CreatePasswordResetToken creates a new password reset token
func (r *SQLiteRepository) CreatePasswordResetToken(ctx context.Context, token *models.PasswordResetToken) error {
	if token.ID == "" {
		token.ID = uuid.New().String()
	}
	query := `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, token.ID, token.UserID, token.TokenHash, token.ExpiresAt, token.CreatedAt)
	return err
}

// GetPasswordResetTokenByHash gets a password reset token by hash
func (r *SQLiteRepository) GetPasswordResetTokenByHash(ctx context.Context, tokenHash string) (*models.PasswordResetToken, error) {
	var token models.PasswordResetToken
	query := `SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM password_reset_tokens WHERE token_hash = ?`
	err := r.db.GetContext(ctx, &token, query, tokenHash)
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// MarkPasswordResetTokenUsed marks a password reset token as used
func (r *SQLiteRepository) MarkPasswordResetTokenUsed(ctx context.Context, tokenID string) error {
	query := `UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, tokenID)
	return err
}

// CleanupExpiredPasswordResetTokens removes expired tokens (should be called periodically)
func (r *SQLiteRepository) CleanupExpiredPasswordResetTokens(ctx context.Context) error {
	query := `DELETE FROM password_reset_tokens WHERE expires_at < datetime('now')`
	_, err := r.db.ExecContext(ctx, query)
	return err
}

// CountPasswordResetTokensForUser counts active reset tokens for a user (for rate limiting)
func (r *SQLiteRepository) CountPasswordResetTokensForUser(ctx context.Context, userID string, since time.Time) (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ? AND created_at >= ?`
	err := r.db.GetContext(ctx, &count, query, userID, since)
	return count, err
}

// ListActivePasswordResetTokens lists all active (not expired, not used) reset tokens
func (r *SQLiteRepository) ListActivePasswordResetTokens(ctx context.Context) ([]*models.PasswordResetToken, error) {
	var tokens []*models.PasswordResetToken
	query := `SELECT id, user_id, token_hash, expires_at, used_at, created_at FROM password_reset_tokens WHERE expires_at > datetime('now') AND used_at IS NULL`
	err := r.db.SelectContext(ctx, &tokens, query)
	return tokens, err
}

// SAML session methods (Phase 2: SAML 2.0 Integration)

// CreateSAMLSession creates a new SAML session
func (r *SQLiteRepository) CreateSAMLSession(ctx context.Context, session *models.SAMLSession) error {
	if session.ID == "" {
		session.ID = uuid.New().String()
	}
	query := `INSERT INTO saml_sessions (id, user_id, saml_session_index, idp_entity_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, session.ID, session.UserID, session.SAMLSessionIndex, session.IdpEntityID, session.CreatedAt, session.ExpiresAt)
	return err
}

// GetSAMLSessionByIndex gets a SAML session by session index
func (r *SQLiteRepository) GetSAMLSessionByIndex(ctx context.Context, sessionIndex string) (*models.SAMLSession, error) {
	var session models.SAMLSession
	query := `SELECT id, user_id, saml_session_index, idp_entity_id, created_at, expires_at FROM saml_sessions WHERE saml_session_index = ? AND expires_at > datetime('now')`
	err := r.db.GetContext(ctx, &session, query, sessionIndex)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// DeleteUserSAMLSessions deletes all SAML sessions for a user
func (r *SQLiteRepository) DeleteUserSAMLSessions(ctx context.Context, userID string) error {
	query := `DELETE FROM saml_sessions WHERE user_id = ?`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// CleanupExpiredSAMLSessions removes expired SAML sessions
func (r *SQLiteRepository) CleanupExpiredSAMLSessions(ctx context.Context) error {
	query := `DELETE FROM saml_sessions WHERE expires_at < datetime('now')`
	_, err := r.db.ExecContext(ctx, query)
	return err
}

// MFA TOTP methods (Phase 5: MFA TOTP Support)

// CreateMFATOTPSecret creates or updates a user's MFA TOTP secret
func (r *SQLiteRepository) CreateMFATOTPSecret(ctx context.Context, secret *models.MFATOTPSecret) error {
	if secret.ID == "" {
		secret.ID = uuid.New().String()
	}
	// Use INSERT OR REPLACE to handle updates
	query := `INSERT OR REPLACE INTO mfa_totp_secrets (id, user_id, secret, enabled, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, secret.ID, secret.UserID, secret.Secret, secret.Enabled, secret.CreatedAt, secret.VerifiedAt)
	return err
}

// GetMFATOTPSecret gets a user's MFA TOTP secret
func (r *SQLiteRepository) GetMFATOTPSecret(ctx context.Context, userID string) (*models.MFATOTPSecret, error) {
	var secret models.MFATOTPSecret
	query := `SELECT id, user_id, secret, enabled, created_at, verified_at FROM mfa_totp_secrets WHERE user_id = ?`
	err := r.db.GetContext(ctx, &secret, query, userID)
	if err != nil {
		return nil, err
	}
	return &secret, nil
}

// EnableMFATOTP enables MFA for a user
func (r *SQLiteRepository) EnableMFATOTP(ctx context.Context, userID string, verifiedAt time.Time) error {
	query := `UPDATE mfa_totp_secrets SET enabled = TRUE, verified_at = ? WHERE user_id = ?`
	_, err := r.db.ExecContext(ctx, query, verifiedAt, userID)
	return err
}

// DisableMFATOTP disables MFA for a user
func (r *SQLiteRepository) DisableMFATOTP(ctx context.Context, userID string) error {
	query := `UPDATE mfa_totp_secrets SET enabled = FALSE WHERE user_id = ?`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// DeleteMFATOTPSecret deletes a user's MFA TOTP secret
func (r *SQLiteRepository) DeleteMFATOTPSecret(ctx context.Context, userID string) error {
	query := `DELETE FROM mfa_totp_secrets WHERE user_id = ?`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// CreateMFABackupCodes creates backup codes for a user
func (r *SQLiteRepository) CreateMFABackupCodes(ctx context.Context, userID string, codeHashes []string) error {
	query := `INSERT INTO mfa_backup_codes (id, user_id, code_hash, used, created_at) VALUES (?, ?, ?, FALSE, datetime('now'))`
	for _, hash := range codeHashes {
		id := uuid.New().String()
		if _, err := r.db.ExecContext(ctx, query, id, userID, hash); err != nil {
			return err
		}
	}
	return nil
}

// GetMFABackupCodes gets unused backup codes for a user
func (r *SQLiteRepository) GetMFABackupCodes(ctx context.Context, userID string) ([]*models.MFABackupCode, error) {
	var codes []*models.MFABackupCode
	query := `SELECT id, user_id, code_hash, used, used_at, created_at FROM mfa_backup_codes WHERE user_id = ? AND used = FALSE ORDER BY created_at DESC`
	err := r.db.SelectContext(ctx, &codes, query, userID)
	return codes, err
}

// VerifyAndUseMFABackupCode verifies a backup code and marks it as used
func (r *SQLiteRepository) VerifyAndUseMFABackupCode(ctx context.Context, userID, code string) (bool, error) {
	// Get all unused backup codes for user
	codes, err := r.GetMFABackupCodes(ctx, userID)
	if err != nil {
		return false, err
	}

	// Check each code
	for _, backupCode := range codes {
		if mfa.VerifyBackupCode(backupCode.CodeHash, code) {
			// Mark as used
			query := `UPDATE mfa_backup_codes SET used = TRUE, used_at = datetime('now') WHERE id = ?`
			_, err := r.db.ExecContext(ctx, query, backupCode.ID)
			return true, err
		}
	}

	return false, nil
}

// DeleteUserMFABackupCodes deletes all backup codes for a user
func (r *SQLiteRepository) DeleteUserMFABackupCodes(ctx context.Context, userID string) error {
	query := `DELETE FROM mfa_backup_codes WHERE user_id = ?`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}

// Group management methods (Phase 5: Group/Team Management)

// CreateGroup creates a new group
func (r *SQLiteRepository) CreateGroup(ctx context.Context, group *models.Group) error {
	if group.ID == "" {
		group.ID = uuid.New().String()
	}
	now := time.Now()
	group.CreatedAt = now
	group.UpdatedAt = now
	query := `INSERT INTO groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, group.ID, group.Name, group.Description, group.CreatedAt, group.UpdatedAt)
	return err
}

// GetGroup gets a group by ID
func (r *SQLiteRepository) GetGroup(ctx context.Context, groupID string) (*models.Group, error) {
	var group models.Group
	query := `SELECT id, name, description, created_at, updated_at FROM groups WHERE id = ?`
	err := r.db.GetContext(ctx, &group, query, groupID)
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// GetGroupByName gets a group by name
func (r *SQLiteRepository) GetGroupByName(ctx context.Context, name string) (*models.Group, error) {
	var group models.Group
	query := `SELECT id, name, description, created_at, updated_at FROM groups WHERE name = ?`
	err := r.db.GetContext(ctx, &group, query, name)
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// ListGroups lists all groups
func (r *SQLiteRepository) ListGroups(ctx context.Context) ([]*models.Group, error) {
	var groups []*models.Group
	query := `SELECT id, name, description, created_at, updated_at FROM groups ORDER BY name ASC`
	err := r.db.SelectContext(ctx, &groups, query)
	return groups, err
}

// UpdateGroup updates a group
func (r *SQLiteRepository) UpdateGroup(ctx context.Context, group *models.Group) error {
	group.UpdatedAt = time.Now()
	query := `UPDATE groups SET name = ?, description = ?, updated_at = ? WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, group.Name, group.Description, group.UpdatedAt, group.ID)
	return err
}

// DeleteGroup deletes a group (cascade deletes members and permissions)
func (r *SQLiteRepository) DeleteGroup(ctx context.Context, groupID string) error {
	query := `DELETE FROM groups WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, groupID)
	return err
}

// AddGroupMember adds a user to a group
func (r *SQLiteRepository) AddGroupMember(ctx context.Context, member *models.GroupMember) error {
	if member.ID == "" {
		member.ID = uuid.New().String()
	}
	member.CreatedAt = time.Now()
	query := `INSERT OR REPLACE INTO group_members (id, group_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, member.ID, member.GroupID, member.UserID, member.Role, member.CreatedAt)
	return err
}

// RemoveGroupMember removes a user from a group
func (r *SQLiteRepository) RemoveGroupMember(ctx context.Context, groupID, userID string) error {
	query := `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`
	_, err := r.db.ExecContext(ctx, query, groupID, userID)
	return err
}

// ListGroupMembers lists all members of a group
func (r *SQLiteRepository) ListGroupMembers(ctx context.Context, groupID string) ([]*models.GroupMember, error) {
	var members []*models.GroupMember
	query := `SELECT id, group_id, user_id, role, created_at FROM group_members WHERE group_id = ? ORDER BY created_at ASC`
	err := r.db.SelectContext(ctx, &members, query, groupID)
	return members, err
}

// ListUserGroups lists all groups a user belongs to
func (r *SQLiteRepository) ListUserGroups(ctx context.Context, userID string) ([]*models.Group, error) {
	var groups []*models.Group
	query := `SELECT g.id, g.name, g.description, g.created_at, g.updated_at FROM groups g 
		INNER JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = ? ORDER BY g.name ASC`
	err := r.db.SelectContext(ctx, &groups, query, userID)
	return groups, err
}

// CreateGroupClusterPermission creates a cluster permission for a group
func (r *SQLiteRepository) CreateGroupClusterPermission(ctx context.Context, perm *models.GroupClusterPermission) error {
	if perm.ID == "" {
		perm.ID = uuid.New().String()
	}
	perm.CreatedAt = time.Now()
	query := `INSERT OR REPLACE INTO group_cluster_permissions (id, group_id, cluster_id, role, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, perm.ID, perm.GroupID, perm.ClusterID, perm.Role, perm.CreatedAt)
	return err
}

// ListGroupClusterPermissions lists cluster permissions for a group
func (r *SQLiteRepository) ListGroupClusterPermissions(ctx context.Context, groupID string) ([]*models.GroupClusterPermission, error) {
	var perms []*models.GroupClusterPermission
	query := `SELECT id, group_id, cluster_id, role, created_at FROM group_cluster_permissions WHERE group_id = ?`
	err := r.db.SelectContext(ctx, &perms, query, groupID)
	return perms, err
}

// DeleteGroupClusterPermission deletes a cluster permission for a group
func (r *SQLiteRepository) DeleteGroupClusterPermission(ctx context.Context, groupID, clusterID string) error {
	query := `DELETE FROM group_cluster_permissions WHERE group_id = ? AND cluster_id = ?`
	_, err := r.db.ExecContext(ctx, query, groupID, clusterID)
	return err
}

// CreateGroupNamespacePermission creates a namespace permission for a group
func (r *SQLiteRepository) CreateGroupNamespacePermission(ctx context.Context, perm *models.GroupNamespacePermission) error {
	if perm.ID == "" {
		perm.ID = uuid.New().String()
	}
	perm.CreatedAt = time.Now()
	query := `INSERT OR REPLACE INTO group_namespace_permissions (id, group_id, cluster_id, namespace, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, perm.ID, perm.GroupID, perm.ClusterID, perm.Namespace, perm.Role, perm.CreatedAt)
	return err
}

// ListGroupNamespacePermissions lists namespace permissions for a group
func (r *SQLiteRepository) ListGroupNamespacePermissions(ctx context.Context, groupID string) ([]*models.GroupNamespacePermission, error) {
	var perms []*models.GroupNamespacePermission
	query := `SELECT id, group_id, cluster_id, namespace, role, created_at FROM group_namespace_permissions WHERE group_id = ?`
	err := r.db.SelectContext(ctx, &perms, query, groupID)
	return perms, err
}

// DeleteGroupNamespacePermission deletes a namespace permission for a group
func (r *SQLiteRepository) DeleteGroupNamespacePermission(ctx context.Context, groupID, clusterID, namespace string) error {
	query := `DELETE FROM group_namespace_permissions WHERE group_id = ? AND cluster_id = ? AND namespace = ?`
	_, err := r.db.ExecContext(ctx, query, groupID, clusterID, namespace)
	return err
}

// GetUserEffectiveClusterPermissions gets effective cluster permissions for a user (user + group permissions)
func (r *SQLiteRepository) GetUserEffectiveClusterPermissions(ctx context.Context, userID string) (map[string]string, error) {
	// Get direct user permissions
	userPerms, _ := r.ListClusterPermissionsByUser(ctx, userID)
	permMap := make(map[string]string)
	for _, p := range userPerms {
		permMap[p.ClusterID] = p.Role
	}

	// Get group permissions
	userGroups, _ := r.ListUserGroups(ctx, userID)
	for _, group := range userGroups {
		groupPerms, _ := r.ListGroupClusterPermissions(ctx, group.ID)
		for _, p := range groupPerms {
			// Group permissions override user permissions if higher role
			if existingRole, exists := permMap[p.ClusterID]; !exists || roleLevel(p.Role) > roleLevel(existingRole) {
				permMap[p.ClusterID] = p.Role
			}
		}
	}

	return permMap, nil
}

// GetUserEffectiveNamespacePermissions gets effective namespace permissions for a user (user + group permissions)
func (r *SQLiteRepository) GetUserEffectiveNamespacePermissions(ctx context.Context, userID, clusterID string) (map[string]string, error) {
	// Get direct user permissions
	allUserPerms, _ := r.ListNamespacePermissionsByUser(ctx, userID)
	var userPerms []*models.NamespacePermission
	for _, p := range allUserPerms {
		if p.ClusterID == clusterID {
			userPerms = append(userPerms, p)
		}
	}
	permMap := make(map[string]string)
	for _, p := range userPerms {
		permMap[p.Namespace] = p.Role
	}

	// Get group permissions
	userGroups, _ := r.ListUserGroups(ctx, userID)
	for _, group := range userGroups {
		groupPerms, _ := r.ListGroupNamespacePermissions(ctx, group.ID)
		for _, p := range groupPerms {
			if p.ClusterID == clusterID {
				// Group permissions override user permissions if higher role
				if existingRole, exists := permMap[p.Namespace]; !exists || roleLevel(p.Role) > roleLevel(existingRole) {
					permMap[p.Namespace] = p.Role
				}
			}
		}
	}

	return permMap, nil
}

// roleLevel returns numeric level for role comparison (higher = more permissions)
func roleLevel(role string) int {
	switch role {
	case "admin":
		return 3
	case "operator":
		return 2
	case "viewer":
		return 1
	default:
		return 0
	}
}

// OIDC Group Sync methods

// CreateOIDCGroupMapping creates an OIDC group mapping
func (r *SQLiteRepository) CreateOIDCGroupMapping(ctx context.Context, mapping *models.OIDCGroupMapping) error {
	if mapping.ID == "" {
		mapping.ID = uuid.New().String()
	}
	mapping.CreatedAt = time.Now()
	query := `INSERT OR REPLACE INTO oidc_group_mappings (id, group_id, oidc_group_name, created_at) VALUES (?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, mapping.ID, mapping.GroupID, mapping.OIDCGroupName, mapping.CreatedAt)
	return err
}

// GetOIDCGroupMapping gets a group by OIDC group name
func (r *SQLiteRepository) GetOIDCGroupMapping(ctx context.Context, oidcGroupName string) (*models.OIDCGroupMapping, error) {
	var mapping models.OIDCGroupMapping
	query := `SELECT id, group_id, oidc_group_name, created_at FROM oidc_group_mappings WHERE oidc_group_name = ?`
	err := r.db.GetContext(ctx, &mapping, query, oidcGroupName)
	if err != nil {
		return nil, err
	}
	return &mapping, nil
}

// ListOIDCGroupMappings lists all OIDC group mappings
func (r *SQLiteRepository) ListOIDCGroupMappings(ctx context.Context) ([]*models.OIDCGroupMapping, error) {
	var mappings []*models.OIDCGroupMapping
	query := `SELECT id, group_id, oidc_group_name, created_at FROM oidc_group_mappings ORDER BY oidc_group_name ASC`
	err := r.db.SelectContext(ctx, &mappings, query)
	return mappings, err
}

// DeleteOIDCGroupMapping deletes an OIDC group mapping
func (r *SQLiteRepository) DeleteOIDCGroupMapping(ctx context.Context, groupID string) error {
	query := `DELETE FROM oidc_group_mappings WHERE group_id = ?`
	_, err := r.db.ExecContext(ctx, query, groupID)
	return err
}

// Security event detection methods (Phase 5: Security Event Detection)

// CreateSecurityEvent creates a security event
func (r *SQLiteRepository) CreateSecurityEvent(ctx context.Context, event *models.SecurityEvent) error {
	if event.ID == "" {
		event.ID = uuid.New().String()
	}
	query := `INSERT INTO security_events (id, event_type, user_id, username, ip_address, user_agent, cluster_id, resource_type, resource_name, action, risk_score, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, event.ID, event.EventType, event.UserID, event.Username, event.IPAddress, event.UserAgent, event.ClusterID, event.ResourceType, event.ResourceName, event.Action, event.RiskScore, event.Details, event.CreatedAt)
	return err
}

// GetIPSecurityTracking gets IP security tracking
func (r *SQLiteRepository) GetIPSecurityTracking(ctx context.Context, ipAddress string) (*models.IPSecurityTracking, error) {
	var tracking models.IPSecurityTracking
	query := `SELECT ip_address, failed_login_count, last_failed_login, account_enumeration_count, last_enumeration_attempt, blocked_until, created_at, updated_at FROM ip_security_tracking WHERE ip_address = ?`
	err := r.db.GetContext(ctx, &tracking, query, ipAddress)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tracking, nil
}

// CreateOrUpdateIPSecurityTracking creates or updates IP security tracking
func (r *SQLiteRepository) CreateOrUpdateIPSecurityTracking(ctx context.Context, tracking *models.IPSecurityTracking) error {
	tracking.UpdatedAt = time.Now()
	query := `INSERT OR REPLACE INTO ip_security_tracking (ip_address, failed_login_count, last_failed_login, account_enumeration_count, last_enumeration_attempt, blocked_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM ip_security_tracking WHERE ip_address = ?), datetime('now')), ?)`
	_, err := r.db.ExecContext(ctx, query, tracking.IPAddress, tracking.FailedLoginCount, tracking.LastFailedLogin, tracking.AccountEnumerationCount, tracking.LastEnumerationAttempt, tracking.BlockedUntil, tracking.IPAddress, tracking.UpdatedAt)
	return err
}

// IncrementIPFailedLogin increments failed login count for an IP
func (r *SQLiteRepository) IncrementIPFailedLogin(ctx context.Context, ipAddress string) error {
	now := time.Now()
	query := `INSERT INTO ip_security_tracking (ip_address, failed_login_count, last_failed_login, created_at, updated_at) 
		VALUES (?, 1, ?, datetime('now'), datetime('now'))
		ON CONFLICT(ip_address) DO UPDATE SET 
			failed_login_count = failed_login_count + 1,
			last_failed_login = ?,
			updated_at = datetime('now')`
	_, err := r.db.ExecContext(ctx, query, ipAddress, now, now)
	return err
}

// IncrementIPAccountEnumeration increments account enumeration count for an IP
func (r *SQLiteRepository) IncrementIPAccountEnumeration(ctx context.Context, ipAddress string) error {
	now := time.Now()
	query := `INSERT INTO ip_security_tracking (ip_address, account_enumeration_count, last_enumeration_attempt, created_at, updated_at) 
		VALUES (?, 1, ?, datetime('now'), datetime('now'))
		ON CONFLICT(ip_address) DO UPDATE SET 
			account_enumeration_count = account_enumeration_count + 1,
			last_enumeration_attempt = ?,
			updated_at = datetime('now')`
	_, err := r.db.ExecContext(ctx, query, ipAddress, now, now)
	return err
}

// BlockIP blocks an IP address until a specified time
func (r *SQLiteRepository) BlockIP(ctx context.Context, ipAddress string, until time.Time) error {
	query := `INSERT INTO ip_security_tracking (ip_address, blocked_until, created_at, updated_at) 
		VALUES (?, ?, datetime('now'), datetime('now'))
		ON CONFLICT(ip_address) DO UPDATE SET 
			blocked_until = ?,
			updated_at = datetime('now')`
	_, err := r.db.ExecContext(ctx, query, ipAddress, until, until)
	return err
}

// ListSecurityEvents lists security events
func (r *SQLiteRepository) ListSecurityEvents(ctx context.Context, eventType *string, ipAddress *string, since *time.Time, limit int) ([]*models.SecurityEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	query := `SELECT id, event_type, user_id, username, ip_address, user_agent, cluster_id, resource_type, resource_name, action, risk_score, details, created_at FROM security_events WHERE 1=1`
	args := []interface{}{}
	if eventType != nil {
		query += ` AND event_type = ?`
		args = append(args, *eventType)
	}
	if ipAddress != nil {
		query += ` AND ip_address = ?`
		args = append(args, *ipAddress)
	}
	if since != nil {
		query += ` AND created_at >= ?`
		args = append(args, *since)
	}
	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)
	var events []*models.SecurityEvent
	err := r.db.SelectContext(ctx, &events, query, args...)
	return events, err
}

// CleanupOldIPSecurityTracking cleans up old IP tracking records (older than 30 days and not blocked)
func (r *SQLiteRepository) CleanupOldIPSecurityTracking(ctx context.Context) error {
	query := `DELETE FROM ip_security_tracking WHERE blocked_until IS NULL OR blocked_until < datetime('now') AND updated_at < datetime('now', '-30 days')`
	_, err := r.db.ExecContext(ctx, query)
	return err
}

// ListBlockedIPs lists currently blocked IP addresses
func (r *SQLiteRepository) ListBlockedIPs(ctx context.Context) ([]*models.IPSecurityTracking, error) {
	var ips []*models.IPSecurityTracking
	query := `SELECT ip_address, failed_login_count, last_failed_login, account_enumeration_count, last_enumeration_attempt, blocked_until, created_at, updated_at FROM ip_security_tracking WHERE blocked_until IS NOT NULL AND blocked_until > datetime('now')`
	err := r.db.SelectContext(ctx, &ips, query)
	return ips, err
}

// UnblockIP unblocks an IP address
func (r *SQLiteRepository) UnblockIP(ctx context.Context, ipAddress string) error {
	query := `UPDATE ip_security_tracking SET blocked_until = NULL, updated_at = datetime('now') WHERE ip_address = ?`
	_, err := r.db.ExecContext(ctx, query, ipAddress)
	return err
}
