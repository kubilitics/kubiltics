# Error States and Recovery (A3.5)

When backend is configured, the UI handles these error cases with clear messages and recovery actions.

## Backend unreachable

- **When:** Backend base URL is set but health check fails (e.g. backend down, wrong URL, CORS).
- **Where:** Banner at top of main content (AppLayout) when `useBackendHealth` returns error.
- **Message:** "Backend unreachable: &lt;error detail&gt;"
- **Actions:**
  - **Retry** — refetch health.
  - **Settings** — open Settings to change backend URL or clear it.

## No clusters

- **When:** GET `/api/v1/clusters` returns 200 with empty array.
- **Where:** Cluster selection page.
- **Message:** "No clusters registered in the backend. Add a cluster via the backend API or settings."
- **Actions:** User can add clusters via backend API or go to Settings.

## Clusters fetch failed

- **When:** GET `/api/v1/clusters` fails (network, 5xx, etc.).
- **Where:** Cluster selection page.
- **Message:** Error message from request (e.g. "Backend API error: 502 - ...").
- **Actions:** **Retry** to refetch clusters.

## Cluster not found (404)

- **When:** Request for a cluster-scoped resource (e.g. GET topology, GET resources) returns 404 (cluster removed or invalid ID).
- **Where:** Topology page (and resource list/detail when backend mode).
- **Message:** Backend error message (e.g. "Backend API error: 404 - Cluster not found").
- **Actions:**
  - **Back to cluster list** — navigate to `/setup/clusters` to pick another cluster.
  - **Retry** — refetch (e.g. if cluster was temporarily unavailable).

## Topology load failed

- **When:** GET `/api/v1/clusters/{clusterId}/topology` fails.
- **Where:** Topology page.
- **Message:** Error message from request.
- **Actions:** **Retry**; if 404, **Back to cluster list** (see above).

## Resource list/detail failed (backend mode)

- **When:** GET resources or GET resource returns error (404, 403, 5xx).
- **Where:** Resource list or detail page.
- **Message:** Shown by React Query / component (e.g. error state with message).
- **Actions:** Retry; for 404 cluster, user can go to cluster selection.

## Error transparency (C2.3)

- **Status code:** Backend API errors are surfaced with HTTP status (e.g. 403 Forbidden, 504 Gateway Timeout) in the error message and in the UI where applicable (e.g. Topology error block shows "Status: 503").
- **Request ID:** When the backend sends `X-Request-ID` (all API responses), the frontend captures it on `BackendApiError` and displays it in error states (e.g. "Request ID: abc-123 (for support)") so support can correlate with backend logs.
- **Actions:** For 404, 403, 503, 504 the Topology page offers **Back to cluster list** and **Retry**; other pages follow the same pattern where applicable.

---

*Single execution roadmap (TASKS.md). Verify completion against the repo.*
