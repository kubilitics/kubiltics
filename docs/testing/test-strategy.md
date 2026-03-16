# Backend Test Strategy

## Overview

This document defines the testing strategy for the Kubilitics backend (`kubilitics-backend/`), covering unit tests, integration tests, and coverage targets. The backend is a Go REST API with WebSocket support, SQLite persistence, and a Helm-based add-on platform.

## Test Categories

### 1. Topology Tests (30+ cases)

Tests for the real-time topology engine that builds cluster graphs from Kubernetes resource watches.

| Category | Test Cases | Description |
|----------|-----------|-------------|
| Graph construction | 8 | Build topology from pods, deployments, services, nodes |
| Edge detection | 6 | Label-selector matching, owner-reference traversal, service→pod edges |
| Incremental update | 5 | Add/remove/update single resources without full rebuild |
| Namespace filtering | 4 | Filter topology by namespace, multi-namespace union |
| Resource grouping | 4 | Group by namespace, by owner, by node |
| Error handling | 3 | Missing owner refs, orphan pods, nil metadata |

### 2. Add-on Lifecycle Tests (20+ cases)

Tests for the Helm-based add-on management system.

| Category | Test Cases | Description |
|----------|-----------|-------------|
| Catalog loading | 4 | Load catalog from embedded YAML, validate schema |
| Install flow | 4 | Install add-on, verify Helm release, status reporting |
| Upgrade flow | 3 | Upgrade version, rollback on failure |
| Uninstall flow | 3 | Clean uninstall, PVC retention, namespace cleanup |
| Health reconciler | 3 | Health check polling, status transitions, error recovery |
| Dependency resolution | 3 | Dependency ordering, circular detection, version constraints |

### 3. Resource Handler Tests (40+ cases)

Tests for the REST API handlers that serve Kubernetes resource data.

| Category | Test Cases | Description |
|----------|-----------|-------------|
| GET /resources/:kind | 8 | List pods, deployments, services, nodes, namespaces, etc. |
| GET /resources/:kind/:name | 6 | Get single resource by name, 404 handling |
| POST /resources/:kind | 4 | Create resource, validation errors, conflict |
| PUT /resources/:kind/:name | 4 | Update resource, optimistic concurrency |
| DELETE /resources/:kind/:name | 4 | Delete resource, cascade options, finalizer handling |
| PATCH /resources/:kind/:name | 4 | Strategic merge patch, JSON patch |
| Query parameters | 6 | Namespace filter, label selector, field selector, pagination |
| Error responses | 4 | 400 bad request, 403 forbidden, 404 not found, 500 internal |

### 4. WebSocket Tests (10+ cases)

| Category | Test Cases | Description |
|----------|-----------|-------------|
| Connection | 3 | Connect, authenticate, disconnect |
| Resource watches | 4 | Subscribe, receive events, unsubscribe, reconnect |
| Topology stream | 3 | Real-time topology deltas, compression, backpressure |

### 5. AI Integration Tests (15+ cases)

| Category | Test Cases | Description |
|----------|-----------|-------------|
| Safety evaluation | 5 | Immutable rules, policy checks, autonomy level enforcement |
| Investigation lifecycle | 4 | Create, stream events, conclude, cancel |
| LLM tool calls | 3 | kubectl tool, resource lookup, log retrieval |
| Memory/persistence | 3 | Conversation history, investigation history |

## Coverage Targets

| Package | Target | Current |
|---------|--------|---------|
| `internal/topology` | 80% | — |
| `internal/addon` | 75% | — |
| `internal/handlers` | 70% | — |
| `internal/websocket` | 65% | — |
| `internal/ai` | 70% | — |
| **Overall** | **70%** | — |

## Coverage Measurement

```bash
# Run tests with coverage
cd kubilitics-backend
go test -count=1 -coverprofile=coverage.out ./...

# View coverage summary
go tool cover -func=coverage.out

# Generate HTML report
go tool cover -html=coverage.out -o coverage.html

# Check coverage meets threshold (CI gate)
go tool cover -func=coverage.out | grep total | awk '{print $3}' | sed 's/%//' | \
  awk '{ if ($1 < 70) exit 1; else exit 0 }'
```

## CI Integration

### GitHub Actions Workflow

The coverage check runs as part of `backend-ci.yml`:

1. **Test step**: `go test -count=1 -coverprofile=coverage.out -race ./...`
2. **Coverage gate**: Fail CI if total coverage drops below 70%
3. **Coverage upload**: Upload `coverage.out` as a workflow artifact
4. **PR comment**: Post coverage diff on pull requests (optional, via codecov or coveralls)

### Pre-merge Checks

Before merging any PR that touches backend code:

- All tests must pass (`go test ./...`)
- Coverage must not decrease by more than 2% from the base branch
- No new packages below 50% coverage
- `govulncheck ./...` must pass clean

## Test Patterns

### Table-Driven Tests

All handler tests and topology tests use Go table-driven test patterns:

```go
func TestTopologyBuild(t *testing.T) {
    tests := []struct {
        name     string
        input    []runtime.Object
        wantNodes int
        wantEdges int
    }{
        {name: "empty cluster", input: nil, wantNodes: 0, wantEdges: 0},
        {name: "single pod", input: []runtime.Object{testPod()}, wantNodes: 1, wantEdges: 0},
        // ...
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            graph := topology.Build(tt.input)
            assert.Equal(t, tt.wantNodes, len(graph.Nodes))
            assert.Equal(t, tt.wantEdges, len(graph.Edges))
        })
    }
}
```

### Test Fixtures

- Use `testdata/` directories for YAML fixtures
- Use `fake.NewSimpleClientset()` for Kubernetes client mocks
- Use `httptest.NewServer()` for handler tests
- Use SQLite `:memory:` for database tests

### Flaky Test Prevention

Per `docs/RELEASE-STANDARDS.md`:

- Never use `time.Sleep()` in tests; use channels or `sync.WaitGroup`
- Use `exec.CommandContext()` for any subprocess calls
- Use `t.Parallel()` where safe (no shared state)
- Use `unshareAvailable()` probe before namespace-sandbox tests on Linux
