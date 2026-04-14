// Package kubeconfigwatch watches the user's kubeconfig file(s) and keeps
// the Kubilitics cluster registry in sync with them. When a context is
// deleted externally (via kubectl config delete-context, kind delete cluster,
// or editing the file), the corresponding persisted cluster is removed.
//
// The design is modeled on Headlamp's backend/pkg/kubeconfig/watcher.go
// with Kubilitics-specific adaptations: SQLite persistence instead of
// in-memory cache, mass-delete safety cap, audit logging, pre-destructive
// JSON snapshots, and deployment-mode gating.
package kubeconfigwatch

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// DefaultPaths returns the list of kubeconfig file paths that the watcher
// should observe. Resolution order:
//
//  1. If $KUBECONFIG is set, split on the OS-appropriate separator (`:`
//     on Unix, `;` on Windows) and use every entry.
//  2. Otherwise, fall back to $HOME/.kube/config.
//
// Empty entries and non-existent files are filtered out. The returned slice
// is ordered as in $KUBECONFIG (or has exactly one element for the fallback).
// An empty slice means "nothing to watch" — the caller should skip starting
// the watcher in that case.
func DefaultPaths() []string {
	var candidates []string

	if env := os.Getenv("KUBECONFIG"); env != "" {
		sep := ":"
		if runtime.GOOS == "windows" {
			sep = ";"
		}
		for _, p := range strings.Split(env, sep) {
			if p == "" {
				continue
			}
			candidates = append(candidates, p)
		}
	} else {
		home, _ := os.UserHomeDir()
		if home == "" {
			return nil
		}
		candidates = append(candidates, filepath.Join(home, ".kube", "config"))
	}

	// Filter non-existent files. A missing path is silently dropped — the
	// caller gets a shorter slice, and the watcher simply watches fewer files.
	// This is safe because sync is fail-safe: if a path disappears later, the
	// watcher reports the error and refuses to mutate anything.
	out := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, p := range candidates {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		abs, err := filepath.Abs(p)
		if err != nil {
			abs = p
		}
		if _, dup := seen[abs]; dup {
			continue
		}
		seen[abs] = struct{}{}
		out = append(out, abs)
	}
	return out
}
