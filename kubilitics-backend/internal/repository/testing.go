package repository

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// NewTestDB opens a temp-file SQLite database with all migrations applied
// and returns the underlying *sql.DB.
// It is intended only for use in tests; the database is cleaned up
// automatically when the test completes.
func NewTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	repo, err := NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteRepository: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })

	migDir := findMigrationsDir(t)
	entries, err := os.ReadDir(migDir)
	if err != nil {
		t.Fatalf("ReadDir migrations: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !isSQLFile(entry.Name()) {
			continue
		}
		migSQL, err := os.ReadFile(filepath.Join(migDir, entry.Name()))
		if err != nil {
			t.Fatalf("ReadFile %s: %v", entry.Name(), err)
		}
		if err := repo.RunMigrations(string(migSQL)); err != nil {
			t.Fatalf("RunMigrations %s: %v", entry.Name(), err)
		}
	}
	return repo.db.DB
}

func findMigrationsDir(t *testing.T) string {
	t.Helper()
	candidates := []string{
		"../../migrations",
		"../../../migrations",
		"../../../../migrations",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	t.Fatalf("could not find migrations dir")
	return ""
}

func isSQLFile(name string) bool {
	return len(name) > 4 && name[len(name)-4:] == ".sql"
}
