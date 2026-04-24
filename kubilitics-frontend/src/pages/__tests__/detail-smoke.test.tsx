/**
 * Smoke tests for GenericResourceDetail component states.
 *
 * Covers: loading skeleton, error state, not-found state.
 * Mocking follows the same pattern as GenericResourceDetail.test.tsx
 * but is intentionally minimal — just enough to verify render states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { Settings } from 'lucide-react';

// ---------------------------------------------------------------------------
// Mock controls — mutated per test to drive component states
// ---------------------------------------------------------------------------
let mockResource: Record<string, unknown> | null = null;
let mockIsLoading = false;
let mockError: Error | null = null;
let mockIsConnected = true;

vi.mock('@/hooks/useK8sResourceDetail', () => ({
  useResourceDetail: () => ({
    resource: mockResource,
    isLoading: mockIsLoading,
    error: mockError,
    age: '5 minutes',
    yaml: 'apiVersion: v1\nkind: Pod',
    isConnected: mockIsConnected,
    refetch: vi.fn(),
  }),
  useResourceEvents: () => ({
    events: [],
  }),
}));

vi.mock('@/hooks/useKubernetes', () => ({
  useDeleteK8sResource: () => ({ mutateAsync: vi.fn() }),
  useUpdateK8sResource: () => ({ mutateAsync: vi.fn() }),
}));

// Phase 7: clusterStore deleted. Appearance helpers moved to clusterAppearance.
vi.mock('@/stores/clusterAppearance', () => ({
  getClusterAppearance: () => ({ color: '', environment: '', alias: '' }),
  setClusterAppearance: vi.fn(),
  getEnvBadgeLabel: () => null,
  getEnvBadgeClasses: () => '',
}));

vi.mock('@/stores/clusterPresenceStore', () => ({
  useActiveCluster: () => ({
    id: 'smoke-cluster-id',
    name: 'smoke-cluster',
    serverUrl: 'https://smoke',
    provider: '',
  }),
  getActiveCluster: () => ({
    id: 'smoke-cluster-id',
    name: 'smoke-cluster',
    serverUrl: 'https://smoke',
    provider: '',
  }),
  useClusterPresenceStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      discovered: [],
      registered: [],
      connected: [],
      availableClusters: () => [],
      activeLogicalIdentity: null,
      isReady: true,
      setActiveByLogicalIdentity: vi.fn(),
      applySnapshot: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
  setActiveClusterBySessionId: vi.fn(),
  __resetForTest: vi.fn(),
}));

vi.mock('@/hooks/useActiveClusterId', () => ({
  useActiveClusterId: () => 'smoke-cluster-id',
}));

vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isBackendConfigured: () => false,
      backendBaseUrl: 'http://localhost:8190',
    };
    return selector(state);
  },
  getEffectiveBackendBaseUrl: () => 'http://localhost:8190',
}));

vi.mock('@/components/layout/Breadcrumbs', () => ({
  Breadcrumbs: () => <div data-testid="breadcrumbs" />,
  useDetailBreadcrumbs: () => [{ label: 'Test' }],
}));

vi.mock('@/utils/resourceKindMapper', () => ({
  normalizeKindForTopology: (kind: string) => kind,
}));

vi.mock('@/lib/exportUtils', () => ({
  downloadResourceJson: vi.fn(),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/notificationFormatter', () => ({
  normalizeError: () => ({
    title: 'Error',
    description: 'Something went wrong',
    details: 'details',
  }),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('@/services/backendApiClient', () => ({
  BackendApiError: class BackendApiError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
      this.name = 'BackendApiError';
    }
  },
}));

vi.mock('@/hooks/useNamespacesFromCluster', () => ({
  useNamespacesFromCluster: () => ({
    namespaces: ['default'],
    isLoading: false,
  }),
}));

vi.mock('@/services/api/resources', () => ({
  applyManifest: vi.fn(),
}));

vi.mock('@/lib/conflictDetection', () => ({
  isConflictError: () => false,
}));

// Stub heavy sub-components to keep tests light
vi.mock('@/components/resources', () => ({
  ResourceDetailLayout: ({ children, tabs, activeTab, name, resourceType }: { children?: React.ReactNode; tabs?: { id: string; label: string; content?: React.ReactNode }[]; activeTab?: string; name?: string; resourceType?: string }) => (
    <div data-testid="resource-detail-layout">
      <span data-testid="resource-name">{name}</span>
      <span data-testid="resource-type">{resourceType}</span>
      {children}
      {tabs?.find((t: { id: string; label: string; content?: React.ReactNode }) => t.id === activeTab)?.content}
    </div>
  ),
  YamlViewer: () => <div data-testid="yaml-viewer" />,
  EventsSection: () => <div data-testid="events-section" />,
  ActionsSection: () => <div data-testid="actions-section" />,
  DeleteConfirmDialog: () => <div data-testid="delete-dialog" />,
  ResourceTopologyView: () => <div data-testid="topology-view" />,
  ResourceComparisonView: () => <div data-testid="comparison-view" />,
}));

vi.mock('@/components/resources/BlastRadiusTab', () => ({
  BlastRadiusTab: () => <div data-testid="blast-radius-tab" />,
}));

vi.mock('@/components/editor/CodeEditor', () => ({
  CodeEditor: () => <div data-testid="code-editor" />,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { GenericResourceDetail } from '@/components/resources/GenericResourceDetail';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderDetail(
  overrides: Partial<React.ComponentProps<typeof GenericResourceDetail>> = {},
  path = '/pods/:namespace/:name',
  entry = '/pods/default/my-pod',
) {
  const props = {
    resourceType: 'pods' as const,
    kind: 'Pod',
    pluralLabel: 'Pods',
    listPath: '/pods',
    resourceIcon: Settings,
    ...overrides,
  };

  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={path} element={<GenericResourceDetail {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockResource = null;
  mockIsLoading = false;
  mockError = null;
  mockIsConnected = true;
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GenericResourceDetail smoke tests', () => {
  it('renders loading skeleton without crashing', () => {
    mockIsLoading = true;

    const { container } = renderDetail();

    // Should render skeleton pulse elements
    const skeletons = container.querySelectorAll('[class*="animate-pulse"], [data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);

    // Should NOT show the loaded layout
    expect(screen.queryByTestId('resource-detail-layout')).not.toBeInTheDocument();
  });

  it('renders error state with retry button', () => {
    mockError = new Error('Connection refused');
    mockIsLoading = false;
    mockResource = null;

    renderDetail();

    expect(screen.getByText(/Could not load Pod/)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Back to Pods')).toBeInTheDocument();
  });

  it('renders not-found state when resource is empty', () => {
    mockResource = { metadata: {} }; // No name in metadata
    mockIsLoading = false;
    mockError = null;

    renderDetail();

    expect(screen.getByText('Pod not found.')).toBeInTheDocument();
    expect(screen.getByText('Back to Pods')).toBeInTheDocument();
  });

  it('renders loaded state when resource is present', () => {
    mockResource = {
      metadata: { name: 'my-pod', namespace: 'default' },
      spec: {},
    };
    mockIsLoading = false;
    mockError = null;

    renderDetail();

    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
    expect(screen.getByTestId('resource-name')).toHaveTextContent('my-pod');
  });
});
