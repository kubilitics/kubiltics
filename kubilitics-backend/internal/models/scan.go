package models

import "time"

// ScanRunStatus represents the lifecycle of a scan run.
type ScanRunStatus string

const (
	ScanRunPending   ScanRunStatus = "pending"
	ScanRunRunning   ScanRunStatus = "running"
	ScanRunCompleted ScanRunStatus = "completed"
	ScanRunFailed    ScanRunStatus = "failed"
)

// ScanRun represents a single invocation of the scanning engine.
type ScanRun struct {
	ID            string        `json:"id" db:"id"`
	Status        ScanRunStatus `json:"status" db:"status"`
	TargetType    string        `json:"target_type" db:"target_type"`
	TargetPath    string        `json:"target_path" db:"target_path"`
	Scanners      string        `json:"scanners" db:"scanners"` // JSON array
	TotalFindings int           `json:"total_findings" db:"total_findings"`
	CriticalCount int           `json:"critical_count" db:"critical_count"`
	HighCount     int           `json:"high_count" db:"high_count"`
	MediumCount   int           `json:"medium_count" db:"medium_count"`
	LowCount      int           `json:"low_count" db:"low_count"`
	InfoCount     int           `json:"info_count" db:"info_count"`
	DurationMs    int64         `json:"duration_ms" db:"duration_ms"`
	ErrorMessage  string        `json:"error_message,omitempty" db:"error_message"`
	StartedAt     *time.Time    `json:"started_at,omitempty" db:"started_at"`
	CompletedAt   *time.Time    `json:"completed_at,omitempty" db:"completed_at"`
	CreatedAt     time.Time     `json:"created_at" db:"created_at"`
}

// ScanFindingStatus tracks the lifecycle of an individual finding.
type ScanFindingStatus string

const (
	ScanFindingOpen          ScanFindingStatus = "open"
	ScanFindingAcknowledged  ScanFindingStatus = "acknowledged"
	ScanFindingFixed         ScanFindingStatus = "fixed"
	ScanFindingFalsePositive ScanFindingStatus = "false_positive"
)

// ScanFinding represents a single security finding persisted in the database.
type ScanFinding struct {
	ID          string            `json:"id" db:"id"`
	RunID       string            `json:"run_id" db:"run_id"`
	Tool        string            `json:"tool" db:"tool"`
	RuleID      string            `json:"rule_id" db:"rule_id"`
	Severity    string            `json:"severity" db:"severity"`
	Title       string            `json:"title" db:"title"`
	Description string            `json:"description,omitempty" db:"description"`
	FilePath    string            `json:"file_path,omitempty" db:"file_path"`
	StartLine   int               `json:"start_line" db:"start_line"`
	EndLine     int               `json:"end_line" db:"end_line"`
	Remediation string            `json:"remediation,omitempty" db:"remediation"`
	CWE         string            `json:"cwe,omitempty" db:"cwe"`           // JSON array
	CVE         string            `json:"cve,omitempty" db:"cve"`           // JSON array
	Confidence  string            `json:"confidence,omitempty" db:"confidence"`
	MetadataRaw string            `json:"metadata_raw,omitempty" db:"metadata"` // JSON object
	Status      ScanFindingStatus `json:"status" db:"status"`
	FirstSeenAt time.Time         `json:"first_seen_at" db:"first_seen_at"`
	LastSeenAt  time.Time         `json:"last_seen_at" db:"last_seen_at"`
}

// ScanStats holds aggregated scan statistics for the dashboard.
type ScanStats struct {
	TotalRuns      int            `json:"total_runs"`
	TotalFindings  int            `json:"total_findings"`
	BySeverity     map[string]int `json:"findings_by_severity"`
	ByTool         map[string]int `json:"findings_by_tool"`
	Trend          []ScanTrend    `json:"trend"`
}

// ScanTrend holds daily finding counts for trend visualization.
type ScanTrend struct {
	Date     string `json:"date" db:"date"`
	Critical int    `json:"critical" db:"critical"`
	High     int    `json:"high" db:"high"`
	Medium   int    `json:"medium" db:"medium"`
	Low      int    `json:"low" db:"low"`
	Info     int    `json:"info" db:"info"`
}
