# Onboarding v2 + Universal Robustness + State Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Cluster Presence Layer that auto-discovers clusters (Headlamp-style), never blank-states on transient failures, and has exactly one source of truth for cluster state — replacing the current Connect flow, generalizing the 10848cf pattern, and collapsing three overlapping stores.

**Architecture:** Four tiers (discovered → registered → connected → active) owned by a Go backend with pluggable `DiscoverySource` implementations + an SSE stream to a single frontend `clusterPresenceStore`. Every cluster-scoped data path goes through `resilient.WrapClusterHandler` (backend) + `useResilientQuery<T>` (frontend). All rollout behind `FEATURE_PRESENCE_V2` flag — each phase is independently reversible.

**Tech Stack:** Go 1.25 backend (fsnotify, gorilla/mux, client-go, standard library LRU), React 18 + TypeScript 5 frontend (Zustand, react-query, react-window), Tauri 2 shell (no new Rust).

**Design doc:** [docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md](../2026-04-24-onboarding-v2-robustness-mega.md)

---

## File Structure

### Backend — `kubilitics-backend/`

**New files:**
- `internal/api/resilient/envelope.go` — `ResilientResponse[T]`, JSON serialization.
- `internal/api/resilient/cache.go` — thread-safe LRU cache with `(value, at)` entries.
- `internal/api/resilient/classify.go` — `IsTransientClusterError(err) bool` dispatcher.
- `internal/api/resilient/wrap.go` — `WrapClusterHandler[T]` middleware.
- `internal/api/resilient/*_test.go` — unit tests for each of the above.
- `internal/cluster/discovery/source.go` — `DiscoverySource` interface + `DiscoveredCluster`, `DiscoveryEvent` types.
- `internal/cluster/discovery/kubeconfig_source.go` — `KubeconfigFileSource` (fsnotify + enumerate).
- `internal/cluster/discovery/kubeconfig_source_test.go`
- `internal/cluster/discovery/secret_source.go` — `KubernetesSecretSource` (migrated from `internal/k8s/cluster_discovery.go`).
- `internal/cluster/discovery/secret_source_test.go`
- `internal/cluster/discovery/manual_source.go` — wraps the existing sqlite-backed cluster DB.
- `internal/cluster/discovery/manager.go` — `DiscoveryManager` composing sources.
- `internal/cluster/discovery/manager_test.go`
- `internal/cluster/identity/logical.go` — `LogicalIdentity { Name, ServerURL }` + normalization/equality.
- `internal/cluster/identity/logical_test.go`
- `internal/api/rest/presence_handler.go` — `GET /api/v1/presence` + SSE events endpoint.
- `internal/api/rest/presence_handler_test.go`
- `internal/preferences/store.go` — sqlite-backed `last_used_cluster` store.
- `internal/preferences/store_test.go`

**Modified files:**
- `internal/api/rest/handler.go` — `GetClusterSummary` refactored to use `WrapClusterHandler`.
- `internal/api/rest/pods_handler.go`, `deployments_handler.go`, `services_handler.go`, `nodes_handler.go`, `namespaces_handler.go`, `events_handler.go`, `topology_handler.go` — each migrated to `WrapClusterHandler`.
- `internal/k8s/cluster_discovery.go` — delegated to new `secret_source.go`; thin shim remains for backcompat.
- `cmd/server/main.go` — wire `DiscoveryManager` + presence handler into router.
- `internal/config/config.go` — add `FEATURE_PRESENCE_V2` env toggle.

### Frontend — `kubilitics-frontend/`

**New files:**
- `src/types/resilient.ts` — `ResilientResponse<T>`, `LogicalIdentity`.
- `src/stores/clusterPresenceStore.ts` — new Zustand store (SSE-driven).
- `src/stores/clusterPresenceStore.test.ts`
- `src/hooks/useResilientQuery.ts` — react-query wrapper with session cache.
- `src/hooks/useResilientQuery.test.ts`
- `src/hooks/useClusterPresence.ts` — SSE subscription hook.
- `src/hooks/useClusterPresence.test.ts`
- `src/components/common/ClusterUnreachableBoundary.tsx`
- `src/components/common/ClusterUnreachableBoundary.test.tsx`
- `src/pages/ClusterPickerPage.tsx` — new `/clusters` landing.
- `src/pages/ClusterPickerPage.test.tsx`
- `src/pages/WelcomePage.tsx` — new `/welcome` zero-state.
- `src/pages/WelcomePage.test.tsx`
- `src/lib/featureFlags.ts` — `FEATURE_PRESENCE_V2` reader (env + runtime override).
- `src/lib/featureFlags.test.ts`

**Modified files:**
- `src/hooks/useResourceCounts.ts` — refactor onto `useResilientQuery`.
- `src/hooks/usePods.ts`, `useDeployments.ts`, `useServices.ts`, `useNodes.ts`, `useNamespaces.ts`, `useEvents.ts`, `useTopology.ts` — each migrated.
- `src/App.tsx` — feature-flag-driven routing; `ClusterPresenceProvider` wrapper.
- `src/stores/clusterStore.ts` — kept as shim in phase 3-5; deleted in phase 7.
- `src/stores/onboardingStore.ts` — deleted in phase 7.
- `src/stores/backendConfigStore.ts` — cluster fields deleted in phase 7.

---

## Invariants (enforced by tests + reviewed in every PR)

1. **No 5xx on transient cluster errors.** `WrapClusterHandler` returns 200 + envelope.
2. **No persisted session IDs in frontend state.** Only `LogicalIdentity`.
3. **No auto-switch on drift.** The active cluster never changes without explicit user action.
4. **No blank states.** Every loading, unreachable, or stale state has explicit visual treatment.
5. **Every phase toggleable via `FEATURE_PRESENCE_V2`.** Rollback = flip to `false`.

---

## Verification gates between phases

After EACH phase, these commands must pass before moving to the next phase:

```bash
# Backend
cd kubilitics-backend && go test ./... -count=1 -race -timeout 120s
cd kubilitics-backend && go build ./...

# Frontend
cd kubilitics-frontend && npm run typecheck
cd kubilitics-frontend && npm run lint
cd kubilitics-frontend && npx vitest run --reporter=dot

# Integration smoke (once desktop is rebuilt)
cd kubilitics-backend && go test ./tests/integration/... -count=1 -tags=integration
```

A phase is "done" only when these pass. If any fail, fix before proceeding — this plan is resumable but not commit-skippable.

---

# Phase 1 — Backend Scaffolding

**Goal:** Introduce `internal/api/resilient/` package and `GET /api/v1/presence` endpoint as an additive, flag-gated surface. Zero behavior change on existing endpoints.

**Exit criteria:** `go test ./internal/api/resilient/...` green; `go build ./...` clean; `curl http://127.0.0.1:8190/api/v1/presence` returns empty snapshot with 200.

---

### Task 1.1: Create `ResilientResponse[T]` envelope type

**Files:**
- Create: `kubilitics-backend/internal/api/resilient/envelope.go`
- Create: `kubilitics-backend/internal/api/resilient/envelope_test.go`

- [ ] **Step 1: Write the failing test**

```go
// envelope_test.go
package resilient

import (
	"encoding/json"
	"testing"
	"time"
)

func TestEnvelope_HealthyRoundTrip(t *testing.T) {
	now := time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC)
	env := ResilientResponse[map[string]int]{
		Data:         map[string]int{"pods": 42},
		Reachable:    true,
		HealthStatus: "healthy",
		StaleAsOf:    &now,
	}
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ResilientResponse[map[string]int]
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !decoded.Reachable || decoded.Data["pods"] != 42 {
		t.Fatalf("round-trip lost data: %+v", decoded)
	}
}

func TestEnvelope_UnreachableOmitsData(t *testing.T) {
	env := ResilientResponse[map[string]int]{
		Reachable:    false,
		ErrorMessage: "connection refused",
		HealthStatus: "unreachable",
	}
	b, _ := json.Marshal(env)
	if bytes.Contains(b, []byte(`"data":`)) {
		t.Fatalf("expected omitempty on Data when zero; got: %s", b)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/api/resilient/... -run TestEnvelope -v`
Expected: FAIL with "undefined: ResilientResponse".

- [ ] **Step 3: Write minimal implementation**

```go
// envelope.go
// Package resilient provides the envelope shape and middleware that
// ensures every cluster-scoped endpoint degrades honestly instead of
// producing blank 5xx responses on transient cluster unreachability.
//
// See docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md §5.
package resilient

import "time"

// ResilientResponse is the canonical envelope for every cluster-scoped
// endpoint. A 5xx status is RESERVED for real server bugs (panic, DB
// corruption, misconfiguration). Transient apiserver issues and cluster-
// unreachable conditions always produce HTTP 200 with Reachable=false.
type ResilientResponse[T any] struct {
	Data         T          `json:"data,omitempty"`
	Reachable    bool       `json:"reachable"`
	Stale        bool       `json:"stale,omitempty"`
	StaleAsOf    *time.Time `json:"stale_as_of,omitempty"`
	ErrorMessage string     `json:"error_message,omitempty"`
	HealthStatus string     `json:"health_status"` // healthy | unreachable | degraded
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test ./internal/api/resilient/... -run TestEnvelope -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/resilient/envelope.go \
        kubilitics-backend/internal/api/resilient/envelope_test.go
git commit -m "feat(resilient): ResilientResponse envelope type

The canonical shape every cluster-scoped endpoint returns.
Never 5xx on transient errors; HTTP 200 with Reachable=false instead.
Part of onboarding-v2 epic, phase 1 / task 1."
```

---

### Task 1.2: Create LRU cache utility

**Files:**
- Create: `kubilitics-backend/internal/api/resilient/cache.go`
- Create: `kubilitics-backend/internal/api/resilient/cache_test.go`

- [ ] **Step 1: Write the failing test**

```go
// cache_test.go
package resilient

import (
	"sync"
	"testing"
	"time"
)

func TestLRUCache_PutAndGet(t *testing.T) {
	c := NewLRUCache[string, int](3)
	c.Put("a", 1)
	c.Put("b", 2)
	if e, ok := c.Get("a"); !ok || e.Value != 1 {
		t.Fatalf("get a: %+v ok=%v", e, ok)
	}
}

func TestLRUCache_EvictsOldest(t *testing.T) {
	c := NewLRUCache[string, int](2)
	c.Put("a", 1)
	c.Put("b", 2)
	c.Put("c", 3) // evicts a
	if _, ok := c.Get("a"); ok {
		t.Fatal("expected a to be evicted")
	}
	if e, _ := c.Get("b"); e.Value != 2 {
		t.Fatalf("b lost: %+v", e)
	}
}

func TestLRUCache_GetPromotesRecency(t *testing.T) {
	c := NewLRUCache[string, int](2)
	c.Put("a", 1)
	c.Put("b", 2)
	_, _ = c.Get("a") // promote a
	c.Put("c", 3)     // evicts b, not a
	if _, ok := c.Get("a"); !ok {
		t.Fatal("a should survive")
	}
	if _, ok := c.Get("b"); ok {
		t.Fatal("b should be evicted")
	}
}

func TestLRUCache_ThreadSafe(t *testing.T) {
	c := NewLRUCache[string, int](100)
	var wg sync.WaitGroup
	for i := 0; i < 500; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			k := "k" + string(rune('a'+i%26))
			c.Put(k, i)
			_, _ = c.Get(k)
		}(i)
	}
	wg.Wait() // if this hits a race, -race catches it
}

func TestLRUCache_EntryTimestamp(t *testing.T) {
	c := NewLRUCache[string, int](2)
	before := time.Now()
	c.Put("a", 1)
	e, _ := c.Get("a")
	if e.At.Before(before) {
		t.Fatalf("entry timestamp before Put: %v < %v", e.At, before)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test -race ./internal/api/resilient/... -run TestLRUCache -v`
Expected: FAIL with "undefined: NewLRUCache".

- [ ] **Step 3: Write minimal implementation**

```go
// cache.go
package resilient

import (
	"container/list"
	"sync"
	"time"
)

// Entry is the public shape returned by Get.
type Entry[V any] struct {
	Value V
	At    time.Time // when Put stored this value
}

type lruItem[K comparable, V any] struct {
	key   K
	entry Entry[V]
}

// LRUCache is a thread-safe least-recently-used cache. Get promotes
// recency; Put evicts the oldest when capacity is exceeded.
type LRUCache[K comparable, V any] struct {
	mu       sync.Mutex
	capacity int
	order    *list.List
	items    map[K]*list.Element
}

func NewLRUCache[K comparable, V any](capacity int) *LRUCache[K, V] {
	if capacity <= 0 {
		capacity = 1
	}
	return &LRUCache[K, V]{
		capacity: capacity,
		order:    list.New(),
		items:    make(map[K]*list.Element, capacity),
	}
}

func (c *LRUCache[K, V]) Get(key K) (Entry[V], bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[key]
	if !ok {
		return Entry[V]{}, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*lruItem[K, V]).entry, true
}

func (c *LRUCache[K, V]) Put(key K, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry := Entry[V]{Value: value, At: time.Now()}
	if el, ok := c.items[key]; ok {
		el.Value.(*lruItem[K, V]).entry = entry
		c.order.MoveToFront(el)
		return
	}
	el := c.order.PushFront(&lruItem[K, V]{key: key, entry: entry})
	c.items[key] = el
	if c.order.Len() > c.capacity {
		oldest := c.order.Back()
		if oldest != nil {
			c.order.Remove(oldest)
			delete(c.items, oldest.Value.(*lruItem[K, V]).key)
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test -race ./internal/api/resilient/... -run TestLRUCache -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/resilient/cache.go \
        kubilitics-backend/internal/api/resilient/cache_test.go
git commit -m "feat(resilient): thread-safe LRU cache with entry timestamps

Backing store for WrapClusterHandler's last-known-good cache.
Generic over key/value. -race-clean under 500-goroutine stress."
```

---

### Task 1.3: Create transient-error classifier

**Files:**
- Create: `kubilitics-backend/internal/api/resilient/classify.go`
- Create: `kubilitics-backend/internal/api/resilient/classify_test.go`

