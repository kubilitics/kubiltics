// Package proxy fronts kubilitics-ai with a single chokepoint that
// enforces cluster_id presence, injects identity metadata, applies
// per-user rate limiting, and emits structured logs and prometheus
// metrics. It speaks kotg-schema (Chat + AIControl) over the wire via
// internal/ai/aiclient.
package proxy

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/aiclient"
	"github.com/kubilitics/kubilitics-backend/internal/ai/types"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type ctxKey int

const (
	ctxUserID ctxKey = iota
	ctxRequestID
)

// WithUser attaches the calling user's ID to ctx for rate limiting and
// metadata injection.
func WithUser(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, ctxUserID, userID)
}

// WithRequestID attaches a per-request correlation ID to ctx.
func WithRequestID(ctx context.Context, reqID string) context.Context {
	return context.WithValue(ctx, ctxRequestID, reqID)
}

func userID(ctx context.Context) string {
	v, _ := ctx.Value(ctxUserID).(string)
	return v
}

func requestID(ctx context.Context) string {
	v, _ := ctx.Value(ctxRequestID).(string)
	return v
}

// Proxy is the single chokepoint between handlers and kubilitics-ai.
type Proxy struct {
	grpc *aiclient.GRPCClient
	http *aiclient.HTTPClient
	rl   *rateLimiter
}

// New constructs a Proxy. rateLimitPerUserPerMin is the per-user budget;
// the rateLimiter sets burst equal to this value.
func New(grpc *aiclient.GRPCClient, http *aiclient.HTTPClient, rateLimitPerUserPerMin int) *Proxy {
	return &Proxy{grpc: grpc, http: http, rl: newRateLimiter(rateLimitPerUserPerMin)}
}

func (p *Proxy) ensureCluster(clusterID string) error {
	if clusterID == "" {
		return types.ErrMissingCluster
	}
	return nil
}

func (p *Proxy) attachMeta(ctx context.Context, clusterID string) context.Context {
	return metadata.AppendToOutgoingContext(ctx,
		"kotg-cluster-id", clusterID,
		"kotg-user-id", userID(ctx),
		"kotg-request-id", requestID(ctx),
	)
}

// Capabilities returns the AI runtime capabilities snapshot.
func (p *Proxy) Capabilities(ctx context.Context, clusterID string) (*kotgv1.AICapabilities, error) {
	if err := p.ensureCluster(clusterID); err != nil {
		proxyErrors.WithLabelValues("capabilities", "missing_cluster").Inc()
		return nil, err
	}
	if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
		rateDropped.WithLabelValues("capabilities").Inc()
		return nil, types.ErrRateLimited
	}
	start := time.Now()
	caps, err := p.grpc.Capabilities(p.attachMeta(ctx, clusterID))
	proxyDuration.WithLabelValues("capabilities", statusLabel(err)).Observe(time.Since(start).Seconds())
	if err != nil {
		proxyErrors.WithLabelValues("capabilities", statusLabel(err)).Inc()
	}
	return caps, err
}

// GetMCPEndpoint forwards a GET to the brain's HTTP server at the given path
// and returns the decoded JSON payload.  Used by the backend MCP status proxy.
func (p *Proxy) GetMCPEndpoint(ctx context.Context, path string) (map[string]interface{}, error) {
	start := time.Now()
	data, err := p.http.GetMCPEndpoint(ctx, path)
	proxyDuration.WithLabelValues("mcp_endpoint", statusLabel(err)).Observe(time.Since(start).Seconds())
	if err != nil {
		proxyErrors.WithLabelValues("mcp_endpoint", statusLabel(err)).Inc()
	}
	return data, err
}

// Status returns the AI runtime status via the HTTP control-plane endpoint.
func (p *Proxy) Status(ctx context.Context) (*aiclient.Status, error) {
	start := time.Now()
	st, err := p.http.GetStatus(ctx)
	proxyDuration.WithLabelValues("status", statusLabel(err)).Observe(time.Since(start).Seconds())
	if err != nil {
		proxyErrors.WithLabelValues("status", statusLabel(err)).Inc()
	}
	return st, err
}

// CreateSession asks kubilitics-ai to allocate a new chat session.
func (p *Proxy) CreateSession(ctx context.Context, clusterID, title string) (*kotgv1.Session, error) {
	if err := p.ensureCluster(clusterID); err != nil {
		proxyErrors.WithLabelValues("create_session", "missing_cluster").Inc()
		return nil, err
	}
	if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
		rateDropped.WithLabelValues("create_session").Inc()
		return nil, types.ErrRateLimited
	}
	start := time.Now()
	sess, err := p.grpc.CreateSession(p.attachMeta(ctx, clusterID), &kotgv1.CreateSessionRequest{
		FocusClusterId: clusterID,
		Title:          title,
	})
	proxyDuration.WithLabelValues("create_session", statusLabel(err)).Observe(time.Since(start).Seconds())
	if err != nil {
		proxyErrors.WithLabelValues("create_session", statusLabel(err)).Inc()
	}
	return sess, err
}

// Send opens a bidirectional chat stream to kubilitics-ai. The caller drives
// stream.Send / stream.Recv and is responsible for half-closing via CloseSend.
func (p *Proxy) Send(ctx context.Context, clusterID string) (kotgv1.Chat_SendClient, error) {
	if err := p.ensureCluster(clusterID); err != nil {
		proxyErrors.WithLabelValues("chat", "missing_cluster").Inc()
		return nil, err
	}
	if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
		rateDropped.WithLabelValues("chat").Inc()
		return nil, types.ErrRateLimited
	}
	cctx := p.attachMeta(ctx, clusterID)
	stream, err := p.grpc.Send(cctx)
	if err != nil {
		proxyErrors.WithLabelValues("chat", statusLabel(err)).Inc()
		return nil, err
	}
	return stream, nil
}

// CancelTurn aborts an in-flight turn server-side.
func (p *Proxy) CancelTurn(ctx context.Context, clusterID, sessionID, turnID string) error {
	if err := p.ensureCluster(clusterID); err != nil {
		proxyErrors.WithLabelValues("cancel_turn", "missing_cluster").Inc()
		return err
	}
	start := time.Now()
	err := p.grpc.CancelTurn(p.attachMeta(ctx, clusterID), &kotgv1.CancelTurnRequest{
		SessionId: sessionID,
		TurnId:    turnID,
	})
	proxyDuration.WithLabelValues("cancel_turn", statusLabel(err)).Observe(time.Since(start).Seconds())
	if err != nil {
		proxyErrors.WithLabelValues("cancel_turn", statusLabel(err)).Inc()
	}
	return err
}

func statusLabel(err error) string {
	if err == nil {
		return "ok"
	}
	if s, ok := status.FromError(err); ok {
		return s.Code().String()
	}
	return "error"
}
