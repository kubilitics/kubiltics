package cli

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFindingKey(t *testing.T) {
	f1 := securityFinding{Category: "pod", Resource: "Pod", Namespace: "default", Name: "nginx", Issue: "root-container"}
	f2 := securityFinding{Category: "pod", Resource: "Pod", Namespace: "default", Name: "nginx", Issue: "root-container"}
	if findingKey(f1) != findingKey(f2) {
		t.Error("same finding should have same key")
	}
	f3 := securityFinding{Category: "rbac", Resource: "ClusterRole", Namespace: "", Name: "admin", Issue: "wildcard"}
	if findingKey(f1) == findingKey(f3) {
		t.Error("different findings should have different keys")
	}
}

func TestParseDuration(t *testing.T) {
	tests := []struct {
		in   string
		want time.Duration
	}{
		{"7d", 7 * 24 * time.Hour},
		{"1d", 24 * time.Hour},
		{"24h", 24 * time.Hour},
		{"1h", time.Hour},
		{"30m", 30 * time.Minute},
	}
	for _, tt := range tests {
		got, err := parseDuration(tt.in)
		if err != nil {
			t.Errorf("parseDuration(%q): %v", tt.in, err)
			continue
		}
		if got != tt.want {
			t.Errorf("parseDuration(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
	_, err := parseDuration("invalid")
	if err == nil {
		t.Error("parseDuration(\"invalid\") should error")
	}
}

func TestSecurityHistory_SaveLoad(t *testing.T) {
	dir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", dir)
	defer os.Setenv("HOME", origHome)

	if err := os.MkdirAll(filepath.Join(dir, ".kcli"), 0o750); err != nil {
		t.Fatal(err)
	}

	h := &securityHistory{
		Scans: []securityHistoryEntry{
			{
				Timestamp: time.Now().Add(-2 * time.Hour).UTC(),
				Namespace: "all",
				Findings: []securityFinding{
					{Category: "pod", Resource: "Pod", Namespace: "default", Name: "test", Issue: "root-container", Severity: "HIGH"},
				},
			},
		},
	}
	if err := saveSecurityHistory(h); err != nil {
		t.Fatalf("saveSecurityHistory: %v", err)
	}

	loaded, err := loadSecurityHistory()
	if err != nil {
		t.Fatalf("loadSecurityHistory: %v", err)
	}
	if len(loaded.Scans) != 1 {
		t.Fatalf("expected 1 scan, got %d", len(loaded.Scans))
	}
	if loaded.Scans[0].Namespace != "all" {
		t.Errorf("namespace = %q, want all", loaded.Scans[0].Namespace)
	}
	if len(loaded.Scans[0].Findings) != 1 {
		t.Errorf("findings count = %d, want 1", len(loaded.Scans[0].Findings))
	}
}
