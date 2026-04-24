// Package identity defines the logical-identity model for clusters.
// A (Name, ServerURL) tuple replaces session UUIDs in all persisted
// state; session IDs change on cluster recreation but the tuple doesn't.
// See docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md §3.3.
package identity

import (
	"fmt"
	"net/url"
	"strings"
)

// LogicalIdentity uniquely identifies a cluster across its possibly-many
// session UUIDs. Name is the kubeconfig context name (case-sensitive);
// ServerURL is normalized (lowercased host, no trailing slash).
type LogicalIdentity struct {
	Name      string `json:"name"`
	ServerURL string `json:"server_url"`
}

// Key returns a stable hashable string suitable for map keys / cache keys.
// Differences in case (of host) or trailing slashes do not produce
// different keys.
func (l LogicalIdentity) Key() string {
	return l.Name + "|" + normalizeURL(l.ServerURL)
}

// Equal returns whether two identities refer to the same cluster.
func (l LogicalIdentity) Equal(other LogicalIdentity) bool {
	return l.Key() == other.Key()
}

// String returns a human-readable representation for logs/UI.
func (l LogicalIdentity) String() string {
	return fmt.Sprintf("%s@%s", l.Name, normalizeURL(l.ServerURL))
}

func normalizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return strings.TrimRight(raw, "/")
	}
	host := strings.ToLower(u.Host)
	scheme := strings.ToLower(u.Scheme)
	path := strings.TrimRight(u.Path, "/")
	if scheme == "" || host == "" {
		return strings.TrimRight(raw, "/")
	}
	if path == "" {
		return fmt.Sprintf("%s://%s", scheme, host)
	}
	return fmt.Sprintf("%s://%s%s", scheme, host, path)
}
