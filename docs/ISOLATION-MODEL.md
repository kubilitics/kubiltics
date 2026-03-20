# Data Isolation Model (D1.1)

## Overview

Kubilitics enforces **cluster-scoped isolation**: every API request that operates on cluster data is bound to a single `clusterId`. There is no cross-tenant or cross-cluster data access within a single request.

## Boundaries

### Cluster as boundary

- **Multi-cluster, single instance:** One backend instance can manage multiple clusters. Each cluster is identified by a unique `clusterId` (stored in the repository when the cluster is added).
- **Per-request scope:** All scoped endpoints use the path parameter `clusterId`:
  - `GET/POST/DELETE /api/v1/clusters/{clusterId}/...`
  - Topology, resources, logs, events, metrics, apply, and delete are all scoped to that `clusterId`.
- **Enforcement:** The backend resolves the Kubernetes client only for **registered** clusters. `ClusterService.GetClient(clusterId)` returns a client only if the cluster exists in the repository. There is no way to access another cluster’s data by guessing IDs; unknown `clusterId` returns 404.
- **Namespace as sub-boundary:** Where applicable (e.g. topology `?namespace=`, resources `?namespace=`), data can be further scoped to a single namespace within that cluster.

### Single-tenant deployment

- **One instance = one organization:** When a single backend instance is deployed for one organization (e.g. desktop sidecar or on-premises install), that instance and its repository (SQLite/Postgres) hold only that org’s clusters. No multi-tenancy is implied; isolation is “one org, one DB.”
- **No cross-tenant data:** The API does not expose any tenant ID or allow filtering by tenant; the only scope is cluster (and optionally namespace). For multi-tenant SaaS, deploy separate backend instances per tenant (or use a separate identity/auth layer that restricts which `clusterId` values a user can see).

## API enforcement summary

| Mechanism | Implementation |
|-----------|-----------------|
| Cluster ID from path | All scoped routes use `mux.Vars(r)["clusterId"]`; no cluster ID from body or header for scoping. |
| Client resolution | `ClusterService.GetClient(clusterID)` returns error if cluster not registered → 404. |
| Input validation | Path parameters (`clusterId`, `kind`, `namespace`, `name`) validated for format and length (see SECURE-DEFAULTS.md). Invalid values → 400. |
| No cross-cluster reads | List/get operations use the single `clusterId` from the URL; no batch or cross-cluster queries. |

## Compliance note

For regulated industries, document that: (1) cluster is the isolation boundary, (2) one instance can be deployed per organization for single-tenant, and (3) multi-tenant SaaS requires separate instances or an additional identity layer that restricts cluster access.
