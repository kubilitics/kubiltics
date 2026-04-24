// Package wrapper is the v1 minimum-viable Safety wrapper that sits
// between the runtime Chat handler and the Router. Every dispatch
// passes through it for:
//
//  1. Preflight validation (cluster_id required, request shape sanity).
//  2. Per-event postcheck: ActionPending events are filtered against
//     the configured allow-list; non-allowed action types are dropped
//     and replaced with a structured Error event so the UI sees a
//     clear "AI tried but the gate refused" message.
//  3. Audit: every dispatch + decision + emitted event terminal is
//     forwarded to an AuditSink (single interface; v1 ships a stdout
//     sink + a no-op sink; v1.5 wires the existing internal/audit
//     pipeline).
//
// Real depth (immutable rules, blast radius, autonomy levels with
// auto-approve, rollback checkpoints) lives in sibling packages
// internal/safety/{engine,policy,blastradius,autonomy,rollback}/ —
// already designed but not yet wired. v1 of 3e wires the outer
// boundary only; v1.5 plugs the rich pieces inside this wrapper.
package wrapper

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/router"
)

// Decision describes what Safety did on a single Event in flight.
type Decision int

const (
	DecisionPass  Decision = iota // event forwarded unchanged
	DecisionBlock                 // event dropped + replaced with Error
)

// AuditEntry is one record of dispatch lifecycle. Emitted at start
// (Phase=PhaseStart), each blocked event (PhaseBlock), and end
// (PhaseEnd / PhaseError).
type AuditEntry struct {
	Phase          Phase
	SessionID      string
	TurnID         string
	FocusClusterID string
	UserID         string
	EngineName     string
	Decision       Decision
	BlockedReason  string // populated when Decision == DecisionBlock
	BlockedKind    string // event kind that was blocked, e.g., "action_pending:apply"
	EventCount     int    // PhaseEnd: total events emitted (post-filter)
	BlockedCount   int    // PhaseEnd: total events blocked
	Error          string // PhaseError: terminal error message
	StartedAt      time.Time
	FinishedAt     time.Time
	Extra          map[string]string
}

type Phase int

const (
	PhaseStart Phase = iota
	PhaseBlock
	PhaseEnd
	PhaseError
)

func (p Phase) String() string {
	switch p {
	case PhaseStart:
		return "start"
	case PhaseBlock:
		return "block"
	case PhaseEnd:
		return "end"
	case PhaseError:
		return "error"
	}
	return "unknown"
}

// AuditSink receives AuditEntry records. Implementations must be
// goroutine-safe and non-blocking (long writes will stall dispatches).
type AuditSink interface {
	Record(entry AuditEntry)
}

// NoopSink discards entries. Useful as a default + in tests.
type NoopSink struct{}

func (NoopSink) Record(_ AuditEntry) {}

// Config controls the wrapper's behavior.
type Config struct {
	// AllowedActions is the action_type allow-list applied to ActionPending
	// events. Empty list means ALL ActionPending events are blocked
	// (most conservative default — overrides must be explicit). To allow
	// every action, set [..."*"...].
	AllowedActions []string

	// Audit receives AuditEntry records. Defaults to NoopSink.
	Audit AuditSink

	// RequireClusterID rejects dispatches with empty FocusClusterID at
	// preflight. Default: true. Disable only for non-cluster contexts
	// (currently none; reserved for future general-purpose chats).
	RequireClusterID bool
}

func (c Config) withDefaults() Config {
	if c.Audit == nil {
		c.Audit = NoopSink{}
	}
	return c
}

// Wrapper holds an inner Router and applies safety to every dispatch.
// Implements the same Dispatch surface so callers can substitute it for
// a Router transparently.
type Wrapper struct {
	inner *router.Router
	cfg   Config

	allowed  map[string]struct{}
	allowAll bool
}

// New constructs a Safety Wrapper around an existing Router.
func New(inner *router.Router, cfg Config) *Wrapper {
	cfg = cfg.withDefaults()
	w := &Wrapper{
		inner:    inner,
		cfg:      cfg,
		allowed:  make(map[string]struct{}, len(cfg.AllowedActions)),
		allowAll: false,
	}
	for _, a := range cfg.AllowedActions {
		if a == "*" {
			w.allowAll = true
			continue
		}
		w.allowed[a] = struct{}{}
	}
	return w
}

