# Desktop Offline / Degraded Mode (C4.3)

## When backend or cluster is unreachable

- **Show status:** The app must show clearly when the backend or cluster is unreachable (e.g. "Backend unreachable", "Cluster disconnected"). Use the existing **BackendStatusBanner** and cluster/connection error states; do not show a blank screen.
- **Cached data with "stale" indicator:** If the app has previously loaded data (e.g. cluster list, topology) and the backend or cluster becomes unreachable, show that data with a visible **stale indicator** (e.g. banner: "Showing cached data; backend unreachable" or "Last updated X min ago — connection lost"). Do not present cached data as if it were live.
- **Retry and recovery:** Provide **Retry** (and **Settings** for backend URL, **Back to cluster list** for cluster-scoped errors) so the user can recover. Document in `docs/ERROR-STATES.md`; desktop reuses the same error UX as web when running in Tauri.
- **No live pretense:** Avoid auto-refresh or timers that suggest data is live when the connection is down; pause or clearly label that updates are paused.

## Implementation notes

- Frontend: `useBackendHealth` and `BackendStatusBanner` already handle "backend unreachable" with Retry and Settings. When health fails, cluster/topology data from previous loads can be shown with a stale banner (e.g. in AppLayout or Topology page when `backendHealthy === false` and we have cached data).
- Optional: add a `dataStale` or `connectionLost` flag when health fails but we still have cached state, and render a small "Data may be outdated" or "Connection lost — showing last known state" banner until the user retries or navigates away.
