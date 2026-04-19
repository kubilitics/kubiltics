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
	"sync"
	"time"

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

// Config holds the immutable wiring for a runtime server.
type Config struct {
	LLM           LLMProvider
	AIVersion     string
	SchemaVersion string
	Providers     []string
	Models        []string
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
	cfg      Config
	mu       sync.Mutex
	sessions map[string]*session
}

// New builds a runtime server. Caller wires it into a *grpc.Server.
func New(cfg Config) *Server {
	return &Server{
		cfg:      cfg,
		sessions: make(map[string]*session),
	}
}

// ── AIControl ──────────────────────────────────────────────────────────────

func (s *Server) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	return &kotgv1.AICapabilities{
		SchemaVersion: s.cfg.SchemaVersion,
		AiVersion:     s.cfg.AIVersion,
		Providers:     s.cfg.Providers,
		Models:        s.cfg.Models,
		SupportsUndo:  false,
		SupportsPlans: false,
	}, nil
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
		s.mu.Unlock()

		prompt := buildPrompt(sess, msg)
		s.mu.Lock()
		sess.turnCount++
		sess.updatedAt = time.Now()
		s.mu.Unlock()

		ch, err := s.cfg.LLM.StreamCompletion(turnCtx, prompt)
		if err != nil {
			cancel()
			if sendErr := stream.Send(s.event(msg.TurnId, &kotgv1.AssistantEvent_Error{
				Error: &kotgv1.ErrorEvent{Code: "llm_error", Message: err.Error()},
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

		var partial bool
		for chunk := range ch {
			if turnCtx.Err() != nil {
				partial = true
				break
			}
			if sendErr := stream.Send(s.event(msg.TurnId, &kotgv1.AssistantEvent_TextDelta{
				TextDelta: &kotgv1.TextDelta{Text: chunk},
			})); sendErr != nil {
				cancel()
				return sendErr
			}
		}
		cancel()
		s.mu.Lock()
		sess.cancel = nil
		s.mu.Unlock()

		finishReason := "stop"
		if partial {
			finishReason = "cancel"
		}
		if sendErr := stream.Send(s.event(msg.TurnId, &kotgv1.AssistantEvent_Done{
			Done: &kotgv1.Done{Partial: partial, FinishReason: finishReason},
		})); sendErr != nil {
			return sendErr
		}
	}
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
	}
	return ev
}

func buildPrompt(sess *session, msg *kotgv1.UserMessage) string {
	if msg.ContextHint == "" {
		return msg.Text
	}
	return msg.Text + "\n\n[context: " + msg.ContextHint + "]"
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
