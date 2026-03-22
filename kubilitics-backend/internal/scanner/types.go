package scanner

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"
)

// Severity levels for findings, ordered by impact.
type Severity string

const (
	SeverityCritical Severity = "CRITICAL"
	SeverityHigh     Severity = "HIGH"
	SeverityMedium   Severity = "MEDIUM"
	SeverityLow      Severity = "LOW"
	SeverityInfo     Severity = "INFO"
)

// SeverityRank returns a numeric rank for sorting (lower = more severe).
func SeverityRank(s Severity) int {
	switch s {
	case SeverityCritical:
		return 0
	case SeverityHigh:
		return 1
	case SeverityMedium:
		return 2
	case SeverityLow:
		return 3
	case SeverityInfo:
		return 4
	default:
		return 5
	}
}

// TargetType defines what is being scanned.
type TargetType string

const (
	TargetDirectory      TargetType = "directory"
	TargetContainerImage TargetType = "container_image"
	TargetHelmChart      TargetType = "helm_chart"
)

// ScanTarget describes what to scan.
type ScanTarget struct {
	Type TargetType `json:"type"`
	Path string     `json:"path"` // local path or image reference
}

// ScanConfig holds per-scan configuration.
type ScanConfig struct {
	Target            ScanTarget    `json:"target"`
	Scanners          []string      `json:"scanners"`           // empty = all available
	Timeout           time.Duration `json:"timeout"`            // per-scanner timeout
	SeverityThreshold Severity      `json:"severity_threshold"` // minimum severity to report
}

// Finding is the unified finding model across all scanners.
type Finding struct {
	ID          string            `json:"id"`
	Tool        string            `json:"tool"`
	RuleID      string            `json:"rule_id"`
	Severity    Severity          `json:"severity"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	File        string            `json:"file"`
	StartLine   int               `json:"start_line"`
	EndLine     int               `json:"end_line"`
	Remediation string            `json:"remediation,omitempty"`
	CWE         []string          `json:"cwe,omitempty"`
	CVE         []string          `json:"cve,omitempty"`
	Confidence  string            `json:"confidence,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// ComputeID generates a deterministic ID for deduplication.
func (f *Finding) ComputeID() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s:%d", f.Tool, f.RuleID, f.File, f.StartLine)))
	f.ID = fmt.Sprintf("%x", h[:12])
	return f.ID
}

// ScanResult is what a single scanner adapter returns.
type ScanResult struct {
	Tool       string        `json:"tool"`
	Findings   []Finding     `json:"findings"`
	Duration   time.Duration `json:"duration"`
	Error      string        `json:"error,omitempty"`
	Skipped    bool          `json:"skipped"`
	SkipReason string        `json:"skip_reason,omitempty"`
}

// Scanner is the interface each adapter must implement.
type Scanner interface {
	Name() string
	Available() bool
	Scan(ctx context.Context, target ScanTarget) (*ScanResult, error)
}
