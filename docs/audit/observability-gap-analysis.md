# Kubilitics OS — Observability Gap Analysis

**Version:** 1.0
**Date:** 2026-03-16
**Scope:** Metrics, logging, tracing, alerting, and monitoring capabilities assessment

---

## Executive Summary

Kubilitics has **scaffolded observability** (OpenTelemetry tracing, Prometheus metrics endpoint, structured logging) but has not completed the instrumentation pipeline. The platform can display Kubernetes metrics-server data and cluster events but lacks deep observability of its own operations, user-facing SLI dashboards, and integration with enterprise monitoring stacks (Prometheus, Grafana, Datadog, New Relic).

**Observability Maturity Score: 4.5/10** — Foundation laid, execution incomplete.

| Pillar | Score | Status |
|--------|-------|--------|
| Metrics (Platform) | 4/10 | Prometheus endpoint exists; minimal custom metrics |
| Metrics (Kubernetes) | 7/10 | metrics-server integration works; no Prometheus-native path |
| Logging | 5/10 | Structured logging (slog) configured; no log aggregation |
| Tracing | 3/10 | OpenTelemetry scaffolded; not instrumented across handlers |
| Alerting | 2/10 | Event-based alerts in UI; no external alerting integration |
| Dashboarding | 6/10 | Built-in dashboard; no Grafana/external dashboard support |

---

## 1. Current State Assessment

### 1.1 Platform Metrics

**What Exists:**
- Prometheus metrics endpoint at `GET /metrics`
- Go runtime metrics (goroutines, memory, GC) via default Prometheus collector
- HTTP request metrics (likely via middleware, needs verification)

**What's Missing:**

| Metric Category | Examples | Business Value | Priority |
|----------------|----------|----------------|----------|
| **API Latency (p50/p95/p99)** | `kubilitics_http_request_duration_seconds{method, path, status}` | SLI for API health | P0 |
| **Active Connections** | `kubilitics_websocket_connections_active{cluster}` | Capacity planning | P0 |
| **Topology Build Time** | `kubilitics_topology_build_duration_seconds{cluster, node_count}` | Performance regression detection | P0 |
| **K8s API Latency** | `kubilitics_k8s_api_duration_seconds{cluster, resource, verb}` | Identify slow clusters | P1 |
| **Circuit Breaker State** | `kubilitics_circuit_breaker_state{cluster}` | Cluster health visibility | P1 |
| **Add-on Install Duration** | `kubilitics_addon_install_duration_seconds{addon, cluster}` | Lifecycle performance | P1 |
| **Auth Events** | `kubilitics_auth_events_total{type, result}` | Security monitoring | P1 |
| **Rate Limit Rejections** | `kubilitics_rate_limit_rejected_total{endpoint}` | Capacity signals | P2 |
| **Cache Hit Rates** | `kubilitics_cache_hit_ratio{cache_name}` | Performance tuning | P2 |
| **Database Query Latency** | `kubilitics_db_query_duration_seconds{query_type}` | DB performance | P2 |
| **gRPC Latency** | `kubilitics_grpc_duration_seconds{method}` | AI integration health | P2 |

### 1.2 Kubernetes Metrics

**What Exists:**
- `useClusterUtilization` hook fetches per-node CPU/memory from metrics-server API
- Per-workload metrics endpoints for Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Pods
- Node metrics via `getNodeMetrics()` API
- Parsing helpers for CPU (millicores/nanocores) and memory (Ki/Mi/Gi/Ti)

**What's Missing:**

| Metric Source | Current | Gap | Priority |
|--------------|---------|-----|----------|
| **metrics-server** | Supported | Only source; not all clusters have it | - |
| **Prometheus** | Not supported | Most production clusters use Prometheus; Kubilitics can't query it | P0 |
| **Custom Metrics API** | Not supported | HPA custom metrics not visible | P1 |
| **External Metrics API** | Not supported | Cloud provider metrics (CloudWatch, Stackdriver) | P2 |
| **Container-level metrics** | Partial | Pod-level aggregated; no per-container breakdown | P1 |
| **Network metrics** | Not supported | No bandwidth, packet, error rate metrics | P1 |
| **Disk I/O metrics** | Not supported | No storage performance metrics | P2 |
| **Historical metrics** | Not supported | Real-time only; no time-series storage/query | P0 |

### 1.3 Logging

**What Exists (Backend):**
- `slog` structured logging with configurable level (debug/info/warn/error) and format (json/text)
- Request ID middleware injects `X-Request-ID` for correlation
- Audit log table in SQLite (API calls with user, resource, action, timestamp)

**What Exists (Frontend):**
- Console-based logging
- Error boundary catches and displays render errors
- `errorTracker.ts` utility for error tracking

**What's Missing:**

