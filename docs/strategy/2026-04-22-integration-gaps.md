# Brain ↔ Backend Integration Gap Audit — 2026-04-22

- Brain repo: `/tmp/kotg-ai-vk/kubilitics-ai/` (branch `feat/validation-bench`, head `22142af`, 29 commits ahead of main)
- Backend: `/Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend/` — running at `http://localhost:8190` during audit
- Live cluster: `5cb1f37d-e31e-4915-8c4d-bdf36ef335ec` (kind-kubilitics-test)
- All endpoints below were curled live; status codes are real observations.

---

## Section A — Brain → Backend contract table

Every new-tool (iter-2 + iter-3) endpoint the brain calls. `src` column points at the brain source.

| Tool | Backend path (brain pattern) | Method | Expected shape (what brain parses) | src |
|---|---|---|---|---|
| `resolve_resource` | `/api/v1/clusters/{id}/resources/{kindPlural}` | GET | `{items:[{metadata:{name,namespace},...}]}` (all-namespace list when no `namespace=` qs) | handlers_gaps.go:56 |
| `observe_recent_changes` (events leg) | `/api/v1/clusters/{id}/events?limit=500[&namespace=]` | GET | `[{lastTimestamp,firstTimestamp,reason,message,involvedObject:{kind,name,namespace}}]` | handlers_gaps.go:201 |
| `observe_recent_changes` (rollout leg) | `/api/v1/clusters/{id}/resources/deployments[?namespace=]` → then `/resources/deployments/{ns}/{name}/rollout-history` | GET | rollout returns `{revisions\|history\|items:[{timestamp\|revision_time\|creationTimestamp,cause\|change_cause\|message}]}` | handlers_gaps.go:249 |
| `who_can_do` | `/resources/clusterroles`, `/resources/roles`, `/resources/clusterrolebindings`, `/resources/rolebindings` | GET (4 parallel) | `{items:[{metadata:{...}, rules|subjects|roleRef:{...}}]}` | handlers_gaps.go:436-449 |
| `observe_pod_metrics` (single pod) | `/api/v1/clusters/{id}/metrics/{ns}/{pod}` | GET | any JSON (surface-as-is) | handlers_gaps.go:655 |
| `observe_pod_metrics` (summary) | `/api/v1/clusters/{id}/metrics/summary` | GET | `{pods:[{namespace,name,cpu_millicores,memory_mib}],...}` | handlers_gaps.go:667 |
| `observe_node_metrics` (specific) | `/api/v1/clusters/{id}/metrics/nodes/{name}` | GET | any JSON | handlers_gaps.go:687 |
| `observe_node_metrics` (cluster) | `/api/v1/clusters/{id}/metrics` | GET | any JSON | handlers_gaps.go:692 |
| `observe_top_pods_by_metric` | `/api/v1/clusters/{id}/metrics/summary` | GET | `{pods:[{namespace,name,cpu_millicores\|cpu,memory_mib\|memory}]}` | handlers_gaps.go:723 |
| `observe_services_by_filter` | `/resources/services[?namespace=]`, `/events?since=15m[&namespace=]`, `/resources/services/{ns}/{name}/endpoints` | GET | Services list; events with endpoint-churn reasons on involvedObject; Endpoints v1 shape `{subsets[].addresses}` | handlers_gaps.go:837,849,875 |
| `observe_secrets_usage` | `/resources/secrets[?ns=]`, `/resources/pods[?ns=]` | GET | standard list envelopes | handlers_gaps.go:965-968 |
| `observe_ingresses_by_tls_expiry` | `/resources/ingresses[?ns=]`, `/resources/ingresses/{ns}/{name}/tls-info` | GET | tls-info: `{certificates:[{not_after\|expires_at, host, issuer}]}` | handlers_gaps.go:1135 |
| `analyze_log_patterns` (REST fallback) | `/api/v1/clusters/{id}/logs/{ns}/{pod}?tail=N[&container=]` | GET | plaintext body | analysis/tools.go:148 |

---

## Section B — Mismatches found

