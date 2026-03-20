# Observability (Phase B2)

Enterprise-grade logging and metrics for production operations.

## Structured logging (B2.1)

- **Format:** One JSON line per HTTP request to stderr (or set `LOG_JSON=1` for app-level slog JSON).
- **Fields:** `time`, `level`, `request_id`, `cluster_id` (when present), `method`, `path`, `status`, `duration_ms`, `error` (when 4xx/5xx).
- **Request ID:** Generated per request (UUID); set in response header `X-Request-ID` for correlation with client/log aggregators.
- **No PII or secrets** in logs.

## Prometheus metrics (B2.2)

Scrape `GET /metrics` (no auth; protect in production).

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `kubilitics_http_requests_total` | Counter | method, path, status | Total HTTP requests (RED: rate). |
| `kubilitics_http_request_duration_seconds` | Histogram | method, path | Request latency (RED: duration). Buckets: 1ms–~9.3s. |
| `kubilitics_topology_build_duration_seconds` | Histogram | — | Topology graph build time (SLO). Buckets: 0.5s–64s. |
| `kubilitics_websocket_connections_active` | Gauge | — | Active WebSocket connections (capacity). |

Path label is normalized via gorilla/mux route template (e.g. `/api/v1/clusters/{clusterId}/topology`) to avoid high cardinality.

## Graceful shutdown and timeouts (B2.3)

- **Request timeouts:** Configurable `KUBILITICS_REQUEST_TIMEOUT_SEC` (default 30) for HTTP read/write.
- **Topology timeout:** Configurable `KUBILITICS_TOPOLOGY_TIMEOUT_SEC` (default 30). On timeout, API returns 503 "Topology build timed out".
- **Shutdown:** On SIGINT/SIGTERM, WebSocket hub is stopped (drain clients), then HTTP server shutdown with configurable `KUBILITICS_SHUTDOWN_TIMEOUT_SEC` (default 15). In-flight requests complete or are cut.

## WebSocket reconnection (B2.4, frontend)

- **Hook:** `useBackendWebSocket({ clusterId, maxRetries, onMessage })` in `kubilitics-frontend/src/hooks/useBackendWebSocket.ts`.
- **Backoff:** Exponential (1s, 2s, 4s, … up to 30s); max retries configurable (default 10).
- **Primary:** WebSocket for real-time topology/resource updates when connected.
- **Fallback:** Polling (e.g. refetch topology every 60s) when WebSocket is disconnected; documented in ERROR-STATES and UI.

---

*Single execution roadmap (TASKS.md).*
