package diff

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// SQLiteSnapshotStore implements SnapshotStore using a SQLite database.
// Snapshots survive backend restarts, unlike InMemorySnapshotStore.
type SQLiteSnapshotStore struct {
	db *sql.DB
}

// NewSQLiteSnapshotStore creates a new SQLite-backed snapshot store.
// It auto-creates the topology_diff_snapshots table if it does not exist.
func NewSQLiteSnapshotStore(db *sql.DB) (*SQLiteSnapshotStore, error) {
	s := &SQLiteSnapshotStore{db: db}
	if err := s.ensureTable(); err != nil {
		return nil, fmt.Errorf("failed to ensure topology_diff_snapshots table: %w", err)
	}
	return s, nil
}

// ensureTable creates the topology_diff_snapshots table and index if they don't exist.
func (s *SQLiteSnapshotStore) ensureTable() error {
	ddl := `
		CREATE TABLE IF NOT EXISTS topology_diff_snapshots (
			id            TEXT PRIMARY KEY,
			cluster_id    TEXT NOT NULL,
			namespace     TEXT NOT NULL DEFAULT '',
			nodes_json    TEXT NOT NULL,
			edges_json    TEXT NOT NULL,
			metadata_json TEXT NOT NULL,
			created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_snapshots_cluster_ns_time
			ON topology_diff_snapshots(cluster_id, namespace, created_at);
	`
	_, err := s.db.Exec(ddl)
	return err
}

// Save persists a topology snapshot. Returns an error if a snapshot with the
// same ID already exists (PRIMARY KEY constraint).
func (s *SQLiteSnapshotStore) Save(snapshot TopologySnapshot) error {
	nodesJSON, err := json.Marshal(snapshot.Nodes)
	if err != nil {
		return fmt.Errorf("failed to marshal nodes: %w", err)
	}

	edgesJSON, err := json.Marshal(snapshot.Edges)
	if err != nil {
		return fmt.Errorf("failed to marshal edges: %w", err)
	}

	metaJSON, err := json.Marshal(snapshot.Metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal metadata: %w", err)
	}

	query := `
		INSERT INTO topology_diff_snapshots (id, cluster_id, namespace, nodes_json, edges_json, metadata_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`
	_, err = s.db.Exec(query,
		snapshot.ID,
		snapshot.ClusterID,
		snapshot.Namespace,
		string(nodesJSON),
		string(edgesJSON),
		string(metaJSON),
		snapshot.CreatedAt.UTC(),
	)
	if err != nil {
		return fmt.Errorf("failed to save snapshot %s: %w", snapshot.ID, err)
	}
	return nil
}

// Get retrieves a snapshot by ID. Returns an error if not found.
func (s *SQLiteSnapshotStore) Get(id string) (*TopologySnapshot, error) {
	query := `
		SELECT id, cluster_id, namespace, nodes_json, edges_json, metadata_json, created_at
		FROM topology_diff_snapshots
		WHERE id = ?
	`
	row := s.db.QueryRow(query, id)
	snap, err := scanSnapshot(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("snapshot %s not found", id)
		}
		return nil, fmt.Errorf("failed to get snapshot %s: %w", id, err)
	}
	return snap, nil
}

// GetLatest returns the most recent snapshot for a cluster+namespace.
// Returns an error if no matching snapshot exists.
func (s *SQLiteSnapshotStore) GetLatest(clusterID, namespace string) (*TopologySnapshot, error) {
	query := `
		SELECT id, cluster_id, namespace, nodes_json, edges_json, metadata_json, created_at
		FROM topology_diff_snapshots
		WHERE cluster_id = ? AND namespace = ?
		ORDER BY created_at DESC
		LIMIT 1
	`
	row := s.db.QueryRow(query, clusterID, namespace)
	snap, err := scanSnapshot(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("no snapshot found for cluster %s namespace %q", clusterID, namespace)
		}
		return nil, fmt.Errorf("failed to get latest snapshot: %w", err)
	}
	return snap, nil
}

// GetByDateRange returns all snapshots for a cluster+namespace within [from, to],
// sorted by creation time ascending.
func (s *SQLiteSnapshotStore) GetByDateRange(clusterID, namespace string, from, to time.Time) ([]TopologySnapshot, error) {
	query := `
		SELECT id, cluster_id, namespace, nodes_json, edges_json, metadata_json, created_at
		FROM topology_diff_snapshots
		WHERE cluster_id = ? AND namespace = ? AND created_at >= ? AND created_at <= ?
		ORDER BY created_at ASC
	`
	rows, err := s.db.Query(query, clusterID, namespace, from.UTC(), to.UTC())
	if err != nil {
		return nil, fmt.Errorf("failed to query snapshots by date range: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var results []TopologySnapshot
	for rows.Next() {
		snap, err := scanSnapshotRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan snapshot row: %w", err)
		}
		results = append(results, *snap)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}

	// Belt-and-suspenders: ensure ascending order even if DB didn't sort correctly
	sort.Slice(results, func(i, j int) bool {
		return results[i].CreatedAt.Before(results[j].CreatedAt)
	})

	return results, nil
}

// DeleteOlderThan removes snapshots older than the given retention duration.
// Returns the number of snapshots deleted.
func (s *SQLiteSnapshotStore) DeleteOlderThan(retention time.Duration) (int, error) {
	cutoff := time.Now().Add(-retention).UTC()

	result, err := s.db.Exec(
		`DELETE FROM topology_diff_snapshots WHERE created_at < ?`,
		cutoff,
	)
	if err != nil {
		return 0, fmt.Errorf("failed to delete old snapshots: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}
	return int(affected), nil
}

// scanSnapshot scans a single row from QueryRow into a TopologySnapshot.
func scanSnapshot(row *sql.Row) (*TopologySnapshot, error) {
	var snap TopologySnapshot
	var nodesJSON, edgesJSON, metaJSON string

	err := row.Scan(
		&snap.ID,
		&snap.ClusterID,
		&snap.Namespace,
		&nodesJSON,
		&edgesJSON,
		&metaJSON,
		&snap.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal([]byte(nodesJSON), &snap.Nodes); err != nil {
		return nil, fmt.Errorf("failed to unmarshal nodes: %w", err)
	}
	if err := json.Unmarshal([]byte(edgesJSON), &snap.Edges); err != nil {
		return nil, fmt.Errorf("failed to unmarshal edges: %w", err)
	}
	if err := json.Unmarshal([]byte(metaJSON), &snap.Metadata); err != nil {
		return nil, fmt.Errorf("failed to unmarshal metadata: %w", err)
	}

	return &snap, nil
}

// scanSnapshotRow scans a single row from Rows.Next() into a TopologySnapshot.
func scanSnapshotRow(rows *sql.Rows) (*TopologySnapshot, error) {
	var snap TopologySnapshot
	var nodesJSON, edgesJSON, metaJSON string

	err := rows.Scan(
		&snap.ID,
		&snap.ClusterID,
		&snap.Namespace,
		&nodesJSON,
		&edgesJSON,
		&metaJSON,
		&snap.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal([]byte(nodesJSON), &snap.Nodes); err != nil {
		return nil, fmt.Errorf("failed to unmarshal nodes: %w", err)
	}
	if err := json.Unmarshal([]byte(edgesJSON), &snap.Edges); err != nil {
		return nil, fmt.Errorf("failed to unmarshal edges: %w", err)
	}
	if err := json.Unmarshal([]byte(metaJSON), &snap.Metadata); err != nil {
		return nil, fmt.Errorf("failed to unmarshal metadata: %w", err)
	}

	return &snap, nil
}
