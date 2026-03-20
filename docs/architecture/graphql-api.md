# GraphQL API Architecture

**Status:** Proposed (not yet implemented)
**Audience:** Backend engineers, frontend engineers
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Schema Design](#2-schema-design)
3. [Resolver Architecture](#3-resolver-architecture)
4. [Performance Considerations vs REST](#4-performance-considerations-vs-rest)
5. [Subscription Model for Real-Time Data](#5-subscription-model-for-real-time-data)
6. [Implementation Plan](#6-implementation-plan)
7. [Decision: GraphQL vs REST](#7-decision-graphql-vs-rest)

---

## 1. Motivation

The current REST API serves topology data as a monolithic response from `GET /api/v1/clusters/{clusterId}/topology?namespace=default`. The frontend receives the full graph (nodes + edges + metadata) and must parse the entire response even when only a subset is needed (e.g., showing a single deployment's dependency tree).

GraphQL would allow the frontend to:
- Request only the fields needed for the current view
- Fetch nested relationships in a single query (e.g., Deployment -> ReplicaSet -> Pods -> Events)
- Subscribe to real-time topology changes via GraphQL subscriptions
- Reduce over-fetching for the topology detail panel

### Current REST Pain Points

| Issue | Impact |
|---|---|
| Full topology response for every view | Wasted bandwidth on large clusters (5000+ nodes) |
| Multiple round trips for detail views | Deployment detail requires: topology + pods + events + metrics |
| No partial graph queries | Cannot request "show me this Service and 2 hops outward" |
| WebSocket is separate from query layer | Two connection models for the frontend to manage |

---

## 2. Schema Design

### Core Types

```graphql
type Query {
  """Fetch a single cluster by ID."""
  cluster(id: ID!): Cluster

  """List all registered clusters."""
  clusters(status: ClusterStatus): [Cluster!]!

  """Fetch the topology graph for a cluster."""
  topology(
    clusterId: ID!
    namespace: String
    rootKind: String
    rootName: String
    depth: Int = 3
  ): TopologyGraph!

  """Fetch a single Kubernetes resource."""
  resource(
    clusterId: ID!
    kind: String!
    namespace: String
    name: String!
  ): KubernetesResource

  """Search resources across all clusters."""
  searchResources(
    query: String!
    kinds: [String!]
    namespaces: [String!]
    limit: Int = 50
  ): [KubernetesResource!]!
}

type Mutation {
  """Register a new cluster."""
  registerCluster(input: RegisterClusterInput!): Cluster!

  """Remove a cluster."""
  removeCluster(id: ID!): Boolean!

  """Scale a workload."""
  scaleWorkload(
    clusterId: ID!
    kind: String!
    namespace: String!
    name: String!
    replicas: Int!
  ): KubernetesResource!

  """Restart a workload rollout."""
  restartRollout(
    clusterId: ID!
    kind: String!
    namespace: String!
    name: String!
  ): KubernetesResource!
}

type Subscription {
  """Subscribe to resource changes in a cluster."""
  resourceChanged(
    clusterId: ID!
    namespace: String
    kinds: [String!]
  ): ResourceEvent!

  """Subscribe to topology changes."""
  topologyChanged(
    clusterId: ID!
    namespace: String
  ): TopologyDelta!

  """Subscribe to Kubernetes events."""
  kubernetesEvent(
    clusterId: ID!
    namespace: String
  ): KubernetesEvent!
}
```

### Topology Types

```graphql
type TopologyGraph {
  schemaVersion: String!
  nodes: [TopologyNode!]!
  edges: [TopologyEdge!]!
  metadata: TopologyMetadata!
}

type TopologyNode {
  id: ID!
  kind: String!
  namespace: String
  name: String!
  apiVersion: String
  metadata: ResourceMetadata!
  computed: ComputedFields!
  """Edges originating from this node."""
  outEdges: [TopologyEdge!]!
  """Edges terminating at this node."""
  inEdges: [TopologyEdge!]!
  """Direct children via OwnerReference."""
  children: [TopologyNode!]!
  """Parent via OwnerReference."""
  owner: TopologyNode
  """Related resources (N-hop traversal)."""
  related(depth: Int = 1, relationshipTypes: [String!]): [TopologyNode!]!
}

type TopologyEdge {
  id: ID!
  source: TopologyNode!
  target: TopologyNode!
  relationshipType: String!
  label: String
  metadata: EdgeMetadata!
}

type TopologyMetadata {
  clusterId: ID!
  generatedAt: DateTime!
  layoutSeed: String!
  isComplete: Boolean!
  nodeCount: Int!
  edgeCount: Int!
  warnings: [GraphWarning!]
}

type TopologyDelta {
  type: DeltaType!
  node: TopologyNode
  edge: TopologyEdge
  timestamp: DateTime!
}

enum DeltaType {
  NODE_ADDED
  NODE_UPDATED
  NODE_REMOVED
  EDGE_ADDED
  EDGE_REMOVED
}
```

### Resource Types

```graphql
type KubernetesResource {
  id: ID!
  kind: String!
  apiVersion: String!
  namespace: String
  name: String!
  metadata: ResourceMetadata!
  spec: JSON
  status: JSON
  """Full YAML representation."""
  yaml: String!
  """Events associated with this resource."""
  events(limit: Int = 50): [KubernetesEvent!]!
  """Metrics for this resource (if available)."""
  metrics: ResourceMetrics
  """Related resources in the topology graph."""
  topology(depth: Int = 2): TopologyGraph!
}

type ResourceMetadata {
  uid: String!
  createdAt: DateTime!
  labels: JSON
  annotations: JSON
  ownerReferences: [OwnerReference!]
}

type ResourceMetrics {
  cpu: MetricValue
  memory: MetricValue
  pods: PodMetrics
}

type MetricValue {
  current: Float!
  limit: Float
  request: Float
  unit: String!
}

type Cluster {
  id: ID!
  name: String!
  status: ClusterStatus!
  kubernetesVersion: String
  nodeCount: Int!
  podCount: Int!
  namespaces: [String!]!
  summary: ClusterSummary!
  """Full topology for this cluster."""
  topology(namespace: String): TopologyGraph!
  """List resources by kind."""
  resources(kind: String!, namespace: String, limit: Int = 100): [KubernetesResource!]!
}

enum ClusterStatus {
  CONNECTED
  DISCONNECTED
  ERROR
}
```

---

## 3. Resolver Architecture

### Resolver Tree

```
Query
├── cluster(id)          → ClusterResolver.Cluster()
│   ├── .topology()      → TopologyResolver.ForCluster()
│   ├── .resources()     → ResourceResolver.List()
│   └── .summary         → ClusterResolver.Summary()
├── topology()           → TopologyResolver.Query()
│   ├── .nodes[].related()  → TopologyResolver.Related() (N-hop BFS)
│   ├── .nodes[].children   → TopologyResolver.Children()
│   └── .edges[].source/target → DataLoader batch resolution
└── resource()           → ResourceResolver.Get()
    ├── .events()        → EventResolver.ForResource()
    ├── .metrics()       → MetricsResolver.ForResource()
    └── .topology()      → TopologyResolver.ForResource()
```

### DataLoader Pattern

To avoid N+1 queries, use DataLoader for batch resolution:

```go
// NodeLoader batches topology node lookups by ID.
type NodeLoader struct {
    cache *TopologyCache
}

func (l *NodeLoader) Load(ctx context.Context, keys []string) []*TopologyNode {
    // Single cache lookup for all requested node IDs
    graph := l.cache.Get(clusterIDFromCtx(ctx), namespaceFromCtx(ctx))
    results := make([]*TopologyNode, len(keys))
    for i, key := range keys {
        results[i] = graph.NodeByID(key)
    }
    return results
}
```

### Go Implementation (gqlgen)

The recommended library is `github.com/99designs/gqlgen`, which generates type-safe resolvers from the schema.

```
kubilitics-backend/
├── internal/
│   └── api/
│       ├── rest/           # Existing REST handlers
│       └── graphql/        # New GraphQL layer
│           ├── schema/
│           │   ├── schema.graphqls
│           │   ├── topology.graphqls
│           │   └── cluster.graphqls
│           ├── resolver/
│           │   ├── root.go
│           │   ├── cluster.go
│           │   ├── topology.go
│           │   ├── resource.go
│           │   └── subscription.go
│           ├── dataloader/
│           │   ├── node_loader.go
│           │   └── middleware.go
│           ├── generated.go    # gqlgen output
│           └── handler.go      # HTTP handler setup
```

---

## 4. Performance Considerations vs REST

### Query Complexity

GraphQL exposes a risk of expensive queries:

```graphql
# Dangerous: unlimited depth traversal
{
  topology(clusterId: "abc") {
    nodes {
      related(depth: 99) {  # Could traverse the entire graph
        related(depth: 99) {
          name
        }
      }
    }
  }
}
```

**Mitigations:**

1. **Query depth limiter** -- Reject queries with depth > 10.
2. **Query complexity analyzer** -- Assign cost to each field; reject queries exceeding a budget (e.g., 1000 points).
3. **Max nodes cap** -- Topology resolver respects `KUBILITICS_TOPOLOGY_MAX_NODES` (default 5000).
4. **Timeout** -- Per-query context timeout of 30 seconds.

### Caching

| Strategy | REST (current) | GraphQL (proposed) |
|---|---|---|
| Full response cache | Yes (per cluster/namespace, 30s TTL) | Not practical (varied query shapes) |
| Field-level cache | No | DataLoader per-request dedup |
| Persistent cache | In-memory per-replica | Shared Redis (for multi-replica) |
| CDN-friendly | Yes (GET with query params) | No (POST bodies) |

For GraphQL, use **persisted queries** (APQ) to regain some cacheability:

```
GET /graphql?extensions={"persistedQuery":{"sha256Hash":"abc123"}}
```

### Response Size Comparison

| Scenario | REST | GraphQL (optimized) | Savings |
|---|---|---|---|
| Topology overview (50 nodes, name only) | 45 KB | 3 KB | 93% |
| Topology full (50 nodes, all fields) | 45 KB | 45 KB | 0% |
| Topology full (5000 nodes) | 4.5 MB | 4.5 MB | 0% |
| Deployment detail (1 resource + pods) | 3 requests, 28 KB | 1 request, 12 KB | 57% |
| Dashboard summary (5 clusters) | 5 requests, 8 KB | 1 request, 4 KB | 50% |

### Latency

| Scenario | REST | GraphQL | Notes |
|---|---|---|---|
| Single topology query | 30 ms | 35 ms | +5 ms parse/validate overhead |
| Detail with related data | 3x 30 ms = 90 ms | 40 ms | Single round trip wins |
| Simple health check | 2 ms | 5 ms | GraphQL always slower for trivial queries |

---

## 5. Subscription Model for Real-Time Data

### Current: WebSocket Handlers

```
WS /ws/resources  → Streams all resource updates for a cluster
WS /ws/events     → Streams Kubernetes events
```

### Proposed: GraphQL Subscriptions

```graphql
subscription {
  topologyChanged(clusterId: "abc", namespace: "default") {
    type       # NODE_ADDED, NODE_UPDATED, NODE_REMOVED, etc.
    node {
      id
      kind
      name
      computed { health }
    }
    timestamp
  }
}
```

**Transport:** WebSocket with `graphql-ws` protocol (not the legacy `subscriptions-transport-ws`).

**Advantages over current WebSocket:**
- Client specifies exactly which fields to receive in each event
- Built-in reconnection and keep-alive in the `graphql-ws` spec
- Single connection for all subscription types

**Disadvantage:**
- More complex server implementation
- Higher per-message overhead (JSON envelope)

---

## 6. Implementation Plan

### Phase 1: Read-Only Queries (Low Risk)

1. Add `gqlgen` dependency and generate scaffolding.
2. Implement `cluster`, `clusters`, and `topology` queries by wrapping existing service layer.
3. Add DataLoader for topology nodes.
4. Add query depth and complexity limits.
5. Mount at `POST /graphql` alongside existing REST routes.
6. No REST routes removed; GraphQL is additive.

### Phase 2: Subscriptions

1. Implement `topologyChanged` subscription using existing WebSocket hub.
2. Use `graphql-ws` protocol handler.
3. Frontend can optionally migrate from raw WebSocket to GraphQL subscriptions.
4. Existing `/ws/*` routes remain for backward compatibility.

### Phase 3: Mutations

1. Implement `scaleWorkload`, `restartRollout`, and `registerCluster` mutations.
2. Add mutation authorization using existing RBAC middleware.
3. Frontend can migrate forms from REST to GraphQL.

### Phase 4: REST Deprecation (Optional)

1. Mark REST topology endpoint as deprecated.
2. Provide 6-month deprecation window.
3. Remove REST endpoint only after all clients have migrated.

---

## 7. Decision: GraphQL vs REST

### Recommendation: Keep REST as primary, add GraphQL as optional layer

| Factor | REST | GraphQL | Verdict |
|---|---|---|---|
| Implementation cost | Already done | Significant new code | REST wins |
| Caching | Simple, CDN-friendly | Complex, needs APQ | REST wins |
| Partial data fetching | Not possible | Core strength | GraphQL wins |
| Real-time updates | Custom WebSocket | Subscriptions (typed) | GraphQL wins |
| Tooling (Go) | Mature | gqlgen is solid | Tie |
| Frontend complexity | Multiple fetch calls | Single query | GraphQL wins |
| Debugging | curl-friendly | Requires GraphQL tooling | REST wins |
| API versioning | URL path versioning | Schema evolution | GraphQL wins |

### When to Add GraphQL

Add GraphQL when:
- The frontend topology views are mature and the field selection patterns are clear
- Multi-round-trip REST calls are a measurable performance bottleneck
- The team has bandwidth to maintain two API layers during the transition

Do not add GraphQL just because it is fashionable. The current REST API is adequate for v1.x.
