// Package gate defines the ActionGate interface that the proxy chain calls
// before forwarding to the sidecar. v1 ships only NoOpGate; subproject 3
// (Action Gateway) plugs in approval/audit/RBAC enforcement without
// touching the proxy.
//
// Note on type names: the kotg-schema generated code does not use the
// names assumed in early planning docs. Actuals (verified against
// github.com/vellankikoti/kotg-schema v1.0.1):
//
//   - Chat is a bidirectional stream RPC named Send. The stream alias is
//     kotgv1.Chat_SendClient (= grpc.BidiStreamingClient[UserMessage,
//     AssistantEvent]). Send takes no request message; the caller streams
//     UserMessage frames after the stream is open.
//   - Cluster mutating RPCs live on the ClusterAction service. The unary
//     request type is kotgv1.ActionRequest and the response is
//     *kotgv1.ActionResult (used by Apply, Delete, Scale, Undo, etc.).
package gate

import (
	"context"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// ChatNext is the proxy-supplied function that, when invoked, opens the
// real bidirectional Send stream against the sidecar. It takes no request
// message because Chat.Send is bidi-streaming — the caller pumps
// UserMessage frames after the stream is established.
type ChatNext func(ctx context.Context) (kotgv1.Chat_SendClient, error)

// ActionNext is the unary equivalent for ClusterAction mutating RPCs
// (Apply / Delete / Scale / Undo / ApproveAction / Propose-then-execute).
type ActionNext func(ctx context.Context, req *kotgv1.ActionRequest) (*kotgv1.ActionResult, error)

// ActionGate wraps the proxy's call to the sidecar, allowing approval,
// audit, and RBAC enforcement to be inserted without modifying the proxy.
type ActionGate interface {
	WrapChat(ctx context.Context, next ChatNext) (kotgv1.Chat_SendClient, error)
	WrapAction(ctx context.Context, req *kotgv1.ActionRequest, next ActionNext) (*kotgv1.ActionResult, error)
}

// NoOpGate forwards to next without modification. v1 default; subproject 3
// replaces it with the Action Gateway implementation.
type NoOpGate struct{}

// WrapChat forwards directly to next.
func (NoOpGate) WrapChat(ctx context.Context, next ChatNext) (kotgv1.Chat_SendClient, error) {
	return next(ctx)
}

// WrapAction forwards directly to next.
func (NoOpGate) WrapAction(ctx context.Context, req *kotgv1.ActionRequest, next ActionNext) (*kotgv1.ActionResult, error) {
	return next(ctx, req)
}
