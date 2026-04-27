// Package runtime implements the kotg-schema Chat + AIControl gRPC services
// (subproject 3a corrected). The contract lives in github.com/vellankikoti/kotg-schema
// — kubilitics-backend imports the same package and consumes this server.
//
// This v1 stub delegates Chat.Send to a single LLM provider with no tools,
// no agents, no actions — just streaming TextDelta events. Sessions are
// in-memory only. The Router (3b), kagent integration (3c), Python multi-agent
// (3d), and Safety wiring (3e) layer on top without changing this contract.
package runtime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/chat"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/budget"
	"github.com/vellankikoti/kubilitics/brain/internal/router"
	"github.com/vellankikoti/kubilitics/brain/internal/tracing/routing"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	tspb "google.golang.org/protobuf/types/known/timestamppb"
)

// LLMProvider is the minimal contract this v1 stub needs. The adapter in
// cmd/server bridges from the existing internal/llm/provider implementations.
type LLMProvider interface {
	StreamCompletion(ctx context.Context, prompt string) (<-chan string, error)
}

// LLMToolProvider is the optional tool-aware extension of LLMProvider. When
// the underlying adapter implements this interface AND the engine was wired
// with a non-nil tools+executor, llmEngine.Stream takes the tool-using path
// instead of the text-only StreamCompletion path. See runtime.NewLLMEngine.
type LLMToolProvider interface {
	StreamCompletionWithTools(
		ctx context.Context,
		focusClusterID string,
		prompt string,
	) (<-chan toolStreamEvent, error)
}

// toolStreamEvent is the runtime-internal mirror of types.AgentStreamEvent
// re-declared here to avoid leaking the internal/llm/types dependency through
// the public LLMProvider interface. The bridge translates between the two.
type toolStreamEvent struct {
	TextToken   string
	Tool        *toolEvent
	RenderBlock *renderBlockEvent
	Done        bool
	Err         error
	TokenUsage  *toolTokenUsage
}

// renderBlockEvent mirrors types.RenderBlockEvent at the runtime
// boundary (same isolation rationale as toolEvent above). For
// Deterministic tools the executor wrapper produces these directly;
// the LLM never sees the underlying data.
type renderBlockEvent struct {
	Type    string
	Data    []byte
	Summary string
}

type toolTokenUsage struct {
	InputTokens  int
	OutputTokens int
}

type toolEvent struct {
	Phase    string // "calling" | "result" | "error"
	CallID   string
	ToolName string
	Args     map[string]interface{}
	Result   string
	Error    string
}

// Dispatcher abstracts whatever picks an engine for a request. v1
// satisfied by *router.Router and *wrapper.Wrapper interchangeably so
// the Safety wrapper (subproject 3e) can be slotted in without changing
// the runtime contract.
type Dispatcher interface {
	Engines() []string
	Dispatch(ctx context.Context, req router.Request) (engineName string, events <-chan router.Event, err error)
}

// Config holds the immutable wiring for a runtime server.
//
// As of subproject 3b the runtime no longer talks to LLMProvider directly;
// it dispatches turns through a Dispatcher. v1 wires a single LLM-direct
// engine (see NewLLMEngine); 3c/3d register kagent + Python engines
// alongside; 3e wraps the Router with a Safety wrapper.
type Config struct {
	Dispatcher    Dispatcher
	AIVersion     string
	SchemaVersion string
	// Providers/Models reflect the underlying LLM/model identities for
	// AICapabilities. Engine names are reported separately via
	// Dispatcher.Engines().
	Providers []string
	Models    []string
}

// session is the in-memory record. Cluster binding + idle eviction are
// minimal v1 stubs; richer lifecycle in 3b.
type session struct {
	id             string
	focusClusterID string
	title          string
	createdAt      time.Time
	updatedAt      time.Time
	turnCount      int
	cancel         context.CancelFunc
}

// Server implements both kotg-schema Chat and AIControl services.
type Server struct {
	kotgv1.UnimplementedChatServer
	kotgv1.UnimplementedAIControlServer
	cfg          Config
	mu           sync.RWMutex
	sessions     map[string]*session
	traceDir     string
	sessionStore chat.SessionStore // optional — nil-safe (no persistence)
	budgetGate   budget.Gate        // optional — nil-safe (no enforcement)
	// adapterProbe reports whether a working LLM adapter is currently
	// wired into the bridge. Capabilities() consults it so the response
	// reflects runtime truth (config-saved + hot-wire applied) rather
	// than the immutable startup-time cfg.Providers list. nil-safe:
	// when unset, capabilities falls back to cfg.Providers.
	adapterProbe func() bool
	// estimatedTurnCostUSD is used when a Gate is wired but the runtime
	// has no per-turn cost estimator yet. A conservative constant (fractions
	// of a cent) keeps the pre-spend check honest without blocking benign
	// conversations on zero-budget setups.
	estimatedTurnCostUSD float64
}

