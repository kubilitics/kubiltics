package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologycache"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologyexport"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
)

// ErrExportNotImplemented is returned when topology export format is not supported.
var ErrExportNotImplemented = errors.New("topology export not yet implemented")

// Supported export formats for POST /topology/export
const (
	ExportFormatJSON   = "json"
	ExportFormatSVG    = "svg"
	ExportFormatDrawio = "drawio"
	ExportFormatPNG    = "png"
)

// TopologyService generates topology graphs (with optional TTL cache; C1.3).
type TopologyService interface {
	GetTopology(ctx context.Context, clusterID string, filters models.TopologyFilters, maxNodes int, forceRefresh bool) (*models.TopologyGraph, error)
	GetTopologyWithClient(ctx context.Context, client *k8s.Client, clusterID string, filters models.TopologyFilters, maxNodes int, forceRefresh bool) (*models.TopologyGraph, error)
	GetResourceTopology(ctx context.Context, clusterID string, kind, namespace, name string) (*models.TopologyGraph, error)
	GetResourceTopologyWithClient(ctx context.Context, client *k8s.Client, clusterID string, kind, namespace, name string) (*models.TopologyGraph, error)
	ExportTopology(ctx context.Context, clusterID string, format string) ([]byte, error)
	ExportTopologyWithClient(ctx context.Context, client *k8s.Client, clusterID string, format string) ([]byte, error)
}

type topologyService struct {
	clusterService *clusterService
	cache          *topologycache.Cache
}

// NewTopologyService creates a topology service. If cache is nil or has TTL 0, caching is disabled.
func NewTopologyService(cs ClusterService, cache *topologycache.Cache) TopologyService {
	return &topologyService{
		clusterService: cs.(*clusterService),
		cache:          cache,
	}
}

func (s *topologyService) GetTopology(ctx context.Context, clusterID string, filters models.TopologyFilters, maxNodes int, forceRefresh bool) (*models.TopologyGraph, error) {
	// BE-OBS-001: Add tracing span for topology build
	// BE-SCALE-002: Support force_refresh query param to bypass cache
	ctx, span := tracing.StartSpanWithAttributes(ctx, "topology.build",
		attribute.String("topology.cluster_id", clusterID),
		attribute.String("topology.namespace", filters.Namespace),
		attribute.Int("topology.max_nodes", maxNodes),
		attribute.Bool("topology.force_refresh", forceRefresh),
	)
	defer span.End()

	// BE-SCALE-002: Check cache unless force_refresh is true
	if !forceRefresh && s.cache != nil {
		if g, ok := s.cache.Get(clusterID, filters.Namespace); ok {
			span.SetAttributes(attribute.Bool("topology.cache_hit", true))
			return g, nil
		}
		span.SetAttributes(attribute.Bool("topology.cache_hit", false))
	} else if forceRefresh {
		span.SetAttributes(attribute.Bool("topology.cache_hit", false), attribute.Bool("topology.force_refresh", true))
	}

	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	engine := topology.NewEngine(client)
	g, err := engine.BuildGraph(ctx, filters, clusterID, maxNodes)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("failed to build topology: %w", err)
	}

	if g != nil {
		span.SetAttributes(
			attribute.Int("topology.nodes", len(g.Nodes)),
			attribute.Int("topology.edges", len(g.Edges)),
		)
	}

	if s.cache != nil {
		s.cache.Set(clusterID, filters.Namespace, g)
	}
	return g, nil
}

// GetTopologyWithClient builds topology using provided client (Headlamp/Lens model)
func (s *topologyService) GetTopologyWithClient(ctx context.Context, client *k8s.Client, clusterID string, filters models.TopologyFilters, maxNodes int, forceRefresh bool) (*models.TopologyGraph, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "topology.build",
		attribute.String("topology.cluster_id", clusterID),
		attribute.String("topology.namespace", filters.Namespace),
		attribute.Int("topology.max_nodes", maxNodes),
		attribute.Bool("topology.force_refresh", forceRefresh),
	)
	defer span.End()

	if !forceRefresh && s.cache != nil {
		if g, ok := s.cache.Get(clusterID, filters.Namespace); ok {
			span.SetAttributes(attribute.Bool("topology.cache_hit", true))
			return g, nil
		}
		span.SetAttributes(attribute.Bool("topology.cache_hit", false))
	} else if forceRefresh {
		span.SetAttributes(attribute.Bool("topology.cache_hit", false), attribute.Bool("topology.force_refresh", true))
	}

	engine := topology.NewEngine(client)
	g, err := engine.BuildGraph(ctx, filters, clusterID, maxNodes)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("failed to build topology: %w", err)
	}

	if g != nil {
		span.SetAttributes(
			attribute.Int("topology.nodes", len(g.Nodes)),
			attribute.Int("topology.edges", len(g.Edges)),
		)
	}

	if s.cache != nil {
		s.cache.Set(clusterID, filters.Namespace, g)
	}
	return g, nil
}

func (s *topologyService) GetResourceTopology(ctx context.Context, clusterID string, kind, namespace, name string) (*models.TopologyGraph, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	return s.GetResourceTopologyWithClient(ctx, client, clusterID, kind, namespace, name)
}

// GetResourceTopologyWithClient builds resource topology using provided client (Headlamp/Lens model)
func (s *topologyService) GetResourceTopologyWithClient(ctx context.Context, client *k8s.Client, clusterID string, kind, namespace, name string) (*models.TopologyGraph, error) {
	engine := topology.NewEngine(client)
	g, err := engine.BuildResourceSubgraph(ctx, kind, namespace, name)
	if err != nil {
		return nil, fmt.Errorf("failed to build resource topology: %w", err)
	}
	topology := g.ToTopologyGraph(clusterID)
	return &topology, nil
}

func (s *topologyService) ExportTopology(ctx context.Context, clusterID string, format string) ([]byte, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	return s.ExportTopologyWithClient(ctx, client, clusterID, format)
}

// ExportTopologyWithClient exports topology using provided client (Headlamp/Lens model)
func (s *topologyService) ExportTopologyWithClient(ctx context.Context, client *k8s.Client, clusterID string, format string) ([]byte, error) {
	format = strings.TrimSpace(strings.ToLower(format))
	if format == "" {
		format = ExportFormatJSON
	}
	// BE-SCALE-002: Export always uses fresh data (force refresh)
	graph, err := s.GetTopologyWithClient(ctx, client, clusterID, models.TopologyFilters{}, 0, true)
	if err != nil {
		return nil, err
	}
	switch format {
	case ExportFormatJSON:
		return topologyexport.GraphToJSON(graph)
	case ExportFormatSVG:
		return topologyexport.GraphToSVG(graph)
	case ExportFormatDrawio:
		return topologyexport.GraphToDrawioXML(graph)
	case ExportFormatPNG:
		return topologyexport.GraphToPNG(graph)
	default:
		return nil, fmt.Errorf("%w: use format=json|svg|drawio|png", ErrExportNotImplemented)
	}
}
