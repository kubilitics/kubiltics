# Topology V2 — Architecture Decision Record

## Status
Accepted — Implementation complete

## Context
Kubilitics needed a production-grade Kubernetes topology visualization engine to replace the prototype Cytoscape.js-based viewer. Requirements: real-time updates, semantic zoom, multi-view modes, 2000+ resource support, Apple-level design quality.

## Decision

### Backend Architecture (Go)
- **Pipeline Pattern**: ResourceBundle → Matchers → Enrichers → ViewFilter → Cache → Response
- **12 Concurrent Relationship Matchers** via `errgroup` with semaphore limiting
- **Resource types**: OwnerRef, Label Selector, Service Selector, Ingress-Service, PV-PVC, ConfigMap Mount, Secret Mount, HPA Target, NetworkPolicy, Service Account, Node Scheduling, PDB Coverage
- **5 View Modes**: Cluster (summary), Namespace (hierarchical), Workload (grouped), Resource-Centric (BFS), RBAC
- **Cache**: TTL-based with cluster-specific invalidation (30s default)
- **Rate Limiting**: Per-cluster (20 builds/min), global semaphore (10 concurrent), circuit breaker (5 failures → 60s cooldown)
- **Feature Flag**: `TOPOLOGY_V2_ENABLED` environment variable with runtime toggle
- **Metrics**: Prometheus-format exposition (build count, duration, cache hits, WS connections, API latency)

### Frontend Architecture (TypeScript/React)
- **React Flow v12** for rendering with custom node/edge types
- **ELK.js** (Eclipse Layout Kernel) for deterministic hierarchical layout (seed=42)
- **Zustand** for centralized state management with localStorage persistence
- **6 Semantic Zoom Levels**: Minimal (<0.3x), Compact (0.3-0.6x), Base (0.6-1.5x), Expanded (>1.5x), Group, Summary
- **WebSocket** real-time updates with 100ms batching and exponential backoff (1s→30s)
- **URL Sync** via react-router searchParams for deep linking
- **Design System**: 8 category color tokens with light/dark mode support
- **Export**: PNG (clipboard), SVG, PDF (jspdf), JSON

### Key Patterns
- All node components wrapped in `React.memo` for render optimization
- ARIA labels on all interactive elements for accessibility
- Keyboard shortcuts for all major actions (PRD Section 8.2)
- Loading skeleton, error states, and empty states for all scenarios
- Health and cost overlays as toggleable layers

## Consequences
- ELK.js layout runs in main thread — may need Web Worker for >5000 nodes
- WebSocket requires server-side informer watches for production K8s clusters
- Circuit breaker state is per-process (not shared across replicas)

## File Structure

```
kubilitics-backend/internal/topology/v2/
├── types.go                    # Core types (ResourceBundle, TopologyNode, TopologyEdge)
├── matcher_*.go               # 12 relationship matchers
├── enricher_health.go         # Health status enrichment
├── enricher_metrics.go        # Metrics enrichment
├── view_filter.go             # 5 view mode filters
├── cache.go                   # TTL cache with invalidation
├── deeplink.go                # Deep link state serialization
├── rate_limiter.go            # Semaphore + circuit breaker
├── feature_flag.go            # Feature flag management
├── metrics.go                 # Prometheus metrics
├── fixture_large.go           # Parameterized test fixtures
├── benchmark_test.go          # Performance benchmarks
├── resilience_test.go         # Partial data resilience tests
└── handler/
    ├── topology_handler.go    # REST API handler
    ├── websocket_handler.go   # WebSocket handler
    ├── export_handler.go      # Multi-format export
    └── openapi.go             # OpenAPI 3.0 spec

kubilitics-frontend/src/topology/
├── TopologyPage.tsx           # Main page with state wiring
├── TopologyCanvas.tsx         # React Flow canvas with ELK layout
├── TopologyToolbar.tsx        # Search, view mode, export controls
├── TopologyDetailPanel.tsx    # Side panel for selected resource
├── TopologyLoadingSkeleton.tsx
├── TopologyErrorState.tsx
├── TopologyEmptyState.tsx
├── nodes/
│   ├── nodeTypes.ts           # Node type registry
│   ├── nodeConfig.ts          # Design tokens (colors, icons)
│   ├── nodeUtils.ts           # Formatting helpers
│   ├── BaseNode.tsx           # Default zoom (0.6-1.5x)
│   ├── CompactNode.tsx        # Medium zoom (0.3-0.6x)
│   ├── MinimalNode.tsx        # Far zoom (<0.3x)
│   ├── ExpandedNode.tsx       # Close zoom (>1.5x)
│   ├── GroupNode.tsx          # Namespace container
│   └── SummaryNode.tsx        # Cluster view summary
├── edges/
│   ├── edgeTypes.ts           # Edge type registry
│   ├── edgeConfig.ts          # Edge style tokens
│   ├── LabeledEdge.tsx        # Default edge with hover
│   └── AnimatedEdge.tsx       # Traffic animation edge
├── hooks/
│   ├── useElkLayout.ts        # ELK.js layout engine
│   ├── useTopologyKeyboard.ts # All keyboard shortcuts
│   ├── useTopologyWebSocket.ts # Real-time WebSocket
│   └── useTopologyNavigation.ts # URL sync
├── overlays/
│   ├── HealthOverlay.tsx      # Health visualization layer
│   └── CostOverlay.tsx        # Cost visualization layer
└── export/
    └── exportPDF.ts           # Client-side PDF generation
```

## Performance Targets
- Layout: <500ms for 500 nodes, <2s for 2000 nodes
- WebSocket latency: <200ms end-to-end
- Semantic zoom transition: <100ms
- Cache hit ratio: >80% in steady state
- Memory: <100MB for 2000-node graph
