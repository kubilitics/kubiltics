package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMemoryFindSimilar(t *testing.T) {
	// Use temp dir to avoid polluting real state
	origHome := os.Getenv("HOME")
	tmp := t.TempDir()
	os.Setenv("HOME", tmp)
	defer os.Setenv("HOME", origHome)

	// Create .kcli dir
	dir := filepath.Join(tmp, ".kcli")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	m := &MemoryStore{Records: []MemoryRecord{}}
	m.Add(MemoryRecord{Resource: "pod/crashed", Issue: "OOMKilled", Resolution: "increased memory to 4Gi", ResolvedAt: "2026-01-15T10:00:00Z"})
	m.Add(MemoryRecord{Resource: "pod/api", Issue: "CrashLoopBackOff", Resolution: "fixed config", ResolvedAt: "2026-01-16T10:00:00Z"})
	if err := m.Save(); err != nil {
		t.Fatal(err)
	}

	loaded, err := LoadMemory()
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		target    string
		wantMatch bool
		wantRes   string
	}{
		{"pod/crashed", true, "increased memory to 4Gi"},
		{"pod/crashed-payment-7f9d-xs2k1", true, "increased memory to 4Gi"},
		{"pod/api", true, "fixed config"},
		{"pod/api-5f8b7-xyz", true, "fixed config"},
		{"pod/other", false, ""},
		{"deployment/crashed", false, ""},
	}
	for _, tt := range tests {
		got := loaded.FindSimilar(tt.target)
		if tt.wantMatch {
			if got == nil {
				t.Errorf("FindSimilar(%q) = nil, want match", tt.target)
			} else if got.Resolution != tt.wantRes {
				t.Errorf("FindSimilar(%q).Resolution = %q, want %q", tt.target, got.Resolution, tt.wantRes)
			}
		} else {
			if got != nil {
				t.Errorf("FindSimilar(%q) = %+v, want nil", tt.target, got)
			}
		}
	}
}
