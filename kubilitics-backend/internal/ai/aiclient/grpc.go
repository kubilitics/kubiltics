// Package aiclient holds the gRPC + HTTP clients kubilitics-backend uses
// to talk to kubilitics-ai (in-cluster, plaintext gRPC; TLS terminated by
// service mesh / network policy).
package aiclient

import (
	"context"
	"fmt"
	"sync"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
)

type GRPCClient struct {
	addr string
	opts ClientOpts

	mu           sync.Mutex
	conn         *grpc.ClientConn
	chat         kotgv1.ChatClient
	control      kotgv1.AIControlClient
	currentState ConnectionState
}

func NewGRPCClient(addr string, opts ClientOpts) *GRPCClient {
	return &GRPCClient{addr: addr, opts: opts, currentState: StateIdle}
}

// NewGRPCClientFromConn wraps an existing *grpc.ClientConn for tests.
func NewGRPCClientFromConn(conn *grpc.ClientConn) *GRPCClient {
	return &GRPCClient{
		opts:         DefaultOpts(),
		conn:         conn,
		chat:         kotgv1.NewChatClient(conn),
		control:      kotgv1.NewAIControlClient(conn),
		currentState: StateOpen,
	}
}

func (c *GRPCClient) State() ConnectionState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.currentState
}

func (c *GRPCClient) ensureOpen(_ context.Context) error {
	c.mu.Lock()
	if c.conn != nil {
		c.mu.Unlock()
		return nil
	}
	c.currentState = StateConnecting
	c.mu.Unlock()

	conn, err := grpc.NewClient(c.addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                c.opts.KeepaliveTime,
			Timeout:             c.opts.KeepaliveTimeout,
			PermitWithoutStream: false,
		}),
	)
	if err != nil {
		c.mu.Lock()
		c.currentState = StateError
		c.mu.Unlock()
		return fmt.Errorf("dial %s: %w", c.addr, err)
	}
	c.mu.Lock()
	c.conn = conn
	c.chat = kotgv1.NewChatClient(conn)
	c.control = kotgv1.NewAIControlClient(conn)
	c.currentState = StateOpen
	c.mu.Unlock()
	return nil
}

func (c *GRPCClient) Capabilities(ctx context.Context) (*kotgv1.AICapabilities, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "aiclient.grpc.Capabilities",
		attribute.String("rpc.system", "grpc"),
	)
	defer span.End()
	if err := c.ensureOpen(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	cctx, cancel := context.WithTimeout(ctx, c.opts.UnaryTimeout)
	defer cancel()
	resp, err := c.control.Capabilities(cctx, &kotgv1.Empty{})
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return resp, err
}

func (c *GRPCClient) Health(ctx context.Context) (*kotgv1.HealthStatus, error) {
	ctx, span := tracing.StartSpan(ctx, "aiclient.grpc.Health")
	defer span.End()
	if err := c.ensureOpen(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	cctx, cancel := context.WithTimeout(ctx, c.opts.UnaryTimeout)
	defer cancel()
	resp, err := c.control.Health(cctx, &kotgv1.Empty{})
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return resp, err
}

func (c *GRPCClient) CreateSession(ctx context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "aiclient.grpc.CreateSession",
		attribute.String("cluster_id", req.GetFocusClusterId()),
	)
	defer span.End()
	if err := c.ensureOpen(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	cctx, cancel := context.WithTimeout(ctx, c.opts.UnaryTimeout)
	defer cancel()
	resp, err := c.chat.CreateSession(cctx, req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return resp, err
}

// Send opens the bidi chat stream. Caller drives Send() / Recv().
func (c *GRPCClient) Send(ctx context.Context) (kotgv1.Chat_SendClient, error) {
	ctx, span := tracing.StartSpan(ctx, "aiclient.grpc.Send")
	defer span.End()
	if err := c.ensureOpen(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	stream, err := c.chat.Send(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return stream, err
}

func (c *GRPCClient) CancelTurn(ctx context.Context, req *kotgv1.CancelTurnRequest) error {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "aiclient.grpc.CancelTurn",
		attribute.String("session_id", req.GetSessionId()),
		attribute.String("turn_id", req.GetTurnId()),
	)
	defer span.End()
	if err := c.ensureOpen(ctx); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return err
	}
	cctx, cancel := context.WithTimeout(ctx, c.opts.UnaryTimeout)
	defer cancel()
	_, err := c.chat.CancelTurn(cctx, req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	return err
}

func (c *GRPCClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil
	}
	err := c.conn.Close()
	c.conn = nil
	c.chat = nil
	c.control = nil
	c.currentState = StateIdle
	return err
}
