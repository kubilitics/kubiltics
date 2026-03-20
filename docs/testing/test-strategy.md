# Backend Test Strategy

**Audience:** Backend engineers, QA engineers
**Applies to:** Kubilitics v0.1.1+
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Test Pyramid](#2-test-pyramid)
3. [Coverage Targets](#3-coverage-targets)
4. [Test Case Matrix: Topology Engine](#4-test-case-matrix-topology-engine)
5. [Test Case Matrix: Add-on Lifecycle](#5-test-case-matrix-add-on-lifecycle)
6. [Test Case Matrix: Resource Handlers](#6-test-case-matrix-resource-handlers)
7. [Test Infrastructure](#7-test-infrastructure)
8. [CI Integration](#8-ci-integration)

---

## 1. Overview

The Kubilitics backend is a Go application that interacts with Kubernetes clusters, generates topology graphs, manages add-on lifecycles, and serves a REST + WebSocket API. This document defines the test strategy, case matrices, and coverage targets.

### Testing Principles

1. **Test behavior, not implementation** -- Tests verify API contracts and observable outcomes, not internal struct fields.
2. **Fast by default** -- Unit tests run without network or cluster access. Integration tests are tagged and run separately.
3. **Deterministic** -- No flaky tests. Tests that depend on timing use `exec.CommandContext` with explicit timeouts.
4. **Isolated** -- Each test creates its own state (in-memory SQLite, mock K8s client). No shared mutable state between tests.

---

## 2. Test Pyramid

```
         ┌───────────┐
         │  E2E (5%) │  Real cluster, full API
         ├───────────┤
         │Integration│  In-memory DB + mock K8s client
         │  (25%)    │
         ├───────────┤
         │   Unit    │  Pure functions, no I/O
         │  (70%)    │
         └───────────┘
```

| Layer | Scope | Speed | K8s Cluster | Database |
|---|---|---|---|---|
| Unit | Single function/method | <1s per test | No (mock) | No (mock) |
| Integration | Handler + service + repo | <5s per test | No (fake client-go) | In-memory SQLite |
| E2E | Full API via HTTP | <30s per test | Yes (kind/minikube) | SQLite or PostgreSQL |

---

## 3. Coverage Targets

| Package | Current | Target | Priority |
|---|---|---|---|
| `internal/api/rest/` | -- | 80% | High |
| `internal/api/websocket/` | -- | 75% | High |
| `internal/auth/` | -- | 90% | Critical |
| `internal/repository/` | -- | 85% | High |
| `internal/k8s/` | -- | 70% | Medium |
| `internal/service/` | -- | 80% | High |
| `internal/addon/` | -- | 80% | High |
| `internal/metrics/` | -- | 75% | Medium |
| `internal/pkg/topologyexport/` | -- | 70% | Medium |
| **Overall** | **--** | **80%** | **--** |

Run coverage:
```bash
go test -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
```

---

## 4. Test Case Matrix: Topology Engine

### 4.1 Graph Construction (12 cases)

| # | Test Case | Input | Expected |
|---|---|---|---|
| T-01 | Empty namespace | Namespace with no resources | Empty graph, `isComplete: true` |
| T-02 | Single pod | 1 Pod | 1 node, 0 edges |
| T-03 | Deployment chain | Deployment -> ReplicaSet -> Pod | 3 nodes, 2 `owns` edges |
| T-04 | Service selects pods | Service + matching Pods | Nodes + `selects` edges |
| T-05 | ConfigMap mount | Pod mounting a ConfigMap | `mounts` edge Pod -> ConfigMap |
| T-06 | Secret env ref | Pod referencing Secret via env | `references` edge Pod -> Secret |
| T-07 | PVC mount | Pod mounting PVC -> PV -> StorageClass | Chain with `mounts` edges |
| T-08 | Ingress routes | Ingress -> Service -> Pods | `routes` + `selects` edges |
| T-09 | RBAC chain | ServiceAccount -> RoleBinding -> Role | `binds` edges |
| T-10 | Network policy | NetworkPolicy selecting pods | `selects` edge |
| T-11 | Cross-namespace ref | Service in ns-a referencing Pod in ns-b | Edge crosses namespace boundary |
| T-12 | CRD with owner refs | Custom resource with ownerReferences | `owns` edge to parent |

### 4.2 Graph Properties (8 cases)

| # | Test Case | Validation |
|---|---|---|
| T-13 | Deterministic layout seed | Same resources -> same `layoutSeed` |
| T-14 | No orphan edges | Every edge source/target exists as a node |
| T-15 | No duplicate nodes | Node IDs are unique |
| T-16 | No duplicate edges | Edge IDs are unique |
| T-17 | Schema version present | `schemaVersion` is "1.0" |
| T-18 | Metadata completeness | `clusterId`, `generatedAt`, `isComplete` all present |
| T-19 | Health computation | Pod in CrashLoopBackOff -> `health: "error"` |
| T-20 | Replica counts | Deployment replicas (desired/ready/available) computed correctly |

### 4.3 Caching and Invalidation (5 cases)

| # | Test Case | Behavior |
|---|---|---|
| T-21 | Cache hit | Second call within TTL returns cached graph |
| T-22 | Cache miss | First call or after TTL expires fetches fresh data |
| T-23 | Invalidation on event | Resource event invalidates cache for that cluster/namespace |
| T-24 | Cross-namespace isolation | Event in ns-a does not invalidate cache for ns-b |
| T-25 | Cache disabled | `TTL=0` always fetches fresh data |

### 4.4 Large Graph Handling (5 cases)

| # | Test Case | Behavior |
|---|---|---|
| T-26 | Max nodes cap | Graph truncated at `TOPOLOGY_MAX_NODES`, `isComplete: false` |
| T-27 | Truncation warning | Warning `TOPOLOGY_TRUNCATED` included in metadata |
| T-28 | Namespace scope reduces graph | Namespace filter produces smaller graph |
| T-29 | 1000-node graph | Completes within 2 seconds |
| T-30 | 5000-node graph | Completes within 10 seconds |

### 4.5 Edge Cases (3 cases)

| # | Test Case | Behavior |
|---|---|---|
| T-31 | Circular owner references | Detected and broken (no infinite loop) |
| T-32 | Resource with missing namespace | Treated as cluster-scoped |
| T-33 | Resource with very long name | Truncated in UI but full in data |

---

## 5. Test Case Matrix: Add-on Lifecycle

### 5.1 Catalog (5 cases)

| # | Test Case | Expected |
|---|---|---|
| A-01 | List full catalog | Returns all registered add-ons with metadata |
| A-02 | Filter by category | Only matching category entries returned |
| A-03 | Catalog entry schema | Each entry has id, name, description, category, chart info |
| A-04 | Unknown category | Returns empty list (not error) |
| A-05 | Catalog caching | Second call within TTL returns cached catalog |

### 5.2 Installation (8 cases)

| # | Test Case | Expected |
|---|---|---|
| A-06 | Install basic add-on | Status transitions: installing -> installed |
| A-07 | Install with custom values | Values override applied to Helm release |
| A-08 | Install to custom namespace | Namespace created if needed, release in target namespace |
| A-09 | Install duplicate | Returns conflict error if already installed |
| A-10 | Install with invalid values | Returns validation error, no Helm release created |
| A-11 | Install timeout | Status set to `failed` after timeout |
| A-12 | Install with dependencies | Prerequisites checked and installed first |
| A-13 | Install audit log | Audit event created with user, add-on, cluster, timestamp |

### 5.3 Uninstallation (4 cases)

| # | Test Case | Expected |
|---|---|---|
| A-14 | Uninstall add-on | Helm release deleted, status set to uninstalled |
| A-15 | Uninstall non-existent | Returns 404 |
| A-16 | Uninstall with dependents | Warning or error if other add-ons depend on this one |
| A-17 | Uninstall audit log | Audit event created |

### 5.4 Upgrade and Status (3 cases)

| # | Test Case | Expected |
|---|---|---|
| A-18 | Upgrade to new version | Helm upgrade executed, version updated in DB |
| A-19 | Health check running | Status reflects actual Helm release status |
| A-20 | Failed add-on recovery | Re-install after failure replaces the failed release |

---

## 6. Test Case Matrix: Resource Handlers

### 6.1 CRUD Operations (12 cases)

| # | Test Case | Method | Expected |
|---|---|---|---|
| R-01 | List pods | GET /resources/pods | 200 with pod list |
| R-02 | List with namespace filter | GET /resources/pods?namespace=x | Only pods in namespace x |
| R-03 | List with label selector | GET /resources/pods?labelSelector=app=x | Only matching pods |
| R-04 | Get single resource | GET /resources/pods/name | 200 with full resource |
| R-05 | Get non-existent resource | GET /resources/pods/missing | 404 |
| R-06 | Delete resource | DELETE /resources/pods/name | 204 |
| R-07 | Delete non-existent | DELETE /resources/pods/missing | 404 |
| R-08 | Apply resource (create) | POST /resources | 201 with created resource |
| R-09 | Apply resource (update) | POST /resources | 200 with updated resource |
| R-10 | Apply invalid YAML | POST /resources | 400 with parse error |
| R-11 | List empty namespace | GET /resources/pods?namespace=empty | 200 with empty array |
| R-12 | List unknown kind | GET /resources/foobar | 404 or 400 |

### 6.2 Deployment Operations (6 cases)

| # | Test Case | Expected |
|---|---|---|
| R-13 | Scale up deployment | Replicas increased, status updated |
| R-14 | Scale down deployment | Replicas decreased, status updated |
| R-15 | Scale to zero | Replicas set to 0 |
| R-16 | Scale non-existent | 404 |
| R-17 | Restart rollout | Pod template annotation updated, rollout started |
| R-18 | Rollout status | Returns rollout progress |

### 6.3 Log Streaming (5 cases)

| # | Test Case | Expected |
|---|---|---|
| R-19 | Stream pod logs | SSE stream with log lines |
| R-20 | Logs with follow | Stream stays open, delivers new lines |
| R-21 | Logs with tail lines | Only last N lines returned |
| R-22 | Logs for specific container | Container filter applied |
| R-23 | Logs for non-existent pod | 404 |

### 6.4 Authentication and Authorization (8 cases)

| # | Test Case | Expected |
|---|---|---|
| R-24 | Request without token | 401 Unauthorized |
| R-25 | Request with expired token | 401 Unauthorized |
| R-26 | Request with invalid token | 401 Unauthorized |
| R-27 | Viewer role cannot delete | 403 Forbidden |
| R-28 | Editor role can create | 200/201 |
| R-29 | Admin role full access | All operations succeed |
| R-30 | Namespace-scoped permission | User can only access permitted namespaces |
| R-31 | Cluster-scoped permission | User can only access permitted clusters |

### 6.5 Error Handling (5 cases)

| # | Test Case | Expected |
|---|---|---|
| R-32 | K8s API 403 | Propagated as 403 to client |
| R-33 | K8s API 404 | Propagated as 404 to client |
| R-34 | K8s API 5xx | Retried 3 times, then 502 to client |
| R-35 | K8s API timeout | 504 Gateway Timeout to client |
| R-36 | Invalid cluster ID | 400 Bad Request |

### 6.6 WebSocket (4 cases)

| # | Test Case | Expected |
|---|---|---|
| R-37 | Connect to /ws/resources | Upgrade succeeds, receives events |
| R-38 | Auth required for WS | Connection without token rejected |
| R-39 | Resource event broadcast | Created/updated/deleted resources produce WS messages |
| R-40 | WS reconnection | Client reconnects after server-side close |

---

## 7. Test Infrastructure

### Mock Kubernetes Client

Use `k8s.io/client-go/kubernetes/fake` for unit and integration tests:

```go
func newTestClient(objects ...runtime.Object) kubernetes.Interface {
    return fake.NewSimpleClientset(objects...)
}
```

### In-Memory Database

Use SQLite with `:memory:` for repository tests:

```go
func newTestRepo(t *testing.T) *repository.SQLiteRepository {
    repo, err := repository.NewSQLiteRepository(":memory:")
    require.NoError(t, err)
    t.Cleanup(func() { repo.Close() })
    return repo
}
```

### Test Helpers

```go
// testserver.go -- Creates a full HTTP test server with all middleware
func NewTestServer(t *testing.T) (*httptest.Server, *TestContext) { ... }

// testauth.go -- Generates valid JWT tokens for test users
func AdminToken() string { ... }
func ViewerToken() string { ... }
func ExpiredToken() string { ... }
```

---

## 8. CI Integration

### GitHub Actions (`backend-ci.yml`)

```yaml
- name: Run tests
  env:
    CGO_ENABLED: 1
    GO_VERSION: '1.25.7'
  run: |
    go test -count=1 -race -coverprofile=coverage.out ./...
    go tool cover -func=coverage.out | tail -1

- name: Check coverage threshold
  run: |
    COVERAGE=$(go tool cover -func=coverage.out | tail -1 | awk '{print $3}' | tr -d '%')
    if (( $(echo "$COVERAGE < 80" | bc -l) )); then
      echo "Coverage $COVERAGE% is below 80% threshold"
      exit 1
    fi
```

### Test Tags

```go
//go:build integration

func TestTopologyWithRealCluster(t *testing.T) {
    // Requires KUBECONFIG pointing to a real cluster
}
```

Run integration tests:
```bash
go test -tags=integration -count=1 ./...
```

### Pre-Commit Checks

```bash
cd kubilitics-backend && go build ./cmd/server && go test -count=1 ./...
```