### B1 — `/metrics/summary` hard-400s the brain (CRITICAL)
- **Symptom**: `observe_pod_metrics` (namespace aggregate) and `observe_top_pods_by_metric` always fall through to `metricsFallback()` even though metrics-server is irrelevant — the 400 is from input validation. Bench scen-pods-33 / scen-pods-42 degraded to "metrics unavailable" LLM answers.
- **Live probe**: `curl /api/v1/clusters/{id}/metrics/summary` → `HTTP 400 {"error":"Missing or invalid clusterId, resource_type, or resource_name"}`.
- **Root cause**: backend `metrics.go:60` rejects the call unless `resource_type` AND `resource_name` query params are both non-empty. Brain intentionally omits them because it wants a cluster-wide digest. The endpoint was rewritten to be per-resource; there is no aggregate mode.
- **Fix estimate**: 2-3 h backend — add an "aggregate path" branch: when `resource_type`/`resource_name` empty, return `{pods:[{namespace,name,cpu_millicores,memory_mib}], nodes:[…]}` using the existing `metricsService`. Alternative (0.5 h brain): swap to `/metrics?namespace=<ns>` per-namespace calls and fan out — but brain is locked.
- **Owns**: backend.

### B2 — Events shape mismatch → `observe_recent_changes` returns 0 rows (CRITICAL)
- **Symptom**: Every `observe_recent_changes` call reports "0 change(s)" regardless of real cluster activity. scen-change-101 effectively blind.
- **Live probe**: `/events?limit=5` returns objects with `first_timestamp`, `last_timestamp`, `reason`, `message`, `resource_kind`, `resource_name`, `namespace`, `event_namespace` — NO `involvedObject`, NO `lastTimestamp` (camelCase).
- **Root cause**: brain `eventTimestamp()` (handlers_gaps.go:324) looks for `lastTimestamp`/`firstTimestamp`/`eventTime`/`timestamp`/`creationTimestamp`; backend emits snake_case (`last_timestamp`). brain `eventInvolvedObject()` (handlers_gaps.go:335) reads `involvedObject.{kind,name,namespace}`; backend emits flat `resource_kind`, `resource_name`, `namespace`.
- **Fix estimate**: 1 h backend (add `involvedObject` convenience field + camelCase timestamp alias) OR 0 h brain if backend exposes a raw-k8s-shape `?raw=1` mode. Backend fix is cleanest because no brain change allowed.
- **Owns**: backend (tactically) — the *right* long-term fix is versioned event schema.
- Also blocks `observe_services_by_filter` `endpoint_churn_events` detection (`countEndpointChurn` reads `involvedObject` kind/namespace).

