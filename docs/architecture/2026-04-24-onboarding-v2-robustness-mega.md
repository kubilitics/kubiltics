# Onboarding v2 + Universal Robustness + State Consolidation — Unified Design

**Date:** 2026-04-24
**Status:** Design approved via brainstorm; implementation plan to be created next.
**Branch:** `feat/onboarding-v2` (off `migrate/monorepo-consolidation` tip — reparent to `main` after PR #94 merges)
**Supersedes workflow documented in:** `project_cluster_lifecycle_bug.md`, the current `/connect` flow

---

## 1. Problem statement

Three entangled problems have produced the same user-visible symptoms for months:

1. **Onboarding friction.** The current `/connect` page offers three parallel tabs (Auto-detect / Upload / Paste). On desktop, "Auto-detect" only surfaces clusters the backend already knows about — it does not read `~/.kube/config` except on first launch. A user who adds a new kube context later cannot see it without re-entering this page. Headlamp and Lens both auto-discover kubeconfig contexts on every launch; Kubilitics does not.

2. **Resilience only at one endpoint.** The 10848cf sidebar-counter fix established a proven pattern — `/summary` never 5xx's on cluster unreachability, backend caches last-known-good, frontend preserves session cache, UI renders an explicit banner. But this contract lives only inside that endpoint + that hook. Every other cluster-scoped data path is still fragile: a transient apiserver blip on a detail page produces a spinner-forever or a flashed empty state.

3. **Three overlapping stores.** `clusterStore`, `backendConfigStore`, and `onboardingStore` each hold fragments of cluster identity and "is the user onboarded" state. Persisted cluster IDs go stale when clusters are recreated externally. Routing decisions read from multiple stores, producing race conditions ("retry to see clusters").

The user experience consequence: the app feels broken. Clusters "disappear." Counters flash to zero. Retries sometimes help, sometimes don't. For an enterprise-grade product targeting millions of users, this is unacceptable.

## 2. Vision

A single, unified **Cluster Presence Layer** that:

- **Discovers clusters the way users expect.** Every time the app opens (and continuously while it runs), read all configured kubeconfigs + in-cluster Secrets and surface the full set of available contexts.
- **Connects on-demand, warms the last-used.** Lazy-by-default (the user's 5 contexts don't all start 5 informers on launch), but the most-recently-used cluster auto-connects in the background so returning users hit the dashboard in one click.
- **Never lies, never silently fails.** Every cluster-scoped data path returns a structured envelope with explicit `reachable` / `stale` / `error` state. Every component honors that envelope. Transient failures preserve last-known values and annotate the UI; they do not produce blank states or spinners-forever.
- **Has one source of truth.** One store owns cluster presence. Routing and rendering derive from it. Persisted state is minimal (last-used logical identity only). The backend is consulted on every launch to reconcile.

## 3. Architecture — The Cluster Presence Layer

### 3.1 The four tiers

```
  kubeconfig files, in-cluster Secrets, CLI `kubilitics register`
          │
          ▼
  ┌──────────────────┐
  │   DISCOVERED     │  Known to exist; not yet touched
  └────────┬─────────┘  (tier 1, refreshed continuously)
           │
           │ backend bootstraps each — parses kubeconfig, stores minimal
           │ identity (name, serverUrl, contextName, source). NO apiserver call.
           ▼
  ┌──────────────────┐
  │   REGISTERED     │  Backend has identity; no live watchers
  └────────┬─────────┘  (tier 2, persistent)
           │
           │ user clicks a cluster OR it's the last-used one at app launch
           ▼
  ┌──────────────────┐
  │   CONNECTED      │  Backend has active client; informers ± pending
  └────────┬─────────┘  (tier 3, ephemeral, LRU-capped at 10)
           │
           │ at most one at a time is "the one the UI is looking at"
           ▼
  ┌──────────────────┐
  │    ACTIVE        │  The cluster the user is currently viewing
  └──────────────────┘  (tier 4, singleton)
```

Every state transition is observable and logged. Every tier has an explicit liveness signal (`reachable`, `last_checked_at`, `error_message`).

### 3.2 Discovery sources (pluggable)

```go
// kubilitics-backend/internal/cluster/discovery/source.go
type DiscoverySource interface {
    Name() string
    // Enumerate returns a snapshot of all clusters this source knows about.
    // Errors are per-cluster; source-level failures are explicit.
    Enumerate(ctx context.Context) ([]DiscoveredCluster, error)
    // Watch streams add/remove/update events over the life of ctx.
    // Optional: return ErrNotSupported if Enumerate-only.
    Watch(ctx context.Context) (<-chan DiscoveryEvent, error)
}
```

Three implementations in v1:

1. **`KubeconfigFileSource`** — watches one or more paths (resolved from `KUBECONFIG` env, then `~/.kube/config`). Uses `fsnotify` to stream changes. 500ms debounce. On change, re-parses and emits adds/removes/updates. **Never panics on malformed YAML** — returns an error scoped to the file.

2. **`KubernetesSecretSource`** — the in-cluster Helm path. Watches Secrets with label `kubilitics.io/cluster-kubeconfig=true` (existing code in `internal/k8s/cluster_discovery.go`). Promoted to implement the same interface.

3. **`ManualSource`** — registers clusters added via the existing POST `/api/v1/clusters` endpoint (paste / upload flows). Backing store is sqlite (existing).

Sources are composed by `DiscoveryManager`. Events are deduplicated by `(source, contextName)`; reconciliation to logical clusters uses `(name, serverUrl)` (Headlamp-style, already partially implemented in `clusterStore.syncClusters`).

### 3.3 Identity model

Every cluster has two IDs:

- **Logical identity** — the tuple `(name, serverUrl)` normalized. Stable across backend restarts, kubeconfig regeneration, and external cluster recreation. This is what gets persisted in localStorage + sqlite.
- **Session ID** — the UUID the backend assigns on registration. Changes on every recreation; never persisted frontend-side.

All frontend URLs, store state, and user-facing handles reference logical identity. The backend translates to session ID internally and gracefully handles the reconciliation when a previously-known logical cluster gets a new session ID (e.g., Docker Desktop restart).

Rationale: the single biggest class of bugs — persisted stale UUIDs causing 404s on `/summary` — is eliminated by never persisting session IDs client-side.

## 4. Lifecycle

### 4.1 App-open happy path

```
t=0     Tauri webview mounts → React app boots
        AppLayout renders LOADING_STATE (skeleton, never blank)

t=0+    useClusterPresence() hook subscribes to
        GET /api/v1/presence (server-sent events)

t=50ms  Backend emits INITIAL snapshot:
          { discovered: [5], registered: [5], connected: [],
            lastUsed: { name: "prod", serverUrl: "..." } }
        Frontend renders cluster list; last-used is highlighted.

t=100ms Backend eagerly kicks connection to last-used cluster in parallel
        with UI render. User sees the list already.

t=500ms User clicks "prod" (or prod auto-selects because it was last-used and
        is already connected).

t=1.5s  Dashboard shows data. /summary is already warm because backend
        started it at t=100ms.
```

**Critical property**: at no point does the UI block on a network call. Every tier transition (discovered → registered → connected → active) emits an event; the UI renders whatever it has and annotates what it's missing.

### 4.2 Connection model — lazy + eager-last-used

Already selected (hybrid C). Implementation:

- On startup, backend enumerates `DiscoveredCluster`s and ensures each has a `RegisteredCluster` row in sqlite (upsert by logical identity).
- Backend reads `last_used_cluster` from its own preferences table (not frontend state).
- If `last_used_cluster` is in `DiscoveredCluster` AND passes the kubeconfig fast-preflight (`kubeconfig parses, host reachable via TCP dial within 2s`), backend transitions it to CONNECTED in the background.
- All other discovered clusters remain at REGISTERED until the user clicks them.
- On click, backend establishes the client connection, spins up informers for the resource types the current page needs (not all 27 upfront — demand-driven), and marks CONNECTED.

LRU cap: at most 10 clusters CONNECTED at any time. On 11th, evict the least-recently-active; its session can be re-established on next click in ~1s.

### 4.3 Kubeconfig file watching

`fsnotify` watcher in the Go backend, with:

- **Debounce**: 500ms. Multiple writes within 500ms produce one re-enumerate.
- **Atomic safety**: editors that use atomic rename (most) produce multiple events — watcher handles both `CREATE` and `RENAME` + `WRITE`.
- **Error recovery**: if the watcher goroutine dies (e.g., inotify watch limit), supervisor respawns it with backoff (1s, 2s, 4s, cap 30s) and emits a presence event noting the degraded state.
- **Honest degradation**: if the file goes missing temporarily (rename-in-flight), DO NOT evict the existing registered clusters; mark them stale with `last_seen_in_kubeconfig_at` and re-validate on next event.

### 4.4 Cluster drift — no rug pulls

Three drift scenarios, three responses:

| Scenario | Detection | Response |
|---|---|---|
| Active cluster becomes unreachable | Any resilient endpoint returns `reachable: false` 3× in a row within 10s | UI shows banner with error + "Switch to <nextBestCluster>?" button. Does NOT auto-switch. Data shown is last-known-good, marked stale. |
| Active cluster recreated externally (new session ID, same logical identity) | Backend detects session ID mismatch during reconciliation; updates session ID atomically | Transparent to user. One presence event with `identityReconciled: true` for observability. |
| Active cluster removed from kubeconfig | `KubeconfigFileSource` emits REMOVE event for active cluster's logical identity | UI shows banner "This cluster was removed from your kubeconfig. Switch to <nextBestCluster>?" — user confirms before switching. |

No auto-switch. Ever. The current auto-fall-back-to-`list[0]` behavior is the root cause of mid-action rug pulls.

## 5. Resilience contract (generalized 10848cf)

This is the core of "never breaks." Everything below is required-by-contract for every cluster-scoped endpoint.

### 5.1 Backend envelope shape

```go
// kubilitics-backend/internal/api/resilient/envelope.go
type ResilientResponse[T any] struct {
    Data        T      `json:"data,omitempty"`
    Reachable   bool   `json:"reachable"`
    Stale       bool   `json:"stale,omitempty"`
    StaleAsOf   *Time  `json:"stale_as_of,omitempty"`
    ErrorMessage string `json:"error_message,omitempty"`
    HealthStatus string `json:"health_status"` // "healthy" | "unreachable" | "degraded"
}
```

Every cluster-scoped endpoint returns this envelope. HTTP status codes: **5xx is reserved for real server bugs only** (panic, DB corruption, misconfiguration). Transient apiserver issues = 200 + `reachable: false`.

### 5.2 Backend helper

```go
// kubilitics-backend/internal/api/resilient/wrap.go
func WrapClusterHandler[T any](
    cache *LRUCache[string, T],
    cacheKey func(r *http.Request) string,
    fetch func(ctx context.Context, r *http.Request) (T, error),
) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        key := cacheKey(r)
        data, err := fetch(r.Context(), r)
        if err != nil {
            if isTransientClusterError(err) {
                // Try cache; fall through to unreachable with no-data if empty.
                if cached, ok := cache.Get(key); ok {
                    respondJSON(w, 200, ResilientResponse[T]{
                        Data: cached.Value, Reachable: false,
                        Stale: true, StaleAsOf: &cached.At,
                        ErrorMessage: err.Error(), HealthStatus: "unreachable",
                    })
                    return
                }
                respondJSON(w, 200, ResilientResponse[T]{
                    Reachable: false, ErrorMessage: err.Error(),
                    HealthStatus: "unreachable",
                })
                return
            }
            // Real bug — 5xx + structured log.
            respondInternalError(w, err)
            return
        }
        cache.Put(key, data)
        respondJSON(w, 200, ResilientResponse[T]{
            Data: data, Reachable: true, HealthStatus: "healthy",
        })
    }
}
```

`isTransientClusterError` classifies: context deadline, connection refused, kubeconfig invalid, unauthorized, TLS handshake failure, DNS lookup failure. Anything else is a real bug.

Every cluster-scoped handler in `internal/api/rest/*.go` is migrated to use `WrapClusterHandler`. Existing `/summary` handler is refactored onto this helper too (it's already the pattern; this unifies).

### 5.3 Frontend hook

```typescript
// kubilitics-frontend/src/hooks/useResilientQuery.ts
export function useResilientQuery<T>(
  endpoint: string,
  options?: { clusterId?: string; refetchInterval?: number; }
): {
  data: T | undefined;        // last-known-good, survives transients
  isLoading: boolean;          // only on first load, never during session
  isReachable: boolean;        // false = cluster unreachable, data may be stale
  isStale: boolean;            // true = data is from backend cache, not live
  errorMessage: string | null; // human-readable reason, if not reachable
  refetch: () => void;
}
```

Implementation:

1. Wraps react-query's `useQuery` with specific defaults (`staleTime: 30s`, `retry: 1 with exponential backoff`).
2. On successful fetch, caches the `data` in a ref scoped to the hook's lifetime (session cache, like `lastRealCountsRef` in `useResourceCounts`).
3. When the response is `{ reachable: false, stale: false }` (no backend cache) AND session cache has data, returns the session cache with `isStale: true, isReachable: false`.
4. When the response is `{ reachable: false, stale: true }` (backend has stale cache), returns the backend's data as-is with `isStale: true, isReachable: false`. Does NOT promote to session cache (stale-of-stale is a liability).
5. Explicit `refetch()` always fires the network call.

Every cluster-scoped data fetch in the app is migrated to `useResilientQuery`. `useResourceCounts` (already-robust) becomes a thin wrapper. Other hooks — `usePods`, `useDeployments`, `useEvents`, `useTopology`, etc. — all refactored.

### 5.4 UI error boundary

```tsx
// kubilitics-frontend/src/components/common/ClusterUnreachableBoundary.tsx
<ClusterUnreachableBoundary
  isReachable={q.isReachable}
  isStale={q.isStale}
  errorMessage={q.errorMessage}
  onSwitchCluster={() => navigate('/clusters')}
>
  {children}
</ClusterUnreachableBoundary>
```

Renders children if reachable. Otherwise renders:

- A non-intrusive banner at the top of the wrapped region (not full-page — that would be a rug pull).
- Banner contents: "This data may be out of date — <cluster> is unreachable (<errorMessage>). <RetryButton /> <SwitchClusterButton />".
- Children still render, but with reduced opacity + a "Stale since X:XX:XX" pill in the corner.

Never blank-states. Never spinners-forever. Every uncertainty is labeled.

## 6. State store consolidation

### 6.1 `clusterPresenceStore` shape

```typescript
// kubilitics-frontend/src/stores/clusterPresenceStore.ts
interface ClusterPresenceState {
  // Server-derived, live via SSE. Never persisted.
  discovered: DiscoveredCluster[];
  registered: RegisteredCluster[];  // discovered ∩ backend-known
  connected: ConnectedCluster[];    // subset of registered, LRU-capped
  activeLogicalIdentity: LogicalIdentity | null;  // { name, serverUrl }

  // Persisted to localStorage — minimal.
  persistedPrefs: {
    lastActiveLogicalIdentity: LogicalIdentity | null;
    // No UUIDs, no session IDs. Only logical identity.
  };

  // Derived (selectors, memoized).
  activeCluster: () => ConnectedCluster | null;  // resolve via logical identity
  availableClusters: () => ClusterView[];        // merged list for the picker
  isReady: () => boolean;                        // presence first-snapshot received

  // Actions.
  setActiveByLogicalIdentity: (id: LogicalIdentity) => void;
  refresh: () => void;  // force SSE reconnect + full re-enumerate
}
```

The SSE stream from `GET /api/v1/presence/events` keeps `discovered`, `registered`, `connected` in sync. The store never polls; it reacts.

### 6.2 Derived selectors

`activeCluster`, `availableClusters`, `isReady` are derived from state — not stored. React components read via Zustand selectors. No stale-ID class of bug is representable in this design: there are no IDs to stale.

### 6.3 Deprecations

- `onboardingStore` → deleted. "Has the user completed onboarding?" is derived from `clusterPresenceStore.persistedPrefs.lastActiveLogicalIdentity != null`.
- `backendConfigStore.currentClusterId` / `currentClusterName` → deleted. Use `clusterPresenceStore.activeCluster()`.
- `clusterStore` → renamed to `clusterPresenceStore`; the Headlamp-identity logic migrates in, but most of the manual syncing dies (SSE replaces 15s poll).

## 7. UX flows

### 7.1 Returning user, last cluster reachable

```
[App opens]                                   0ms
[Skeleton renders]                            0ms
[Presence SSE snapshot arrives]               50ms
  → activeLogicalIdentity resolves to "prod"
  → "prod" is in discovered+registered and passes fast-preflight
[Backend transitions "prod" to CONNECTED in parallel]  100ms
[UI auto-navigates to /dashboard with "prod" selected]  150ms
[Dashboard renders last-known-good counts (from backend cache)] 200ms
["prod" summary refreshes live]               1.2s
```

**Total perceived wait: ~200ms.** No Connect page, no picker, no friction.

### 7.2 Returning user, last cluster unreachable

```
[App opens]                                   0ms
[Presence snapshot]                           50ms
  → "prod" is in discovered but fast-preflight fails (TCP dial timeout)
  → backend marks "prod" registered-but-unreachable
[UI lands on /clusters picker, "prod" marked red with error tooltip]  100ms
[User either clicks "retry" or picks another cluster]
```

No spinner-forever, no silent failure. The honest-degradation list from §3.2 does the talking.

### 7.3 New user with kubeconfig (5 contexts, no prior Kubilitics state)

```
[App opens]                                   0ms
[Presence snapshot]                           50ms
  → 5 discovered, 0 with lastActiveLogicalIdentity
[UI lands on /clusters picker]                100ms
  → "Select a cluster to get started" header
  → 5 cards with status badges (healthy / unreachable / unknown)
  → most-recently-modified-in-kubeconfig cluster pre-highlighted
[User clicks one]
[Backend connects; UI navigates to /dashboard]  1.5s
```

### 7.4 New user with no kubeconfig (welcome)

```
[App opens]
[Presence snapshot: discovered=[], registered=[]]
[UI lands on /welcome]
  → "Kubilitics needs a Kubernetes cluster to do its thing."
  → 3 CTAs:
     [Create a local cluster]  → runs kind/k3d via existing CLI integration
     [Add an existing cluster] → opens kubeconfig file picker (paste UI is the advanced fallback)
     [Take the tour]           → read-only demo mode with synthetic data
[User picks; flows through to registration + /dashboard]
```

### 7.5 Power user with 100+ contexts

- Cluster picker uses **virtual scroll** (react-window or similar) — renders only visible rows.
- Top of picker has a search box that filters by name, serverUrl host, labels (future).
- "Starred clusters" concept (in persistedPrefs, limit 10) — starred appears first, rest sorted by last-used then alphabetical.
- Preflight reachability checks are rate-limited (10 in parallel, rolling) to avoid saturating the network on launch.

## 8. Migration & backward compatibility

This is a large refactor. Non-negotiable: **the app must remain usable on every commit**. Approach:

1. **Phase 1 — Backend scaffolding.** Introduce `internal/api/resilient/` package. Add `GET /api/v1/presence` endpoint + SSE events. No behavior change; new endpoint runs alongside old.

2. **Phase 2 — Discovery sources.** Implement `DiscoverySource` interface, migrate existing `cluster_discovery.go` to `KubernetesSecretSource`, add `KubeconfigFileSource`. Wire into `DiscoveryManager`. Expose via new presence endpoint.

3. **Phase 3 — Frontend presence store (shadowed).** Build `clusterPresenceStore`, wire up SSE subscription. NEW store runs alongside `clusterStore`. Feature flag: `FEATURE_PRESENCE_V2` (default off).

4. **Phase 4 — Resilience contract rollout.** Refactor one endpoint at a time onto `WrapClusterHandler`. Frontend hooks migrated one at a time to `useResilientQuery`. Each migration has a regression test. `/summary` (already robust) becomes the reference implementation.

5. **Phase 5 — New UX routes.** Add `/clusters` picker and `/welcome` as new routes. Feature-flagged. Old `/connect` still works.

6. **Phase 6 — Flip the flag.** After Phase 4 reaches a coverage threshold (all high-traffic hooks migrated: counts, pods, events, deployments, services, nodes, namespaces, topology) and Phase 5 UI is validated: default `FEATURE_PRESENCE_V2=true`, deprecate `/connect`, delete `onboardingStore`.

7. **Phase 7 — Cleanup.** Remove old code paths, old stores, feature flag. Single-source-of-truth achieved.

Every phase is independently reversible. Feature flag is the kill switch.

## 9. Testing strategy

- **Unit**: every `DiscoverySource` impl, `WrapClusterHandler` middleware (including every transient-error classification branch), `useResilientQuery` (matching the 4-test coverage pattern from 10848cf, extended to the new semantics).
- **Integration**: Tauri + Go backend + kind cluster. Scenarios:
  - Fresh install → `KubeconfigFileSource` discovers 3 contexts → user picks one → dashboard loads.
  - Running app → user adds a new context to `~/.kube/config` → within 1s, presence event fires → cluster appears in picker.
  - Active cluster's apiserver is killed via `docker kill` → within 10s, banner appears → data shown is last-known-good.
  - Active cluster is deleted from kubeconfig → banner asks user to switch.
  - 100 contexts in kubeconfig → picker renders in <100ms, scroll is smooth.
- **Regression** — every bug historically reported against onboarding becomes a named test. The "sidebar counters flash to zero" scenario from 10848cf is carried over verbatim.
- **Property tests** — `(name, serverUrl)` reconciliation across session ID churn; LRU eviction invariants; backend envelope never 5xx's on transient classifications.

## 10. Non-goals

Out of scope for this spec (explicitly deferred to follow-ups):

- Multi-cluster split view (viewing two clusters side-by-side). The ACTIVE tier is a singleton here; future work can extend.
- OIDC / cloud-provider auth (EKS auth, GKE gcloud auth, AKS). Current plumbing already exists; this spec doesn't change it. Future source types can be added.
- Cluster provisioning (creating clusters on EKS/GKE/AKS from within Kubilitics). The "Create a local cluster" welcome CTA invokes existing `kcli`/`kind`/`k3d` paths; no new provisioning code.
- Offline/disconnected mode. Kubilitics still requires a backend process locally. Future pure-kubeconfig mode is a separate spec.
- Replacing react-query. `useResilientQuery` wraps it; no swap.

## 11. Open questions

None that block implementation. Any ambiguity surfaced during implementation is resolved by:

- Leaning toward **explicit state over inference** ("loading"/"empty"/"unreachable" are distinct, never the same visual).
- Leaning toward **user control over automation** (no auto-switch on drift).
- Leaning toward **cache by logical identity, not by session ID**.

## 12. Success metrics

- **Time-to-dashboard for returning user**: <500ms p50, <1s p95 (measured from app open to interactive dashboard).
- **Cluster-reachability false-positive rate**: "broken" banner shown when cluster is actually fine — target <0.1% of user sessions.
- **Retry-to-see-clusters rate**: user explicitly clicks a retry/refresh because the list didn't populate — target 0% of returning-user sessions.
- **Counter-flash-to-zero rate**: counters show 0 when cluster is actually populated — target 0% outside first-ever load.
- **Onboarding abandonment**: new users who open the app and close it before selecting a cluster — target <10%. (Baseline unknown.)
- **Support burden**: "my clusters are missing, what do I do" tickets — target drop to 0 post-rollout.

---

**Next step:** invoke `superpowers:writing-plans` to produce a phase-by-phase implementation plan keyed to §8.
