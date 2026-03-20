# Topology V2 API

## Overview

The topology v2 API provides a structured graph of Kubernetes resources and their relationships, suitable for the React Flow–based topology UI.

## Endpoint

```
GET /api/v1/clusters/{clusterId}/topology/v2
```

### Query parameters

| Parameter       | Type   | Description                          |
|----------------|--------|--------------------------------------|
| `mode`         | string | `cluster`, `namespace`, `workload`, `resource`, `rbac` (default: `namespace`) |
| `namespace`    | string | Filter namespaced resources to this namespace (optional) |
| `resource`     | string | Focus resource ID for resource-centric mode |
| `depth`       | int    | Hop depth for resource-centric view  |

### Response (TopologyResponse)

- **metadata**: `clusterId`, `clusterName`, `mode`, `resourceCount`, `edgeCount`, `buildTimeMs`
- **nodes**: Array of nodes (id, kind, name, namespace, category, status, layer, group, …)
- **edges**: Array of edges (id, source, target, relationshipType, label, …)
- **groups**: Array of groups (id, label, type, members, style)

When no cluster client is available, the API returns mock data (5 nodes, 4 edges, 1 group).

## Enabling V2 in the frontend

Set in `.env` or environment:

```
VITE_FEATURE_TOPOLOGY_V2=true
```

With this flag, the Topology page uses the v2 React Flow renderer and the v2 API above. Default is `false` (v1 topology) until v2 is promoted as default after E2E and visual regression coverage.

## Backend benchmarks

Run relationship and graph builder benchmarks:

```bash
go test -bench=. ./internal/topology/v2/... ./internal/topology/v2/builder/...
```
