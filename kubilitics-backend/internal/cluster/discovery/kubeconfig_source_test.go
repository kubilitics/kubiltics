package discovery

import (
	"context"
	"testing"
)

func TestKubeconfigFileSource_EnumerateTwoContexts(t *testing.T) {
	s := NewKubeconfigFileSource([]string{"testdata/sample-kubeconfig.yaml"})
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("enumerate: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 clusters, got %d: %+v", len(got), got)
	}
	names := map[string]bool{}
	for _, c := range got {
		names[c.Identity.Name] = true
		if c.Source != "kubeconfig" {
			t.Errorf("source: %q", c.Source)
		}
		if c.KubeconfigPath == "" {
			t.Error("kubeconfig_path must be set")
		}
	}
	if !names["prod"] || !names["staging"] {
		t.Fatalf("missing expected contexts: %v", names)
	}
}

func TestKubeconfigFileSource_MissingFileReturnsEmpty(t *testing.T) {
	s := NewKubeconfigFileSource([]string{"/does/not/exist"})
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("missing file should not error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want empty, got %d", len(got))
	}
}

func TestKubeconfigFileSource_MalformedYAMLReturnsError(t *testing.T) {
	s := NewKubeconfigFileSource([]string{"kubeconfig_source_test.go"}) // not yaml
	_, err := s.Enumerate(context.Background())
	if err == nil {
		t.Fatal("malformed file must surface an error, not silent success")
	}
}