### B3 — `/metrics` cluster endpoint returns help-message instead of data (MEDIUM)
- **Symptom**: `observe_node_metrics` with no `name` returns `{"node":"", "metrics":{"message":"Use query namespace= …"}}` — LLM has no data to reason with.
- **Live probe**: `HTTP 200 {"message":"Use query namespace= to get namespace metrics, or /clusters/{clusterId}/metrics/{namespace}/{pod} for pod metrics"}`.
- **Root cause**: backend `metrics.go:135` short-circuits with a hint string when `namespace=` is empty. brain expects real metrics data there.
- **Fix estimate**: 1 h backend — return `metricsService.GetNodesSummary()` (already exists as `GetClusterMetrics`'s sibling concept) when namespace empty; or add a `/metrics/nodes` list endpoint.
- **Owns**: backend.

### B4 — Ingress `tls-info` subresource doesn't exist (MEDIUM)
- **Symptom**: `observe_ingresses_by_tls_expiry` always returns `tls_inspection_unavailable: true` — scen-network-86 effectively blind.
- **Live probe**: `/resources/ingresses/{ns}/{name}/tls-info` → `HTTP 404 {"error":"Not found"}`. No route registered in `handler.go`.
- **Root cause**: endpoint was aspirational when brain iter-3 was written; backend only has `tls-info` on *Secrets* (`handler.go:523`), not Ingresses.
- **Fix estimate**: 3-4 h backend — add `GetIngressTLSInfo`: read ingress.spec.tls[].secretName → look up each secret → parse x509 → return `{certificates:[{host, issuer, not_after, expires_at}]}`. Most of the x509 parsing already exists in `tls_info.go` for Secrets.
- **Owns**: backend.

### B5 — Rollout `changeCause` vs `change_cause` (LOW)
- **Symptom**: `observe_recent_changes` rollout rows have empty `summary` (falls through to literal "new revision") — cosmetic but confusing in bench.
- **Live probe**: `/resources/deployments/{ns}/{name}/rollout-history` returns `{revisions:[{changeCause:"", creationTimestamp:..., revision:1}]}`.
- **Root cause**: brain `strOr(rev, "cause", "change_cause", "message")` (handlers_gaps.go:265) does not include camelCase `changeCause`.
- **Fix estimate**: 0.25 h brain — add `"changeCause"` to strOr list. **Brain locked**, so backend must emit snake_case alias OR accept the cosmetic loss.
- **Owns**: backend (1-line alias) or defer.

### B6 — `metrics-summary` expected key `pods` is never populated (follows from B1)
- Once B1 is fixed the backend should shape the aggregate as `{pods:[{namespace,name,cpu_millicores,memory_mib}]}` exactly. `observe_top_pods_by_metric` reads this directly. Any other key names require a second brain patch.

### Clean integrations (work today, confirmed)
- `/resources/{kindPlural}` list (deployments, clusterroles, roles, rolebindings, clusterrolebindings, services, secrets, pods, ingresses) — all return `{items:[...]}` that brain's `extractResourceItems` handles.
- `/resources/deployments/{ns}/{name}/rollout-history` — timestamps parse via `creationTimestamp`.
- `/resources/services/{ns}/{name}/endpoints` — `subsets[].addresses` parse cleanly, "no endpoints" detection works.
- `/logs/{ns}/{pod}?tail=N&container=C` — REST fallback for `analyze_log_patterns` works end-to-end.
- `/metrics/{ns}/{pod}` and `/metrics/nodes/{name}` — return metrics-server data when pod is targeted explicitly.

---

## Section C — What to build in backend (prioritized)

1. **Aggregate metrics summary** — new behavior on `GET /api/v1/clusters/{id}/metrics/summary` when `resource_type` & `resource_name` are empty. Return:
   ```json
   { "pods": [{"namespace":"…","name":"…","cpu_millicores":123,"memory_mib":45.6}],
     "nodes": [{"name":"…","cpu_millicores":…,"memory_mib":…}] }
   ```
   Used by: `observe_pod_metrics` (aggregate), `observe_top_pods_by_metric`.
   Hint: iterate `metricsService.ListPodMetrics(all-namespaces)`; already exists behind `/metrics/{ns}/{pod}`.

2. **Event-shape compatibility layer** — on `GET /events`, add two fields to every item:
   ```json
   { "involvedObject": {"kind":"…","name":"…","namespace":"…"},
     "lastTimestamp": "<RFC3339 copy of last_timestamp>" }
   ```
   Used by: `observe_recent_changes`, `observe_services_by_filter`.
   Hint: single `aliasEvent(e)` helper in `events.go` right before `respondJSON`; leave old snake_case fields in place for frontend.

3. **Ingress TLS inspection** — new `GET /api/v1/clusters/{id}/resources/ingresses/{ns}/{name}/tls-info` returning
   ```json
   { "certificates": [{"host":"foo","issuer":"…","not_after":"2026-05-01T…Z"}] }
   ```
   Used by: `observe_ingresses_by_tls_expiry`.
   Hint: read ingress.spec.tls[]; for each entry look up secret via existing `GetSecretTLSInfo` and re-shape. Register route next to line 524 in `handler.go`.

4. **Cluster-wide node metrics** — either change `/metrics` (no query) to return `{nodes:[…]}` instead of the help-message, or add `/metrics/nodes`. Used by: `observe_node_metrics` cluster view.

5. **(Optional, low-risk)** rollout-history: emit `change_cause` alongside `changeCause` in the JSON response.

---

## Section D — Safe low-risk patches (propose-only, NOT applied)

1. **`internal/api/rest/events.go`** — in the GET events response marshaling, copy snake_case timestamps to camelCase + add `involvedObject` object. Rough one-liner per event:
   ```go
   e.InvolvedObject = struct{ Kind, Name, Namespace string }{e.ResourceKind, e.ResourceName, e.Namespace}
   e.LastTimestamp = e.LastTimestampSnake  // alias
   ```
   Unblocks B2 without touching brain.

2. **`internal/api/rest/metrics.go:60`** — loosen validation: if both `resource_type` AND `resource_name` empty, route to a new `GetAggregate` path instead of 400. Actual aggregation is a second commit (item C1) but the 400→200(empty) transition alone makes the brain fallback less noisy.

3. **`internal/api/rest/deployments.go`** (rollout-history serializer) — emit both `changeCause` and `change_cause` (1-line alias). Clears B5.

---

## Section E — Brain bugs revealed

None fatal — every brain call has a coherent "endpoint missing" fallback. The only brain-side nit that would be worth a 1-commit patch (when feat/validation-bench unfreezes) is:

- `handlers_gaps.go:265` — add `"changeCause"` to the `strOr(rev, …)` call to handle camelCase rollout field without needing a backend alias.

Everything else is backend-side.

---

## Summary

Three endpoint families block bench recovery: **metrics aggregate**, **events shape**, **ingress TLS**. Fixing just items C1 and C2 in the backend (≈3-4 h total) should convert ~5 bench scenarios from degraded fallbacks to clean answers. Ingress TLS (C3) unlocks one additional scenario.

Backend was reachable throughout; all status codes above are live observations against kind-kubilitics-test.
