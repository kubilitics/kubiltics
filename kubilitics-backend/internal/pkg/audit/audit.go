// Package audit provides audit logging for mutating operations (C3.3).
// Logs who (identity/request), what (resource), when, and outcome for delete and apply.
package audit

import (
	"encoding/json"
	"log/slog"
	"os"
	"time"
)

// Event represents one audit event (structured for compliance and retention).
type Event struct {
	Time      string `json:"time"`   // ISO8601
	Action    string `json:"action"` // "delete" | "apply" | "patch" | "rollback" | "trigger" | "retry"
	RequestID string `json:"request_id,omitempty"`
	ClusterID string `json:"cluster_id,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	Outcome   string `json:"outcome"` // "success" | "failure"
	Message   string `json:"message,omitempty"`
}

var auditLog = slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

// LogDelete records a delete operation. Call from handler after delete (or on failure).
func LogDelete(requestID, clusterID, kind, namespace, name, outcome, message string) {
	e := Event{
		Time:      time.Now().UTC().Format(time.RFC3339Nano),
		Action:    "delete",
		RequestID: requestID,
		ClusterID: clusterID,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Outcome:   outcome,
		Message:   message,
	}
	auditLog.Info("audit", "event", mustMarshal(e))
}

// ApplyEvent is the audit payload for apply operations.
type ApplyEvent struct {
	Time      string            `json:"time"`
	Action    string            `json:"action"`
	RequestID string            `json:"request_id,omitempty"`
	ClusterID string            `json:"cluster_id,omitempty"`
	Outcome   string            `json:"outcome"`
	Message   string            `json:"message,omitempty"`
	Resources []AppliedResource `json:"resources,omitempty"`
}

// LogApply records an apply operation (create/update). resources is the list of applied resources.
func LogApply(requestID, clusterID, outcome, message string, resources []AppliedResource) {
	e := ApplyEvent{
		Time:      time.Now().UTC().Format(time.RFC3339Nano),
		Action:    "apply",
		RequestID: requestID,
		ClusterID: clusterID,
		Outcome:   outcome,
		Message:   message,
		Resources: resources,
	}
	auditLog.Info("audit", "event", mustMarshal(e))
}

// AppliedResource describes one resource in an apply (no secret data).
type AppliedResource struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Action    string `json:"action"` // "created" | "updated"
}

// LogMutation records a mutation (patch, rollback, trigger, retry). Call from handler after the operation or on failure.
func LogMutation(requestID, clusterID, action, kind, namespace, name, outcome, message string) {
	e := Event{
		Time:      time.Now().UTC().Format(time.RFC3339Nano),
		Action:    action,
		RequestID: requestID,
		ClusterID: clusterID,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Outcome:   outcome,
		Message:   message,
	}
	auditLog.Info("audit", "event", mustMarshal(e))
}

// CommandEvent captures execution metadata for shell/kcli command runs.
type CommandEvent struct {
	Time       string `json:"time"`
	Action     string `json:"action"` // "kcli_exec" | "kcli_stream" | ...
	RequestID  string `json:"request_id,omitempty"`
	ClusterID  string `json:"cluster_id,omitempty"`
	Command    string `json:"command,omitempty"`
	Outcome    string `json:"outcome"` // "success" | "failure"
	Message    string `json:"message,omitempty"`
	ExitCode   int    `json:"exit_code,omitempty"`
	DurationMs int64  `json:"duration_ms,omitempty"`
}

// LogCommand records command execution events for operational audit.
func LogCommand(requestID, clusterID, action, command, outcome, message string, exitCode int, duration time.Duration) {
	e := CommandEvent{
		Time:       time.Now().UTC().Format(time.RFC3339Nano),
		Action:     action,
		RequestID:  requestID,
		ClusterID:  clusterID,
		Command:    command,
		Outcome:    outcome,
		Message:    message,
		ExitCode:   exitCode,
		DurationMs: duration.Milliseconds(),
	}
	auditLog.Info("audit", "event", mustMarshal(e))
}

func mustMarshal(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}
