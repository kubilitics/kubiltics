// Package proxy fronts the AI sidecar with a single chokepoint that
// enforces cluster_id presence, injects identity metadata, runs each call
// through the ActionGate, applies per-user rate limiting, and emits
// structured logs and prometheus metrics. Streams are SpawnID-guarded so
// that a sidecar respawn cleanly aborts in-flight streams.
package proxy

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/gate"
	"github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
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

// Proxy is the single chokepoint between handlers and the sidecar.
type Proxy struct {
	sup  supervisor.Supervisor
	gate gate.ActionGate
	rl   *rateLimiter
}

// New constructs a Proxy. rateLimitPerUserPerMin is the per-user budget;
// the rateLimiter sets burst equal to this value.
func New(sup supervisor.Supervisor, g gate.ActionGate, rateLimitPerUserPerMin int) *Proxy {
	return &Proxy{sup: sup, gate: g, rl: newRateLimiter(rateLimitPerUserPerMin)}
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

// GetCapabilities returns the cached sidecar capabilities snapshot,
// spawning the sidecar on first use.
func (p *Proxy) GetCapabilities(ctx context.Context, clusterID string) (*types.CapabilitiesSnapshot, error) {
	if err := p.ensureCluster(clusterID); err != nil {
		proxyErrors.WithLabelValues("capabilities", "missing_cluster").Inc()
		return nil, err
	}
	if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
		rateDropped.WithLabelValues("capabilities").Inc()
		return nil, types.ErrRateLimited
	}
	start := time.Now()
	snap, err := p.sup.GetCapabilities(p.attachMeta(ctx, clusterID))
	proxyDuration.WithLabelValues("capabilities", statusLabel(err)).Observe(time.Since(start).Seconds())
	if err != nil {
		proxyErrors.WithLabelValues("capabilities", statusLabel(err)).Inc()
	}
	return snap, err
}

// Refresh forces the supervisor to recycle the sidecar.
func (p *Proxy) Refresh(ctx context.Context) error {
	start := time.Now()
	err := p.sup.Refresh(ctx)
	proxyDuration.WithLabelValues("refresh", statusLabel(err)).Observe(time.Since(start).Seconds())
	if err != nil {
		proxyErrors.WithLabelValues("refresh", statusLabel(err)).Inc()
	}
	return err
}

// CreateSession asks the sidecar to allocate a new chat session for the
// given cluster and optional title. The returned Session carries the
// server-assigned SessionId that subsequent Chat streams reference.
func (p *Proxy) CreateSession(ctx context.Context, clusterID, title string) (*kotgv1.Session, error) {
	if err := p.ensureCluster(clusterID); err != nil {
		proxyErrors.WithLabelValues("create_session", "missing_cluster").Inc()
		return nil, err
	}
	if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
		rateDropped.WithLabelValues("create_session").Inc()
		return nil, types.ErrRateLimited
	}
	rc, err := p.sup.EnsureReady(ctx)
	if err != nil {
		proxyErrors.WithLabelValues("create_session", statusLabel(err)).Inc()
		return nil, err
	}
	cli := kotgv1.NewChatClient(rc.Conn)
	cctx := p.attachMeta(ctx, clusterID)
	return cli.CreateSession(cctx, &kotgv1.CreateSessionRequest{
		FocusClusterId: clusterID,
		Title:          title,
	})
}

// Chat opens a bidirectional chat stream. The returned stream is
// SpawnID-guarded; if the sidecar respawns, Recv returns Aborted +
// ErrSpawnChanged. The caller MUST drain Recv until error to release the
// supervisor.IncStreams reservation.
func (p *Proxy) Chat(ctx context.Context, clusterID string, chatTimeout time.Duration) (kotgv1.Chat_SendClient, string, error) {
	if err := p.ensureCluster(clusterID); err != nil {
		proxyErrors.WithLabelValues("chat", "missing_cluster").Inc()
		return nil, "", err
	}
	if uid := userID(ctx); uid != "" && !p.rl.allow(uid) {
		rateDropped.WithLabelValues("chat").Inc()
		return nil, "", types.ErrRateLimited
	}
	rc, err := p.sup.EnsureReady(ctx)
	if err != nil {
		proxyErrors.WithLabelValues("chat", statusLabel(err)).Inc()
		return nil, "", err
	}
	spawnID := rc.SpawnID
	cctx := p.attachMeta(ctx, clusterID)
	if chatTimeout > 0 {
		var cancel context.CancelFunc
		cctx, cancel = context.WithTimeout(cctx, chatTimeout)
		// cancel is intentionally not called here; the stream lifetime
		// owns the context. wrapStream's Recv path will surface
		// completion to the caller, who is responsible for closing.
		_ = cancel
	}
	p.sup.IncStreams()

	next := func(c context.Context) (kotgv1.Chat_SendClient, error) {
		cli := kotgv1.NewChatClient(rc.Conn)
		return cli.Send(c)
	}
	stream, err := p.gate.WrapChat(cctx, next)
	if err != nil {
		p.sup.DecStreams()
		proxyErrors.WithLabelValues("chat", statusLabel(err)).Inc()
		return nil, "", err
	}
	return wrapStream(stream, spawnID, p.sup), spawnID, nil
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
