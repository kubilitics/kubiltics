# Load Testing Guide

**Audience:** Backend engineers, SREs
**Applies to:** Kubilitics v0.1.1+
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Target Metrics](#2-target-metrics)
3. [k6 HTTP Load Tests](#3-k6-http-load-tests)
4. [k6 WebSocket Load Tests](#4-k6-websocket-load-tests)
5. [Go Benchmarks](#5-go-benchmarks)
6. [Running Load Tests](#6-running-load-tests)
7. [Interpreting Results](#7-interpreting-results)

---

## 1. Overview

This document covers load testing for the Kubilitics backend using k6 for HTTP and WebSocket tests, and Go's built-in benchmark framework for internal performance measurements.

### Test Categories

| Category | Tool | Target |
|---|---|---|
| HTTP API throughput | k6 | REST endpoints under concurrent load |
| WebSocket scalability | k6 | Concurrent WS connections and message throughput |
| Topology generation | Go benchmark | Graph construction time and memory |
| Database operations | Go benchmark | Query latency under load |

---

## 2. Target Metrics

### Service Level Objectives (SLOs)

| Metric | Target | Measurement |
|---|---|---|
| API latency P50 | < 50 ms | k6 HTTP |
| API latency P95 | < 200 ms | k6 HTTP |
| API latency P99 | < 500 ms | k6 HTTP |
| Topology generation P95 (50 nodes) | < 100 ms | Go benchmark |
| Topology generation P95 (500 nodes) | < 500 ms | Go benchmark |
| Topology generation P95 (5000 nodes) | < 3 s | Go benchmark |
| WebSocket message latency P95 | < 100 ms | k6 WS |
| Error rate | < 0.1% | k6 HTTP |
| Max concurrent WS connections (2 replicas) | 500 | k6 WS |
| Requests/second (2 replicas) | > 500 | k6 HTTP |

### Resource Budget

| Component | CPU limit | Memory limit | Max connections |
|---|---|---|---|
| Backend (per replica) | 2000m | 1Gi | -- |
| PostgreSQL | 2000m | 4Gi | 200 |
| Redis | 500m | 256Mi | -- |

---

## 3. k6 HTTP Load Tests

### Setup

```bash
# Install k6
brew install grafana/tap/k6

# Or via Docker
docker pull grafana/k6
```

### Test Script: API Endpoints

```javascript
// load-tests/http-api.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const topologyLatency = new Trend('topology_latency', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const TOKEN = __ENV.AUTH_TOKEN || '';

export const options = {
  scenarios: {
    smoke: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    errors: ['rate<0.01'],
    topology_latency: ['p(95)<500'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`,
};

export default function () {
  // 1. List clusters
  const clustersRes = http.get(`${BASE_URL}/api/v1/clusters`, { headers });
  check(clustersRes, {
    'list clusters 200': (r) => r.status === 200,
  });
  errorRate.add(clustersRes.status !== 200);

  if (clustersRes.status !== 200 || !clustersRes.json().length) {
    sleep(1);
    return;
  }

  const clusters = clustersRes.json();
  const clusterId = clusters[0].id;

  // 2. Get cluster summary
  const summaryRes = http.get(
    `${BASE_URL}/api/v1/clusters/${clusterId}/summary`,
    { headers }
  );
  check(summaryRes, { 'cluster summary 200': (r) => r.status === 200 });
  errorRate.add(summaryRes.status !== 200);

  // 3. Generate topology
  const topoStart = Date.now();
  const topoRes = http.get(
    `${BASE_URL}/api/v1/clusters/${clusterId}/topology?namespace=default`,
    { headers, timeout: '10s' }
  );
  topologyLatency.add(Date.now() - topoStart);
  check(topoRes, {
    'topology 200': (r) => r.status === 200,
    'topology has nodes': (r) => r.json().nodes && r.json().nodes.length > 0,
  });
  errorRate.add(topoRes.status !== 200);

  // 4. List pods
  const podsRes = http.get(
    `${BASE_URL}/api/v1/clusters/${clusterId}/resources/pods?namespace=default`,
    { headers }
  );
  check(podsRes, { 'list pods 200': (r) => r.status === 200 });
  errorRate.add(podsRes.status !== 200);

  // 5. Get addon catalog
  const addonsRes = http.get(
    `${BASE_URL}/api/v1/clusters/${clusterId}/addons/catalog`,
    { headers }
  );
  check(addonsRes, { 'addon catalog 200': (r) => r.status === 200 });
  errorRate.add(addonsRes.status !== 200);

  sleep(1);
}
```

### Test Script: Spike Test

```javascript
// load-tests/spike.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '5s', target: 200 },
        { duration: '30s', target: 200 },
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/healthz/ready`);
  check(res, { 'healthz 200': (r) => r.status === 200 });
}
```

---

## 4. k6 WebSocket Load Tests

### Test Script: WebSocket Connections

```javascript
// load-tests/websocket.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const wsMessages = new Counter('ws_messages_received');
const wsLatency = new Trend('ws_message_latency', true);

const BASE_URL = __ENV.WS_URL || 'ws://localhost:8080';
const TOKEN = __ENV.AUTH_TOKEN || '';

export const options = {
  scenarios: {
    websocket: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    ws_messages_received: ['count>100'],
    ws_message_latency: ['p(95)<100'],
  },
};

export default function () {
  const url = `${BASE_URL}/ws/resources?token=${TOKEN}`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', function () {
      socket.send(JSON.stringify({
        type: 'subscribe',
        clusterId: 'test-cluster',
        namespace: 'default',
      }));
    });

    socket.on('message', function (msg) {
      wsMessages.add(1);
      try {
        const data = JSON.parse(msg);
        if (data.timestamp) {
          wsLatency.add(Date.now() - new Date(data.timestamp).getTime());
        }
      } catch (e) { /* non-JSON ping */ }
    });

    socket.on('error', function (e) {
      console.error('WS error:', e.error());
    });

    sleep(30);
    socket.close();
  });

  check(res, { 'WS connected': (r) => r && r.status === 101 });
}
```

---

## 5. Go Benchmarks

### Topology Generation Benchmark

```go
// internal/service/topology_bench_test.go
package service

import (
    "context"
    "fmt"
    "testing"
)

func BenchmarkTopologyGeneration(b *testing.B) {
    sizes := []int{10, 50, 100, 500, 1000, 5000}
    for _, size := range sizes {
        b.Run(fmt.Sprintf("nodes_%d", size), func(b *testing.B) {
            client := testutil.NewFakeClientWithResources(size)
            svc := NewTopologyService(client, nil)
            b.ResetTimer()
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                _, err := svc.GenerateTopology(context.Background(), "test-cluster", "default")
                if err != nil {
                    b.Fatal(err)
                }
            }
        })
    }
}

func BenchmarkTopologyCacheLookup(b *testing.B) {
    cache := NewTopologyCache(30)
    graph := testutil.GenerateMockGraph(500)
    cache.Set("cluster-1", "default", graph)
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = cache.Get("cluster-1", "default")
    }
}
```

### Database Benchmark

```go
// internal/repository/benchmark_test.go
func BenchmarkAuditLogInsert(b *testing.B) {
    repo := newTestRepo(b)
    ctx := context.Background()
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = repo.CreateAuditEvent(ctx, AuditEvent{
            Action:   "topology.view",
            UserID:   "user-1",
            Resource: fmt.Sprintf("cluster-%d", i),
        })
    }
}
```

### Running Go Benchmarks

```bash
cd kubilitics-backend

# Run all benchmarks
go test -bench=. -benchmem ./...

# Run specific benchmark with 10s duration
go test -bench=BenchmarkTopologyGeneration -benchtime=10s ./internal/service/

# Compare with benchstat
go test -bench=. -benchmem -count=5 ./... > old.txt
# ... make changes ...
go test -bench=. -benchmem -count=5 ./... > new.txt
benchstat old.txt new.txt
```

---

## 6. Running Load Tests

### Prerequisites

```bash
brew install grafana/tap/k6

# Start the backend
cd kubilitics-backend && go run ./cmd/server

# Obtain auth token
export AUTH_TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme"}' | jq -r '.token')
```

### Run Tests

```bash
# HTTP load test
k6 run -e BASE_URL=http://localhost:8080 -e AUTH_TOKEN=$AUTH_TOKEN load-tests/http-api.js

# WebSocket load test
k6 run -e WS_URL=ws://localhost:8080 -e AUTH_TOKEN=$AUTH_TOKEN load-tests/websocket.js

# Spike test
k6 run -e BASE_URL=http://localhost:8080 load-tests/spike.js
```

### Output to Prometheus/Grafana

```bash
k6 run \
  --out experimental-prometheus-rw \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
  -e BASE_URL=http://localhost:8080 \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  load-tests/http-api.js
```

---

## 7. Interpreting Results

### Key Indicators

| Indicator | Healthy | Warning | Critical |
|---|---|---|---|
| P95 latency | < 200 ms | 200-500 ms | > 500 ms |
| Error rate | < 0.1% | 0.1-1% | > 1% |
| RPS achieved | > target | 80-100% of target | < 80% of target |
| WS connections | All connected | >95% connected | < 95% connected |

### Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| High P99, low P50 | Topology cache misses | Increase cache TTL or warm cache |
| Increasing latency over time | Memory leak or GC pressure | Profile with `pprof` |
| Connection refused at high VUs | `max_connections` exhausted | Deploy PgBouncer |
| WS messages delayed | Redis PubSub backlog | Scale Redis or check network |
| Timeouts on topology | Large cluster without namespace filter | Scope queries to a namespace |
