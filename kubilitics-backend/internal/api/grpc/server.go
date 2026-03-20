package grpc

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	v1 "github.com/kubilitics/kubilitics-backend/api/grpc/v1"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// Server represents the gRPC server
type Server struct {
	server           *grpc.Server
	healthServer     *health.Server
	clusterService   service.ClusterService
	topologyService  service.TopologyService
	metricsService   service.MetricsService
	port             int
	log              *slog.Logger
}

// NewServer creates a new gRPC server instance
func NewServer(cfg *config.Config, clusterService service.ClusterService, topologyService service.TopologyService, metricsService service.MetricsService, log *slog.Logger) *Server {
	opts := []grpc.ServerOption{
		grpc.MaxRecvMsgSize(10 * 1024 * 1024), // 10MB max message size
		grpc.MaxSendMsgSize(10 * 1024 * 1024),
		grpc.ConnectionTimeout(30 * time.Second),
	}

	// FIX P2-003: Wire TLS support for gRPC when configured.
	if cfg.GRPCTLSEnabled {
		if cfg.TLSCertPath == "" || cfg.TLSKeyPath == "" {
			log.Error("gRPC TLS enabled but cert/key paths are empty — falling back to insecure")
		} else {
			creds, err := credentials.NewServerTLSFromFile(cfg.TLSCertPath, cfg.TLSKeyPath)
			if err != nil {
				log.Error("Failed to load gRPC TLS credentials, falling back to insecure", "error", err)
			} else {
				opts = append(opts, grpc.Creds(creds))
				log.Info("gRPC TLS enabled", "cert", cfg.TLSCertPath)
			}
		}
	}

	s := grpc.NewServer(opts...)
	healthServer := health.NewServer()

	// Register health service
	grpc_health_v1.RegisterHealthServer(s, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Enable reflection for development/testing
	reflection.Register(s)

	// Register ClusterDataService
	clusterDataSvc := newClusterDataService(clusterService, topologyService, metricsService, log)
	v1.RegisterClusterDataServiceServer(s, clusterDataSvc)
	log.Info("ClusterDataService registered")

	return &Server{
		server:           s,
		healthServer:     healthServer,
		clusterService:   clusterService,
		topologyService:  topologyService,
		metricsService:   metricsService,
		port:             cfg.GRPCPort,
		log:              log,
	}
}

// Start starts the gRPC server
func (s *Server) Start(ctx context.Context) error {
	addr := fmt.Sprintf("0.0.0.0:%d", s.port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}

	s.log.Info("gRPC server starting", "address", addr, "port", s.port)

	go func() {
		if err := s.server.Serve(listener); err != nil {
			s.log.Error("gRPC server failed", "error", err)
		}
	}()

	return nil
}

// Stop gracefully stops the gRPC server
func (s *Server) Stop() {
	s.log.Info("Stopping gRPC server")
	s.healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_NOT_SERVING)

	// Graceful stop with timeout
	stopped := make(chan struct{})
	go func() {
		s.server.GracefulStop()
		close(stopped)
	}()

	select {
	case <-stopped:
		s.log.Info("gRPC server stopped gracefully")
	case <-time.After(5 * time.Second):
		s.log.Warn("gRPC server forced to stop after timeout")
		s.server.Stop()
	}
}