| Logging Gap | Impact | Priority |
|-------------|--------|----------|
| **No log aggregation endpoint** | Operators can't forward backend logs to ELK/Loki/Splunk | P0 |
| **No structured frontend error reporting** | Client-side errors invisible to operators | P1 |
| **No log correlation across services** | Backend → AI engine → K8s requests not traceable | P1 |
| **No pod log streaming enhancements** | Single container, no multi-container follow, no log search/filter in UI | P1 |
| **No audit log export** | Audit data locked in SQLite; can't ship to SIEM | P1 |
| **No log retention management** | Audit log grows unbounded | P2 |
| **No request body logging (configurable)** | Debugging production issues requires body inspection | P2 |

### 1.4 Distributed Tracing

**What Exists:**
- OpenTelemetry initialization in `main.go` (`BE-OBS-001` requirement tag)
- Configuration: `tracing_enabled`, `tracing_endpoint`, `tracing_service_name`, `tracing_sampling_rate`
- OpenTelemetry SDK imported and initialized

**What's Missing:**

| Tracing Gap | Impact | Priority |
|-------------|--------|----------|
| **No span creation in handlers** | API requests not traced end-to-end | P0 |
| **No K8s client instrumentation** | Can't trace latency to specific K8s API calls | P0 |
| **No database span instrumentation** | SQLite/PostgreSQL queries not in traces | P1 |
| **No frontend tracing** | User interactions not correlated to backend spans | P2 |
| **No Helm operation tracing** | Add-on install/upgrade durations not traced | P1 |
| **No gRPC interceptor tracing** | AI engine calls not in trace context | P1 |
| **No trace context propagation** | Backend → AI engine trace context not propagated | P1 |
| **No sampling configuration docs** | Operators don't know how to configure sampling | P2 |

### 1.5 Alerting

**What Exists:**
- `AlertsStrip` component shows Kubernetes warning/critical events in UI
- `RecentEventsWidget` displays event timeline
- Add-on platform has `notification_channels` table (Slack, email)
- Add-on upgrade/failure notifications

**What's Missing:**

| Alerting Gap | Impact | Priority |
|-------------|--------|----------|
| **No platform health alerts** | Backend down, DB full, circuit breaker open — nobody notified | P0 |
| **No Prometheus AlertManager integration** | Can't fire alerts through standard K8s alerting pipeline | P0 |
| **No PagerDuty/OpsGenie/Slack webhook** | On-call engineers not notified | P0 |
| **No alert rules engine** | Users can't define custom alerting conditions | P1 |
| **No alert deduplication** | Same event fires repeatedly | P1 |
| **No alert silencing/acknowledgment** | Can't suppress known issues during maintenance | P2 |
| **No alert history** | No record of past alerts and resolutions | P2 |

---

## 2. Observability Architecture Gap Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    DESIRED OBSERVABILITY STACK                    │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Metrics   │  │ Logging  │  │ Tracing  │  │ Alerting         │ │
│  │ Prometheus│  │ Loki/ELK │  │ Jaeger/  │  │ AlertManager/    │ │
│  │ /Datadog  │  │ /Splunk  │  │ Tempo    │  │ PagerDuty/Slack  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
│       │              │              │                  │           │
│  ┌────┴──────────────┴──────────────┴──────────────────┴─────────┐│
│  │                    KUBILITICS BACKEND                          ││
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐ ││
│  │  │ /metrics│  │ slog     │  │ OTel SDK │  │ Notification  │ ││
│  │  │ [EXISTS]│  │ [EXISTS] │  │ [PARTIAL]│  │ Channels      │ ││
│  │  │ minimal │  │ no ship  │  │ no spans │  │ [ADDON ONLY]  │ ││
│  │  └─────────┘  └──────────┘  └──────────┘  └───────────────┘ ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  LEGEND:  [EXISTS] = scaffolded  [PARTIAL] = incomplete           │
│           [ADDON ONLY] = only for add-on events                   │
│           RED = critical gap                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Comparison with Enterprise Expectations

### 3.1 What Enterprise Kubernetes Tools Provide

| Capability | Lens | Rancher | Datadog K8s | Kubilitics |
|-----------|------|---------|-------------|-----------|
| Built-in metrics dashboard | Y | Y | Y | Y |
| Prometheus query integration | Extension | Y | Y | N |
| Historical metrics (time range) | Extension | Y | Y | N |
| Custom metrics/HPA visibility | N | Y | Y | N |
| Log aggregation | Extension | Y | Y | N |
| Distributed tracing | N | N | Y | Scaffolded |
| Alert rules engine | N | Y | Y | N |
| AlertManager integration | N | Y | N/A | N |
| PagerDuty/Slack alerts | N | Y | Y | Addon-only |
| Grafana dashboard export | N | Y | N | N |
| SLO/SLI tracking | N | N | Y | N |
| Cost attribution | N | N | Y | Placeholder |
| Network metrics | N | Limited | Y | N |

