# Scale & Security (Phase C)

This document describes multi-cluster limits, K8s API timeouts/retries, and related configuration for the Kubilitics backend.

## Multi-cluster handling (C1.1)

- **Limit:** The backend supports a configurable maximum number of registered clusters (default **100**). This avoids unbounded resource use and K8s API load on startup.
- **Configuration:** Set `max_clusters` in config or `KUBILITICS_MAX_CLUSTERS` (e.g. `100`). Value `0` means use the default (100).
- **Behavior:**
  - `GET /api/v1/clusters` returns all clusters with per-cluster **status**: `connected`, `disconnected`, or `error`.
  - Adding a cluster when at the limit returns `400` with a message like `cluster limit reached (max N)`.
  - **Unhealthy clusters do not kill the process:** Connection failures or K8s errors when loading or listing clusters only update that cluster’s status; the server continues serving other clusters.
- **Status semantics:**
  - `connected` — K8s client is live and cluster info was fetched successfully.
  - `disconnected` — No client in memory, or context cancelled/deadline exceeded (transient).
  - `error` — K8s API error (e.g. 403, 5xx) or client creation failure.

## K8s API: timeouts and retries (C1.2)

- **Timeouts:** Outbound calls to the Kubernetes API use a bounded context. Default timeout is **15 seconds** (config: `k8s_timeout_sec` or `KUBILITICS_K8S_TIMEOUT_SEC`). This applies to list/get/delete, cluster info, and connection test. Implemented in `internal/k8s` (client timeout applied per call).
- **Retries:** Transient server errors (5xx) and rate limiting (429) are retried with exponential backoff: **3 attempts**, backoff 100ms → 300ms → 900ms (capped at 2s). Non-retryable errors (4xx except 429) are returned immediately. Implemented in `internal/k8s/retry.go` (`doWithRetry` / `doWithRetryValue`).
- **Propagation:** HTTP 403 (Forbidden) and 404 (Not Found) from the K8s API are returned to the client with the same status code so clients can distinguish RBAC and missing-resource cases (see REST handlers in `internal/api/rest/resources.go`).

## Topology cache (C1.3)

- **Implemented.** Topology is cached per `(clusterId, namespace)` with a configurable TTL (default **30s**; config: `topology_cache_ttl_sec` or `KUBILITICS_TOPOLOGY_CACHE_TTL_SEC`). Set to `0` to disable caching.
- **Invalidation:** When a resource event is broadcast via WebSocket with a non-empty `clusterID`, the hub calls the registered topology invalidator: `InvalidateForClusterNamespace(clusterID, namespace)` so that cache entries for that scope are removed. When per-cluster informers are wired, pass `clusterID` and `namespace` into `BroadcastResourceEvent` so that only the affected scope is invalidated.
- **Observability:** Prometheus counters `kubilitics_topology_cache_hits_total` and `kubilitics_topology_cache_misses_total` are incremented on each Get so cache effectiveness can be monitored.

## Topology scope for large clusters (C1.4)

- **Namespace scope:** Supported. Use `GET /api/v1/clusters/{clusterId}/topology?namespace=my-ns` to return only resources in that namespace. This bounds response size for large clusters.
- **Max nodes cap:** Configurable limit per response (config: `topology_max_nodes` or `KUBILITICS_TOPOLOGY_MAX_NODES`; default **5000**). When the graph reaches this many nodes, discovery stops, the response is truncated, `metadata.isComplete` is `false`, and a warning `TOPOLOGY_TRUNCATED` is included. Use `?namespace=` to scope or increase the config to allow larger single-request graphs.
- **Resource Y + N-hop:** Not yet implemented; namespace scope and max-nodes cap address the main large-cluster risk (OOM/timeout). N-hop from a seed resource can be added later.

## Rate limiting outbound K8s calls (C1.5)

- **Implemented.** A token-bucket rate limiter is applied **per cluster** (per K8s client). Config: `k8s_rate_limit_per_sec` (rate in requests/second) and `k8s_rate_limit_burst` (burst size). When both are set (e.g. `50` and `100`), each outbound call (List, Get, Delete, GetClusterInfo, TestConnection, Apply) waits for a token before proceeding. Default is `0` (no limit). Env: `KUBILITICS_K8S_RATE_LIMIT_PER_SEC`, `KUBILITICS_K8S_RATE_LIMIT_BURST`. This reduces the risk of 429 from the kube-apiserver when many users or tabs hit the same cluster.