// Engines exposes the inner Router's registered engine names. Used by
// Capabilities so the safety wrapper is a drop-in replacement.
func (w *Wrapper) Engines() []string {
	return w.inner.Engines()
}

// Dispatch runs preflight, calls the inner Router, then filters every
// emitted Event through postcheck. The returned channel emits the same
// Event values the inner Router would have, EXCEPT ActionPending events
// whose action_type is not in the allow-list — those are replaced with
// a single Error event with code="policy_denied".
//
// engineName is what the inner Router picked. It's still internal-only
// per the Output Normalizer rule.
func (w *Wrapper) Dispatch(ctx context.Context, req router.Request) (engineName string, events <-chan router.Event, err error) {
	startedAt := time.Now()

	// Preflight.
	if w.cfg.RequireClusterID && req.FocusClusterID == "" {
		w.cfg.Audit.Record(AuditEntry{
			Phase:      PhaseError,
			SessionID:  req.SessionID,
			TurnID:     req.TurnID,
			UserID:     req.UserID,
			Error:      "preflight: focus_cluster_id required",
			StartedAt:  startedAt,
			FinishedAt: time.Now(),
		})
		return "", nil, fmt.Errorf("safety preflight: focus_cluster_id required")
	}

	engineName, innerCh, err := w.inner.Dispatch(ctx, req)
	if err != nil {
		w.cfg.Audit.Record(AuditEntry{
			Phase:          PhaseError,
			SessionID:      req.SessionID,
			TurnID:         req.TurnID,
			FocusClusterID: req.FocusClusterID,
			UserID:         req.UserID,
			EngineName:     engineName,
			Error:          err.Error(),
			StartedAt:      startedAt,
			FinishedAt:     time.Now(),
		})
		return engineName, nil, err
	}

	w.cfg.Audit.Record(AuditEntry{
		Phase:          PhaseStart,
		SessionID:      req.SessionID,
		TurnID:         req.TurnID,
		FocusClusterID: req.FocusClusterID,
		UserID:         req.UserID,
		EngineName:     engineName,
		StartedAt:      startedAt,
	})

	out := make(chan router.Event, 16)
	go func() {
		defer close(out)
		var (
			emittedCount int
			blockedCount int
		)
		for ev := range innerCh {
			// Postcheck: filter ActionPending against the allow-list.
			if ev.Kind == router.KindActionPending && !w.actionAllowed(ev.ActionType) {
				blockedCount++
				w.cfg.Audit.Record(AuditEntry{
					Phase:          PhaseBlock,
					SessionID:      req.SessionID,
					TurnID:         req.TurnID,
					FocusClusterID: req.FocusClusterID,
					UserID:         req.UserID,
					EngineName:     engineName,
					Decision:       DecisionBlock,
					BlockedReason:  fmt.Sprintf("action_type %q not in allow-list", ev.ActionType),
					BlockedKind:    "action_pending:" + ev.ActionType,
					StartedAt:      time.Now(),
				})
				select {
				case out <- router.Event{
					Kind:    router.KindError,
					Code:    "policy_denied",
					Message: fmt.Sprintf("action %q is not enabled in this Kubilitics deployment", ev.ActionType),
				}:
				case <-ctx.Done():
					return
				}
				continue
			}
			select {
			case out <- ev:
				emittedCount++
			case <-ctx.Done():
				return
			}
		}
		w.cfg.Audit.Record(AuditEntry{
			Phase:          PhaseEnd,
			SessionID:      req.SessionID,
			TurnID:         req.TurnID,
			FocusClusterID: req.FocusClusterID,
			UserID:         req.UserID,
			EngineName:     engineName,
			EventCount:     emittedCount,
			BlockedCount:   blockedCount,
			StartedAt:      startedAt,
			FinishedAt:     time.Now(),
		})
	}()
	return engineName, out, nil
}

func (w *Wrapper) actionAllowed(actionType string) bool {
	if w.allowAll {
		return true
	}
	_, ok := w.allowed[actionType]
	return ok
}

// CollectingSink is a goroutine-safe AuditSink that records every entry
// in a slice. Useful in tests + for future v1.5 integration with a real
// audit pipeline.
type CollectingSink struct {
	mu      sync.Mutex
	entries []AuditEntry
}

func (s *CollectingSink) Record(e AuditEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = append(s.entries, e)
}

func (s *CollectingSink) Entries() []AuditEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]AuditEntry, len(s.entries))
	copy(out, s.entries)
	return out
}