### 3.2 Kubilitics Positioning

Kubilitics is positioned as a **management platform**, not a monitoring platform. However, users expect their management tool to surface the observability data they need for decision-making without switching to another tool.

**Minimum Viable Observability (MVO) for Enterprise:**
1. Query Prometheus for metrics (most clusters have it)
2. Display time-range metrics (not just real-time)
3. Alert on critical cluster events via webhook
4. Export own operational metrics for Grafana/Datadog

---

## 4. Recommendations

### 4.1 P0 — Required for Enterprise GA

**OBS-P0-01: Prometheus Integration**
Add a Prometheus query provider alongside metrics-server. When a Prometheus endpoint is detected (via ServiceMonitor or manual config), use PromQL to fetch richer metrics: container-level CPU/memory, network I/O, request rates, error rates.

**OBS-P0-02: Historical Metrics with Time Range**
Store metrics snapshots in the database (5-minute granularity, 7-day retention by default). Add time-range selector to Dashboard and resource detail pages. This is the single most impactful observability improvement.

**OBS-P0-03: Platform Metrics Instrumentation**
Instrument the top 10 custom metrics listed in Section 1.1 (API latency, WebSocket connections, topology build time, K8s API latency, circuit breaker state). These metrics flow through the existing `/metrics` endpoint.

**OBS-P0-04: Webhook Alert Delivery**
Extend the existing `notification_channels` system beyond add-ons to support cluster event alerts. Allow users to configure rules like "Alert on Warning events in production namespace" → Slack/PagerDuty webhook.

### 4.2 P1 — Required for Public Launch

**OBS-P1-01: OpenTelemetry Span Instrumentation**
Create spans for: HTTP handler entry/exit, K8s API calls, database queries, Helm operations, gRPC calls. Propagate trace context to kubilitics-ai service.

**OBS-P1-02: Structured Log Shipping**
Support log output to stdout (for container log collection) and optional direct shipping to Loki/Elasticsearch via configurable sink.

**OBS-P1-03: Audit Log Export**
Add `GET /api/v1/audit-log/export` endpoint with CSV/JSON format, date range filtering, and streaming for large datasets.

**OBS-P1-04: Container-Level Metrics**
Break pod metrics into per-container metrics to support multi-container pod debugging (init containers, sidecars).

### 4.3 P2 — Enterprise Maturity

**OBS-P2-01: Grafana Dashboard Templates**
Publish pre-built Grafana dashboards for Kubilitics operational metrics. Include: API latency heatmap, WebSocket connection gauge, topology build histogram, circuit breaker state timeline.

**OBS-P2-02: SLO/SLI Framework**
Define platform SLIs (API availability, topology freshness, WebSocket uptime) and allow enterprise users to configure SLO targets with burn-rate alerting.

**OBS-P2-03: Cost Attribution Completion**
The `cost/` package is a placeholder. Integrate with OpenCost or Kubecost for real cost-per-namespace, cost-per-workload attribution.

**OBS-P2-04: Network Metrics**
Integrate with CNI-level metrics (Cilium Hubble, Calico Felix) for network flow visibility, bandwidth, packet drops.

---

## 5. Implementation Roadmap

### Phase 1: Foundation (2-3 weeks)
- Instrument top 10 Prometheus custom metrics
- Add time-range selector with in-memory metric buffering (last 1 hour)
- Add Prometheus provider to metrics service (PromQL client)
- Create webhook notification endpoint for cluster events

### Phase 2: Depth (3-4 weeks)
- OpenTelemetry span instrumentation across all handlers
- Structured log shipping (stdout JSON + optional Loki sink)
- Audit log export endpoint
- Container-level metrics in pod detail view

### Phase 3: Enterprise (4-6 weeks)
- Grafana dashboard templates
- AlertManager integration
- Historical metrics storage (SQLite/PostgreSQL, 7-day default)
- SLO/SLI framework scaffolding
- Cost attribution with OpenCost

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Prometheus not installed in cluster | Medium | Users get no metrics improvement | Fall back to metrics-server; show "install Prometheus" CTA (like metrics-server CTA) |
| Historical metrics overwhelm SQLite | High | Database grows rapidly, write contention | Use separate time-series table with automatic purging; move to TimescaleDB/InfluxDB for enterprise |
| OpenTelemetry overhead | Low | Tracing adds latency | Configurable sampling rate (default 10%); disable in production if needed |
| Alert fatigue | Medium | Too many alerts cause ignoring | Default to high-severity only; require explicit opt-in for lower severity |

---

*End of Observability Gap Analysis — Kubilitics OS v1.0*
