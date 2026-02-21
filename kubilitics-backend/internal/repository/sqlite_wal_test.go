package repository

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// TestSQLiteWAL_ConcurrentWrites tests SQLite WAL mode under concurrent writes
func TestSQLiteWAL_ConcurrentWrites(t *testing.T) {
	// Use file-based database for WAL tests since :memory: databases are per-connection
	dbPath := fmt.Sprintf("/tmp/test_wal_%d.db", time.Now().UnixNano())
	repo, err := NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	defer repo.Close()
	defer func() {
		os.Remove(dbPath)
	}()
	
	// Run migrations
	migrationSQL := `CREATE TABLE IF NOT EXISTS clusters (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		context TEXT NOT NULL,
		kubeconfig_path TEXT,
		server_url TEXT,
		version TEXT,
		status TEXT,
		provider TEXT,
		last_connected DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	// Verify table exists before starting concurrent operations
	testCluster := &models.Cluster{
		ID:      "test-verify",
		Name:     "test",
		Context:  "test",
		Status:   "connected",
		Provider: "test",
	}
	if err := repo.Create(context.Background(), testCluster); err != nil {
		t.Fatalf("Failed to create test cluster: %v", err)
	}
	// Verify we can read it back
	_, err = repo.Get(context.Background(), "test-verify")
	if err != nil {
		t.Fatalf("Failed to read test cluster: %v", err)
	}
	// Clean up test cluster
	_ = repo.Delete(context.Background(), "test-verify")
	
	// Concurrent writes test
	// NOTE: SQLite serializes writers even in WAL mode. Keep concurrency low
	// enough that the 5s busy_timeout is sufficient in CI environments.
	const numGoroutines = 3
	const writesPerGoroutine = 3
	var wg sync.WaitGroup
	errors := make(chan error, numGoroutines*writesPerGoroutine)
	
	// Start concurrent writers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()
			for j := 0; j < writesPerGoroutine; j++ {
				cluster := &models.Cluster{
					ID:      fmt.Sprintf("cluster-%d-%d", goroutineID, j),
					Name:     "test-cluster",
					Context:  "test-context",
					Status:   "connected",
					Provider: "test",
				}
				if err := repo.Create(context.Background(), cluster); err != nil {
					errors <- err
				}
			}
		}(i)
	}
	
	// Wait for all writes to complete
	wg.Wait()
	close(errors)
	
	// Check for errors — WAL mode allows concurrent readers but writers still
	// serialize. With a 5s busy_timeout and low concurrency, all writes should
	// complete successfully.
	errorCount := 0
	for err := range errors {
		if err != nil {
			errorCount++
			t.Logf("Concurrent write error: %v", err)
		}
	}

	if errorCount > 0 {
		t.Errorf("Expected no errors from concurrent writes with WAL mode, got %d errors", errorCount)
	}
	
	// Verify all writes succeeded by counting clusters
	clusters, err := repo.List(context.Background())
	if err != nil {
		t.Fatalf("Failed to list clusters: %v", err)
	}
	
	expectedCount := numGoroutines * writesPerGoroutine
	if len(clusters) != expectedCount {
		t.Errorf("Expected %d clusters, got %d", expectedCount, len(clusters))
	}
}

// TestSQLiteWAL_ConcurrentReadsAndWrites tests concurrent reads and writes
func TestSQLiteWAL_ConcurrentReadsAndWrites(t *testing.T) {
	// Use file-based database for WAL tests
	dbPath := fmt.Sprintf("/tmp/test_wal_rw_%d.db", time.Now().UnixNano())
	repo, err := NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	defer repo.Close()
	defer func() {
		os.Remove(dbPath)
	}()
	
	migrationSQL := `CREATE TABLE IF NOT EXISTS clusters (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		context TEXT NOT NULL,
		kubeconfig_path TEXT,
		server_url TEXT,
		version TEXT,
		status TEXT,
		provider TEXT,
		last_connected DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	// Verify table exists
	testCluster := &models.Cluster{
		ID:      "test-verify-2",
		Name:     "test",
		Context:  "test",
		Status:   "connected",
		Provider: "test",
	}
	if err := repo.Create(context.Background(), testCluster); err != nil {
		t.Fatalf("Failed to create test cluster: %v", err)
	}
	// Verify we can read it back
	_, err = repo.Get(context.Background(), "test-verify-2")
	if err != nil {
		t.Fatalf("Failed to read test cluster: %v", err)
	}
	// Clean up
	_ = repo.Delete(context.Background(), "test-verify-2")
	
	// Create initial cluster
	cluster := &models.Cluster{
		ID:      "cluster-1",
		Name:     "test-cluster",
		Context:  "test-context",
		Status:   "connected",
		Provider: "test",
	}
	if err := repo.Create(context.Background(), cluster); err != nil {
		t.Fatalf("Failed to create initial cluster: %v", err)
	}
	
	// Concurrent reads and writes
	// NOTE: SQLite WAL allows concurrent readers but serializes writers.
	// Keep writer count low to avoid SQLITE_BUSY in CI environments.
	const numWriters = 2
	const numReaders = 3
	const writesPerWriter = 3
	var wg sync.WaitGroup
	
	// Start writers
	for i := 0; i < numWriters; i++ {
		wg.Add(1)
		go func(writerID int) {
			defer wg.Done()
			for j := 0; j < writesPerWriter; j++ {
				cluster := &models.Cluster{
					ID:      fmt.Sprintf("cluster-w%d-%d", writerID, j),
					Name:     "test-cluster",
					Context:  "test-context",
					Status:   "connected",
					Provider: "test",
				}
				_ = repo.Create(context.Background(), cluster)
			}
		}(i)
	}
	
	// Start readers
	for i := 0; i < numReaders; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				_, _ = repo.List(context.Background())
				_, _ = repo.Get(context.Background(), "cluster-1")
				time.Sleep(10 * time.Millisecond)
			}
		}()
	}
	
	// Wait for all operations to complete
	wg.Wait()
	
	// Verify final state
	clusters, err := repo.List(context.Background())
	if err != nil {
		t.Fatalf("Failed to list clusters: %v", err)
	}
	
	// Should have initial cluster + all written clusters
	expectedMin := 1 + (numWriters * writesPerWriter)
	if len(clusters) < expectedMin {
		t.Errorf("Expected at least %d clusters, got %d", expectedMin, len(clusters))
	}
}

// TestSQLiteWAL_ConnectionPool tests that connection pool settings work correctly
func TestSQLiteWAL_ConnectionPool(t *testing.T) {
	// Use file-based database
	dbPath := fmt.Sprintf("/tmp/test_wal_pool_%d.db", time.Now().UnixNano())
	repo, err := NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	defer repo.Close()
	defer func() {
		os.Remove(dbPath)
	}()
	
	// Run migrations first
	migrationSQL := `CREATE TABLE IF NOT EXISTS clusters (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		context TEXT NOT NULL,
		kubeconfig_path TEXT,
		server_url TEXT,
		version TEXT,
		status TEXT,
		provider TEXT,
		last_connected DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	
	// Verify connection pool by performing operations
	testCluster := &models.Cluster{
		ID:      "test-pool",
		Name:     "test",
		Context:  "test",
		Status:   "connected",
		Provider: "test",
	}
	if err := repo.Create(context.Background(), testCluster); err != nil {
		t.Fatalf("Failed to create cluster: %v", err)
	}
	
	// Verify we can read it back
	_, err = repo.Get(context.Background(), "test-pool")
	if err != nil {
		t.Fatalf("Failed to get cluster: %v", err)
	}
	
	// Clean up
	_ = repo.Delete(context.Background(), "test-pool")
}
