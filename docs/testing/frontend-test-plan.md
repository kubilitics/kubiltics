# Frontend Test Plan

**Audience:** Frontend engineers, QA engineers
**Applies to:** Kubilitics Frontend v1.0.0+
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Test Toolchain](#2-test-toolchain)
3. [Page Rendering Tests](#3-page-rendering-tests)
4. [Topology Component Snapshot Tests](#4-topology-component-snapshot-tests)
5. [Zustand Store Tests](#5-zustand-store-tests)
6. [E2E Scenarios](#6-e2e-scenarios)
7. [Coverage Targets](#7-coverage-targets)
8. [CI Integration](#8-ci-integration)

---

## 1. Overview

The Kubilitics frontend is a React + TypeScript SPA built with Vite. It includes 100+ pages for Kubernetes resource management, a topology visualization engine (React Flow + ELK layout), and Zustand state stores.

### Testing Principles

1. **Render tests verify that pages mount without crashing** -- Every page gets a smoke test.
2. **Snapshot tests catch unintended visual regressions** -- Topology components are snapshot-tested.
3. **Store tests verify state logic in isolation** -- Zustand stores are tested without rendering components.
4. **E2E tests verify critical user journeys** -- From login to topology visualization.

---

## 2. Test Toolchain

| Tool | Purpose | Config |
|---|---|---|
| Vitest | Unit + integration test runner | `vitest.config.ts` |
| React Testing Library | Component rendering + assertions | `@testing-library/react` |
| jsdom | DOM environment for Vitest | `environment: 'jsdom'` |
| Playwright | E2E browser tests | `playwright.config.ts` |
| MSW | API mocking for integration tests | `src/mocks/handlers.ts` |

---

## 3. Page Rendering Tests

Every page must have a smoke test verifying it renders without throwing.

### Top 10 Pages

| # | Page | File | Test Case |
|---|---|---|---|
| P-01 | Dashboard | `src/pages/Dashboard.tsx` | Renders dashboard cards and cluster summary |
| P-02 | Topology | `src/pages/Topology.tsx` | Renders topology canvas with toolbar |
| P-03 | Cluster Overview | `src/pages/ClusterOverview.tsx` | Renders resource counts and health status |
| P-04 | Deployments | `src/pages/Deployments.tsx` | Renders deployment table with columns |
| P-05 | Services | `src/pages/Services.tsx` | Renders service list with type badges |
| P-06 | Pods (Deployment detail) | `src/pages/DeploymentDetail.tsx` | Renders pod table within deployment detail |
| P-07 | ConfigMaps | `src/pages/ConfigMaps.tsx` | Renders configmap table with data preview |
| P-08 | Namespaces | `src/pages/Namespaces.tsx` | Renders namespace list with status |
| P-09 | Events | `src/pages/Events.tsx` | Renders event stream with type filtering |
| P-10 | KubeConfig Setup | `src/pages/KubeConfigSetup.tsx` | Renders file upload form and context selector |

### Test Pattern

```typescript
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { Dashboard } from './Dashboard';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>
  );
}

describe('Dashboard', () => {
  it('renders without crashing', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });

  it('shows cluster summary cards', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText(/clusters/i)).toBeInTheDocument();
  });
});
```

### Additional Page Tests

| # | Page | Key Assertion |
|---|---|---|
| P-11 | Nodes | Node table renders with CPU/memory columns |
| P-12 | StatefulSets | StatefulSet list renders with replica counts |
| P-13 | DaemonSets | DaemonSet list renders with desired/current counts |
| P-14 | Jobs | Job list renders with completions |
| P-15 | CronJobs | CronJob list renders with schedule column |
| P-16 | Secrets | Secret list renders with type column (data masked) |
| P-17 | PersistentVolumeClaims | PVC list renders with status and capacity |
| P-18 | Ingresses | Ingress list renders with host and path |
| P-19 | NetworkPolicies | NetworkPolicy list renders with pod selector |
| P-20 | CRDs Overview | CRD list renders with group, version, kind |

---

## 4. Topology Component Snapshot Tests

Snapshot tests capture the rendered DOM structure of topology components. When a component's output changes, the snapshot diff shows exactly what changed.

### Components to Snapshot

| # | Component | File | Mock Data |
|---|---|---|---|
| S-01 | BaseNode | `src/topology/nodes/BaseNode.tsx` | Single Pod node |
| S-02 | CompactNode | `src/topology/nodes/CompactNode.tsx` | Deployment node (compact mode) |
| S-03 | ExpandedNode | `src/topology/nodes/ExpandedNode.tsx` | Deployment node with replicas |
| S-04 | MinimalNode | `src/topology/nodes/MinimalNode.tsx` | Pod node (minimal view) |
| S-05 | SummaryNode | `src/topology/nodes/SummaryNode.tsx` | Namespace summary node |
| S-06 | GroupNode | `src/topology/nodes/GroupNode.tsx` | Namespace group |
| S-07 | AnimatedEdge | `src/topology/edges/AnimatedEdge.tsx` | Owns-type edge |
| S-08 | LabeledEdge | `src/topology/edges/LabeledEdge.tsx` | Selects-type edge with label |
| S-09 | TopologyToolbar | `src/topology/TopologyToolbar.tsx` | Default toolbar state |
| S-10 | TopologyDetailPanel | `src/topology/TopologyDetailPanel.tsx` | Selected Pod node |
| S-11 | TopologyBreadcrumbs | `src/topology/TopologyBreadcrumbs.tsx` | Cluster > Namespace path |
| S-12 | TopologyEmptyState | `src/topology/TopologyEmptyState.tsx` | No resources |
| S-13 | TopologyErrorState | `src/topology/TopologyErrorState.tsx` | Connection error |
| S-14 | TopologyLoadingSkeleton | `src/topology/TopologyLoadingSkeleton.tsx` | Loading state |
| S-15 | HealthOverlay | `src/topology/overlays/HealthOverlay.tsx` | Mixed health states |

### Snapshot Test Pattern

```typescript
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BaseNode } from './BaseNode';

const mockNode = {
  id: 'Pod/default/nginx',
  data: {
    kind: 'Pod',
    name: 'nginx-abc123',
    namespace: 'default',
    computed: { health: 'healthy' },
  },
};

describe('BaseNode', () => {
  it('matches snapshot', () => {
    const { container } = render(<BaseNode {...mockNode} />);
    expect(container).toMatchSnapshot();
  });

  it('matches snapshot with error health', () => {
    const errorNode = {
      ...mockNode,
      data: { ...mockNode.data, computed: { health: 'error' } },
    };
    const { container } = render(<BaseNode {...errorNode} />);
    expect(container).toMatchSnapshot();
  });
});
```

### Updating Snapshots

```bash
npx vitest run --update
npx vitest run src/topology/nodes/BaseNode.test.tsx --update
```

---

## 5. Zustand Store Tests

### Stores to Test

| # | Store | File | Key State |
|---|---|---|---|
| Z-01 | clusterStore | `src/stores/clusterStore.ts` | Selected cluster, cluster list, connection status |
| Z-02 | authStore | `src/stores/authStore.ts` | Auth token, user info, login/logout |
| Z-03 | uiStore | `src/stores/uiStore.ts` | Sidebar state, active panel, modals |
| Z-04 | themeStore | `src/stores/themeStore.ts` | Theme preference (light/dark/system) |
| Z-05 | addonStore | `src/stores/addonStore.ts` | Catalog, installed addons, install status |
| Z-06 | topologyStore | `src/topology/store/topologyStore.ts` | Nodes, edges, selected node, filters |
| Z-07 | notificationStore | `src/stores/notificationStore.ts` | Notification queue, dismiss |
| Z-08 | kubeConfigStore | `src/stores/kubeConfigStore.ts` | Contexts, selected context |
| Z-09 | backendConfigStore | `src/stores/backendConfigStore.ts` | Backend URL, connection state |
| Z-10 | aiPanelStore | `src/stores/aiPanelStore.ts` | AI panel open/close, conversation |

### Test Pattern

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useClusterStore } from './clusterStore';

describe('clusterStore', () => {
  beforeEach(() => {
    useClusterStore.setState(useClusterStore.getInitialState());
  });

  it('starts with no selected cluster', () => {
    const state = useClusterStore.getState();
    expect(state.selectedCluster).toBeNull();
  });

  it('sets selected cluster', () => {
    const cluster = { id: 'abc', name: 'prod', status: 'connected' };
    useClusterStore.getState().selectCluster(cluster);
    expect(useClusterStore.getState().selectedCluster).toEqual(cluster);
  });

  it('clears selected cluster', () => {
    useClusterStore.getState().selectCluster({ id: 'abc' });
    useClusterStore.getState().clearSelection();
    expect(useClusterStore.getState().selectedCluster).toBeNull();
  });
});
```

### Store Test Checklist

For each store, verify:
- [ ] Initial state is correct
- [ ] Each action produces the expected state change
- [ ] Selectors derive correct values
- [ ] Async actions handle loading/error states
- [ ] Store reset works correctly

---

## 6. E2E Scenarios

### Playwright Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
```

### E2E Test Scenarios

| # | Scenario | Steps | Expected |
|---|---|---|---|
| E-01 | Login flow | Navigate to login, enter credentials, submit | Redirected to dashboard |
| E-02 | KubeConfig setup | Upload kubeconfig file, select context, connect | Cluster appears in sidebar |
| E-03 | Dashboard loads | Login, navigate to dashboard | Cluster cards visible with status |
| E-04 | Topology renders | Select cluster, navigate to topology | Canvas renders with nodes and edges |
| E-05 | Topology node click | Click a node on the topology canvas | Detail panel opens with resource info |
| E-06 | Topology export | Click export button, select PNG | File downloads |
| E-07 | Resource list navigation | Navigate to Deployments page | Table renders with deployments |
| E-08 | Resource detail | Click a deployment in the list | Detail page shows pods, events |
| E-09 | Namespace switching | Change namespace in dropdown | Resource lists update to new namespace |
| E-10 | Dark mode toggle | Toggle theme in settings | All pages render in dark mode |
| E-11 | Add-on catalog | Navigate to add-ons, browse catalog | Catalog cards render with install buttons |
| E-12 | Search resources | Type in global search bar | Results show matching resources |
| E-13 | WebSocket live updates | Create a resource via kubectl | UI updates within 5 seconds |
| E-14 | Cluster disconnect | Disconnect cluster | Status badge changes, topology clears |
| E-15 | Error state | Navigate to non-existent route | 404 page renders |

---

## 7. Coverage Targets

| Category | Target | Measurement |
|---|---|---|
| Page rendering tests | 100% of pages have smoke tests | Count of test files vs page files |
| Topology snapshot tests | 100% of topology components | Snapshot file count |
| Zustand store tests | 100% of stores | Store test file count |
| Line coverage (vitest) | 70% | `vitest run --coverage` |
| E2E scenario coverage | 15 scenarios passing | Playwright test count |

### Running Tests

```bash
npm run test              # Unit + integration
npx vitest run --coverage # With coverage
npm run test:watch        # Watch mode
npm run e2e              # E2E tests
npm run e2e:ci           # E2E in CI mode
```

---

## 8. CI Integration

### GitHub Actions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
        working-directory: kubilitics-frontend
      - name: Run unit tests
        run: npx vitest run --coverage
        working-directory: kubilitics-frontend

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
        working-directory: kubilitics-frontend
      - run: npx playwright install --with-deps
        working-directory: kubilitics-frontend
      - name: Run E2E tests
        run: npm run e2e:ci
        working-directory: kubilitics-frontend
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: kubilitics-frontend/playwright-report/
```
