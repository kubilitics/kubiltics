package discovery

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
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

func TestKubeconfigFileSource_WatchEmitsAddOnEdit(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/kubeconfig"
	writeKubeconfig(t, path, map[string]string{"a": "https://a"})

	s := NewKubeconfigFileSource([]string{path})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}

	// Add a context by rewriting the file.
	time.Sleep(50 * time.Millisecond) // let watcher warm up
	writeKubeconfig(t, path, map[string]string{"a": "https://a", "b": "https://b"})

	seenAdd := false
	timeout := time.After(2 * time.Second)
	for !seenAdd {
		select {
		case e := <-ch:
			if e.Kind == EventAdd && e.Cluster.Identity.Name == "b" {
				seenAdd = true
			}
		case <-timeout:
			t.Fatal("no EventAdd for b within 2s")
		}
	}
}

func TestKubeconfigFileSource_WatchEmitsRemoveOnDelete(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/kubeconfig"
	writeKubeconfig(t, path, map[string]string{"a": "https://a", "b": "https://b"})

	s := NewKubeconfigFileSource([]string{path})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	time.Sleep(50 * time.Millisecond)

	writeKubeconfig(t, path, map[string]string{"a": "https://a"}) // removed b

	seenRemove := false
	timeout := time.After(2 * time.Second)
	for !seenRemove {
		select {
		case e := <-ch:
			if e.Kind == EventRemove && e.Cluster.Identity.Name == "b" {
				seenRemove = true
			}
		case <-timeout:
			t.Fatal("no EventRemove for b within 2s")
		}
	}
}

// writeKubeconfig is a test helper — minimal valid kubeconfig.
func writeKubeconfig(t *testing.T, path string, clusters map[string]string) {
	t.Helper()
	var buf strings.Builder
	buf.WriteString("apiVersion: v1\nkind: Config\nclusters:\n")
	for n, s := range clusters {
		fmt.Fprintf(&buf, "- name: %s\n  cluster: {server: %q}\n", n, s)
	}
	buf.WriteString("contexts:\n")
	for n := range clusters {
		fmt.Fprintf(&buf, "- name: %s\n  context: {cluster: %s, user: u}\n", n, n)
	}
	buf.WriteString("users:\n- name: u\n  user: {token: x}\ncurrent-context: \"\"\n")
	if err := os.WriteFile(path, []byte(buf.String()), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
}
