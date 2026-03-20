# Topology V2 — Performance Tuning Guide

## Backend Performance

### Concurrent Matcher Execution
All 12 relationship matchers run concurrently via `errgroup`. The global semaphore limits concurrency to 10 simultaneous builds. Tune via `rateLimiter.maxConcurrent`.

### Cache Configuration
Default TTL is 30 seconds. For high-churn clusters, reduce to 15s. For stable environments, increase to 60s. Cache is per-cluster and invalidated on topology rebuild.

### Circuit Breaker
Opens after 5 consecutive failures with 60s cooldown. Adjust thresholds in `rate_limiter.go`:
- `maxFailures`: failures before circuit opens (default: 5)
- `cooldownDuration`: time before circuit resets (default: 60s)

### Rate Limiting
Per-cluster rate limit: 20 builds/minute. Prevents runaway rebuilds during rapid K8s events.

### Large Cluster Optimization
For clusters with >2000 resources:
1. Use namespace filtering to reduce graph scope
2. Increase cache TTL to reduce rebuild frequency
3. Consider running topology builder as a separate microservice
4. Use Resource-Centric view (BFS depth=3) instead of full namespace view

## Frontend Performance

### ELK Layout
The ELK layout engine runs synchronously in the main thread. For large graphs (>1000 nodes), consider:
- Debouncing layout recalculations (already set to layout on data change)
- Using Web Workers for ELK computation (future enhancement)
- Reducing visible node count via namespace filtering

### React Flow Optimization
- All node components use `React.memo` to prevent unnecessary re-renders
- Edge components use `useCallback` for event handlers
- Zustand selectors use shallow equality checks
- WebSocket events are batched in 100ms windows before triggering re-renders

### Semantic Zoom
Node type switching based on zoom level uses the `getNodeType(zoom)` function. This is computed during layout, not during render, so zoom changes are fast.

### Bundle Size
Key dependencies and approximate sizes:
- `@xyflow/react`: ~150KB gzipped
- `elkjs`: ~180KB gzipped (WASM)
- `jspdf`: ~100KB gzipped (loaded dynamically for PDF export only)
- `html-to-image`: ~10KB gzipped (loaded dynamically for screenshot only)

Dynamic imports are used for export-related dependencies to keep initial bundle small.

## Monitoring

### Prometheus Metrics
Access metrics at `GET /api/v1/topology/v2/metrics`:
- `kubilitics_topology_builds_total` — total builds
- `kubilitics_topology_build_errors_total` — build failures
- `kubilitics_topology_build_duration_seconds` — build latency histogram
- `kubilitics_topology_cache_hits_total` / `cache_misses_total`
- `kubilitics_topology_ws_connections` — active WebSocket count
- `kubilitics_topology_api_calls_total` — API call count
- `kubilitics_topology_api_latency_seconds` — API response time

### Performance Benchmarks
Run benchmarks to establish baselines:
```bash
go test ./internal/topology/v2/... -bench=. -benchmem -count=5
```

Expected results (Apple M1):
- 100 resources: <5ms
- 500 resources: <25ms
- 1000 resources: <80ms
- 2000 resources: <200ms
