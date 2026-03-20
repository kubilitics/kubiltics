package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	_ "github.com/lib/pq"
)

// PostgresRepository implements repositories using PostgreSQL
type PostgresRepository struct {
	db *sqlx.DB
}

// NewPostgresRepository creates a new PostgreSQL repository
func NewPostgresRepository(connectionString string) (*PostgresRepository, error) {
	db, err := sqlx.Connect("postgres", connectionString)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to PostgreSQL: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	return &PostgresRepository{db: db}, nil
}

// Close closes the database connection
func (r *PostgresRepository) Close() error {
	return r.db.Close()
}

// RunMigrations runs database migrations
func (r *PostgresRepository) RunMigrations(migrationSQL string) error {
	_, err := r.db.Exec(migrationSQL)
	return err
}

// ClusterRepository implementation

func (r *PostgresRepository) CreateCluster(ctx context.Context, cluster *models.Cluster) error {
	if cluster.ID == "" {
		cluster.ID = uuid.New().String()
	}

	query := `
		INSERT INTO clusters (id, name, context, kubeconfig_path, server_url, version, status, last_connected, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`

	_, err := r.db.ExecContext(ctx, query,
		cluster.ID,
		cluster.Name,
		cluster.Context,
		cluster.KubeconfigPath,
		cluster.ServerURL,
		cluster.Version,
		cluster.Status,
		cluster.LastConnected,
		time.Now(),
		time.Now(),
	)

	return err
}

func (r *PostgresRepository) GetCluster(ctx context.Context, id string) (*models.Cluster, error) {
	var cluster models.Cluster
	query := `SELECT * FROM clusters WHERE id = $1`

	err := r.db.GetContext(ctx, &cluster, query, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}

	return &cluster, err
}

func (r *PostgresRepository) ListClusters(ctx context.Context) ([]*models.Cluster, error) {
	var clusters []*models.Cluster
	query := `SELECT * FROM clusters ORDER BY created_at DESC`

	err := r.db.SelectContext(ctx, &clusters, query)
	return clusters, err
}

func (r *PostgresRepository) UpdateCluster(ctx context.Context, cluster *models.Cluster) error {
	query := `
		UPDATE clusters
		SET name = $1, context = $2, kubeconfig_path = $3, server_url = $4, version = $5,
		    status = $6, last_connected = $7, updated_at = $8
		WHERE id = $9
	`

	_, err := r.db.ExecContext(ctx, query,
		cluster.Name,
		cluster.Context,
		cluster.KubeconfigPath,
		cluster.ServerURL,
		cluster.Version,
		cluster.Status,
		cluster.LastConnected,
		time.Now(),
		cluster.ID,
	)

	return err
}

func (r *PostgresRepository) DeleteCluster(ctx context.Context, id string) error {
	query := `DELETE FROM clusters WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// TopologyRepository implementation

func (r *PostgresRepository) SaveTopologySnapshot(ctx context.Context, snapshot *models.TopologySnapshot) error {
	if snapshot.ID == "" {
		snapshot.ID = uuid.New().String()
	}

	query := `
		INSERT INTO topology_snapshots (id, cluster_id, namespace, data, node_count, edge_count, layout_seed, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

func (r *PostgresRepository) GetTopologySnapshot(ctx context.Context, id string) (*models.TopologySnapshot, error) {
	var snapshot models.TopologySnapshot
	query := `SELECT * FROM topology_snapshots WHERE id = $1`

	err := r.db.GetContext(ctx, &snapshot, query, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("snapshot not found: %s", id)
	}

	return &snapshot, err
}

func (r *PostgresRepository) ListTopologySnapshots(ctx context.Context, clusterID string, limit int) ([]*models.TopologySnapshot, error) {
	var snapshots []*models.TopologySnapshot
	query := `
		SELECT * FROM topology_snapshots
		WHERE cluster_id = $1
		ORDER BY timestamp DESC
		LIMIT $2
	`

	err := r.db.SelectContext(ctx, &snapshots, query, clusterID, limit)
	return snapshots, err
}

func (r *PostgresRepository) GetLatestTopologySnapshot(ctx context.Context, clusterID, namespace string) (*models.TopologySnapshot, error) {
	var snapshot models.TopologySnapshot
	var query string
	var args []interface{}

	if namespace != "" {
		query = `
			SELECT * FROM topology_snapshots
			WHERE cluster_id = $1 AND namespace = $2
			ORDER BY timestamp DESC
			LIMIT 1
		`
		args = []interface{}{clusterID, namespace}
	} else {
		query = `
			SELECT * FROM topology_snapshots
			WHERE cluster_id = $1 AND namespace IS NULL
			ORDER BY timestamp DESC
			LIMIT 1
		`
		args = []interface{}{clusterID}
	}

	err := r.db.GetContext(ctx, &snapshot, query, args...)
	if err == sql.ErrNoRows {
		return nil, nil
	}

	return &snapshot, err
}

func (r *PostgresRepository) DeleteOldTopologySnapshots(ctx context.Context, clusterID string, olderThan time.Time) error {
	query := `DELETE FROM topology_snapshots WHERE cluster_id = $1 AND timestamp < $2`
	_, err := r.db.ExecContext(ctx, query, clusterID, olderThan)
	return err
}

// HistoryRepository implementation

func (r *PostgresRepository) CreateResourceHistory(ctx context.Context, history *models.ResourceHistory) error {
	if history.ID == "" {
		history.ID = uuid.New().String()
	}

	query := `
		INSERT INTO resource_history (id, cluster_id, resource_type, namespace, name, action, yaml, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	_, err := r.db.ExecContext(ctx, query,
		history.ID,
		"", // cluster_id - needs to be added
		history.ResourceType,
		history.Namespace,
		history.Name,
		history.Action,
		history.YAML,
		history.Timestamp,
	)

	return err
}

func (r *PostgresRepository) ListResourceHistory(ctx context.Context, clusterID, resourceType, namespace, name string, limit int) ([]*models.ResourceHistory, error) {
	var history []*models.ResourceHistory
	query := `
		SELECT * FROM resource_history
		WHERE 1=1
	`
	args := []interface{}{}
	paramCount := 1

	if clusterID != "" {
		query += fmt.Sprintf(" AND cluster_id = $%d", paramCount)
		args = append(args, clusterID)
		paramCount++
	}

	if resourceType != "" {
		query += fmt.Sprintf(" AND resource_type = $%d", paramCount)
		args = append(args, resourceType)
		paramCount++
	}

	if namespace != "" {
		query += fmt.Sprintf(" AND namespace = $%d", paramCount)
		args = append(args, namespace)
		paramCount++
	}

	if name != "" {
		query += fmt.Sprintf(" AND name = $%d", paramCount)
		args = append(args, name)
		paramCount++
	}

	query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT $%d", paramCount)
	args = append(args, limit)

	err := r.db.SelectContext(ctx, &history, query, args...)
	return history, err
}

// Transaction support

func (r *PostgresRepository) BeginTx(ctx context.Context) (*sqlx.Tx, error) {
	return r.db.BeginTxx(ctx, nil)
}
