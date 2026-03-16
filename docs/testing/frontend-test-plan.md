# Frontend Test Plan

## Overview

This document defines the test plan for the Kubilitics frontend (`kubilitics-frontend/`), a React + TypeScript + Vite SPA. It covers unit tests, component tests, snapshot tests, store tests, and E2E scenarios.

## Test Framework Stack

- **Unit/Component tests**: Vitest + React Testing Library
- **Snapshot tests**: Vitest inline snapshots
- **E2E tests**: Playwright
- **Mocking**: MSW (Mock Service Worker) for API mocking

## Top 10 Page Test Plans

### 1. Dashboard Overview (`/`)

| Test | Type | Description |
|------|------|-------------|
| Renders cluster summary cards | Component | Verify pod count, node count, namespace count display |
| Handles loading state | Component | Skeleton loaders shown during data fetch |
| Handles error state | Component | Error banner shown when API fails |
| Handles empty cluster | Component | Empty state illustration when no resources |
| Health ring displays correctly | Snapshot | Ring gauge percentages match data |
| Metric cards link to detail pages | Component | Click navigates to correct route |

### 2. Topology View (`/topology`)

| Test | Type | Description |
|------|------|-------------|
| Renders topology canvas | Component | Canvas element present, WebGL context initialized |
| Node selection shows detail panel | Component | Click node opens side panel with resource detail |
| Namespace filter works | Component | Selecting namespace filters displayed nodes |
| Search highlights matching nodes | Component | Search term highlights matching resources |
| Empty topology shows placeholder | Component | Empty state when no resources |
| Zoom controls work | Component | Zoom in/out buttons change canvas scale |

### 3. Pods List (`/pods`)

| Test | Type | Description |
|------|------|-------------|
| Renders pod table with data | Component | Table rows match mock data |
| Status badges show correct colors | Snapshot | Running=green, Pending=yellow, Failed=red |
| Namespace filter | Component | Dropdown filters table rows |
| Sort by column | Component | Click header sorts ascending/descending |
| Search filter | Component | Text input filters by pod name |
| Pagination | Component | Page navigation shows correct slice |

### 4. Deployment Detail (`/deployments/:name`)

| Test | Type | Description |
|------|------|-------------|
| Renders deployment info | Component | Name, namespace, replicas, image displayed |
| Pods tab shows related pods | Component | Pod table filtered to deployment's pods |
| Scaling slider works | Component | Slider changes replica count input |
| Rollback button triggers dialog | Component | Confirmation dialog before rollback |
| Events tab shows deployment events | Component | Event list with timestamps |

### 5. AI Assistant (`/ai`)

| Test | Type | Description |
|------|------|-------------|
| Chat input sends message | Component | Enter sends message, appears in chat |
| Streaming response renders | Component | SSE tokens appear progressively |
| Safety guard blocks dangerous actions | Component | Block message shown for kube-system mutations |
| Investigation panel opens | Component | "Investigate" button opens investigation UI |

### 6. Add-ons Marketplace (`/addons`)

| Test | Type | Description |
|------|------|-------------|
| Renders catalog grid | Component | Add-on cards with name, description, icon |
| Install button triggers flow | Component | Click opens install dialog |
| Installed add-ons show status | Component | Health badges on installed add-ons |
| Search filters add-ons | Component | Text input filters catalog |

### 7. Settings Page (`/settings`)

| Test | Type | Description |
|------|------|-------------|
| Theme toggle works | Component | Dark/light mode switch persists |
| Backend URL config saves | Component | Input saves to store |
| Safety panel renders | Component | Autonomy level selector, rules list |

### 8. Nodes List (`/nodes`)

| Test | Type | Description |
|------|------|-------------|
| Renders node table | Component | Rows with node name, status, capacity |
| Metric rings display | Snapshot | CPU/memory ring gauges |
| Cordon/uncordon action | Component | Button toggles schedulable state |

### 9. Services List (`/services`)

| Test | Type | Description |
|------|------|-------------|
| Renders service table | Component | Type, cluster IP, external IP columns |
| Port mapping display | Snapshot | Port/target-port format |
| Namespace filter | Component | Dropdown filters correctly |

### 10. Security Overview (`/security`)

| Test | Type | Description |
|------|------|-------------|
| Security score displays | Component | Score card with grade |
| Vulnerability table | Component | Rows with severity, CVE, affected image |
| RBAC audit results | Component | Permission findings list |

## Snapshot Test Strategy (24 Topology Components)

### Approach

- Use Vitest inline snapshots for deterministic UI output
- Mock all data sources via MSW
- Test both light and dark mode variants
- Update snapshots intentionally (review diffs in PRs)

### Components to Snapshot

