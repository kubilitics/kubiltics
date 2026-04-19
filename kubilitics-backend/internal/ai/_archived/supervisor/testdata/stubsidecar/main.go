// Package main is a test-only stub of kotg-ai-server. It performs the
// supervisor handshake (cert blob from stdin, bind :0, print READY <port>)
// and answers grpc-health + AIControl.Capabilities. Invoked by the
// supervisor integration tests via exec; not shipped in production.
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net"
	"os"

	"github.com/kubilitics/kubilitics-backend/internal/ai/certs"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

type aiControl struct {
	kotgv1.UnimplementedAIControlServer
}

type chatSrv struct {
	kotgv1.UnimplementedChatServer
}

// CreateSession returns a deterministic Session sufficient for the
// handlers to assert SessionId is set. Title echoes the request.
func (c *chatSrv) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	return &kotgv1.Session{
		SessionId:      "stub-session-1",
		Title:          req.GetTitle(),
		FocusClusterId: req.GetFocusClusterId(),
	}, nil
}

// Capabilities returns a fixed AICapabilities payload sufficient for tests
// to assert non-nil fields.
func (a *aiControl) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	return &kotgv1.AICapabilities{
		SchemaVersion: "1.0.0",
		AiVersion:     "0.0.0-stub",
		Providers:     []string{"stub"},
		Models:        []string{"stub-model"},
		SupportsUndo:  true,
		SupportsPlans: true,
	}, nil
}

func main() {
	bundle, err := certs.ReadStdinBlob(os.Stdin)
	if err != nil {
		log.Fatalf("read certs: %v", err)
	}
	serverCert, err := tls.X509KeyPair(bundle.ServerCertPEM, bundle.ServerKeyPEM)
	if err != nil {
		log.Fatalf("server keypair: %v", err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(bundle.CAPEM) {
		log.Fatalf("ca pool")
	}
	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientCAs:    caPool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS13,
	}

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	port := lis.Addr().(*net.TCPAddr).Port

	srv := grpc.NewServer(grpc.Creds(credentials.NewTLS(tlsCfg)))
	h := health.NewServer()
	h.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	healthpb.RegisterHealthServer(srv, h)
	kotgv1.RegisterAIControlServer(srv, &aiControl{})
	kotgv1.RegisterChatServer(srv, &chatSrv{})

	fmt.Fprintf(os.Stdout, "READY %d\n", port)
	if err := srv.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