// SetSessionStore wires a persistent backing store for chat messages.
// When set, every Send user message is appended before dispatch and
// assistant text-deltas are concatenated into an assistant message on
// turn completion. nil-safe — passing nil keeps the in-memory-only
// behavior of previous builds.
//
// Phase 2 / B.3 — survives process restart so reopening the app lands
// the user back in the prior conversation.
func (s *Server) SetSessionStore(store chat.SessionStore) {
	s.mu.Lock()
	s.sessionStore = store
	s.mu.Unlock()
}

// SetBudgetGate wires a pre-dispatch budget primitive (Phase 2 / Gap 3).
// When set, every Send turn debits estimatedTurnCostUSD before dispatching
// to the router. On ErrBudgetExceeded the handler emits an Error event
// with code="budget_exceeded" + a Done{Partial:true,FinishReason:"budget"}
// and returns without invoking the LLM. nil disables enforcement.
func (s *Server) SetBudgetGate(g budget.Gate, estimatedTurnCostUSD float64) {
	s.mu.Lock()
	s.budgetGate = g
	if estimatedTurnCostUSD > 0 {
		s.estimatedTurnCostUSD = estimatedTurnCostUSD
	}
	s.mu.Unlock()
}

// BudgetGate returns the wired gate (may be nil). Exposed so admin HTTP
// endpoints can query spend + reset the accumulator.
func (s *Server) BudgetGate() budget.Gate {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.budgetGate
}

// SetTraceDir configures the directory where per-turn routing traces are
// written. An empty string disables tracing (no-op recorder). The directory
// is created on first use, not here, so callers can set this at any time.
func (s *Server) SetTraceDir(dir string) {
	s.mu.Lock()
	s.traceDir = dir
	s.mu.Unlock()
}

// New builds a runtime server. Caller wires it into a *grpc.Server.
func New(cfg Config) *Server {
	return &Server{
		cfg:                  cfg,
		sessions:             make(map[string]*session),
		estimatedTurnCostUSD: 0.01, // conservative default: 1¢/turn
	}
}

// ── AIControl ──────────────────────────────────────────────────────────────

func (s *Server) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	// Honest readiness signal: when the adapter probe says no provider is
	// wired (user hasn't saved config yet, or saved config built a nil
	// adapter due to bad creds / unreachable Ollama), return empty
	// Providers + Models. The kubilitics-backend handler downgrades
	// `ready` to false based on that, and the chat-status pill shows
	// "AI Not Configured" or "AI Unreachable" instead of a green light
	// over a brain that can't actually answer a turn.
	s.mu.RLock()
	probe := s.adapterProbe
	s.mu.RUnlock()
	providers := s.cfg.Providers
	models := s.cfg.Models
	if probe != nil && !probe() {
		providers = nil
		models = nil
	}
	return &kotgv1.AICapabilities{
		SchemaVersion: s.cfg.SchemaVersion,
		AiVersion:     s.cfg.AIVersion,
		Providers:     providers,
		Models:        models,
		SupportsUndo:  false,
		SupportsPlans: false,
	}, nil
}

// SetAdapterProbe wires a callback that Capabilities consults to report
// whether a working LLM adapter is currently bridged. cmd/server/main.go
// passes `func() bool { return bridge.Adapter() != nil }` so AI Settings
// hot-wire flips the readiness signal without restarting the brain.
// nil-safe — passing nil reverts to the static cfg.Providers behavior.
func (s *Server) SetAdapterProbe(probe func() bool) {
	s.mu.Lock()
	s.adapterProbe = probe
	s.mu.Unlock()
}

func (s *Server) Health(_ context.Context, _ *kotgv1.Empty) (*kotgv1.HealthStatus, error) {
	return &kotgv1.HealthStatus{
		State:  kotgv1.HealthStatus_STATE_OK,
		Detail: "ready",
		Ts:     tspb.Now(),
	}, nil
}

// ── Chat ────────────────────────────────────────────────────────────────────

func (s *Server) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	if req.FocusClusterId == "" {
		return nil, status.Error(codes.InvalidArgument, "focus_cluster_id required")
	}
	id := newID("sess")
	now := time.Now()
	sess := &session{
		id:             id,
		focusClusterID: req.FocusClusterId,
		title:          req.Title,
		createdAt:      now,
		updatedAt:      now,
	}
	s.mu.Lock()
	s.sessions[id] = sess
	s.mu.Unlock()
	return sessionToProto(sess), nil
}

