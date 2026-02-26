// Package state — failure pattern memory (P3-2).
//
// Stores diagnosed failures and their resolutions. Used by kcli why to surface
// similar past resolutions when failures recur.
package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const memoryFileName = "memory.json"
const maxMemoryRecords = 200

// MemoryRecord is a single failure + resolution entry.
type MemoryRecord struct {
	Resource   string `json:"resource"`   // e.g. "pod/crashed", "deployment/api"
	Issue      string `json:"issue"`     // e.g. "OOMKilled", "CrashLoopBackOff"
	Resolution string `json:"resolution"`
	ResolvedAt string `json:"resolvedAt"` // RFC3339
}

// MemoryStore holds failure records.
type MemoryStore struct {
	Records []MemoryRecord `json:"records"`
}

func memoryFilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, stateDirName, memoryFileName), nil
}

// LoadMemory reads the memory store from disk.
func LoadMemory() (*MemoryStore, error) {
	path, err := memoryFilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &MemoryStore{Records: []MemoryRecord{}}, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return &MemoryStore{Records: []MemoryRecord{}}, nil
	}
	var s MemoryStore
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	if s.Records == nil {
		s.Records = []MemoryRecord{}
	}
	return &s, nil
}

// Save writes the memory store to disk.
func (m *MemoryStore) Save() error {
	path, err := memoryFilePath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// Add appends a record and trims to maxMemoryRecords (oldest first).
func (m *MemoryStore) Add(r MemoryRecord) {
	r.Resource = strings.TrimSpace(r.Resource)
	r.Issue = strings.TrimSpace(r.Issue)
	r.Resolution = strings.TrimSpace(r.Resolution)
	if r.ResolvedAt == "" {
		r.ResolvedAt = time.Now().UTC().Format(time.RFC3339)
	}
	m.Records = append(m.Records, r)
	if len(m.Records) > maxMemoryRecords {
		m.Records = m.Records[len(m.Records)-maxMemoryRecords:]
	}
}

// FindSimilar returns the most recent record that matches the target resource.
// Match: same resource type (pod, deployment, etc.) and (exact name or target
// name starts with record name, e.g. pod/crashed matches pod/crashed-payment-xxx).
func (m *MemoryStore) FindSimilar(target string) *MemoryRecord {
	target = strings.TrimSpace(target)
	if target == "" {
		return nil
	}
	targetKind, targetName := splitResource(target)
	if targetKind == "" || targetName == "" {
		return nil
	}
	var best *MemoryRecord
	var bestTime time.Time
	for i := len(m.Records) - 1; i >= 0; i-- {
		r := &m.Records[i]
		recKind, recName := splitResource(r.Resource)
		if recKind != targetKind {
			continue
		}
		if recName == targetName {
			// Exact match
		} else if strings.HasPrefix(targetName, recName) || strings.HasPrefix(recName, targetName) {
			// Prefix match (e.g. crashed vs crashed-payment)
		} else {
			continue
		}
		t, _ := time.Parse(time.RFC3339, r.ResolvedAt)
		if t.After(bestTime) {
			best = r
			bestTime = t
		}
	}
	return best
}

func splitResource(res string) (kind, name string) {
	parts := strings.SplitN(strings.TrimSpace(res), "/", 2)
	if len(parts) != 2 {
		return "", ""
	}
	kind = strings.TrimSpace(strings.ToLower(parts[0]))
	name = strings.TrimSpace(parts[1])
	// Normalize kind
	switch kind {
	case "po", "pods":
		kind = "pod"
	case "pod":
		kind = "pod"
	case "deploy", "deployments":
		kind = "deployment"
	case "deployment":
		kind = "deployment"
	case "rs", "replicaset":
		kind = "replicaset"
	case "svc", "service":
		kind = "service"
	case "node":
		kind = "node"
	default:
		kind = strings.ToLower(kind)
	}
	return kind, name
}
