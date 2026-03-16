# Load Testing Baseline

## Overview

This document defines the load testing strategy and target metrics for the Kubilitics backend. It covers HTTP API throughput, WebSocket connections, and topology build benchmarks.

## Tools

- **k6** — HTTP and WebSocket load testing
- **Go benchmarks** — Internal function performance (topology build, serialization)
- **pprof** — CPU and memory profiling during load tests

## 1. k6 HTTP API Throughput

### Script: `tests/load/api-throughput.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const latencyP95 = new Trend('latency_p95');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 VUs
    { duration: '1m',  target: 50 },   // Ramp up to 50 VUs
    { duration: '2m',  target: 50 },   // Hold at 50 VUs
    { duration: '1m',  target: 100 },  // Ramp up to 100 VUs
    { duration: '2m',  target: 100 },  // Hold at 100 VUs
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95th percentile < 500ms
    http_req_failed: ['rate<0.01'],    // Error rate < 1%
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'health 200': (r) => r.status === 200 });

  // List pods
  const podsRes = http.get(`${BASE_URL}/api/v1/resources/pods`);
  check(podsRes, { 'pods 200': (r) => r.status === 200 });
  errorRate.add(podsRes.status !== 200);
  latencyP95.add(podsRes.timings.duration);

  // List deployments
  const deploymentsRes = http.get(`${BASE_URL}/api/v1/resources/deployments`);
  check(deploymentsRes, { 'deployments 200': (r) => r.status === 200 });

  // Get topology
  const topoRes = http.get(`${BASE_URL}/api/v1/topology`);
  check(topoRes, { 'topology 200': (r) => r.status === 200 });
  errorRate.add(topoRes.status !== 200);
  latencyP95.add(topoRes.timings.duration);

  // List nodes
  const nodesRes = http.get(`${BASE_URL}/api/v1/resources/nodes`);
  check(nodesRes, { 'nodes 200': (r) => r.status === 200 });

  // Namespace-filtered query
  const nsPodsRes = http.get(`${BASE_URL}/api/v1/resources/pods?namespace=kube-system`);
  check(nsPodsRes, { 'ns-pods 200': (r) => r.status === 200 });

  sleep(0.5);
}
```

### Running

```bash
# Local
k6 run tests/load/api-throughput.js

# Against staging
k6 run -e BASE_URL=https://staging.kubilitics.dev tests/load/api-throughput.js

# With JSON output for analysis
k6 run --out json=results.json tests/load/api-throughput.js
```

## 2. WebSocket Load Test

### Script: `tests/load/ws-load.js`

```javascript
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const messagesReceived = new Counter('ws_messages_received');

export const options = {
  stages: [
    { duration: '30s', target: 25 },   // 25 concurrent WS connections
    { duration: '2m',  target: 25 },   // Hold
    { duration: '30s', target: 50 },   // Scale to 50
    { duration: '2m',  target: 50 },   // Hold
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    ws_connecting: ['p(95)<1000'],      // Connection time < 1s
    ws_messages_received: ['count>100'], // At least 100 messages total
  },
};

const WS_URL = __ENV.WS_URL || 'ws://localhost:8080/ws/topology';

export default function () {
  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', () => {
      // Subscribe to topology updates
      socket.send(JSON.stringify({
        type: 'subscribe',
        resource: 'topology',
      }));
    });

    socket.on('message', (data) => {
      messagesReceived.add(1);
      const msg = JSON.parse(data);
      check(msg, {
        'has type': (m) => m.type !== undefined,
      });
    });

    socket.on('error', (e) => {
      console.error('WS error:', e);
    });

    // Keep connection open for 30 seconds
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });

  check(res, { 'WS status 101': (r) => r && r.status === 101 });
  sleep(1);
}
```

### Target Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| Max concurrent connections | 200 | WebSocket connections before degradation |
| Message delivery latency | < 100ms | Time from server event to client receipt |
| Connection setup time (p95) | < 1s | WebSocket handshake completion |
| Memory per connection | < 50 KB | Server memory overhead per WS client |

## 3. Go Benchmarks for Topology Build

### Benchmark File: `internal/topology/topology_bench_test.go`

```go
package topology_test

