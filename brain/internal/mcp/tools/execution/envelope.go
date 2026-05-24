package execution

import (
	"time"
)

// executionMeta is the `_execution` block injected into every successful
// execution tool result.  It gives the LLM (and human operators) a
// structured record of what happened, when, and at what autonomy level.
type executionMeta struct {
	Tool             string `json:"tool"`
	ExecutionID      string `json:"execution_id"`
	AutonomyLevel    int    `json:"autonomy_level"`
	ElapsedMs        int64  `json:"elapsed_ms"`
	IdempotencyKey   string `json:"idempotency_key,omitempty"`
	IdempotencyGuard bool   `json:"idempotency_recorded"` // true = guard was armed
}

// withExecutionEnvelope injects an `_execution` metadata block into a tool
// result.  If result is already a map, the block is inserted directly.
// Otherwise result is wrapped in a map under `value`.
func withExecutionEnvelope(
	toolName string,
	executionID string,
	autonomyLevel int,
	elapsed time.Duration,
	idempotencyKey string,
	idempotencyRecorded bool,
	result interface{},
) interface{} {
	meta := map[string]interface{}{
		"tool":                toolName,
		"execution_id":        executionID,
		"autonomy_level":      autonomyLevel,
		"elapsed_ms":          elapsed.Milliseconds(),
		"idempotency_recorded": idempotencyRecorded,
	}
	if idempotencyKey != "" {
		meta["idempotency_key"] = idempotencyKey
	}

	if m, ok := result.(map[string]interface{}); ok {
		m["_execution"] = meta
		return m
	}
	return map[string]interface{}{
		"value":      result,
		"_execution": meta,
	}
}
