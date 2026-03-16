# Kubilitics — Task Rewrite: Observability

**Source:** PRD-02 AI Engine (metrics) + Observability Gap Analysis
**Date:** 2026-03-16
**Priority Framework:** P0 = blocks launch, P1 = blocks growth, P2 = competitive advantage

---

## Sprint 1: Metrics Foundation (2 weeks)

### TASK-OBS-001: Platform Metrics Instrumentation (P0) ✅
**Goal:** Make Kubilitics itself observable via Prometheus
**Acceptance Criteria:**
- [x] `kubilitics_http_request_duration_seconds` histogram (method, path, status)
- [x] `kubilitics_http_requests_total` counter (method, path, status)
- [x] `kubilitics_websocket_connections_active` gauge (cluster)
- [x] `kubilitics_topology_build_duration_seconds` histogram (cluster, node_count)
- [x] `kubilitics_k8s_api_duration_seconds` histogram (cluster, resource, verb)
- [x] `kubilitics_circuit_breaker_state` gauge (cluster) [0=closed, 1=half-open, 2=open]
- [x] `kubilitics_addon_install_duration_seconds` histogram (addon, cluster)
- [x] `kubilitics_auth_events_total` counter (type, result)
- [x] `kubilitics_cache_hit_ratio` gauge (cache_name)
- [x] `kubilitics_rate_limit_rejected_total` counter (endpoint)
- [x] All metrics registered on existing `/metrics` endpoint

### TASK-OBS-002: Prometheus Query Provider (P0) ✅
**Goal:** Query real metrics from production clusters (most clusters run Prometheus)
**Acceptance Criteria:**
- [x] New `PrometheusProvider` in metrics service alongside existing `MetricsServerProvider`
- [x] Auto-detect Prometheus endpoint (ServiceMonitor discovery or manual config)
- [x] PromQL client with configurable timeout
- [x] Fetch: container CPU/memory, network I/O, request rates, error rates
- [x] Fallback: metrics-server if Prometheus not available
- [x] Frontend: show "Prometheus" or "metrics-server" as data source badge

### TASK-OBS-003: Time-Range Metrics (P0) ✅
**Goal:** Answer "What happened in the last hour?" — most requested missing feature
**Acceptance Criteria:**
- [x] Time-range selector on Dashboard: Last 15m / 1h / 6h / 24h / 7d / Custom
- [x] If Prometheus available: query PromQL with time range
- [x] If metrics-server only: in-memory buffer (last 1 hour, 1-minute granularity)
- [x] Sparkline charts on resource cards showing trend
- [x] Time range applies to all Dashboard widgets (metrics, events, pod distribution)

---

## Sprint 2: Alerting & Logging (2 weeks)

### TASK-OBS-004: Webhook Alert Delivery (P0) ✅
**Goal:** Notify operators when critical events occur
**Acceptance Criteria:**
- [x] Extend `notification_channels` beyond add-on events to cluster events
- [x] Alert rule configuration: resource type, severity, namespace, message pattern
- [x] Webhook targets: Slack, PagerDuty, OpsGenie, generic HTTP POST
- [x] Alert deduplication: same event doesn't fire within cooldown window
- [x] Alert history: store sent alerts with timestamps
- [x] Frontend: Settings → Alerts configuration page

### TASK-OBS-005: Structured Log Shipping (P1) ✅
**Goal:** Enable log aggregation for production deployments
**Acceptance Criteria:**
- [x] JSON log output to stdout (for container log collectors: Fluentd, Fluent Bit)
- [x] Structured fields: timestamp, level, message, request_id, user_id, cluster_id, resource
- [x] Optional: direct Loki push endpoint (configurable via env var)
- [x] Document log collection setup for ELK, Loki, CloudWatch

### TASK-OBS-006: Audit Log Export (P1) ✅
**Goal:** Enable compliance and external analysis
**Acceptance Criteria:**
- [x] `GET /api/v1/admin/audit-log/export` endpoint
- [x] Format: JSON or CSV (query parameter)
- [x] Filters: date range, user, resource type, action
- [x] Streaming response for large datasets
- [x] Rate limited (1 export per minute per user)

---

## Sprint 3: Tracing & Depth (3 weeks)

### TASK-OBS-007: OpenTelemetry Span Instrumentation (P1) ✅
**Goal:** End-to-end distributed tracing
**Acceptance Criteria:**
- [x] HTTP handler middleware creates root span for every request
- [x] K8s client wrapper creates child span for every API call
- [x] Database repository creates child span for every query
- [x] Helm operations create child span for install/upgrade/rollback
- [x] gRPC interceptor propagates trace context to kubilitics-ai
- [x] Sampling rate configurable (default 10%)
- [x] Works with Jaeger, Tempo, Zipkin (OTLP export)

### TASK-OBS-008: Container-Level Metrics (P1) ✅
**Goal:** Debug multi-container pods (init containers, sidecars)
**Acceptance Criteria:**
- [x] Pod metrics endpoint returns per-container breakdown
- [x] Frontend pod detail shows per-container CPU/memory
- [x] Support init containers and sidecar containers
- [x] Container selector dropdown in pod metrics view

### TASK-OBS-009: Dashboard Alert Positioning (P1) ✅
**Goal:** Critical alerts demand attention
**Acceptance Criteria:**
- [x] Move AlertsStrip to persistent banner at top of Dashboard (above all widgets)
- [x] When critical events exist: red banner with count and "View Details" button
- [x] When warnings only: amber banner, dismissible
- [x] Banner auto-updates via WebSocket
- [x] Collapsed state: "3 critical, 12 warnings" with expand button

---

## Backlog

### TASK-OBS-010: Grafana Dashboard Templates (P2) ✅
Publish pre-built Grafana JSON dashboards for Kubilitics operational metrics.

### TASK-OBS-011: SLO/SLI Framework (P2) ✅
Define platform SLIs and allow enterprise users to configure SLO targets.

### TASK-OBS-012: Network Metrics (P2) ✅
Integrate with Cilium Hubble / Calico Felix for network flow visibility.

### TASK-OBS-013: Cost Attribution (P2) ✅
Integrate with OpenCost for real cost-per-namespace, cost-per-workload.

### TASK-OBS-014: Historical Metrics Storage (P2) ✅
Store metrics in database (5-min granularity, 7-day retention) for offline clusters.

---

*Total Tasks: 14 | P0: 4 | P1: 5 | P2: 5 | ✅ All Complete*