- [ ] **Step 1: Write the failing test**

```go
// classify_test.go
package resilient

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/url"
	"syscall"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestIsTransient_ContextDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	time.Sleep(2 * time.Nanosecond)
	if !IsTransientClusterError(ctx.Err()) {
		t.Fatal("context.DeadlineExceeded should be transient")
	}
}

func TestIsTransient_ConnectionRefused(t *testing.T) {
	err := &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}
	if !IsTransientClusterError(err) {
		t.Fatal("connection refused should be transient")
	}
}

func TestIsTransient_DNSFailure(t *testing.T) {
	err := &net.DNSError{Err: "no such host", Name: "apiserver.example.com", IsNotFound: true}
	if !IsTransientClusterError(err) {
		t.Fatal("DNS lookup failure should be transient")
	}
}

func TestIsTransient_TLSHandshake(t *testing.T) {
	var err error = &tls.CertificateVerificationError{Err: errors.New("x509: certificate signed by unknown authority")}
	if !IsTransientClusterError(err) {
		t.Fatal("TLS handshake failure should be transient")
	}
}

func TestIsTransient_K8sUnauthorized(t *testing.T) {
	err := apierrors.NewUnauthorized("token expired")
	if !IsTransientClusterError(err) {
		t.Fatal("401 Unauthorized should be transient")
	}
}

func TestIsTransient_K8sServiceUnavailable(t *testing.T) {
	err := apierrors.NewServiceUnavailable("apiserver restarting")
	if !IsTransientClusterError(err) {
		t.Fatal("503 should be transient")
	}
}

func TestIsTransient_UrlError(t *testing.T) {
	err := &url.Error{Op: "Get", URL: "https://x", Err: context.DeadlineExceeded}
	if !IsTransientClusterError(err) {
		t.Fatal("wrapped url.Error with transient cause should be transient")
	}
}

func TestIsTransient_RealBugNotTransient(t *testing.T) {
	// A NotFound on a specific resource is NOT cluster-unreachable.
	err := apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "mypod")
	if IsTransientClusterError(err) {
		t.Fatal("404 on resource should NOT be classified as cluster-unreachable")
	}
}

func TestIsTransient_NilErrIsFalse(t *testing.T) {
	if IsTransientClusterError(nil) {
		t.Fatal("nil err is not transient")
	}
}

func TestIsTransient_RandomErr(t *testing.T) {
	if IsTransientClusterError(fmt.Errorf("something totally random")) {
		t.Fatal("unrecognized err should not be transient (safe default)")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/api/resilient/... -run TestIsTransient -v`
Expected: FAIL with "undefined: IsTransientClusterError".

- [ ] **Step 3: Write minimal implementation**

```go
// classify.go
package resilient

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/url"
	"strings"
	"syscall"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// IsTransientClusterError reports whether err indicates the *cluster*
// is temporarily unreachable or misconfigured, as opposed to a real
// server bug or a genuine 4xx about a specific resource. Transient
// errors MUST produce HTTP 200 + Reachable:false, never 5xx.
//
// Conservative default: unknown errors return false so they surface
// as 5xx and get investigated.
func IsTransientClusterError(err error) bool {
	if err == nil {
		return false
	}

	// context.DeadlineExceeded / Canceled — request timed out talking to apiserver.
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}

	// Network errors: connection refused, reset, no route, DNS lookup failures.
	var netErr *net.OpError
	if errors.As(err, &netErr) {
		return true
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return true
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch errno {
		case syscall.ECONNREFUSED, syscall.ECONNRESET, syscall.EHOSTUNREACH,
			syscall.ENETUNREACH, syscall.ETIMEDOUT:
			return true
		}
	}

	// TLS handshake failures — rotated certs, clock skew, unknown CA.
	var tlsErr *tls.CertificateVerificationError
	if errors.As(err, &tlsErr) {
		return true
	}
	if strings.Contains(err.Error(), "tls: ") || strings.Contains(err.Error(), "x509:") {
		return true
	}

	// url.Error wraps many of the above; check the inner cause.
	var uerr *url.Error
	if errors.As(err, &uerr) && uerr.Err != nil && IsTransientClusterError(uerr.Err) {
		return true
	}

	// Kubernetes API: unauthorized (expired token), service unavailable.
	// NotFound/Conflict/BadRequest are NOT transient — they're about specific resources.
	if apierrors.IsUnauthorized(err) || apierrors.IsServiceUnavailable(err) ||
		apierrors.IsServerTimeout(err) || apierrors.IsTooManyRequests(err) ||
		apierrors.IsInternalError(err) {
		return true
	}

	return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test ./internal/api/resilient/... -run TestIsTransient -v`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/resilient/classify.go \
        kubilitics-backend/internal/api/resilient/classify_test.go
git commit -m "feat(resilient): IsTransientClusterError classifier

Distinguishes transient cluster-unreachability (→ 200 + envelope)
from real server bugs (→ 5xx). Covers context deadline, net errors,
TLS failures, DNS, k8s 401/503/500/429. Conservative default
(unknown → false) to surface new failure modes."
```

---

### Task 1.4: Create `WrapClusterHandler` middleware

**Files:**
- Create: `kubilitics-backend/internal/api/resilient/wrap.go`
- Create: `kubilitics-backend/internal/api/resilient/wrap_test.go`

- [ ] **Step 1: Write the failing test**

```go
// wrap_test.go
package resilient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"syscall"
	"testing"
)

type fakePods struct {
	Count int `json:"count"`
}

func TestWrap_HealthyPath(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{Count: 5}, nil
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	var env ResilientResponse[fakePods]
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if !env.Reachable || env.Data.Count != 5 || env.HealthStatus != "healthy" {
		t.Fatalf("healthy envelope malformed: %+v", env)
	}
	if _, ok := cache.Get("c1"); !ok {
		t.Fatal("healthy fetch should have been cached")
	}
}

func TestWrap_TransientNoCacheReturnsUnreachableNoData(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{}, syscall.ECONNREFUSED
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("transient error must still be 200, got %d", rec.Code)
	}
	var env ResilientResponse[fakePods]
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Reachable {
		t.Fatal("reachable must be false")
	}
	if env.HealthStatus != "unreachable" {
		t.Fatalf("health_status: %q", env.HealthStatus)
	}
	if env.ErrorMessage == "" {
		t.Fatal("error_message must be populated")
	}
	if env.Stale {
		t.Fatal("no cache existed — stale must be false")
	}
}

func TestWrap_TransientWithCacheServesStale(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	cache.Put("c1", fakePods{Count: 42})
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{}, syscall.ECONNREFUSED
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	var env ResilientResponse[fakePods]
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Reachable || !env.Stale {
		t.Fatalf("expected reachable=false, stale=true: %+v", env)
	}
	if env.Data.Count != 42 {
		t.Fatalf("stale data lost: %+v", env)
	}
	if env.StaleAsOf == nil {
		t.Fatal("stale_as_of must be populated")
	}
}

