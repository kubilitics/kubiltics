// Package runtime implements the AgentRuntimeService gRPC server (subproject 3a).
//
// This v1 stub delegates Chat to a single LLM provider with no tools, no
// agents, no actions — just streaming TextDelta events. It establishes the
// backend↔AI contract surface so the wider system can be wired before the
// existing engines (MCP, safety, autonomy) are plugged in.
package runtime

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	aiv1 "github.com/vellankikoti/kotg.ai/kubilitics-ai/api/proto/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	Engines       []string
	Providers     []string
	Models        []string
}

// Server implements aiv1.AgentRuntimeServiceServer.
type Server struct {
	aiv1.UnimplementedAgentRuntimeServiceServer
	cfg     Config
	anchors uint64
}

// New constructs a runtime Server.
func New(cfg Config) *Server {
	if cfg.SchemaVersion == "" {
		cfg.SchemaVersion = "1.0.0"
	}
	return &Server{cfg: cfg}
}

func (s *Server) nextAnchor(prefix string) string {
	n := atomic.AddUint64(&s.anchors, 1)
	return fmt.Sprintf("%s-%d", prefix, n)
}

func (s *Server) emit(event *aiv1.AIEvent) *aiv1.AIEvent {
	if event.EmittedAt == nil {
		event.EmittedAt = timestamppb.Now()
	}
	if event.SchemaVersion == "" {
		event.SchemaVersion = s.cfg.SchemaVersion
	}
	return event
}

// Chat handles a bidirectional chat stream. v1 behavior:
//   - First request must be CreateSession; we reply with SessionCreated.
//   - Subsequent UserMessage requests are forwarded to the LLM and streamed
//     back as TextDelta events, terminated by Done.
func (s *Server) Chat(stream aiv1.AgentRuntimeService_ChatServer) error {
	ctx := stream.Context()
	if s.cfg.LLM == nil {
		return status.Error(codes.FailedPrecondition, "no LLM provider configured")
	}

	var sessionID string
	for {
		req, err := stream.Recv()
		if err != nil {
			return err
		}

		switch r := req.Request.(type) {
		case *aiv1.ChatRequest_Create:
			sessionID = s.nextAnchor("sess")
			_ = r // focus_cluster_id, user_id, title currently unused in stub
			if err := stream.Send(s.emit(&aiv1.AIEvent{
				AnchorId: s.nextAnchor("evt"),
				Event: &aiv1.AIEvent_SessionCreated{
					SessionCreated: &aiv1.SessionCreated{SessionId: sessionID},
				},
			})); err != nil {
				return err
			}

		case *aiv1.ChatRequest_Message:
			msg := r.Message
			if msg == nil || msg.Text == "" {
				continue
			}
			if err := s.runTurn(ctx, stream, msg.Text); err != nil {
				return err
			}

		default:
			return status.Error(codes.InvalidArgument, "unknown ChatRequest variant")
		}
	}
}

func (s *Server) runTurn(ctx context.Context, stream aiv1.AgentRuntimeService_ChatServer, prompt string) error {
	start := time.Now()
	tokenCh, err := s.cfg.LLM.StreamCompletion(ctx, prompt)
	if err != nil {
		return stream.Send(s.emit(&aiv1.AIEvent{
			AnchorId: s.nextAnchor("evt"),
			Event: &aiv1.AIEvent_ErrorEvent{
				ErrorEvent: &aiv1.ErrorEvent{Code: "llm_error", Message: err.Error()},
			},
		}))
	}

	var completionTokens int32
	for {
		select {
		case <-ctx.Done():
			return stream.Send(s.emit(&aiv1.AIEvent{
				AnchorId: s.nextAnchor("evt"),
				Event: &aiv1.AIEvent_Done{Done: &aiv1.Done{
					Cancelled:        true,
					Partial:          true,
					CompletionTokens: completionTokens,
					EngineUsed:       "llm-direct",
					TotalLatencyMs:   time.Since(start).Milliseconds(),
				}},
			}))
		case tok, ok := <-tokenCh:
			if !ok {
				return stream.Send(s.emit(&aiv1.AIEvent{
					AnchorId: s.nextAnchor("evt"),
					Event: &aiv1.AIEvent_Done{Done: &aiv1.Done{
						CompletionTokens: completionTokens,
						EngineUsed:       "llm-direct",
						TotalLatencyMs:   time.Since(start).Milliseconds(),
					}},
				}))
			}
			completionTokens++
			if err := stream.Send(s.emit(&aiv1.AIEvent{
				AnchorId: s.nextAnchor("evt"),
				Event: &aiv1.AIEvent_TextDelta{
					TextDelta: &aiv1.TextDelta{Text: tok},
				},
			})); err != nil {
				return err
			}
		}
	}
}

// RunAgent is not implemented in v1 — agents come in subproject 3b.
func (s *Server) RunAgent(stream aiv1.AgentRuntimeService_RunAgentServer) error {
	return status.Error(codes.Unimplemented, "RunAgent not implemented in v1 stub")
}

// CancelTurn is a no-op in v1 (cancellation flows via stream context).
func (s *Server) CancelTurn(ctx context.Context, req *aiv1.CancelRequest) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, nil
}

// Capabilities advertises what this stub supports.
func (s *Server) Capabilities(ctx context.Context, _ *emptypb.Empty) (*aiv1.CapabilitiesResponse, error) {
	return &aiv1.CapabilitiesResponse{
		SchemaVersion:  s.cfg.SchemaVersion,
		AiVersion:      s.cfg.AIVersion,
		Engines:        s.cfg.Engines,
		Providers:      s.cfg.Providers,
		Models:         s.cfg.Models,
		AutonomyLevel:  aiv1.AutonomyLevel_AUTONOMY_OBSERVE,
		SupportsUndo:   false,
		SupportsPlans:  false,
		AllowedActions: nil,
	}, nil
}
