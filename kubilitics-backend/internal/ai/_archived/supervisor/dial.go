package supervisor

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/certs"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func dialMTLS(ctx context.Context, port int, bundle *certs.Bundle) (*grpc.ClientConn, error) {
	clientPair, err := tls.X509KeyPair(bundle.ClientCertPEM, bundle.ClientKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("client keypair: %w", err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(bundle.CAPEM) {
		return nil, fmt.Errorf("ca pool")
	}
	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{clientPair},
		RootCAs:      caPool,
		ServerName:   "localhost",
		MinVersion:   tls.VersionTLS13,
	}
	target := fmt.Sprintf("127.0.0.1:%d", port)
	return grpc.NewClient(target,
		grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)),
	)
}

func checkHealth(ctx context.Context, conn *grpc.ClientConn, timeout time.Duration) error {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cli := healthpb.NewHealthClient(conn)
	resp, err := cli.Check(cctx, &healthpb.HealthCheckRequest{Service: ""})
	if err != nil {
		return fmt.Errorf("health check: %w", err)
	}
	if resp.Status != healthpb.HealthCheckResponse_SERVING {
		return fmt.Errorf("health not SERVING: %v", resp.Status)
	}
	return nil
}

// fetchCapabilities calls AIControl.Capabilities (NOTE: not GetCapabilities; the
// real RPC is named Capabilities and takes kotgv1.Empty).
func fetchCapabilities(ctx context.Context, conn *grpc.ClientConn) (*kotgv1.AICapabilities, error) {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cli := kotgv1.NewAIControlClient(conn)
	return cli.Capabilities(cctx, &kotgv1.Empty{})
}
