# Health gating and circuit breaker — impact review and fixes

## Scope of recent changes

1. **backendApiClient**: Removed dead `settingsStore` import; circuit-open and getHealth error messages made desktop-friendly; added `resetBackendCircuit()` for Retry.
2. **BackendStatusBanner**: In Tauri, user-facing copy only (no backend URL); Retry resets circuit and refetches health; Settings button hidden in desktop.
3. **useClustersFromBackend**: Optional `gateOnHealth: true` — when set (Connect page only), clusters run only after health succeeds to avoid request storm.
4. **useDiscoverClusters**: Gated on health + circuit; only used on Connect.
5. **ClusterConnect**: Uses `gateOnHealth: true`, shows error strip when health or cluster/discover fails, Retry resets circuit and refetches health.

## Impact on core features (verified)

| Feature | How it talks to backend | Impact of health/circuit changes |
|--------|--------------------------|-----------------------------------|
| **Topology** | `useClusterTopology` / `useResourceTopology` → `getTopology` / `getResourceTopology` → `backendRequest` | No change. Uses `isBackendConfigured()` and clusterId; not gated on health. When backend is down, first request fails → circuit opens → later topology calls throw immediately (no storm). |
| **Metrics** | Various hooks → `listResources`, metrics APIs → `backendRequest` | Same as topology. Circuit limits repeated failures; no new gating. |
| **KCLI / Shell** | Completions and TUI state: `getShellComplete`, `getKCLIComplete`, `getKCLITUIState` → `backendRequest`. WebSocket: `getKubectlShellStreamUrl` / `getKCLIShellStreamUrl` return URL; `new WebSocket(url)` is direct. | REST calls are subject to circuit (fail fast when open). WebSocket is not gated by circuit; connection fails at TCP/WS level if backend is down. Behavior unchanged. |
| **Cluster list (HomePage, ProjectDetail, dialogs)** | `useClustersFromBackend()` with no options | **Fix applied**: Default is `gateOnHealth: false`, so clusters load immediately (no wait for health). No regression. |
| **Connect page** | `useClustersFromBackend({ gateOnHealth: true })` + `useDiscoverClusters()` | Health runs first; clusters and discover run only after health succeeds. Retry resets circuit and refetches health so recovery works. |

## Gaps that were fixed

1. **Regression**: Clusters list was gated on health everywhere → HomePage and other pages saw empty clusters until health completed. **Fix**: `gateOnHealth` is optional; only Connect passes `gateOnHealth: true`.
2. **useDiscoverClusters**: Missing `circuitOpen` check. **Fix**: Added `!circuitOpen` to `enabled`.
3. **getHealth()**: Circuit-open error still said "Start backend with: make restart". **Fix**: Same Tauri vs browser message as `backendRequest`.
4. **Documentation**: Clarified in `backendApiClient.ts` that circuit applies to all `backendRequest`/getHealth; shell WebSocket is direct and not gated.

## No change required

- **Topology / metrics / KCLI**: No new health gating added; they already use `backendRequest` or direct WebSocket. Circuit breaker continues to apply to REST only; first wave of requests can still run (then circuit opens). To avoid that wave on every page would require gating every backend hook on health, which was not in scope and would add latency everywhere.

## Testing checklist

- [ ] Desktop: Open app → Connect; with backend down, only health runs (no cluster/discover storm); error strip and Retry visible; Retry resets circuit and refetches health.
- [ ] Desktop: Backend up → clusters and discover load after health; connect to cluster → Home/Dashboard load; clusters list on HomePage is populated without delay.
- [ ] Topology: Select cluster → open Topology; graph loads; with backend down, topology fails once then circuit opens.
- [ ] Shell/KCLI: Open shell; completions/TUI use backendRequest; WebSocket connects directly; with backend down, REST fails (circuit), WS fails at connect.
- [ ] BackendStatusBanner: In desktop, copy is "Connection issue..."; no Settings button; Retry works after resetting circuit.