| # | Component | Snapshot Focus |
|---|-----------|---------------|
| 1 | TopologyCanvas | SVG structure, node positions |
| 2 | TopologyNode | Node shape, label, status color |
| 3 | TopologyEdge | Edge path, arrow direction |
| 4 | TopologyDetailPanel | Panel layout, resource fields |
| 5 | TopologyControls | Zoom, fit, layout buttons |
| 6 | TopologySearch | Search input, results dropdown |
| 7 | TopologyLegend | Legend items, color coding |
| 8 | TopologyMinimap | Minimap viewport indicator |
| 9 | TopologyFilters | Namespace, kind filter chips |
| 10 | TopologyGroupHeader | Group label, collapse button |
| 11 | PodNode | Pod icon, name, status |
| 12 | DeploymentNode | Deployment icon, replica count |
| 13 | ServiceNode | Service icon, type badge |
| 14 | NodeNode | Node icon, capacity bars |
| 15 | NamespaceGroup | Namespace boundary, label |
| 16 | IngressNode | Ingress icon, host/path |
| 17 | StatefulSetNode | StatefulSet icon, ordinal |
| 18 | DaemonSetNode | DaemonSet icon, node count |
| 19 | ConfigMapNode | ConfigMap icon, key count |
| 20 | SecretNode | Secret icon, type badge |
| 21 | HPANode | HPA icon, min/max replicas |
| 22 | JobNode | Job icon, completion status |
| 23 | CronJobNode | CronJob icon, schedule |
| 24 | PVCNode | PVC icon, capacity |

## Zustand Store Test Patterns

### Pattern

```typescript
import { renderHook, act } from '@testing-library/react';
import { useClusterStore } from '../stores/clusterStore';

describe('clusterStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useClusterStore.setState(useClusterStore.getInitialState());
  });

  it('sets active cluster', () => {
    const { result } = renderHook(() => useClusterStore());
    act(() => {
      result.current.setActiveCluster('minikube');
    });
    expect(result.current.activeCluster).toBe('minikube');
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useClusterStore());
    act(() => {
      result.current.setActiveCluster('kind-cluster');
    });
    const stored = JSON.parse(localStorage.getItem('cluster-store') ?? '{}');
    expect(stored.state.activeCluster).toBe('kind-cluster');
  });
});
```

### Stores to Test

| Store | Key Behaviors |
|-------|--------------|
| clusterStore | Active cluster, cluster list, connection status |
| backendConfigStore | Backend URL, AI URL, persistence |
| aiAvailableStore | AI availability detection, feature flags |
| themeStore | Dark/light mode, system preference detection |
| topologyStore | Selected node, zoom level, layout mode |
| notificationStore | Add/dismiss/clear notifications |

## E2E Test Scenarios (5 Critical User Journeys)

### 1. First-time Setup and Dashboard

```
1. Navigate to / (landing page)
2. Connect to cluster (enter kubeconfig path or select context)
3. Verify dashboard loads with cluster summary
4. Verify pod count > 0 (at least kube-system pods)
5. Navigate to topology, verify graph renders
```

### 2. Resource Drill-down

```
1. Navigate to /pods
2. Filter by namespace "kube-system"
3. Click on a pod row
4. Verify detail page shows pod spec, events, logs tab
5. Navigate back, verify filter state preserved
```

### 3. AI Investigation

```
1. Navigate to /pods, find a non-Running pod (or mock one)
2. Click "Investigate" button
3. Verify step indicator progresses through 4 steps
4. Verify findings are displayed with severity badges
5. Verify "Share" button copies URL with investigation ID
```

### 4. Add-on Install/Uninstall

```
1. Navigate to /addons
2. Search for "metrics-server"
3. Click "Install"
4. Verify install dialog appears with configuration options
5. Confirm install, verify status changes to "Installing" then "Installed"
6. Click "Uninstall", confirm, verify removal
```

### 5. Safety Guard Enforcement

```
1. Navigate to AI assistant
2. Request: "Delete namespace kube-system"
3. Verify safety guard blocks the action
4. Verify immutable rule violation is displayed
5. Request: "Scale deployment nginx to 3 replicas"
6. Verify diff preview is shown with "Apply" button
```

## CI Integration

### Vitest (Unit + Component + Snapshot)

```bash
cd kubilitics-frontend
npm run test          # Run all tests
npm run test:coverage # With coverage report
```

- Coverage target: 60% overall, 80% for stores
- Snapshot update: `npm run test -- -u` (review in PR)

### Playwright (E2E)

```bash
cd kubilitics-frontend
npx playwright test   # Run E2E suite
npx playwright test --ui  # Interactive mode
```

- E2E tests run against a local dev server with MSW mocks
- CI runs headless Chromium only (fastest)
- Screenshots on failure uploaded as artifacts
