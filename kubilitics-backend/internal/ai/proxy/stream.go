package proxy

import (
	"sync/atomic"

	"github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
	"github.com/kubilitics/kubilitics-backend/internal/ai/types"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// guardedStream wraps a Chat send stream with SpawnID enforcement and a
// once-only DecStreams release. Chat_SendClient is a type alias for
// grpc.BidiStreamingClient[UserMessage, AssistantEvent], which is an
// interface, so we embed it and override Recv only.
type guardedStream struct {
	grpc.BidiStreamingClient[kotgv1.UserMessage, kotgv1.AssistantEvent]
	spawnID string
	sup     supervisor.Supervisor
	closed  atomic.Bool
}

func wrapStream(s kotgv1.Chat_SendClient, spawnID string, sup supervisor.Supervisor) kotgv1.Chat_SendClient {
	return &guardedStream{
		BidiStreamingClient: s,
		spawnID:             spawnID,
		sup:                 sup,
	}
}

func (g *guardedStream) Recv() (*kotgv1.AssistantEvent, error) {
	if g.spawnID != g.sup.CurrentSpawnID() {
		g.closeOnce()
		return nil, status.Error(codes.Aborted, types.ErrSpawnChanged.Error())
	}
	ev, err := g.BidiStreamingClient.Recv()
	if err != nil {
		g.closeOnce()
	}
	return ev, err
}

func (g *guardedStream) closeOnce() {
	if g.closed.CompareAndSwap(false, true) {
		g.sup.DecStreams()
	}
}
