// Package main is a tiny echo stand-in for kubilitics-ai used by manual
// smoke tests. Listens on :50051 (gRPC: Chat + AIControl) + :8080 (HTTP /status).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	tspb "google.golang.org/protobuf/types/known/timestamppb"
)

type srv struct {
	kotgv1.UnimplementedChatServer
	kotgv1.UnimplementedAIControlServer
}

func (s *srv) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	return &kotgv1.AICapabilities{
		SchemaVersion: "1.0.1",
		AiVersion:     "stub-0.0.1",
		Providers:     []string{"echo"},
		Models:        []string{"echo-1"},
	}, nil
}

func (s *srv) Health(_ context.Context, _ *kotgv1.Empty) (*kotgv1.HealthStatus, error) {
	return &kotgv1.HealthStatus{State: kotgv1.HealthStatus_STATE_OK, Detail: "ready"}, nil
}

func (s *srv) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	return &kotgv1.Session{
		SessionId:      "stub-session",
		Title:          req.Title,
		FocusClusterId: req.FocusClusterId,
		CreatedAt:      tspb.Now(),
		UpdatedAt:      tspb.Now(),
	}, nil
}

func (s *srv) Send(stream kotgv1.Chat_SendServer) error {
	for {
		msg, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		text := "Echo: " + msg.Text
		for _, word := range strings.Fields(text) {
			_ = stream.Send(&kotgv1.AssistantEvent{
				AnchorId: msg.TurnId,
				Event:    &kotgv1.AssistantEvent_TextDelta{TextDelta: &kotgv1.TextDelta{Text: word + " "}},
			})
		}
		_ = stream.Send(&kotgv1.AssistantEvent{
			AnchorId: msg.TurnId,
			Event:    &kotgv1.AssistantEvent_Done{Done: &kotgv1.Done{FinishReason: "stop"}},
		})
	}
}

func (s *srv) CancelTurn(_ context.Context, _ *kotgv1.CancelTurnRequest) (*kotgv1.Empty, error) {
	return &kotgv1.Empty{}, nil
}

func main() {
	grpcAddr := os.Getenv("STUB_GRPC_ADDR")
	if grpcAddr == "" {
		grpcAddr = ":50051"
	}
	httpAddr := os.Getenv("STUB_HTTP_ADDR")
	if httpAddr == "" {
		httpAddr = ":8080"
	}
	grpcLis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatalf("grpc listen %s: %v", grpcAddr, err)
	}
	g := grpc.NewServer()
	s := &srv{}
	kotgv1.RegisterChatServer(g, s)
	kotgv1.RegisterAIControlServer(g, s)
	go func() {
		log.Printf("stub kubilitics-ai gRPC %s", grpcAddr)
		_ = g.Serve(grpcLis)
	}()

	http.HandleFunc("/status", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"state": "ready", "version": "stub-0.0.1", "engines": []string{"llm"},
		})
	})
	log.Printf("stub kubilitics-ai HTTP %s", httpAddr)
	log.Fatal(http.ListenAndServe(httpAddr, nil))
}