import (
    "testing"
    "github.com/kubilitics/kubiltics/internal/topology"
    "github.com/kubilitics/kubiltics/internal/testutil"
)

func BenchmarkTopologyBuild_10Resources(b *testing.B) {
    resources := testutil.GenerateResources(10)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        topology.Build(resources)
    }
}

func BenchmarkTopologyBuild_100Resources(b *testing.B) {
    resources := testutil.GenerateResources(100)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        topology.Build(resources)
    }
}

func BenchmarkTopologyBuild_1000Resources(b *testing.B) {
    resources := testutil.GenerateResources(1000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        topology.Build(resources)
    }
}

func BenchmarkTopologyBuild_5000Resources(b *testing.B) {
    resources := testutil.GenerateResources(5000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        topology.Build(resources)
    }
}

func BenchmarkTopologyIncremental_AddNode(b *testing.B) {
    graph := topology.Build(testutil.GenerateResources(500))
    newPod := testutil.GeneratePod("benchmark-pod")
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        graph.AddResource(newPod)
    }
}

func BenchmarkTopologySerialization(b *testing.B) {
    graph := topology.Build(testutil.GenerateResources(500))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = graph.ToJSON()
    }
}
```

### Running Benchmarks

```bash
cd kubilitics-backend

# Run all topology benchmarks
go test -bench=. -benchmem ./internal/topology/...

# Compare before/after a change
go test -bench=. -benchmem -count=10 ./internal/topology/... > before.txt
# (make changes)
go test -bench=. -benchmem -count=10 ./internal/topology/... > after.txt
benchstat before.txt after.txt
```

### Target Metrics

| Benchmark | Target | Description |
|-----------|--------|-------------|
| Build 100 resources | < 5ms | Small cluster topology build |
| Build 1000 resources | < 50ms | Medium cluster topology build |
| Build 5000 resources | < 250ms | Large cluster topology build |
| Incremental add | < 0.5ms | Single resource addition |
| Serialization (500 resources) | < 10ms | JSON serialization for WebSocket push |
| Memory (1000 resources) | < 20 MB | Heap allocation for topology graph |

## 4. Measurement Methodology

### Baseline Establishment

1. Run each benchmark 10 times on a consistent environment (CI runner or dedicated VM)
2. Record p50, p95, p99 latencies and throughput (ops/sec)
3. Store results as the baseline in `tests/load/baseline.json`

### Regression Detection

- Run benchmarks on every PR that touches `internal/topology/` or `internal/handlers/`
- Compare against baseline using `benchstat`
- Flag regressions > 10% as CI warnings
- Flag regressions > 25% as CI failures

### Environment

- **k6 tests**: Run against a local backend connected to a kind cluster with 50 pods
- **Go benchmarks**: Run on CI (GitHub Actions `ubuntu-latest`, 2 CPU, 7 GB RAM)
- **Profiling**: Run locally with `go tool pprof` for deep analysis

### Profiling Commands

```bash
# CPU profile during load test
curl http://localhost:8080/debug/pprof/profile?seconds=30 > cpu.prof
go tool pprof -http=:9090 cpu.prof

# Memory profile
curl http://localhost:8080/debug/pprof/heap > heap.prof
go tool pprof -http=:9090 heap.prof

# Goroutine profile (check for leaks)
curl http://localhost:8080/debug/pprof/goroutine > goroutine.prof
go tool pprof -http=:9090 goroutine.prof
```

## 5. Dashboard and Monitoring

For production deployments, expose metrics via Prometheus:

- `kubilitics_http_request_duration_seconds` — histogram by handler
- `kubilitics_ws_active_connections` — gauge of active WebSocket connections
- `kubilitics_topology_build_duration_seconds` — histogram of topology build times
- `kubilitics_topology_resource_count` — gauge of resources in topology graph

These can be visualized in Grafana alongside k6 load test results for correlation.