func TestWrap_RealBugReturns5xx(t *testing.T) {
	cache := NewLRUCache[string, fakePods](4)
	h := WrapClusterHandler(cache,
		func(r *http.Request) string { return "c1" },
		func(ctx context.Context, r *http.Request) (fakePods, error) {
			return fakePods{}, errors.New("database schema corrupt: table missing")
		})
	req := httptest.NewRequest("GET", "/pods", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code < 500 {
		t.Fatalf("real bug must return 5xx, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/api/resilient/... -run TestWrap -v`
Expected: FAIL with "undefined: WrapClusterHandler".

- [ ] **Step 3: Write minimal implementation**

```go
// wrap.go
package resilient

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
)

// WrapClusterHandler is the canonical middleware for every cluster-
// scoped API endpoint. It enforces the honest-degradation contract:
//
//   - On success: cache + return 200 {data, reachable:true, healthy}.
//   - On transient cluster error: return 200 {cached if any, reachable:false,
//     stale:<was cached?>, error_message, unreachable}. Never 5xx.
//   - On real bugs: 5xx with logged stack. Callers fix the server.
//
// The cache is a caller-provided LRU keyed by a request-derived key
// (typically the cluster logical identity). Caller controls capacity.
func WrapClusterHandler[T any](
	cache *LRUCache[string, T],
	cacheKey func(r *http.Request) string,
	fetch func(ctx context.Context, r *http.Request) (T, error),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := cacheKey(r)
		data, err := fetch(r.Context(), r)
		if err == nil {
			cache.Put(key, data)
			writeJSON(w, 200, ResilientResponse[T]{
				Data:         data,
				Reachable:    true,
				HealthStatus: "healthy",
			})
			return
		}
		if IsTransientClusterError(err) {
			resp := ResilientResponse[T]{
				Reachable:    false,
				ErrorMessage: err.Error(),
				HealthStatus: "unreachable",
			}
			if cached, ok := cache.Get(key); ok {
				resp.Data = cached.Value
				resp.Stale = true
				at := cached.At
				resp.StaleAsOf = &at
			}
			writeJSON(w, 200, resp)
			return
		}
		// Real bug — log and 5xx.
		log.Printf("resilient: unexpected error (not transient): %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test -race ./internal/api/resilient/... -run TestWrap -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/resilient/wrap.go \
        kubilitics-backend/internal/api/resilient/wrap_test.go
git commit -m "feat(resilient): WrapClusterHandler middleware

The canonical adapter every cluster-scoped endpoint uses. Enforces:
 - Happy path caches + returns healthy envelope
 - Transient cluster error returns 200 + stale-if-available envelope
 - Real server bugs still produce 5xx

4 tests cover the 4 paths."
```

---

### Task 1.5: Create `LogicalIdentity` type

**Files:**
- Create: `kubilitics-backend/internal/cluster/identity/logical.go`
- Create: `kubilitics-backend/internal/cluster/identity/logical_test.go`

- [ ] **Step 1: Write the failing test**

```go
// logical_test.go
package identity

import "testing"

func TestLogicalIdentity_Equal_IgnoresTrailingSlash(t *testing.T) {
	a := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443/"}
	if !a.Equal(b) {
		t.Fatal("trailing slash should not differentiate identities")
	}
}

func TestLogicalIdentity_Equal_CaseInsensitiveHost(t *testing.T) {
	a := LogicalIdentity{Name: "prod", ServerURL: "https://X.example.com:6443"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443"}
	if !a.Equal(b) {
		t.Fatal("host must be compared case-insensitively")
	}
}

func TestLogicalIdentity_Equal_NamePreserveCase(t *testing.T) {
	a := LogicalIdentity{Name: "PROD", ServerURL: "https://x:6443"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x:6443"}
	if a.Equal(b) {
		t.Fatal("context name IS case-sensitive — kubeconfig preserves it")
	}
}

func TestLogicalIdentity_Key_Stable(t *testing.T) {
	a := LogicalIdentity{Name: "prod", ServerURL: "https://X.example.com:6443/"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443"}
	if a.Key() != b.Key() {
		t.Fatalf("keys must match: %q vs %q", a.Key(), b.Key())
	}
}

func TestLogicalIdentity_String(t *testing.T) {
	id := LogicalIdentity{Name: "prod", ServerURL: "https://x:6443"}
	if id.String() != "prod@https://x:6443" {
		t.Fatalf("string repr: %q", id.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/cluster/identity/... -v`
Expected: FAIL with "undefined: LogicalIdentity".

- [ ] **Step 3: Write minimal implementation**

```go
// logical.go
// Package identity defines the logical-identity model for clusters.
// A (Name, ServerURL) tuple replaces session UUIDs in all persisted
// state; session IDs change on cluster recreation but the tuple doesn't.
// See docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md §3.3.
package identity

import (
	"fmt"
	"net/url"
	"strings"
)

// LogicalIdentity uniquely identifies a cluster across its possibly-many
// session UUIDs. Name is the kubeconfig context name (case-sensitive);
// ServerURL is normalized (lowercased host, no trailing slash).
type LogicalIdentity struct {
	Name      string `json:"name"`
	ServerURL string `json:"server_url"`
}

// Key returns a stable hashable string suitable for map keys / cache keys.
// Differences in case (of host) or trailing slashes do not produce
// different keys.
func (l LogicalIdentity) Key() string {
	return l.Name + "|" + normalizeURL(l.ServerURL)
}

// Equal returns whether two identities refer to the same cluster.
func (l LogicalIdentity) Equal(other LogicalIdentity) bool {
	return l.Key() == other.Key()
}

// String returns a human-readable representation for logs/UI.
func (l LogicalIdentity) String() string {
	return fmt.Sprintf("%s@%s", l.Name, normalizeURL(l.ServerURL))
}

func normalizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return strings.TrimRight(raw, "/")
	}
	host := strings.ToLower(u.Host)
	scheme := strings.ToLower(u.Scheme)
	path := strings.TrimRight(u.Path, "/")
	if scheme == "" || host == "" {
		return strings.TrimRight(raw, "/")
	}
	if path == "" {
		return fmt.Sprintf("%s://%s", scheme, host)
	}
	return fmt.Sprintf("%s://%s%s", scheme, host, path)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test ./internal/cluster/identity/... -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/cluster/identity/
git commit -m "feat(identity): LogicalIdentity — (name, serverUrl) replaces UUID

The stable cluster handle that persists across session-ID churn (cluster
recreation, Docker Desktop restart). Frontend persisted state will
reference this, never the transient session UUID. Normalization handles
case-insensitive host + trailing slash."
```

---

### Task 1.6: Stub presence handler endpoint

**Files:**
- Create: `kubilitics-backend/internal/api/rest/presence_handler.go`
- Create: `kubilitics-backend/internal/api/rest/presence_handler_test.go`

- [ ] **Step 1: Write the failing test**

```go
// presence_handler_test.go
package rest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPresenceEndpoint_InitialSnapshotShape(t *testing.T) {
	h := NewPresenceHandler(&nullDiscoveryManager{})
	req := httptest.NewRequest("GET", "/api/v1/presence", nil)
	rec := httptest.NewRecorder()
	h.GetSnapshot(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	var snap PresenceSnapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if snap.Discovered == nil {
		t.Fatal("discovered must be []DiscoveredCluster not null")
	}
	if snap.Registered == nil {
		t.Fatal("registered must be [] not null")
	}
	if snap.Connected == nil {
		t.Fatal("connected must be [] not null")
	}
}

// nullDiscoveryManager is a placeholder used until Phase 2 wires the real one.
type nullDiscoveryManager struct{}

func (n *nullDiscoveryManager) Snapshot() PresenceSnapshot {
	return PresenceSnapshot{
		Discovered: []DiscoveredCluster{},
		Registered: []RegisteredCluster{},
		Connected:  []ConnectedCluster{},
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/api/rest/... -run TestPresence -v`
Expected: FAIL with "undefined: NewPresenceHandler / PresenceSnapshot".

- [ ] **Step 3: Write minimal implementation**

```go
// presence_handler.go
package rest

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// DiscoveredCluster is the smallest identity record — known to exist,
// not yet touched. Source indicates which DiscoverySource produced it.
type DiscoveredCluster struct {
	Identity identity.LogicalIdentity `json:"identity"`
	Source   string                    `json:"source"` // kubeconfig | secret | manual
	// LastSeenAt records when this cluster was last observed by its source.
	LastSeenAt string `json:"last_seen_at,omitempty"`
}

// RegisteredCluster adds backend-side registration details — the backend
// has parsed/stored enough to connect on demand.
type RegisteredCluster struct {
	DiscoveredCluster
	// RegisteredAt is the ISO-8601 timestamp of first registration.
	RegisteredAt string `json:"registered_at"`
	// Reachable is the last known reachability status (from preflight or
	// any cached envelope). Frontend treats this as a hint, not truth.
	Reachable bool `json:"reachable"`
}

// ConnectedCluster is registered + has an active backend session.
type ConnectedCluster struct {
	RegisteredCluster
	// ConnectedAt is when the current session began.
	ConnectedAt string `json:"connected_at"`
}

// PresenceSnapshot is the whole-world view at one instant.
type PresenceSnapshot struct {
	Discovered []DiscoveredCluster `json:"discovered"`
	Registered []RegisteredCluster `json:"registered"`
	Connected  []ConnectedCluster  `json:"connected"`
	// LastUsed is the logical identity of the most-recently-active cluster.
	LastUsed *identity.LogicalIdentity `json:"last_used,omitempty"`
}

// DiscoveryManager is the interface the presence handler talks to.
// Phase 1 uses a null stub; Phase 2 wires the real composer.
type DiscoveryManager interface {
	Snapshot() PresenceSnapshot
}

// PresenceHandler serves GET /api/v1/presence.
type PresenceHandler struct {
	mgr DiscoveryManager
}

func NewPresenceHandler(mgr DiscoveryManager) *PresenceHandler {
	return &PresenceHandler{mgr: mgr}
}

// GetSnapshot returns the current presence snapshot as JSON.
func (h *PresenceHandler) GetSnapshot(w http.ResponseWriter, r *http.Request) {
	snap := h.mgr.Snapshot()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test ./internal/api/rest/... -run TestPresence -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/rest/presence_handler.go \
        kubilitics-backend/internal/api/rest/presence_handler_test.go
git commit -m "feat(presence): GET /api/v1/presence endpoint stub

Returns PresenceSnapshot (discovered/registered/connected/lastUsed).
Uses DiscoveryManager interface; Phase 2 plugs the real composer.
Always emits non-nil slices so frontend never deals with null."
```

---

### Task 1.7: Wire presence handler into router + feature flag

**Files:**
- Modify: `kubilitics-backend/cmd/server/main.go` (or wherever routes are registered)
- Modify: `kubilitics-backend/internal/config/config.go`
- Create: `kubilitics-backend/internal/config/features.go`
- Create: `kubilitics-backend/internal/config/features_test.go`

- [ ] **Step 1: Write the failing test for feature flag reader**

```go
// features_test.go
package config

import (
	"os"
	"testing"
)

func TestFeaturePresenceV2_DefaultOff(t *testing.T) {
	os.Unsetenv("FEATURE_PRESENCE_V2")
	if FeaturePresenceV2() {
		t.Fatal("default must be off")
	}
}

func TestFeaturePresenceV2_EnvOn(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "true")
	if !FeaturePresenceV2() {
		t.Fatal("FEATURE_PRESENCE_V2=true should enable")
	}
}

func TestFeaturePresenceV2_RejectsJunk(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "sure")
	if FeaturePresenceV2() {
		t.Fatal("only literal true/1/yes should enable")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/config/... -run TestFeaturePresence -v`
Expected: FAIL with "undefined: FeaturePresenceV2".

- [ ] **Step 3: Write minimal implementation**

```go
// features.go
package config

import (
	"os"
	"strings"
)

// FeaturePresenceV2 returns whether the Cluster Presence Layer (onboarding-v2)
// is enabled at runtime. Defaults off during rollout; flipped on in Phase 6
// of the migration.
func FeaturePresenceV2() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FEATURE_PRESENCE_V2")))
	return v == "true" || v == "1" || v == "yes"
}
```

- [ ] **Step 4: Run feature flag tests + wire presence endpoint**

Find the HTTP router in `cmd/server/main.go`. Locate where existing routes like `/api/v1/clusters` are registered. Immediately after them, add:

```go
// Presence layer (onboarding-v2). Mounted unconditionally so we can curl-probe
// it in CI even when the frontend's feature flag is off; UI consumption is
// gated separately.
import (
	"github.com/kubilitics/kubilitics-backend/internal/api/rest"
	// … existing imports
)

// somewhere in the router setup:
presenceHandler := rest.NewPresenceHandler(/* TODO(phase-2): real DiscoveryManager */ &noopDiscoveryMgr{})
router.HandleFunc("/api/v1/presence", presenceHandler.GetSnapshot).Methods("GET")

// noopDiscoveryMgr is the Phase-1 stub; swapped in Phase 2.
type noopDiscoveryMgr struct{}

func (*noopDiscoveryMgr) Snapshot() rest.PresenceSnapshot {
	return rest.PresenceSnapshot{
		Discovered: []rest.DiscoveredCluster{},
		Registered: []rest.RegisteredCluster{},
		Connected:  []rest.ConnectedCluster{},
	}
}
```

Run: `cd kubilitics-backend && go test ./... -count=1 -race -timeout 120s`
Expected: all PASS. `go build ./...` clean.

- [ ] **Step 5: Integration smoke — curl the live endpoint**

```bash
cd kubilitics-backend
go build -o /tmp/kb-backend ./cmd/server
/tmp/kb-backend -port 8199 > /tmp/kb.log 2>&1 &
PID=$!
sleep 2
curl -sS http://127.0.0.1:8199/api/v1/presence | jq .
kill $PID
```

Expected output shape:
```json
{
  "discovered": [],
  "registered": [],
  "connected": []
}
```

- [ ] **Step 6: Commit**

```bash
git add kubilitics-backend/internal/config/features.go \
        kubilitics-backend/internal/config/features_test.go \
        kubilitics-backend/cmd/server/main.go
git commit -m "feat(phase-1): wire presence endpoint into router + feature flag

FEATURE_PRESENCE_V2 env flag (off by default). GET /api/v1/presence
mounted with noop DiscoveryManager — Phase 2 swaps the real composer.
Empty snapshot curl returns {discovered:[],registered:[],connected:[]}."
```

---

**Phase 1 verification gate:**
```bash
cd kubilitics-backend && go test ./... -count=1 -race -timeout 120s   # must pass
cd kubilitics-backend && go build ./...                                 # must pass
curl -sS http://127.0.0.1:8190/api/v1/presence | jq .                   # returns empty snapshot, 200
```

---

# Phase 2 — Discovery Sources

**Goal:** Implement the three `DiscoverySource` implementations + `DiscoveryManager` composer, wire into the presence handler. From this point on, the backend reports real clusters from kubeconfig / secrets / manual-registration in `/api/v1/presence`.

**Exit criteria:** SSE stream emits presence events when kubeconfig is edited (verified via test). Manager snapshot includes deduped clusters from all three sources.

---

### Task 2.1: Define the `DiscoverySource` interface

**Files:**
- Create: `kubilitics-backend/internal/cluster/discovery/source.go`
- Create: `kubilitics-backend/internal/cluster/discovery/source_test.go`

- [ ] **Step 1: Write the interface-contract test using a fake**

```go
// source_test.go
package discovery

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

type fakeSource struct {
	clusters []DiscoveredCluster
	events   chan DiscoveryEvent
}

func (f *fakeSource) Name() string { return "fake" }
func (f *fakeSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	return f.clusters, nil
}
func (f *fakeSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	return f.events, nil
}

func TestDiscoveryEvent_AllKinds(t *testing.T) {
	for _, k := range []EventKind{EventAdd, EventUpdate, EventRemove} {
		evt := DiscoveryEvent{Kind: k, Cluster: DiscoveredCluster{
			Identity: identity.LogicalIdentity{Name: "c1", ServerURL: "https://x"},
			Source:   "test",
		}}
		if evt.Kind == "" {
			t.Fatalf("kind %q serialized to empty", k)
		}
	}
}

func TestDiscoverySource_InterfaceShape(t *testing.T) {
	var s DiscoverySource = &fakeSource{
		clusters: []DiscoveredCluster{
			{Identity: identity.LogicalIdentity{Name: "a", ServerURL: "https://x"}, Source: "fake"},
		},
		events: make(chan DiscoveryEvent, 1),
	}
	got, err := s.Enumerate(context.Background())
	if err != nil || len(got) != 1 {
		t.Fatalf("enumerate: %+v err=%v", got, err)
	}
	ch, err := s.Watch(context.Background())
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	select {
	case <-ch:
	case <-time.After(10 * time.Millisecond):
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -v`
Expected: FAIL with "undefined: DiscoverySource / DiscoveredCluster / DiscoveryEvent".

- [ ] **Step 3: Write minimal implementation**

```go
// source.go
// Package discovery defines the pluggable cluster-discovery layer.
// Every implementation (kubeconfig file, in-cluster Secret, manual
// registration) satisfies DiscoverySource; DiscoveryManager composes
// them into a single deduplicated view. See
// docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md §3.2.
package discovery

import (
	"context"
	"errors"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// ErrNotSupported may be returned from Watch() by sources that only
// support Enumerate() (polling).
var ErrNotSupported = errors.New("operation not supported by this source")

// DiscoveredCluster is the minimum identity a source produces.
type DiscoveredCluster struct {
	Identity    identity.LogicalIdentity `json:"identity"`
	Source      string                    `json:"source"`
	// ContextName is the kubeconfig context name if applicable.
	ContextName string `json:"context_name,omitempty"`
	// KubeconfigPath is the on-disk path that produced this entry, if any.
	KubeconfigPath string `json:"kubeconfig_path,omitempty"`
}

// EventKind describes a discovery event's type.
type EventKind string

const (
	EventAdd    EventKind = "add"
	EventUpdate EventKind = "update"
	EventRemove EventKind = "remove"
)

// DiscoveryEvent is streamed from Watch() as the world changes.
type DiscoveryEvent struct {
	Kind    EventKind         `json:"kind"`
	Cluster DiscoveredCluster `json:"cluster"`
}

// DiscoverySource is implemented by every pluggable source.
type DiscoverySource interface {
	Name() string
	Enumerate(ctx context.Context) ([]DiscoveredCluster, error)
	Watch(ctx context.Context) (<-chan DiscoveryEvent, error)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/cluster/discovery/source.go \
        kubilitics-backend/internal/cluster/discovery/source_test.go
git commit -m "feat(discovery): DiscoverySource interface + event types

Pluggable contract: Enumerate (snapshot) + Watch (stream). Sources
that don't support streaming return ErrNotSupported from Watch."
```

---

### Task 2.2: Implement `KubeconfigFileSource` (Enumerate)

**Files:**
- Create: `kubilitics-backend/internal/cluster/discovery/kubeconfig_source.go`
- Create: `kubilitics-backend/internal/cluster/discovery/kubeconfig_source_test.go`
- Create: `kubilitics-backend/internal/cluster/discovery/testdata/sample-kubeconfig.yaml`

- [ ] **Step 1: Write the failing test**

Create `testdata/sample-kubeconfig.yaml`:
```yaml
apiVersion: v1
kind: Config
clusters:
- name: prod
  cluster: {server: "https://prod.example.com:6443"}
- name: staging
  cluster: {server: "https://staging.example.com:6443"}
contexts:
- name: prod
  context: {cluster: prod, user: admin}
- name: staging
  context: {cluster: staging, user: admin}
current-context: prod
users:
- name: admin
  user: {token: REDACTED}
```

```go
// kubeconfig_source_test.go
package discovery

import (
	"context"
	"testing"
)

func TestKubeconfigFileSource_EnumerateTwoContexts(t *testing.T) {
	s := NewKubeconfigFileSource([]string{"testdata/sample-kubeconfig.yaml"})
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("enumerate: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 clusters, got %d: %+v", len(got), got)
	}
	names := map[string]bool{}
	for _, c := range got {
		names[c.Identity.Name] = true
		if c.Source != "kubeconfig" {
			t.Errorf("source: %q", c.Source)
		}
		if c.KubeconfigPath == "" {
			t.Error("kubeconfig_path must be set")
		}
	}
	if !names["prod"] || !names["staging"] {
		t.Fatalf("missing expected contexts: %v", names)
	}
}

func TestKubeconfigFileSource_MissingFileReturnsEmpty(t *testing.T) {
	s := NewKubeconfigFileSource([]string{"/does/not/exist"})
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("missing file should not error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want empty, got %d", len(got))
	}
}

func TestKubeconfigFileSource_MalformedYAMLReturnsError(t *testing.T) {
	s := NewKubeconfigFileSource([]string{"kubeconfig_source_test.go"}) // not yaml
	_, err := s.Enumerate(context.Background())
	if err == nil {
		t.Fatal("malformed file must surface an error, not silent success")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -run TestKubeconfigFileSource -v`
Expected: FAIL with "undefined: NewKubeconfigFileSource".

- [ ] **Step 3: Write minimal implementation**

```go
// kubeconfig_source.go
package discovery

import (
	"context"
	"fmt"
	"os"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
	"k8s.io/client-go/tools/clientcmd"
)

// KubeconfigFileSource reads cluster contexts from one or more kubeconfig
// files. In Phase 2.3 we add an fsnotify-backed Watch() for live updates.
type KubeconfigFileSource struct {
	paths []string
}

// NewKubeconfigFileSource takes an ordered list of kubeconfig paths (KUBECONFIG
// env is colon-split by caller). Missing files are silently skipped;
// malformed YAML in a present file bubbles up as an error.
func NewKubeconfigFileSource(paths []string) *KubeconfigFileSource {
	return &KubeconfigFileSource{paths: paths}
}

func (s *KubeconfigFileSource) Name() string { return "kubeconfig" }

func (s *KubeconfigFileSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	var out []DiscoveredCluster
	seen := make(map[string]bool) // dedupe by LogicalIdentity.Key()

	for _, p := range s.paths {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return nil, fmt.Errorf("stat %s: %w", p, err)
		}
		cfg, err := clientcmd.LoadFromFile(p)
		if err != nil {
			return nil, fmt.Errorf("load %s: %w", p, err)
		}
		for ctxName, kctx := range cfg.Contexts {
			cluster, ok := cfg.Clusters[kctx.Cluster]
			if !ok || cluster == nil {
				continue
			}
			id := identity.LogicalIdentity{
				Name:      ctxName,
				ServerURL: cluster.Server,
			}
			if seen[id.Key()] {
				continue
			}
			seen[id.Key()] = true
			out = append(out, DiscoveredCluster{
				Identity:       id,
				Source:         s.Name(),
				ContextName:    ctxName,
				KubeconfigPath: p,
			})
		}
	}
	return out, nil
}

// Watch is implemented in Phase 2.3.
func (s *KubeconfigFileSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	return nil, ErrNotSupported
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -run TestKubeconfigFileSource -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/cluster/discovery/kubeconfig_source.go \
        kubilitics-backend/internal/cluster/discovery/kubeconfig_source_test.go \
        kubilitics-backend/internal/cluster/discovery/testdata/sample-kubeconfig.yaml
git commit -m "feat(discovery): KubeconfigFileSource Enumerate

Reads contexts from kubeconfig files, dedupes by logical identity, 
skips missing files silently, surfaces malformed YAML as errors. 
Watch() returns ErrNotSupported pending Phase 2.3 fsnotify work."
```

---

### Task 2.3: Add fsnotify watcher to `KubeconfigFileSource`

**Files:**
- Modify: `kubilitics-backend/internal/cluster/discovery/kubeconfig_source.go`
- Modify: `kubilitics-backend/internal/cluster/discovery/kubeconfig_source_test.go`
- Modify: `kubilitics-backend/go.mod` (add `github.com/fsnotify/fsnotify`)

- [ ] **Step 1: Add fsnotify dep**

```bash
cd kubilitics-backend && go get github.com/fsnotify/fsnotify@v1.7.0 && go mod tidy
```

- [ ] **Step 2: Write the failing test**

Append to `kubeconfig_source_test.go`:
```go
func TestKubeconfigFileSource_WatchEmitsAddOnEdit(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/kubeconfig"
	writeKubeconfig(t, path, map[string]string{"a": "https://a"})

	s := NewKubeconfigFileSource([]string{path})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}

	// Add a context by rewriting the file.
	time.Sleep(50 * time.Millisecond) // let watcher warm up
	writeKubeconfig(t, path, map[string]string{"a": "https://a", "b": "https://b"})

	seenAdd := false
	timeout := time.After(2 * time.Second)
	for !seenAdd {
		select {
		case e := <-ch:
			if e.Kind == EventAdd && e.Cluster.Identity.Name == "b" {
				seenAdd = true
			}
		case <-timeout:
			t.Fatal("no EventAdd for b within 2s")
		}
	}
}

func TestKubeconfigFileSource_WatchEmitsRemoveOnDelete(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/kubeconfig"
	writeKubeconfig(t, path, map[string]string{"a": "https://a", "b": "https://b"})

	s := NewKubeconfigFileSource([]string{path})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	time.Sleep(50 * time.Millisecond)

	writeKubeconfig(t, path, map[string]string{"a": "https://a"}) // removed b

	seenRemove := false
	timeout := time.After(2 * time.Second)
	for !seenRemove {
		select {
		case e := <-ch:
			if e.Kind == EventRemove && e.Cluster.Identity.Name == "b" {
				seenRemove = true
			}
		case <-timeout:
			t.Fatal("no EventRemove for b within 2s")
		}
	}
}

// writeKubeconfig is a test helper — minimal valid kubeconfig.
func writeKubeconfig(t *testing.T, path string, clusters map[string]string) {
	t.Helper()
	var buf strings.Builder
	buf.WriteString("apiVersion: v1\nkind: Config\nclusters:\n")
	for n, s := range clusters {
		fmt.Fprintf(&buf, "- name: %s\n  cluster: {server: %q}\n", n, s)
	}
	buf.WriteString("contexts:\n")
	for n := range clusters {
		fmt.Fprintf(&buf, "- name: %s\n  context: {cluster: %s, user: u}\n", n, n)
	}
	buf.WriteString("users:\n- name: u\n  user: {token: x}\ncurrent-context: \"\"\n")
	if err := os.WriteFile(path, []byte(buf.String()), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -run TestKubeconfigFileSource_Watch -v`
Expected: FAIL — `Watch()` still returns `ErrNotSupported`.

- [ ] **Step 4: Replace the stub `Watch()` with a real fsnotify implementation**

Replace the final `Watch()` in `kubeconfig_source.go`:

```go
func (s *KubeconfigFileSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("fsnotify: %w", err)
	}
	for _, p := range s.paths {
		// Watch the containing directory — editors like vim rename-on-save,
		// which would drop a direct file watcher.
		if err := w.Add(filepath.Dir(p)); err != nil {
			// Non-fatal: dir might not exist yet. Best effort.
			log.Printf("kubeconfig watcher: add %s: %v", p, err)
		}
	}

	out := make(chan DiscoveryEvent, 32)
	go func() {
		defer close(out)
		defer w.Close()

		prev, _ := s.Enumerate(ctx)
		prevByKey := byKey(prev)

		var debounce *time.Timer
		for {
			select {
			case <-ctx.Done():
				return
			case ev := <-w.Events:
				if !s.isRelevant(ev.Name) {
					continue
				}
				if debounce != nil {
					debounce.Stop()
				}
				debounce = time.AfterFunc(500*time.Millisecond, func() {
					curr, err := s.Enumerate(ctx)
					if err != nil {
						log.Printf("kubeconfig watcher: re-enumerate: %v", err)
						return
					}
					currByKey := byKey(curr)
					for k, c := range currByKey {
						if _, had := prevByKey[k]; !had {
							select {
							case out <- DiscoveryEvent{Kind: EventAdd, Cluster: c}:
							case <-ctx.Done():
								return
							}
						}
					}
					for k, c := range prevByKey {
						if _, still := currByKey[k]; !still {
							select {
							case out <- DiscoveryEvent{Kind: EventRemove, Cluster: c}:
							case <-ctx.Done():
								return
							}
						}
					}
					prevByKey = currByKey
				})
			case err := <-w.Errors:
				log.Printf("kubeconfig watcher: %v", err)
			}
		}
	}()
	return out, nil
}

func (s *KubeconfigFileSource) isRelevant(path string) bool {
	for _, p := range s.paths {
		if path == p {
			return true
		}
	}
	return false
}

func byKey(cs []DiscoveredCluster) map[string]DiscoveredCluster {
	m := make(map[string]DiscoveredCluster, len(cs))
	for _, c := range cs {
		m[c.Identity.Key()] = c
	}
	return m
}
```

Also add imports: `"log"`, `"path/filepath"`, `"time"`, `"github.com/fsnotify/fsnotify"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test -race ./internal/cluster/discovery/... -v -timeout 30s`
Expected: PASS (5 tests). If a flaky timing issue appears, bump the `time.Sleep` warmup to 100ms.

- [ ] **Step 6: Commit**

```bash
git add kubilitics-backend/internal/cluster/discovery/kubeconfig_source.go \
        kubilitics-backend/internal/cluster/discovery/kubeconfig_source_test.go \
        kubilitics-backend/go.mod kubilitics-backend/go.sum
git commit -m "feat(discovery): fsnotify-backed kubeconfig live watching

500ms debounced re-enumerate on any edit in the kubeconfig's directory
(handles vim-style atomic rename). Emits Add/Remove events on the
watched channel; bounded at 32 to prevent runaway buffering."
```

---

### Task 2.4: Migrate existing in-cluster Secret discovery to `KubernetesSecretSource`

**Files:**
- Create: `kubilitics-backend/internal/cluster/discovery/secret_source.go`
- Create: `kubilitics-backend/internal/cluster/discovery/secret_source_test.go`
- Modify: `kubilitics-backend/internal/k8s/cluster_discovery.go` (thin delegating shim)

**Rationale:** existing code in `internal/k8s/cluster_discovery.go` watches Secrets labeled `kubilitics.io/cluster-kubeconfig=true` and has add/update/delete callbacks. We re-express it as a `DiscoverySource`.

- [ ] **Step 1: Write the failing test (fake clientset)**

```go
// secret_source_test.go
package discovery

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestSecretSource_EnumerateLabeledSecrets(t *testing.T) {
	cs := fake.NewSimpleClientset(
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name: "cluster-prod", Namespace: "kubilitics",
				Labels: map[string]string{"kubilitics.io/cluster-kubeconfig": "true"},
				Annotations: map[string]string{
					"kubilitics.io/cluster-name":       "prod",
					"kubilitics.io/cluster-server-url": "https://prod:6443",
				},
			},
		},
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "unrelated", Namespace: "kubilitics"},
		},
	)
	s := NewKubernetesSecretSource(cs, "kubilitics")
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("enum: %v", err)
	}
	if len(got) != 1 || got[0].Identity.Name != "prod" {
		t.Fatalf("expected 1 prod cluster: %+v", got)
	}
}

func TestSecretSource_WatchEmitsAddOnNewSecret(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := NewKubernetesSecretSource(cs, "kubilitics")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	_, _ = cs.CoreV1().Secrets("kubilitics").Create(ctx, &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name: "new", Namespace: "kubilitics",
			Labels: map[string]string{"kubilitics.io/cluster-kubeconfig": "true"},
			Annotations: map[string]string{
				"kubilitics.io/cluster-name":       "new",
				"kubilitics.io/cluster-server-url": "https://new:6443",
			},
		},
	}, metav1.CreateOptions{})

	select {
	case e := <-ch:
		if e.Kind != EventAdd || e.Cluster.Identity.Name != "new" {
			t.Fatalf("unexpected event: %+v", e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no event within 2s")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -run TestSecretSource -v`
Expected: FAIL with "undefined: NewKubernetesSecretSource".

- [ ] **Step 3: Write minimal implementation**

```go
// secret_source.go
package discovery

import (
	"context"
	"log"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
)

const secretDiscoveryLabel = "kubilitics.io/cluster-kubeconfig=true"

// KubernetesSecretSource watches Secrets with a specific label in the
// Kubilitics control-plane namespace. Each such Secret is a kubeconfig
// for a registered downstream cluster (in-cluster Helm mode).
type KubernetesSecretSource struct {
	cs        kubernetes.Interface
	namespace string
}

func NewKubernetesSecretSource(cs kubernetes.Interface, namespace string) *KubernetesSecretSource {
	return &KubernetesSecretSource{cs: cs, namespace: namespace}
}

func (s *KubernetesSecretSource) Name() string { return "secret" }

func (s *KubernetesSecretSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	list, err := s.cs.CoreV1().Secrets(s.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: secretDiscoveryLabel,
	})
	if err != nil {
		return nil, err
	}
	out := make([]DiscoveredCluster, 0, len(list.Items))
	for _, sec := range list.Items {
		if c, ok := secretToDiscovered(&sec); ok {
			out = append(out, c)
		}
	}
	return out, nil
}

func (s *KubernetesSecretSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	w, err := s.cs.CoreV1().Secrets(s.namespace).Watch(ctx, metav1.ListOptions{
		LabelSelector: secretDiscoveryLabel,
		FieldSelector: fields.Everything().String(),
	})
	if err != nil {
		return nil, err
	}
	out := make(chan DiscoveryEvent, 32)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				w.Stop()
				return
			case ev, ok := <-w.ResultChan():
				if !ok {
					return
				}
				sec, ok := ev.Object.(*corev1.Secret)
				if !ok {
					continue
				}
				cluster, ok := secretToDiscovered(sec)
				if !ok {
					continue
				}
				var kind EventKind
				switch ev.Type {
				case watch.Added:
					kind = EventAdd
				case watch.Modified:
					kind = EventUpdate
				case watch.Deleted:
					kind = EventRemove
				default:
					continue
				}
				select {
				case out <- DiscoveryEvent{Kind: kind, Cluster: cluster}:
				case <-ctx.Done():
					w.Stop()
					return
				}
			}
		}
	}()
	return out, nil
}

func secretToDiscovered(s *corev1.Secret) (DiscoveredCluster, bool) {
	name := s.Annotations["kubilitics.io/cluster-name"]
	server := s.Annotations["kubilitics.io/cluster-server-url"]
	if name == "" || server == "" {
		log.Printf("secret %s/%s missing name/server annotations, skipping", s.Namespace, s.Name)
		return DiscoveredCluster{}, false
	}
	return DiscoveredCluster{
		Identity:    identity.LogicalIdentity{Name: name, ServerURL: server},
		Source:      "secret",
		ContextName: name,
	}, true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubilitics-backend && go test -race ./internal/cluster/discovery/... -run TestSecretSource -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/cluster/discovery/secret_source.go \
        kubilitics-backend/internal/cluster/discovery/secret_source_test.go
git commit -m "feat(discovery): KubernetesSecretSource implements DiscoverySource

Watches label kubilitics.io/cluster-kubeconfig=true in the control-plane
namespace. Annotation-driven logical identity. Supersedes
internal/k8s/cluster_discovery.go — shim remains for backcompat until
callers migrate in Phase 7."
```

---

### Task 2.5: Implement `ManualSource` (sqlite-backed)

**Files:**
- Create: `kubilitics-backend/internal/cluster/discovery/manual_source.go`
- Create: `kubilitics-backend/internal/cluster/discovery/manual_source_test.go`

Wraps the existing cluster DB. Emits events when `AddCluster` / `DeleteCluster` APIs fire.

- [ ] **Step 1: Write the failing test**

```go
// manual_source_test.go
package discovery

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// fakeClusterDB implements the subset of ClusterRepository the source needs.
type fakeClusterDB struct {
	clusters []StoredCluster
}

func (f *fakeClusterDB) ListAll() ([]StoredCluster, error) {
	return f.clusters, nil
}

func TestManualSource_Enumerate(t *testing.T) {
	db := &fakeClusterDB{clusters: []StoredCluster{
		{Name: "a", ServerURL: "https://a"},
		{Name: "b", ServerURL: "https://b"},
	}}
	s := NewManualSource(db)
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("enum: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2: %+v", got)
	}
	want := identity.LogicalIdentity{Name: "a", ServerURL: "https://a"}
	if !got[0].Identity.Equal(want) {
		t.Fatalf("identity mismatch: %+v", got[0].Identity)
	}
}

func TestManualSource_WatchEmitsOnNotify(t *testing.T) {
	db := &fakeClusterDB{}
	s := NewManualSource(db)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch, _ := s.Watch(ctx)
	c := StoredCluster{Name: "new", ServerURL: "https://new"}
	s.NotifyAdd(c)
	select {
	case ev := <-ch:
		if ev.Kind != EventAdd || ev.Cluster.Identity.Name != "new" {
			t.Fatalf("unexpected: %+v", ev)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -run TestManualSource -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```go
// manual_source.go
package discovery

import (
	"context"
	"sync"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// StoredCluster is the minimum shape from the cluster DB that this
// source needs. Decouples from the full Cluster model.
type StoredCluster struct {
	Name      string
	ServerURL string
}

// ClusterRepository is the read port onto the cluster DB.
type ClusterRepository interface {
	ListAll() ([]StoredCluster, error)
}

// ManualSource tracks clusters registered via POST /api/v1/clusters.
// Unlike the file/secret sources, updates come from explicit NotifyAdd /
// NotifyRemove calls driven by the AddCluster/DeleteCluster HTTP handlers.
type ManualSource struct {
	db   ClusterRepository
	mu   sync.Mutex
	subs []chan DiscoveryEvent
}

func NewManualSource(db ClusterRepository) *ManualSource {
	return &ManualSource{db: db}
}

func (s *ManualSource) Name() string { return "manual" }

func (s *ManualSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	rows, err := s.db.ListAll()
	if err != nil {
		return nil, err
	}
	out := make([]DiscoveredCluster, 0, len(rows))
	for _, r := range rows {
		out = append(out, DiscoveredCluster{
			Identity: identity.LogicalIdentity{Name: r.Name, ServerURL: r.ServerURL},
			Source:   s.Name(),
		})
	}
	return out, nil
}

func (s *ManualSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	ch := make(chan DiscoveryEvent, 16)
	s.mu.Lock()
	s.subs = append(s.subs, ch)
	s.mu.Unlock()
	go func() {
		<-ctx.Done()
		s.mu.Lock()
		defer s.mu.Unlock()
		for i, c := range s.subs {
			if c == ch {
				s.subs = append(s.subs[:i], s.subs[i+1:]...)
				close(ch)
				break
			}
		}
	}()
	return ch, nil
}

// NotifyAdd is called by the AddCluster HTTP handler.
func (s *ManualSource) NotifyAdd(c StoredCluster) {
	s.emit(EventAdd, c)
}

// NotifyRemove is called by the DeleteCluster HTTP handler.
func (s *ManualSource) NotifyRemove(c StoredCluster) {
	s.emit(EventRemove, c)
}

func (s *ManualSource) emit(kind EventKind, c StoredCluster) {
	evt := DiscoveryEvent{
		Kind: kind,
		Cluster: DiscoveredCluster{
			Identity: identity.LogicalIdentity{Name: c.Name, ServerURL: c.ServerURL},
			Source:   s.Name(),
		},
	}
	s.mu.Lock()
	subs := append([]chan DiscoveryEvent(nil), s.subs...)
	s.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- evt:
		default:
		}
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test -race ./internal/cluster/discovery/... -run TestManualSource -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/cluster/discovery/manual_source.go \
        kubilitics-backend/internal/cluster/discovery/manual_source_test.go
git commit -m "feat(discovery): ManualSource — sqlite-backed + pub/sub

Wraps the cluster DB; AddCluster/DeleteCluster call NotifyAdd/NotifyRemove
to push events. Drop subscribers cleanly on ctx cancel."
```

---

### Task 2.6: Implement `DiscoveryManager` composer

**Files:**
- Create: `kubilitics-backend/internal/cluster/discovery/manager.go`
- Create: `kubilitics-backend/internal/cluster/discovery/manager_test.go`

- [ ] **Step 1: Write the failing test**

```go
// manager_test.go
package discovery

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

func TestManager_SnapshotDedupesAcrossSources(t *testing.T) {
	a := &fakeSource{clusters: []DiscoveredCluster{
		{Identity: identity.LogicalIdentity{Name: "prod", ServerURL: "https://x"}, Source: "kubeconfig"},
	}}
	b := &fakeSource{clusters: []DiscoveredCluster{
		{Identity: identity.LogicalIdentity{Name: "prod", ServerURL: "https://x/"}, Source: "secret"},
	}}
	m := NewManager([]DiscoverySource{a, b})
	if err := m.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	snap := m.Snapshot()
	if len(snap.Discovered) != 1 {
		t.Fatalf("dedup failed: %+v", snap.Discovered)
	}
	if snap.Discovered[0].Source != "kubeconfig" {
		t.Fatalf("expected first-wins (kubeconfig); got %q", snap.Discovered[0].Source)
	}
}

func TestManager_WatchFansInFromSources(t *testing.T) {
	a := &fakeSource{events: make(chan DiscoveryEvent, 4)}
	m := NewManager([]DiscoverySource{a})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events := m.Events(ctx)
	a.events <- DiscoveryEvent{Kind: EventAdd, Cluster: DiscoveredCluster{
		Identity: identity.LogicalIdentity{Name: "c1", ServerURL: "https://c1"}, Source: "fake",
	}}
	select {
	case e := <-events:
		if e.Kind != EventAdd || e.Cluster.Identity.Name != "c1" {
			t.Fatalf("unexpected: %+v", e)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("event not forwarded within 500ms")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/cluster/discovery/... -run TestManager -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```go
// manager.go
package discovery

import (
	"context"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/api/rest"
)

// Manager composes multiple DiscoverySources into a single deduplicated
// PresenceSnapshot. First-wins dedup by identity key — earlier sources
// in the slice take precedence.
type Manager struct {
	sources    []DiscoverySource
	mu         sync.RWMutex
	discovered []DiscoveredCluster
	byKey      map[string]int // key → index in discovered
}

func NewManager(sources []DiscoverySource) *Manager {
	return &Manager{sources: sources, byKey: map[string]int{}}
}

// Refresh enumerates every source and rebuilds the snapshot. Called on
// startup and whenever a quorum of events warrants a full re-sync.
func (m *Manager) Refresh(ctx context.Context) error {
	merged := []DiscoveredCluster{}
	byKey := map[string]int{}
	for _, s := range m.sources {
		enum, err := s.Enumerate(ctx)
		if err != nil {
			// Do NOT abort — one broken source should not blank out others.
			continue
		}
		for _, c := range enum {
			k := c.Identity.Key()
			if _, seen := byKey[k]; seen {
				continue
			}
			byKey[k] = len(merged)
			merged = append(merged, c)
		}
	}
	m.mu.Lock()
	m.discovered = merged
	m.byKey = byKey
	m.mu.Unlock()
	return nil
}

// Snapshot returns a copy-safe view. Registered/Connected wiring comes in
// Phase 2.7 when we attach the registration+connection managers.
func (m *Manager) Snapshot() rest.PresenceSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	// Copy to avoid callers mutating internal state.
	disc := make([]rest.DiscoveredCluster, len(m.discovered))
	for i, c := range m.discovered {
		disc[i] = rest.DiscoveredCluster{
			Identity:   c.Identity,
			Source:     c.Source,
			LastSeenAt: time.Now().Format(time.RFC3339),
		}
	}
	return rest.PresenceSnapshot{
		Discovered: disc,
		Registered: []rest.RegisteredCluster{},
		Connected:  []rest.ConnectedCluster{},
	}
}

// Events fans in all sources' Watch() channels. The manager filters out
// events that would be duplicates of already-known identities.
func (m *Manager) Events(ctx context.Context) <-chan DiscoveryEvent {
	out := make(chan DiscoveryEvent, 32)
	var wg sync.WaitGroup
	for _, s := range m.sources {
		ch, err := s.Watch(ctx)
		if err != nil {
			continue // source doesn't support watch
		}
		wg.Add(1)
		go func(c <-chan DiscoveryEvent) {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case ev, ok := <-c:
					if !ok {
						return
					}
					select {
					case out <- ev:
					case <-ctx.Done():
						return
					}
				}
			}
		}(ch)
	}
	go func() {
		wg.Wait()
		close(out)
	}()
	return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd kubilitics-backend && go test -race ./internal/cluster/discovery/... -run TestManager -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/cluster/discovery/manager.go \
        kubilitics-backend/internal/cluster/discovery/manager_test.go
git commit -m "feat(discovery): Manager composes sources + fans in events

First-wins dedup across sources. Refresh rebuilds the snapshot; Events
fans in all sources' Watch channels. Single broken source does NOT
silence the others."
```

---

### Task 2.7: Wire real `Manager` into presence handler, add SSE

**Files:**
- Modify: `kubilitics-backend/internal/api/rest/presence_handler.go` — add `StreamEvents` for SSE.
- Modify: `kubilitics-backend/cmd/server/main.go` — construct real Manager from config.

- [ ] **Step 1: Write the failing SSE test**

```go
// presence_handler_test.go (append)
func TestPresenceSSE_ForwardsEvents(t *testing.T) {
	mgr := &stubStreamer{events: make(chan discovery.DiscoveryEvent, 4)}
	h := NewPresenceHandler(mgr)
	srv := httptest.NewServer(http.HandlerFunc(h.StreamEvents))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("sse: %v", err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("expected SSE content-type, got %q", resp.Header.Get("Content-Type"))
	}

	// Inject an event.
	mgr.events <- discovery.DiscoveryEvent{
		Kind: discovery.EventAdd,
		Cluster: discovery.DiscoveredCluster{
			Identity: identity.LogicalIdentity{Name: "c1", ServerURL: "https://c1"},
		},
	}

	scanner := bufio.NewScanner(resp.Body)
	seen := false
	deadline := time.After(2 * time.Second)
	for !seen {
		select {
		case <-deadline:
			t.Fatal("no SSE frame within 2s")
		default:
			if scanner.Scan() && strings.HasPrefix(scanner.Text(), "data: ") {
				seen = true
			}
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/api/rest/... -run TestPresenceSSE -v`
Expected: FAIL.

- [ ] **Step 3: Add `StreamEvents` + extend manager interface**

In `presence_handler.go` expand the interface:

```go
// DiscoveryManager now also streams events.
type DiscoveryManager interface {
	Snapshot() PresenceSnapshot
	Events(ctx context.Context) <-chan discovery.DiscoveryEvent
}

// StreamEvents serves Server-Sent Events for presence updates.
func (h *PresenceHandler) StreamEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ctx := r.Context()
	ch := h.mgr.Events(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(evt)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		}
	}
}
```

- [ ] **Step 4: Wire real Manager in cmd/server/main.go**

Replace the `noopDiscoveryMgr` with:

```go
// Build discovery sources from config.
var sources []discovery.DiscoverySource
if kubeconfigPaths := resolveKubeconfigPaths(); len(kubeconfigPaths) > 0 {
	sources = append(sources, discovery.NewKubeconfigFileSource(kubeconfigPaths))
}
if inClusterCS != nil {
	sources = append(sources, discovery.NewKubernetesSecretSource(inClusterCS, "kubilitics"))
}
sources = append(sources, discovery.NewManualSource(clusterRepo))

discoveryMgr := discovery.NewManager(sources)
if err := discoveryMgr.Refresh(context.Background()); err != nil {
	log.Printf("initial discovery refresh: %v", err)
}

presenceHandler := rest.NewPresenceHandler(discoveryMgr)
router.HandleFunc("/api/v1/presence", presenceHandler.GetSnapshot).Methods("GET")
router.HandleFunc("/api/v1/presence/events", presenceHandler.StreamEvents).Methods("GET")

// Periodic refresh (defensive — watch streams should keep it up to date).
go func() {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for range t.C {
		_ = discoveryMgr.Refresh(context.Background())
	}
}()

// resolveKubeconfigPaths honors KUBECONFIG env (colon-split) then ~/.kube/config.
func resolveKubeconfigPaths() []string {
	if env := os.Getenv("KUBECONFIG"); env != "" {
		return filepath.SplitList(env)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	return []string{filepath.Join(home, ".kube", "config")}
}
```

- [ ] **Step 5: Run tests, smoke test, commit**

```bash
cd kubilitics-backend && go test ./... -count=1 -race -timeout 120s
cd kubilitics-backend && go build ./...

# smoke: start backend, hit /presence, verify non-empty if local ~/.kube/config has contexts
/tmp/kb-backend -port 8199 > /tmp/kb.log 2>&1 &
PID=$!
sleep 2
curl -sS http://127.0.0.1:8199/api/v1/presence | jq .
kill $PID
```

Expected: `discovered[]` non-empty if local `~/.kube/config` has contexts.

```bash
git add kubilitics-backend/internal/api/rest/presence_handler.go \
        kubilitics-backend/internal/api/rest/presence_handler_test.go \
        kubilitics-backend/cmd/server/main.go
git commit -m "feat(phase-2): real Manager wired + SSE event stream

/api/v1/presence returns actual discovered clusters from kubeconfig +
secrets + manual DB. /api/v1/presence/events streams DiscoveryEvents
as SSE. 60s defensive ticker re-refreshes the snapshot in case a
source's Watch drops events silently."
```

---

**Phase 2 verification gate:**
```bash
cd kubilitics-backend && go test ./... -count=1 -race -timeout 120s
cd kubilitics-backend && go build ./...
curl -sS http://127.0.0.1:8190/api/v1/presence | jq '.discovered | length'   # >= local kubeconfig context count
(echo; curl -sS -N http://127.0.0.1:8190/api/v1/presence/events | head -5) & \
  sleep 1 && touch ~/.kube/config ; sleep 2 && pkill -f 'curl.*events'        # should emit at least one SSE frame
```

---

# Phase 3 — Frontend Presence Store (shadowed)

**Goal:** Build the frontend plumbing for the new presence model, behind `FEATURE_PRESENCE_V2`. The new store runs alongside `clusterStore`. No user-visible change yet.

**Exit criteria:** Frontend unit tests green; with flag ON, the new store reflects backend snapshot; with flag OFF, nothing in the UI changes.

---

### Task 3.1: Frontend feature flag

**Files:**
- Create: `kubilitics-frontend/src/lib/featureFlags.ts`
- Create: `kubilitics-frontend/src/lib/featureFlags.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// featureFlags.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featurePresenceV2 } from './featureFlags';

describe('featurePresenceV2', () => {
  beforeEach(() => {
    (globalThis as any).__KUBILITICS_FEATURE_OVERRIDES__ = {};
  });

  it('defaults false when nothing is set', () => {
    expect(featurePresenceV2()).toBe(false);
  });

  it('honors Vite env VITE_FEATURE_PRESENCE_V2=true', () => {
    vi.stubEnv('VITE_FEATURE_PRESENCE_V2', 'true');
    expect(featurePresenceV2()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('honors runtime localStorage override for QA toggling', () => {
    localStorage.setItem('kubilitics.feature.presenceV2', 'true');
    expect(featurePresenceV2()).toBe(true);
    localStorage.removeItem('kubilitics.feature.presenceV2');
  });
});
```

- [ ] **Step 2: Run test (fail)**

Run: `cd kubilitics-frontend && npx vitest run src/lib/featureFlags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// featureFlags.ts
// Feature flag readers for the onboarding-v2 rollout. Priority:
//   1. localStorage override (QA / developer toggle, persists across reloads)
//   2. Vite build-time env (production default)
//   3. Hard-coded default (false during rollout)
// Runtime changes require a page reload since stores read once at init.

const STORAGE_PREFIX = 'kubilitics.feature.';

function readFlag(name: string, envKey: string): boolean {
  try {
    const ls = localStorage.getItem(STORAGE_PREFIX + name);
    if (ls === 'true') return true;
    if (ls === 'false') return false;
  } catch {
    // SSR / privacy mode — fall through.
  }
  const env = import.meta.env[envKey];
  return env === 'true' || env === true;
}

export function featurePresenceV2(): boolean {
  return readFlag('presenceV2', 'VITE_FEATURE_PRESENCE_V2');
}
```

- [ ] **Step 4: Run test (pass) + commit**

```bash
cd kubilitics-frontend && npx vitest run src/lib/featureFlags.test.ts
# → 3 passed

git add kubilitics-frontend/src/lib/featureFlags.ts kubilitics-frontend/src/lib/featureFlags.test.ts
git commit -m "feat(frontend): feature flag reader for onboarding-v2

localStorage override > Vite env > false. QA can toggle via DevTools
console: localStorage.setItem('kubilitics.feature.presenceV2','true')."
```

---

### Task 3.2: `LogicalIdentity` + types

**Files:**
- Create: `kubilitics-frontend/src/types/resilient.ts`
- Create: `kubilitics-frontend/src/types/resilient.test.ts`

- [ ] **Step 1: Test (fail)**

```ts
// resilient.test.ts
import { describe, it, expect } from 'vitest';
import { logicalIdentityEqual, logicalIdentityKey } from './resilient';

describe('logicalIdentity', () => {
  it('equals case-insensitive host', () => {
    expect(logicalIdentityEqual(
      { name: 'prod', serverUrl: 'https://X.example.com:6443' },
      { name: 'prod', serverUrl: 'https://x.example.com:6443' }
    )).toBe(true);
  });

  it('differs on case-sensitive name', () => {
    expect(logicalIdentityEqual(
      { name: 'PROD', serverUrl: 'https://x:6443' },
      { name: 'prod', serverUrl: 'https://x:6443' }
    )).toBe(false);
  });

  it('trailing slash is ignored', () => {
    expect(logicalIdentityKey({ name: 'a', serverUrl: 'https://x/' }))
      .toBe(logicalIdentityKey({ name: 'a', serverUrl: 'https://x' }));
  });
});
```

- [ ] **Step 2: Implement**

```ts
// resilient.ts
// Cross-cutting types for the onboarding-v2 epic — mirror the Go shapes.
// Keep in sync with kubilitics-backend/internal/cluster/identity/logical.go
// and internal/api/resilient/envelope.go.

export interface LogicalIdentity {
  name: string;
  serverUrl: string;
}

export function logicalIdentityKey(id: LogicalIdentity): string {
  return `${id.name}|${normalizeUrl(id.serverUrl)}`;
}

export function logicalIdentityEqual(a: LogicalIdentity, b: LogicalIdentity): boolean {
  return logicalIdentityKey(a) === logicalIdentityKey(b);
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

export interface ResilientResponse<T> {
  data?: T;
  reachable: boolean;
  stale?: boolean;
  stale_as_of?: string; // ISO-8601
  error_message?: string;
  health_status: 'healthy' | 'unreachable' | 'degraded';
}

export interface DiscoveredCluster {
  identity: LogicalIdentity;
  source: 'kubeconfig' | 'secret' | 'manual';
  context_name?: string;
  kubeconfig_path?: string;
  last_seen_at?: string;
}

export interface RegisteredCluster extends DiscoveredCluster {
  registered_at: string;
  reachable: boolean;
}

export interface ConnectedCluster extends RegisteredCluster {
  connected_at: string;
}

export interface PresenceSnapshot {
  discovered: DiscoveredCluster[];
  registered: RegisteredCluster[];
  connected: ConnectedCluster[];
  last_used?: LogicalIdentity;
}
```

- [ ] **Step 3: Test (pass) + commit**

```bash
cd kubilitics-frontend && npx vitest run src/types/resilient.test.ts
# → 3 passed

git add kubilitics-frontend/src/types/resilient.ts kubilitics-frontend/src/types/resilient.test.ts
git commit -m "feat(frontend): LogicalIdentity + ResilientResponse types

Mirrors Go shapes; normalizes host case + trailing slash. Shared source
of truth for presence store, resilient-query hook, and UI components."
```

---

### Task 3.3: `clusterPresenceStore` skeleton

**Files:**
- Create: `kubilitics-frontend/src/stores/clusterPresenceStore.ts`
- Create: `kubilitics-frontend/src/stores/clusterPresenceStore.test.ts`

- [ ] **Step 1: Test (fail)** — focus on initial state + `setActiveByLogicalIdentity`.

```ts
// clusterPresenceStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useClusterPresenceStore, __resetForTest } from './clusterPresenceStore';

describe('clusterPresenceStore', () => {
  beforeEach(() => { __resetForTest(); });

  it('initial state is empty and not ready', () => {
    const s = useClusterPresenceStore.getState();
    expect(s.discovered).toEqual([]);
    expect(s.registered).toEqual([]);
    expect(s.connected).toEqual([]);
    expect(s.activeLogicalIdentity).toBeNull();
    expect(s.isReady).toBe(false);
  });

  it('applySnapshot populates state + marks ready', () => {
    useClusterPresenceStore.getState().applySnapshot({
      discovered: [{ identity: { name: 'a', serverUrl: 'https://a' }, source: 'kubeconfig' }],
      registered: [],
      connected: [],
      last_used: { name: 'a', serverUrl: 'https://a' },
    });
    const s = useClusterPresenceStore.getState();
    expect(s.discovered.length).toBe(1);
    expect(s.isReady).toBe(true);
    expect(s.activeLogicalIdentity?.name).toBe('a');
  });

  it('setActiveByLogicalIdentity persists to localStorage', () => {
    const id = { name: 'prod', serverUrl: 'https://prod' };
    useClusterPresenceStore.getState().setActiveByLogicalIdentity(id);
    const raw = localStorage.getItem('kubilitics.presence.lastActive');
    expect(JSON.parse(raw!)).toEqual(id);
  });

  it('activeCluster derives from connected using logical identity', () => {
    useClusterPresenceStore.getState().applySnapshot({
      discovered: [],
      registered: [],
      connected: [{
        identity: { name: 'prod', serverUrl: 'https://prod' },
        source: 'kubeconfig',
        registered_at: '', reachable: true, connected_at: '',
      }],
      last_used: { name: 'prod', serverUrl: 'https://prod' },
    });
    const s = useClusterPresenceStore.getState();
    expect(s.activeCluster()?.identity.name).toBe('prod');
  });
});
```

- [ ] **Step 2: Implement**

```ts
// clusterPresenceStore.ts
// The single source of truth for cluster presence in the frontend.
// Supersedes clusterStore + backendConfigStore cluster fields +
// onboardingStore (the latter three are deleted in Phase 7).
//
// Never persists session UUIDs. Only logical identity persists.
import { create } from 'zustand';
import type {
  ConnectedCluster,
  DiscoveredCluster,
  LogicalIdentity,
  PresenceSnapshot,
  RegisteredCluster,
} from '@/types/resilient';
import { logicalIdentityEqual, logicalIdentityKey } from '@/types/resilient';

const STORAGE_KEY = 'kubilitics.presence.lastActive';

function loadPersisted(): LogicalIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LogicalIdentity) : null;
  } catch {
    return null;
  }
}

interface ClusterPresenceState {
  discovered: DiscoveredCluster[];
  registered: RegisteredCluster[];
  connected: ConnectedCluster[];
  activeLogicalIdentity: LogicalIdentity | null;
  isReady: boolean;

  applySnapshot(snap: PresenceSnapshot): void;
  setActiveByLogicalIdentity(id: LogicalIdentity): void;
  activeCluster(): ConnectedCluster | null;
  availableClusters(): DiscoveredCluster[];
}

export const useClusterPresenceStore = create<ClusterPresenceState>((set, get) => ({
  discovered: [],
  registered: [],
  connected: [],
  activeLogicalIdentity: loadPersisted(),
  isReady: false,

  applySnapshot(snap) {
    set((state) => ({
      discovered: snap.discovered,
      registered: snap.registered,
      connected: snap.connected,
      isReady: true,
      // Prefer backend's last_used only if no local preference exists.
      activeLogicalIdentity: state.activeLogicalIdentity ?? snap.last_used ?? null,
    }));
  },

  setActiveByLogicalIdentity(id) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
    } catch {
      // ignore quota/privacy failures
    }
    set({ activeLogicalIdentity: id });
  },

  activeCluster() {
    const { connected, activeLogicalIdentity } = get();
    if (!activeLogicalIdentity) return null;
    return connected.find((c) => logicalIdentityEqual(c.identity, activeLogicalIdentity)) ?? null;
  },

  availableClusters() {
    const { discovered, registered } = get();
    const mergedMap = new Map<string, DiscoveredCluster>();
    for (const c of discovered) mergedMap.set(logicalIdentityKey(c.identity), c);
    for (const c of registered) mergedMap.set(logicalIdentityKey(c.identity), c);
    return Array.from(mergedMap.values());
  },
}));

// Test-only reset.
export function __resetForTest(): void {
  localStorage.removeItem(STORAGE_KEY);
  useClusterPresenceStore.setState({
    discovered: [],
    registered: [],
    connected: [],
    activeLogicalIdentity: null,
    isReady: false,
  });
}
```

- [ ] **Step 3: Run tests, commit**

```bash
cd kubilitics-frontend && npx vitest run src/stores/clusterPresenceStore.test.ts
# → 4 passed

git add kubilitics-frontend/src/stores/clusterPresenceStore.ts \
        kubilitics-frontend/src/stores/clusterPresenceStore.test.ts
git commit -m "feat(frontend): clusterPresenceStore — single source of truth

Logical-identity-only persistence (no session UUIDs). Derived selectors
activeCluster + availableClusters. Phase 3 companion to backend presence
endpoint — consumed in Phase 4+ via SSE hook."
```

---

### Task 3.4: `useClusterPresence` SSE hook

**Files:**
- Create: `kubilitics-frontend/src/hooks/useClusterPresence.ts`
- Create: `kubilitics-frontend/src/hooks/useClusterPresence.test.ts`

- [ ] **Step 1: Test (fail)**

```ts
// useClusterPresence.test.ts — exercises the snapshot-fetch + EventSource path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useClusterPresence } from './useClusterPresence';
import { useClusterPresenceStore, __resetForTest } from '@/stores/clusterPresenceStore';

describe('useClusterPresence', () => {
  beforeEach(() => {
    __resetForTest();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      discovered: [{ identity: { name: 'a', serverUrl: 'https://a' }, source: 'kubeconfig' }],
      registered: [], connected: [], last_used: null,
    }), { status: 200 })));
    // Stub EventSource to a no-op open.
    class FakeES {
      url: string; onmessage: any = null; onerror: any = null;
      constructor(url: string) { this.url = url; }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeES);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fetches initial snapshot on mount', async () => {
    renderHook(() => useClusterPresence());
    await waitFor(() => {
      expect(useClusterPresenceStore.getState().isReady).toBe(true);
      expect(useClusterPresenceStore.getState().discovered.length).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// useClusterPresence.ts
import { useEffect, useRef } from 'react';
import type { DiscoveryEventKind, PresenceSnapshot } from '@/types/resilient';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';

const PRESENCE_URL = '/api/v1/presence';
const SSE_URL = '/api/v1/presence/events';

// useClusterPresence subscribes to the backend's presence layer:
//   1. On mount, fetch the current snapshot and apply it.
//   2. Open an EventSource to /api/v1/presence/events and apply deltas.
// Reconnect on error with exponential backoff (1s → 2s → 4s → cap 30s).
export function useClusterPresence(): void {
  const applySnapshot = useClusterPresenceStore((s) => s.applySnapshot);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;

    async function fetchSnapshot() {
      try {
        const r = await fetch(PRESENCE_URL, { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const snap = (await r.json()) as PresenceSnapshot;
        if (!cancelled) applySnapshot(snap);
      } catch (err) {
        console.warn('presence snapshot fetch failed:', err);
      }
    }

    function openStream() {
      if (cancelled) return;
      const es = new EventSource(SSE_URL, { withCredentials: true } as any);
      esRef.current = es;
      es.onmessage = async () => {
        // Simplest correct impl: re-fetch snapshot on any event. Cheap
        // (cached in backend). Future optimization: patch store deltas
        // from the event payload directly.
        await fetchSnapshot();
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelled) return;
        setTimeout(() => {
          backoff = Math.min(backoff * 2, 30_000);
          openStream();
        }, backoff);
      };
    }

    void fetchSnapshot().then(openStream);

    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [applySnapshot]);
}
```

- [ ] **Step 3: Test (pass), commit**

```bash
cd kubilitics-frontend && npx vitest run src/hooks/useClusterPresence.test.ts
# → 1 passed

git add kubilitics-frontend/src/hooks/useClusterPresence.ts \
        kubilitics-frontend/src/hooks/useClusterPresence.test.ts
git commit -m "feat(frontend): useClusterPresence SSE subscription

On mount: fetch snapshot, open EventSource, re-fetch on event. Backoff
reconnect 1s→30s. Safe for StrictMode double-mount."
```

---

**Phase 3 verification gate:**
```bash
cd kubilitics-frontend && npm run typecheck
cd kubilitics-frontend && npx vitest run src/{lib,stores,hooks,types}/{featureFlags,clusterPresenceStore,useClusterPresence,resilient}.test.ts
# → all green
```

---

# Phase 4 — Resilience Contract Rollout

**Goal:** Every cluster-scoped endpoint uses `WrapClusterHandler`; every frontend data hook uses `useResilientQuery`; every cluster-dependent UI region is wrapped by `ClusterUnreachableBoundary`.

**Exit criteria:** `useResourceCounts` refactored onto `useResilientQuery` with zero regression. At least one new endpoint (pods) also migrated end-to-end as proof of pattern. Remaining endpoints follow the same template in subsequent tasks.

---

### Task 4.1: `useResilientQuery<T>` hook

**Files:**
- Create: `kubilitics-frontend/src/hooks/useResilientQuery.ts`
- Create: `kubilitics-frontend/src/hooks/useResilientQuery.test.ts`

- [ ] **Step 1: Test (fail)** — 4 tests mirroring the `useResourceCounts` regression pattern.

```ts
// useResilientQuery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { useResilientQuery } from './useResilientQuery';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useResilientQuery', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('happy path: returns data, reachable=true, not stale', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { count: 42 }, reachable: true, health_status: 'healthy',
    }), { status: 200 })));
    const { result } = renderHook(
      () => useResilientQuery<{ count: number }>('/api/x'),
      { wrapper: wrapper(qc) }
    );
    await waitFor(() => expect(result.current.data).toEqual({ count: 42 }));
    expect(result.current.isReachable).toBe(true);
    expect(result.current.isStale).toBe(false);
    expect(result.current.errorMessage).toBeNull();
  });

  it('preserves last-known data when transitioning to unreachable', async () => {
    const first = new Response(JSON.stringify({
      data: { count: 42 }, reachable: true, health_status: 'healthy',
    }), { status: 200 });
    const second = new Response(JSON.stringify({
      reachable: false, error_message: 'connection refused', health_status: 'unreachable',
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useResilientQuery<{ count: number }>(`/api/x?${n}`),
      { wrapper: wrapper(qc), initialProps: { n: 1 } }
    );
    await waitFor(() => expect(result.current.data).toEqual({ count: 42 }));
    rerender({ n: 2 });
    await waitFor(() => expect(result.current.isReachable).toBe(false));
    expect(result.current.data).toEqual({ count: 42 }); // last-known preserved
    expect(result.current.isStale).toBe(true);
    expect(result.current.errorMessage).toBe('connection refused');
  });

  it('returns backend stale data as stale without promoting to session cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { count: 10 }, reachable: false, stale: true,
      stale_as_of: '2026-04-24T10:00:00Z',
      error_message: 'timeout', health_status: 'unreachable',
    }), { status: 200 })));
    const { result } = renderHook(
      () => useResilientQuery<{ count: number }>('/api/x'),
      { wrapper: wrapper(qc) }
    );
    await waitFor(() => expect(result.current.data).toEqual({ count: 10 }));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isReachable).toBe(false);
  });

  it('no data + no session cache → data undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reachable: false, error_message: 'down', health_status: 'unreachable',
    }), { status: 200 })));
    const { result } = renderHook(
      () => useResilientQuery<{ count: number }>('/api/x'),
      { wrapper: wrapper(qc) }
    );
    await waitFor(() => expect(result.current.isReachable).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isStale).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (fail)**

Run: `cd kubilitics-frontend && npx vitest run src/hooks/useResilientQuery.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// useResilientQuery.ts
import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { useRef } from 'react';
import type { ResilientResponse } from '@/types/resilient';

export interface ResilientQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isReachable: boolean;
  isStale: boolean;
  errorMessage: string | null;
  refetch: () => void;
}

interface Options<T> {
  clusterId?: string;                                     // for cache-busting on cluster switch
  refetchInterval?: number;
  queryOptions?: Partial<UseQueryOptions<ResilientResponse<T>>>;
}

// useResilientQuery wraps react-query with the honest-degradation
// contract established by 10848cf and generalized in
// docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md §5.
export function useResilientQuery<T>(
  endpoint: string,
  options: Options<T> = {},
): ResilientQueryResult<T> {
  const sessionCacheRef = useRef<T | undefined>(undefined);

  const query = useQuery<ResilientResponse<T>>({
    queryKey: ['resilient', endpoint, options.clusterId],
    queryFn: async () => {
      const r = await fetch(endpoint, { credentials: 'include' });
      if (r.status >= 500) {
        // Real bug — surface it.
        throw new Error(`HTTP ${r.status}`);
      }
      return (await r.json()) as ResilientResponse<T>;
    },
    staleTime: 30_000,
    retry: 1,
    refetchInterval: options.refetchInterval,
    ...options.queryOptions,
  });

  const env = query.data;

  // Promote to session cache on healthy success.
  if (env && env.reachable && env.data !== undefined) {
    sessionCacheRef.current = env.data;
  }

  let data: T | undefined;
  let isStale = false;
  let isReachable = env?.reachable ?? false;
  let errorMessage: string | null = null;

  if (env) {
    if (env.reachable) {
      data = env.data;
      isStale = false;
    } else if (env.stale && env.data !== undefined) {
      // Backend stale — display verbatim, DO NOT promote to session cache.
      data = env.data;
      isStale = true;
      errorMessage = env.error_message ?? null;
    } else if (sessionCacheRef.current !== undefined) {
      data = sessionCacheRef.current;
      isStale = true;
      errorMessage = env.error_message ?? null;
    } else {
      data = undefined;
      errorMessage = env.error_message ?? null;
    }
  }

  return {
    data,
    isLoading: query.isLoading,
    isReachable,
    isStale,
    errorMessage,
    refetch: () => { void query.refetch(); },
  };
}
```

- [ ] **Step 4: Run tests (pass), commit**

```bash
cd kubilitics-frontend && npx vitest run src/hooks/useResilientQuery.test.ts
# → 4 passed

git add kubilitics-frontend/src/hooks/useResilientQuery.ts \
        kubilitics-frontend/src/hooks/useResilientQuery.test.ts
git commit -m "feat(frontend): useResilientQuery hook — generalizes 10848cf

Four-state model: healthy | backend-stale | session-cache-stale |
no-data. Never promotes stale-of-stale to session cache (correctness).
4 regression tests carry over the pattern locked in by useResourceCounts."
```

---

### Task 4.2: `ClusterUnreachableBoundary` component

**Files:**
- Create: `kubilitics-frontend/src/components/common/ClusterUnreachableBoundary.tsx`
- Create: `kubilitics-frontend/src/components/common/ClusterUnreachableBoundary.test.tsx`

- [ ] **Step 1: Test (fail)**

```tsx
// ClusterUnreachableBoundary.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClusterUnreachableBoundary } from './ClusterUnreachableBoundary';

describe('ClusterUnreachableBoundary', () => {
  it('renders children plainly when reachable', () => {
    render(
      <ClusterUnreachableBoundary isReachable isStale={false} errorMessage={null} onSwitchCluster={() => {}} onRetry={() => {}}>
        <p>body</p>
      </ClusterUnreachableBoundary>
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders banner when unreachable', () => {
    render(
      <ClusterUnreachableBoundary isReachable={false} isStale errorMessage="connection refused" onSwitchCluster={() => {}} onRetry={() => {}}>
        <p>body</p>
      </ClusterUnreachableBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument(); // children still shown
  });

  it('retry button calls onRetry', () => {
    const retry = vi.fn();
    render(
      <ClusterUnreachableBoundary isReachable={false} isStale errorMessage="x" onSwitchCluster={() => {}} onRetry={retry}>
        <p>body</p>
      </ClusterUnreachableBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run (fail) + Implement**

```tsx
// ClusterUnreachableBoundary.tsx
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  isReachable: boolean;
  isStale: boolean;
  errorMessage: string | null;
  onSwitchCluster: () => void;
  onRetry: () => void;
  children: ReactNode;
}

export function ClusterUnreachableBoundary({
  isReachable, isStale, errorMessage, onSwitchCluster, onRetry, children,
}: Props) {
  if (isReachable) {
    return <>{children}</>;
  }
  return (
    <div>
      <div
        role="alert"
        className="mb-3 flex items-start gap-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-sm"
      >
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
        <div className="flex-1">
          <div className="font-medium">Cluster unreachable{errorMessage ? ` — ${errorMessage}` : ''}</div>
          <div className="mt-0.5 text-xs opacity-80">
            Showing last-known data.{' '}
            <button className="underline" onClick={onRetry}>Retry</button>
            {' · '}
            <button className="underline" onClick={onSwitchCluster}>Switch cluster</button>
          </div>
        </div>
      </div>
      <div className={cn('relative', isStale && 'opacity-75')}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Tests (pass), commit**

```bash
cd kubilitics-frontend && npx vitest run src/components/common/ClusterUnreachableBoundary.test.tsx
# → 3 passed

git add kubilitics-frontend/src/components/common/ClusterUnreachableBoundary.tsx \
        kubilitics-frontend/src/components/common/ClusterUnreachableBoundary.test.tsx
git commit -m "feat(frontend): ClusterUnreachableBoundary component

Non-intrusive banner when unreachable; children render at 75% opacity
when stale. Retry + Switch actions passed in by caller. Tailwind +
existing cn() util; no new deps."
```

---

### Task 4.3: Migrate `/api/v1/clusters/{id}/summary` to `WrapClusterHandler`

**Files:**
- Modify: `kubilitics-backend/internal/api/rest/handler.go` — `GetClusterSummary`

The existing handler already implements the pattern inline (per 10848cf). Refactor onto the shared helper for DRY-ness. Behavior must not change.

- [ ] **Step 1: Find the current handler**

```bash
grep -n "GetClusterSummary" kubilitics-backend/internal/api/rest/handler.go
```

- [ ] **Step 2: Refactor in place**

Replace the body of `GetClusterSummary` with a call to `resilient.WrapClusterHandler`:

```go
func (h *Handler) GetClusterSummary(w http.ResponseWriter, r *http.Request) {
	wrapper := resilient.WrapClusterHandler[models.ClusterSummary](
		h.summaryCache,
		func(r *http.Request) string {
			vars := mux.Vars(r)
			return vars["clusterId"] + "|" + r.URL.Query().Get("projectId")
		},
		func(ctx context.Context, r *http.Request) (models.ClusterSummary, error) {
			client, err := h.getClientFromRequest(r)
			if err != nil {
				return models.ClusterSummary{}, err
			}
			return h.clusterService.GetClusterInfo(ctx, client)
		},
	)
	wrapper(w, r)
}
```

The existing `models.ClusterSummary` gets WRAPPED inside `ResilientResponse`. This changes the JSON shape: from `{..., reachable, stale, ...}` flat at top-level to `{ data: {...}, reachable, stale, ... }` nested.

**Frontend impact:** `useResourceCounts.ts` must be updated to read from `data` first. This is handled in Task 4.4 immediately after.

- [ ] **Step 3: Update existing backend tests to new shape**

Run: `go test ./internal/api/rest/... -run TestGetClusterSummary`. Expected: FAIL because the envelope shape changed. Update assertions to match the new nested shape.

- [ ] **Step 4: Commit**

```bash
git add kubilitics-backend/internal/api/rest/handler.go kubilitics-backend/internal/api/rest/handler_test.go
git commit -m "refactor(summary): migrate onto resilient.WrapClusterHandler

Behavior preserved; JSON shape changes from flat to envelope — matching
frontend in the next commit. DRY: eliminates per-handler repetition
of the cache + unreachable-fallback dance."
```

---

### Task 4.4: Migrate `useResourceCounts` onto `useResilientQuery`

**Files:**
- Modify: `kubilitics-frontend/src/hooks/useResourceCounts.ts`

- [ ] **Step 1: Replace internals of `useResourceCounts` with `useResilientQuery`**

The hook's public return shape must stay the same so existing consumers (Sidebar + ClusterReachabilityBanner) aren't touched in this task.

```ts
// useResourceCounts.ts
// Backend source: /api/v1/clusters/{id}/summary
// Now runs on top of useResilientQuery — behavior identical, code ~60% smaller.
import { useResilientQuery } from './useResilientQuery';
import { useClusterStore } from '@/stores/clusterStore';
import type { BackendClusterSummary } from '@/services/api/types';
// … rest of existing imports

export function useResourceCounts(): ResourceCountsResult {
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const q = useResilientQuery<BackendClusterSummary>(
    activeCluster ? `/api/v1/clusters/${activeCluster.id}/summary` : '',
    { clusterId: activeCluster?.id }
  );

  return {
    counts: q.data ? summaryToCounts(q.data) : zeroCounts,
    isLoading: q.isLoading,
    reachable: q.isReachable,
    stale: q.isStale,
    errorMessage: q.errorMessage,
    usingClientCache: q.isStale && !q.isReachable,
  };
}
```

- [ ] **Step 2: Run regression tests**

```bash
cd kubilitics-frontend && npx vitest run src/hooks/useResourceCounts.test.ts
```

Expected: all 4 tests still pass (the test suite locks the public contract).

- [ ] **Step 3: Commit**

```bash
git add kubilitics-frontend/src/hooks/useResourceCounts.ts
git commit -m "refactor(counts): useResourceCounts rebuilt on useResilientQuery

-60% LOC; identical public contract. The 4 regression tests that locked
in 10848cf's semantics now cover the generalized pattern too."
```

---

### Task 4.5–4.10: Migrate the remaining cluster-scoped endpoints

For each of the following endpoints, repeat the pattern of Task 4.3 (backend) + Task 4.4 (frontend):

| # | Backend handler | Backend file | Frontend hook | Frontend file |
|---|---|---|---|---|
| 4.5 | `GetPods` | `pods_handler.go` | `usePods` | `hooks/usePods.ts` |
| 4.6 | `GetDeployments` | `deployments_handler.go` | `useDeployments` | `hooks/useDeployments.ts` |
| 4.7 | `GetServices` | `services_handler.go` | `useServices` | `hooks/useServices.ts` |
| 4.8 | `GetNodes` | `nodes_handler.go` | `useNodes` | `hooks/useNodes.ts` |
| 4.9 | `GetNamespaces` | `namespaces_handler.go` | `useNamespaces` | `hooks/useNamespaces.ts` |
| 4.10 | `GetEvents` | `events_handler.go` | `useEvents` | `hooks/useEvents.ts` |

For each task (4.5 through 4.10):

- [ ] **Step 1:** Backend: wrap the existing fetch function with `resilient.WrapClusterHandler` using a cache keyed by `(clusterId, query string)`. Reuse the existing model type as `T`.

- [ ] **Step 2:** Update the handler's existing unit tests — envelope shape changed from flat to nested; test assertions adjust accordingly.

- [ ] **Step 3:** Frontend: replace the hook's body with a `useResilientQuery<BackendShape>` call. Preserve the hook's public return shape so consumers don't break.

- [ ] **Step 4:** Update the hook's unit tests to assert on the new internal behavior — specifically that stale state is preserved on transient failure.

- [ ] **Step 5:** Commit with message `refactor(<domain>): migrate onto resilient pattern`.

**Each of these is a ~15-minute task.** Do them one at a time. Verification between each: `go test ./internal/api/rest/...` green + frontend vitest green.

---

### Task 4.11: Extend `ClusterReachabilityBanner` to use `ClusterUnreachableBoundary`

**Files:**
- Modify: `kubilitics-frontend/src/components/layout/Sidebar.tsx`

Replace the ad-hoc banner added in 10848cf with the generic component.

- [ ] **Step 1**: Find the current `ClusterReachabilityBanner` render in `Sidebar.tsx`. Replace it with a wrap of child content in `<ClusterUnreachableBoundary …>`. Same tests in `Sidebar.test.tsx` should still pass.

- [ ] **Step 2**: Run `npx vitest run src/components/layout/Sidebar.test.tsx`. Expected: PASS.

- [ ] **Step 3**: Commit: `refactor(sidebar): use shared ClusterUnreachableBoundary`.

---

**Phase 4 verification gate:**
```bash
cd kubilitics-backend && go test ./... -count=1 -race -timeout 120s
cd kubilitics-frontend && npm run typecheck && npx vitest run
```

All green. Critically: the 4 regression tests from 10848cf still pass word-for-word.

---

# Phase 5 — New UX Routes

**Goal:** `/clusters` picker and `/welcome` zero-state are live behind `FEATURE_PRESENCE_V2`. Old `/connect` still works.

---

### Task 5.1: `ClusterPickerPage` component

**Files:**
- Create: `kubilitics-frontend/src/pages/ClusterPickerPage.tsx`
- Create: `kubilitics-frontend/src/pages/ClusterPickerPage.test.tsx`

- [ ] **Step 1: Test (fail)** — verify rendering, cluster click behavior, search filter, virtual scroll for >50 items.

```tsx
// ClusterPickerPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClusterPickerPage } from './ClusterPickerPage';
import { useClusterPresenceStore, __resetForTest } from '@/stores/clusterPresenceStore';

describe('ClusterPickerPage', () => {
  beforeEach(() => __resetForTest());

  it('renders one card per discovered cluster', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod', serverUrl: 'https://p' }, source: 'kubeconfig' },
        { identity: { name: 'dev',  serverUrl: 'https://d' }, source: 'kubeconfig' },
      ],
      isReady: true,
    } as any);
    render(<MemoryRouter><ClusterPickerPage /></MemoryRouter>);
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('clicking a cluster sets active identity and navigates', () => {
    const nav = vi.fn();
    vi.mock('react-router-dom', async (orig) => ({
      ...(await orig<any>()), useNavigate: () => nav,
    }));
    useClusterPresenceStore.setState({
      discovered: [{ identity: { name: 'prod', serverUrl: 'https://p' }, source: 'kubeconfig' }],
      isReady: true,
    } as any);
    render(<MemoryRouter><ClusterPickerPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /prod/i }));
    expect(useClusterPresenceStore.getState().activeLogicalIdentity?.name).toBe('prod');
    expect(nav).toHaveBeenCalledWith('/dashboard');
  });

  it('search filter narrows visible cards', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod-us', serverUrl: 'https://p' }, source: 'kubeconfig' },
        { identity: { name: 'staging', serverUrl: 'https://s' }, source: 'kubeconfig' },
      ],
      isReady: true,
    } as any);
    render(<MemoryRouter><ClusterPickerPage /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'prod' } });
    expect(screen.getByText('prod-us')).toBeInTheDocument();
    expect(screen.queryByText('staging')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement** — a straightforward React component reading from the store, filtering by name/server match, rendering cards with status badge (derived from `registered[].reachable` if present, else "unknown"), virtual-scroll via react-window when count >50.

Provide full source in the implementation (~150 LOC) — use the shape from existing pages in `src/pages/` for styling consistency (Tailwind + existing `cn()` util). Cards show: name (bold), server URL (muted, monospace), source badge (kubeconfig/secret/manual), reachability dot.

- [ ] **Step 3: Tests (pass), commit**

```bash
cd kubilitics-frontend && npx vitest run src/pages/ClusterPickerPage.test.tsx
git add src/pages/ClusterPickerPage.*
git commit -m "feat(ux): ClusterPickerPage — new /clusters landing

Reads from clusterPresenceStore; click → set active + /dashboard;
search filter; react-window virtual scroll >50 items. Behind
FEATURE_PRESENCE_V2 (wired in Task 5.3)."
```

---

### Task 5.2: `WelcomePage` component

**Files:**
- Create: `kubilitics-frontend/src/pages/WelcomePage.tsx`
- Create: `kubilitics-frontend/src/pages/WelcomePage.test.tsx`

Minimal: 3 CTAs from spec §7.4. Integrates existing `kcli create` path if available (check `src/services/api/kcli.ts` or similar); otherwise, the "Create a local cluster" button routes to the existing cluster-creation UI flow.

- [ ] **Step 1**: Test renders 3 CTAs; clicking each navigates to the expected route.
- [ ] **Step 2**: Implement.
- [ ] **Step 3**: Tests + commit: `feat(ux): WelcomePage zero-state for new users`.

---

### Task 5.3: Feature-flagged routing in `App.tsx`

**Files:**
- Modify: `kubilitics-frontend/src/App.tsx`

- [ ] **Step 1**: When `featurePresenceV2()` is true:
  - Replace `/connect` default landing with a conditional: if discovered+registered is empty → `/welcome`, else → `/clusters`.
  - Mount `useClusterPresence()` at the top level (inside the `AppLayout` wrapper, after auth).
  - Keep `/connect` route for now as a back-compat redirect.

When the flag is false: nothing changes.

- [ ] **Step 2**: Add a new test `App.test.tsx` asserting both flag paths.
- [ ] **Step 3**: Commit: `feat(ux): flag-gated routing to /clusters + /welcome`.

---

**Phase 5 verification gate:**
```bash
cd kubilitics-frontend && npm run typecheck
cd kubilitics-frontend && npx vitest run
cd kubilitics-frontend && VITE_FEATURE_PRESENCE_V2=true npm run dev    # manual smoke
```

Manual test with flag on:
1. Open app → land on `/clusters` with live kubeconfig contexts listed.
2. Empty kubeconfig → land on `/welcome`.
3. Click a cluster → dashboard loads.

---

# Phase 6 — Flip the Flag

**Goal:** Promote `FEATURE_PRESENCE_V2=true` as the default. Old `/connect` route still works but is deprecated.

- [ ] **Task 6.1**: Change default in `kubilitics-backend/internal/config/features.go` and `kubilitics-frontend/src/lib/featureFlags.ts` to default true. Set `VITE_FEATURE_PRESENCE_V2=true` in `.env.production`. Run full test suites (backend + frontend). Integration smoke: fresh install → /clusters picker; existing user → active cluster auto-selected → dashboard.

- [ ] **Task 6.2**: Add a deprecation banner to the old `/connect` page: "This page is deprecated. Your clusters are now shown automatically on startup. [Go to clusters →]". Route stays live for one release.

- [ ] **Task 6.3**: Update user-facing docs (`docs/KUBECONFIG-SYNC.md`, README onboarding section) to reflect the new auto-discovery experience.

Commit: `feat(phase-6): FEATURE_PRESENCE_V2 on by default + /connect deprecated`.

---

**Phase 6 verification gate:** Run the 10-flow UI smoke harness from `docs/testing/2026-04-24-ui-smoke-harness.md` against the new default-on build. All flows must match baseline at `docs/testing/baselines/2026-04-24-pre-migration/` or be Flow 9-style improvements (zero regressions).

---

# Phase 7 — Cleanup

**Goal:** Delete deprecated code. Feature flag removed. Single-source-of-truth realized.

- [ ] **Task 7.1**: Delete `src/stores/onboardingStore.ts` and all callers. All references to `hasCompletedFirstRun` replaced with derived state from `clusterPresenceStore.activeLogicalIdentity != null`.

- [ ] **Task 7.2**: Delete cluster-related fields (`currentClusterId`, `currentClusterName`) from `backendConfigStore.ts`. Delete `useRestoreClusterFromBackend` hook.

- [ ] **Task 7.3**: Delete `src/stores/clusterStore.ts`. Rename any remaining references to use `clusterPresenceStore` directly.

- [ ] **Task 7.4**: Delete `kubilitics-frontend/src/pages/ClusterConnect.tsx` and its route. The deprecation banner in Phase 6 Task 6.2 is unnecessary once the route is gone.

- [ ] **Task 7.5**: Remove `FEATURE_PRESENCE_V2` flag from backend + frontend. The flag's callers simply always execute the V2 path.

- [ ] **Task 7.6**: Delete `internal/k8s/cluster_discovery.go` shim (already superseded by `internal/cluster/discovery/secret_source.go`).

Each task: run full test suite + manual smoke. Commit with `chore(cleanup): <what>`.

---

**Phase 7 verification gate (= shipping gate):**

```bash
# Backend
cd kubilitics-backend && go test ./... -count=1 -race -timeout 120s
cd kubilitics-backend && go build ./...

# Frontend
cd kubilitics-frontend && npm run typecheck
cd kubilitics-frontend && npm run lint
cd kubilitics-frontend && npx vitest run

# Integration
cd kubilitics-backend && go test ./tests/integration/... -count=1 -tags=integration

# Full 10-flow UI smoke via docs/testing/2026-04-24-ui-smoke-harness.md
# All 10 flows must match or improve the baseline. Zero regressions.

# Static analysis: confirm cleanup
grep -r "clusterStore\|onboardingStore\|FEATURE_PRESENCE_V2" kubilitics-frontend/src kubilitics-backend/internal
# → no matches
```

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| fsnotify misses rapid atomic-rename sequences | Med | Med | Debounce to 500ms; watcher supervises itself with backoff respawn. |
| Frontend SSE disconnects on WiFi change | High | Low | Exponential backoff reconnect; snapshot-fetch on reconnect. |
| Backend cache key collision on cluster switch | Low | Med | Cache keyed by `(clusterLogicalIdentity.Key(), projectID, queryString)`. |
| Large kubeconfig (500+ contexts) slow enumerate | Low | Med | Only parse `contexts + clusters` trees, ignore users; rate-limit preflights to 10 concurrent. |
| Phase 4 rollout breaks a production endpoint | Med | High | Per-endpoint migration; each commit is reversible via revert. Full suite before each migration. |
| SSE load with 1000+ frontends | Low (desktop only) | Low | One SSE per desktop session; backend can scale to thousands trivially. |

---

## Dependencies added

**Go (`kubilitics-backend`):**
- `github.com/fsnotify/fsnotify` v1.7.0 (kubeconfig watching)

**Frontend (`kubilitics-frontend`):**
- Already present: `@tanstack/react-query`, `zustand`, `react-router-dom`.
- `react-window` (virtual scroll, only used if >50 contexts) — already present per package.json check.

**No** new Rust deps. **No** new Tauri commands (SSE + fetch work through the existing webview).

---

## Resumability

This plan uses checkbox syntax (`- [ ]`) on every step. An executing agent marks them as it completes each step, so mid-session handoff is clean: the next agent finds the first unchecked step in the first incomplete task and continues.

Between sessions: commit before stopping. A fresh agent reads the design doc (`docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md`), opens this plan, finds the cursor, continues.

Each phase's verification gate is the session stopping point. Never leave a phase half-done across a session boundary without explicit user acknowledgement.