// Send is the bidi chat stream.
func (s *Server) Send(stream kotgv1.Chat_SendServer) error {
	for {
		msg, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if msg.SessionId == "" {
			return status.Error(codes.InvalidArgument, "session_id required on UserMessage")
		}
		s.mu.Lock()
		sess, ok := s.sessions[msg.SessionId]
		s.mu.Unlock()
		if !ok {
			return status.Errorf(codes.NotFound, "session %q not found", msg.SessionId)
		}

		turnCtx, cancel := context.WithCancel(stream.Context())
		s.mu.Lock()
		sess.cancel = cancel
		sess.turnCount++
		sess.updatedAt = time.Now()
		s.mu.Unlock()

		// Attach a per-turn routing trace recorder when a trace dir is configured.
		// Off by default (traceDir == "") so production traffic sees zero overhead.
		s.mu.RLock()
		td := s.traceDir
		s.mu.RUnlock()
		if td != "" {
			if rec, err := routing.NewFileRecorder(msg.TurnId, td); err == nil {
				defer rec.Close()
				rec.Stage("user_msg", map[string]any{
					"bytes": len(msg.Text),
				})
				turnCtx = routing.WithRecorder(turnCtx, rec)
			}
		}

		// Persist the user message before dispatch. If the store write
		// fails (disk full, schema drift), log-and-continue: a persistence
		// miss must never block an in-flight turn.
		s.mu.RLock()
		store := s.sessionStore
		gate := s.budgetGate
		estCost := s.estimatedTurnCostUSD
		s.mu.RUnlock()
		if store != nil {
			_ = store.Append(turnCtx, msg.SessionId, chat.Message{
				Role:    "user",
				Content: msg.Text,
			})
		}

		// Pre-dispatch budget gate (Phase 2 / Gap 3). Debit estCost; on
		// ErrBudgetExceeded short-circuit the turn with a recognizable
		// Error event + partial-Done. The frontend's BudgetExceededBanner
		// keys off ErrorEvent.Code == "budget_exceeded".
		if gate != nil {
			if budgetErr := gate.AllowDebit(turnCtx, estCost); budgetErr != nil {
				cancel()
				s.mu.Lock()
				sess.cancel = nil
				s.mu.Unlock()
				if sendErr := stream.Send(s.event(msg.TurnId, &kotgv1.AssistantEvent_Error{
					Error: &kotgv1.ErrorEvent{
						Code:    "budget_exceeded",
						Message: budgetErr.Error(),
					},
				})); sendErr != nil {
					return sendErr
				}
				if sendErr := stream.Send(s.event(msg.TurnId, &kotgv1.AssistantEvent_Done{
					Done: &kotgv1.Done{Partial: true, FinishReason: "budget"},
				})); sendErr != nil {
					return sendErr
				}
				continue
			}
		}

		req := router.Request{
			SessionID:      msg.SessionId,
			TurnID:         msg.TurnId,
			FocusClusterID: sess.focusClusterID,
			Text:           msg.Text,
			ContextHint:    msg.ContextHint,
		}

		engineName, events, dispatchErr := s.cfg.Dispatcher.Dispatch(turnCtx, req)
		if dispatchErr != nil {
			cancel()
			s.mu.Lock()
			sess.cancel = nil
			s.mu.Unlock()
			if sendErr := stream.Send(s.event(msg.TurnId, &kotgv1.AssistantEvent_Error{
				Error: &kotgv1.ErrorEvent{Code: "router_error", Message: dispatchErr.Error()},
			})); sendErr != nil {
				return sendErr
			}
			if sendErr := stream.Send(s.event(msg.TurnId, &kotgv1.AssistantEvent_Done{
				Done: &kotgv1.Done{Partial: true, FinishReason: "error"},
			})); sendErr != nil {
				return sendErr
			}
			continue
		}

		// Internal-only logging of which engine ran. NEVER surfaced on the wire
		// (the Output Normalizer rule: chat clients only see canonical events).
		// When observability is added: log.Info("engine_used", "engine", engineName).
		_ = engineName

		var assistantBuf strings.Builder
		for ev := range events {
			if ev.Kind == router.KindTextDelta {
				assistantBuf.WriteString(ev.Text)
			}
			mapped := s.mapRouterEvent(msg.TurnId, ev)
			if mapped == nil {
				continue
			}
			if sendErr := stream.Send(mapped); sendErr != nil {
				cancel()
				// Drain remaining events so the engine goroutine isn't blocked.
				for range events {
				}
				s.mu.Lock()
				sess.cancel = nil
				s.mu.Unlock()
				return sendErr
			}
		}
		// Commit the assistant side of the turn once the stream closes.
		if store != nil && assistantBuf.Len() > 0 {
			_ = store.Append(context.Background(), msg.SessionId, chat.Message{
				Role:    "assistant",
				Content: assistantBuf.String(),
			})
		}
		cancel()
		s.mu.Lock()
		sess.cancel = nil
		s.mu.Unlock()
	}
}

