# Topology API Contract

**Canonical response shape** for `GET /api/v1/clusters/{clusterId}/topology`. The backend MUST emit this shape so the frontend can consume it without mapping. OpenAPI definition: `kubilitics-backend/api/swagger.yaml` (schemas `TopologyGraph`, `TopologyNode`, `TopologyEdge`).

## Response: TopologyGraph

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | string | Schema version for compatibility (e.g. `"1.0"`). |
| `nodes` | array | List of graph nodes (see TopologyNode). |
| `edges` | array | List of graph edges (see TopologyEdge). |
| `metadata` | object | Graph-level metadata (see below). |

### metadata (graph-level)

| Field | Type | Description |
|-------|------|-------------|
| `clusterId` | string | Cluster identifier. |
| `generatedAt` | string (date-time) | When the graph was generated. |
| `layoutSeed` | string | Deterministic seed for consistent layout (same graph ⇒ same positions). |
| `isComplete` | boolean | Whether all relationships were discovered; `false` = partial or validation warnings. |
| `warnings` | array | Optional list of `GraphWarning` (code, message, affectedNodes). |

## TopologyNode

Each node MUST include these fields (frontend uses `kind` and `id`; do not use `type` in place of `kind`).

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier, e.g. `Pod/default/nginx-abc123` or `Node/worker-1`. |
| `kind` | string | Kubernetes resource kind (e.g. `Pod`, `Deployment`, `Service`). |
| `namespace` | string | Resource namespace (empty for cluster-scoped). |
| `name` | string | Resource name. |
| `metadata` | object | Labels, annotations, uid, createdAt. |
| `computed` | object | At least `health`; optionally `restartCount`, `replicas` (desired/ready/available). |

Other optional fields: `apiVersion`, `status`, `position` (x, y for layout).

## TopologyEdge

Each edge MUST include these fields (frontend uses `relationshipType`; do not use `type` in place of `relationshipType`).

| Field | Type | Description |
|-------|------|-------------|
| `relationshipType` | string | Canonical relationship, e.g. `owns`, `selects`, `mounts`, `routes`, `schedules`, `contains`. |
| `source` | string | Source node `id`. |
| `target` | string | Target node `id`. |
| `id` | string | Unique edge identifier. |
| `label` | string | Human-readable label. |
| `metadata` | object | derivation, confidence, sourceField. |

## Naming alignment

- **Backend / OpenAPI:** Use `kind` (not `Type`) for node resource type. Use `relationshipType` (not `type`) for edge relationship.
- **Frontend:** Expects `kind` and `relationshipType`; see `kubilitics-frontend/src/types/topology.ts`.

## Sample JSON

A minimal valid response is provided in the OpenAPI spec as the `example` for `GET /clusters/{id}/topology` (200). It matches the frontend types in `TopologyNode`, `TopologyEdge`, and `TopologyGraph`.

## Verification

- OpenAPI schemas in `kubilitics-backend/api/swagger.yaml`: `TopologyGraph`, `TopologyNode`, `TopologyEdge`.
- Frontend types: `kubilitics-frontend/src/types/topology.ts`.
