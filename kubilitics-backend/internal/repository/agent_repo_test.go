package repository

import (
	"testing"
)

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
	if len(names) != 4 {
		t.Fatalf("expected 4 agent-trust tables, got %v", names)
	}
}