// mapRouterEvent translates a canonical router.Event into the kotg-schema
// AssistantEvent variant. Action/Plan/Citation are forwarded for forward-compat
// once 3e (safety) and 3g (approval UI) ship.
func (s *Server) mapRouterEvent(turnID string, ev router.Event) *kotgv1.AssistantEvent {
	switch ev.Kind {
	case router.KindTextDelta:
		return s.event(turnID, &kotgv1.AssistantEvent_TextDelta{
			TextDelta: &kotgv1.TextDelta{Text: ev.Text},
		})
	case router.KindError:
		return s.event(turnID, &kotgv1.AssistantEvent_Error{
			Error: &kotgv1.ErrorEvent{Code: ev.Code, Message: ev.Message},
		})
	case router.KindDone:
		return s.event(turnID, &kotgv1.AssistantEvent_Done{
			Done: &kotgv1.Done{
				Partial:          ev.Partial,
				Cancelled:        ev.Cancelled,
				FinishReason:     ev.FinishReason,
				PromptTokens:     ev.PromptTokens,
				CompletionTokens: ev.CompletionTokens,
			},
		})
	case router.KindToolStart:
		return s.event(turnID, &kotgv1.AssistantEvent_ToolStart{
			ToolStart: &kotgv1.ToolStart{ToolCallId: ev.ToolCallID, ToolName: ev.ToolName, Preview: ev.Preview},
		})
	case router.KindToolEnd:
		return s.event(turnID, &kotgv1.AssistantEvent_ToolEnd{
			ToolEnd: &kotgv1.ToolEnd{ToolCallId: ev.ToolCallID, Ok: ev.OK, Preview: ev.Preview},
		})
	case router.KindActionPending, router.KindPlanProposed, router.KindCitation:
		// TODO(3e/3g): map to AssistantEvent_ActionPending / _PlanProposed / _Citation.
		return nil
	case router.KindRenderBlock:
		return s.event(turnID, &kotgv1.AssistantEvent_RenderBlock{
			RenderBlock: &kotgv1.RenderBlock{
				Type:    ev.RenderType,
				Data:    ev.RenderData,
				Summary: ev.RenderSummary,
			},
		})
	}
	return nil
}

func (s *Server) CancelTurn(_ context.Context, req *kotgv1.CancelTurnRequest) (*kotgv1.Empty, error) {
	if req.SessionId == "" {
		return nil, status.Error(codes.InvalidArgument, "session_id required")
	}
	s.mu.Lock()
	sess, ok := s.sessions[req.SessionId]
	if ok && sess.cancel != nil {
		sess.cancel()
	}
	s.mu.Unlock()
	if !ok {
		return nil, status.Errorf(codes.NotFound, "session %q not found", req.SessionId)
	}
	return &kotgv1.Empty{}, nil
}

func (s *Server) ListSessions(req *kotgv1.ListSessionsRequest, stream kotgv1.Chat_ListSessionsServer) error {
	s.mu.Lock()
	out := make([]*session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		if req.SinceUnix > 0 && sess.updatedAt.Unix() <= req.SinceUnix {
			continue
		}
		out = append(out, sess)
	}
	s.mu.Unlock()

	limit := int(req.Limit)
	if limit <= 0 || limit > len(out) {
		limit = len(out)
	}
	for i := 0; i < limit; i++ {
		if err := stream.Send(sessionToProto(out[i])); err != nil {
			return err
		}
	}
	return nil
}

// ── Helpers ────────────────────────────────────────────────────────────────

func (s *Server) event(turnID string, variant interface{}) *kotgv1.AssistantEvent {
	ev := &kotgv1.AssistantEvent{
		AnchorId: turnID + "-" + newID("anc"),
	}
	switch v := variant.(type) {
	case *kotgv1.AssistantEvent_TextDelta:
		ev.Event = v
	case *kotgv1.AssistantEvent_ToolStart:
		ev.Event = v
	case *kotgv1.AssistantEvent_ToolEnd:
		ev.Event = v
	case *kotgv1.AssistantEvent_ActionPending:
		ev.Event = v
	case *kotgv1.AssistantEvent_PlanProposed:
		ev.Event = v
	case *kotgv1.AssistantEvent_Citation:
		ev.Event = v
	case *kotgv1.AssistantEvent_Error:
		ev.Event = v
	case *kotgv1.AssistantEvent_Done:
		ev.Event = v
	case *kotgv1.AssistantEvent_RenderBlock:
		ev.Event = v
	}
	return ev
}

func sessionToProto(s *session) *kotgv1.Session {
	return &kotgv1.Session{
		SessionId:      s.id,
		Title:          s.title,
		FocusClusterId: s.focusClusterID,
		CreatedAt:      tspb.New(s.createdAt),
		UpdatedAt:      tspb.New(s.updatedAt),
		TurnCount:      int32(s.turnCount),
	}
}

func newID(prefix string) string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return prefix + "-" + hex.EncodeToString(b[:])
}
