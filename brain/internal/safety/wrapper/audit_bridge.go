package wrapper

import (
	"context"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
)

// LoggerSink bridges the wrapper's AuditSink interface into the
// production internal/audit.Logger pipeline. v1.5 closes the
// previously open prod gap (the wrapper used to default to NoopSink).
//
// Each AuditEntry is converted into one audit.Event and fed to L. The
// translation flattens wrapper-specific fields (Phase, Decision,
// BlockedReason) into Metadata so downstream tooling can filter on them
// without losing information. Nil L is handled gracefully — Record
// becomes a no-op so test/dev paths don't crash.
type LoggerSink struct {
	L audit.Logger
}

// Record converts a wrapper.AuditEntry into an audit.Event and logs it.
func (s LoggerSink) Record(entry AuditEntry) {
	if s.L == nil {
		return
	}

	eventType := mapPhaseToEventType(entry.Phase)
	ev := audit.NewEvent(eventType).
		WithCorrelationID(correlationID(entry)).
		WithUser(entry.UserID).
		WithResource(entry.FocusClusterID, "cluster").
		WithMetadata("phase", entry.Phase.String()).
		WithMetadata("session_id", entry.SessionID).
		WithMetadata("turn_id", entry.TurnID).
		WithMetadata("engine", entry.EngineName)

	switch entry.Phase {
	case PhaseStart:
		ev = ev.WithResult(audit.ResultPending).
			WithDescription("safety wrapper: dispatch start")
	case PhaseEnd:
		ev = ev.WithResult(audit.ResultSuccess).
			WithDescription("safety wrapper: dispatch end").
			WithMetadata("event_count", entry.EventCount).
			WithMetadata("blocked_count", entry.BlockedCount)
		if !entry.FinishedAt.IsZero() && !entry.StartedAt.IsZero() {
			ev = ev.WithDuration(entry.FinishedAt.Sub(entry.StartedAt))
		}
	case PhaseBlock:
		ev = ev.WithResult(audit.ResultDenied).
			WithDescription("safety wrapper: event blocked").
			WithMetadata("blocked_reason", entry.BlockedReason).
			WithMetadata("blocked_kind", entry.BlockedKind).
			WithMetadata("decision", "block")
	case PhaseError:
		ev = ev.WithResult(audit.ResultFailure).
			WithDescription("safety wrapper: dispatch error").
			WithMetadata("error", entry.Error)
	}

	for k, v := range entry.Extra {
		ev = ev.WithMetadata("extra."+k, v)
	}

	_ = s.L.Log(context.Background(), ev)
}

// mapPhaseToEventType keeps wrapper events in their own audit namespace
// (`safety.wrapper.*`) so downstream filters can isolate them from
// MCP-tool action events that already use `action.*`.
func mapPhaseToEventType(p Phase) audit.EventType {
	switch p {
	case PhaseStart:
		return audit.EventType("safety.wrapper.dispatch_start")
	case PhaseEnd:
		return audit.EventType("safety.wrapper.dispatch_end")
	case PhaseBlock:
		return audit.EventType("safety.wrapper.blocked")
	case PhaseError:
		return audit.EventType("safety.wrapper.error")
	}
	return audit.EventType("safety.wrapper.unknown")
}

// correlationID picks the most-specific available id for cross-event
// tracing: TurnID first (one chat turn), SessionID as a fallback.
func correlationID(e AuditEntry) string {
	if e.TurnID != "" {
		return e.TurnID
	}
	return e.SessionID
}
