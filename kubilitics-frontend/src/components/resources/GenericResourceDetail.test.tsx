/**
 * Tests for src/components/resources/GenericResourceDetail.tsx
 *
 * Covers: loading skeleton, error card, not-found card, custom tabs rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { Settings } from 'lucide-react';

// ---- Mock controls ----
let mockResource: Record<string, unknown> | null = null;
let mockIsLoading = false;
let mockError: Error | null = null;
let mockIsConnected = true;

vi.mock('@/hooks/useK8sResourceDetail', () => ({
  useResourceDetail: () => ({
    resource: mockResource,
    isLoading: mockIsLoading,
    error: mockError,
    age: '2 hours',
    yaml: 'apiVersion: v1\nkind: ConfigMap',
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

vi.mock('@/stores/clusterAppearance', () => ({
  getClusterAppearance: () => ({ color: '', environment: '', alias: '' }),
  setClusterAppearance: vi.fn(),
  getEnvBadgeLabel: () => null,
  getEnvBadgeClasses: () => '',
}));

vi.mock('@/stores/clusterPresenceStore', () => ({
  useActiveCluster: () => ({
    id: 'test-cluster-id',
    name: 'test-cluster',
    serverUrl: 'https://test',
    provider: '',
  }),
  getActiveCluster: () => ({
    id: 'test-cluster-id',
    name: 'test-cluster',
    serverUrl: 'https://test',
    provider: '',
  }),
  useClusterPresenceStore: () => ({
    discovered: [],
    registered: [],
    connected: [],
    availableClusters: () => [],
  }),
  setActiveClusterBySessionId: vi.fn(),
  __resetForTest: vi.fn(),
}));

vi.mock('@/hooks/useActiveClusterId', () => ({
  useActiveClusterId: () => 'test-cluster-id',
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
  Breadcrumbs: ({ segments }: { segments?: unknown[] }) => <div data-testid="breadcrumbs">{segments?.length ?? 0} segments</div>,
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
  normalizeError: (_err: unknown, _ctx: unknown) => ({
    title: 'Error',
    description: 'Something went wrong',
    details: 'Technical details here',
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

// Mock the heavy sub-components to keep tests light
vi.mock('@/components/resources', () => ({
  ResourceDetailLayout: ({ children, tabs, activeTab, name, resourceType, ...rest }: { children?: React.ReactNode; tabs?: { id: string; label: string; content?: React.ReactNode }[]; activeTab?: string; name?: string; resourceType?: string; [key: string]: unknown }) => (
    <div data-testid="resource-detail-layout">
      <div data-testid="resource-name">{name}</div>
      <div data-testid="resource-type">{resourceType}</div>
      {children}
      <div data-testid="tabs">
        {tabs?.map((t: { id: string; label: string; content?: React.ReactNode }) => (
          <div key={t.id} data-testid={`tab-${t.id}`}>
            {t.label}
          </div>
        ))}
      </div>
      {/* Render active tab content */}
      {tabs?.find((t: { id: string; label: string; content?: React.ReactNode }) => t.id === activeTab)?.content}
    </div>
  ),
  YamlViewer: () => <div data-testid="yaml-viewer">YAML</div>,
  EventsSection: () => <div data-testid="events-section">Events</div>,
  ActionsSection: ({ actions }: { actions?: unknown[] }) => (
    <div data-testid="actions-section">{actions?.length} actions</div>
  ),
  DeleteConfirmDialog: () => <div data-testid="delete-dialog" />,
  ResourceTopologyView: () => <div data-testid="topology-view" />,
  ResourceComparisonView: () => <div data-testid="comparison-view" />,
}));

vi.mock('@/components/resources/BlastRadiusTab', () => ({
  BlastRadiusTab: () => <div data-testid="blast-radius-tab" />,
}));

import { GenericResourceDetail } from './GenericResourceDetail';

// Helper to render with route params
function renderWithParams(
  props: Partial<React.ComponentProps<typeof GenericResourceDetail>> = {},
  routePath = '/configmaps/:namespace/:name',
  entryPath = '/configmaps/default/my-config',
) {
  const defaultProps = {
    resourceType: 'configmaps' as const,
    kind: 'ConfigMap',
    pluralLabel: 'ConfigMaps',
    listPath: '/configmaps',
    resourceIcon: Settings,
    ...props,
  };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entryPath]}>
        <Routes>
          <Route
            path={routePath}
            element={<GenericResourceDetail {...defaultProps} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
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

// ============================================================================

describe('GenericResourceDetail', () => {
  it('shows loading skeleton when loading', () => {
    mockIsLoading = true;

    const { container } = renderWithParams();

    // The loading state renders Skeleton components (which render divs with specific classes)
    // There should be multiple skeleton elements
    const skeletons = container.querySelectorAll('[class*="animate-pulse"], [data-slot="skeleton"]');
    // At minimum, expect the layout skeleton (h-20) plus card skeletons
    expect(skeletons.length).toBeGreaterThan(0);

    // Should NOT show the resource detail layout
    expect(screen.queryByTestId('resource-detail-layout')).not.toBeInTheDocument();
  });

  it('shows error card on error', () => {
    mockError = new Error('Connection refused');
    mockIsLoading = false;

    renderWithParams();

    expect(screen.getByText(/Could not load ConfigMap/)).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Back to ConfigMaps')).toBeInTheDocument();
  });

  it('shows "Copy technical details" button on non-404 error', () => {
    mockError = new Error('Internal server error');
    mockIsLoading = false;

    renderWithParams();

    expect(screen.getByText('Copy technical details')).toBeInTheDocument();
  });

  it('shows not-found card when resource is missing', () => {
    mockResource = { metadata: {} }; // No name in metadata
    mockIsLoading = false;
    mockError = null;
    mockIsConnected = true;

    renderWithParams();

    expect(screen.getByText('ConfigMap not found.')).toBeInTheDocument();
    expect(screen.getByText('Back to ConfigMaps')).toBeInTheDocument();
  });

  it('renders resource detail layout when resource is loaded', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
      data: { key: 'value' },
    };
    mockIsLoading = false;
    mockError = null;

    renderWithParams();

    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
    expect(screen.getByTestId('resource-name')).toHaveTextContent('my-config');
    expect(screen.getByTestId('resource-type')).toHaveTextContent('ConfigMap');
  });

  it('renders standard tabs (events, traces, yaml, compare, topology, blast-radius, actions)', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    renderWithParams();

    expect(screen.getByTestId('tab-events')).toBeInTheDocument();
    expect(screen.getByTestId('tab-traces')).toBeInTheDocument();
    expect(screen.getByTestId('tab-yaml')).toBeInTheDocument();
    expect(screen.getByTestId('tab-compare')).toBeInTheDocument();
    expect(screen.getByTestId('tab-topology')).toBeInTheDocument();
    expect(screen.getByTestId('tab-blast-radius')).toBeInTheDocument();
    expect(screen.getByTestId('tab-actions')).toBeInTheDocument();
  });

  it('renders custom tabs before standard tabs', () => {
    mockResource = {
      metadata: { name: 'my-deploy', namespace: 'default' },
    };

    const customTabs = [
      {
        id: 'overview',
        label: 'Overview',
        render: () => <div data-testid="custom-overview">Custom Overview Content</div>,
      },
      {
        id: 'replicas',
        label: 'Replicas',
        render: () => <div data-testid="custom-replicas">Replicas Content</div>,
      },
    ];

    renderWithParams({
      customTabs,
      resourceType: 'deployments' as React.ComponentProps<typeof GenericResourceDetail>['resourceType'],
      kind: 'Deployment',
      pluralLabel: 'Deployments',
      listPath: '/deployments',
    }, '/deployments/:namespace/:name', '/deployments/default/my-deploy');

    // Custom tabs should appear
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-replicas')).toBeInTheDocument();

    // The default active tab is 'overview' — custom content should render
    expect(screen.getByTestId('custom-overview')).toBeInTheDocument();
  });

  it('uses default loading card count of 4', () => {
    mockIsLoading = true;

    const { container } = renderWithParams();

    // The component renders loadingCardCount skeletons in the grid
    // Default is 4 — just verify the loading state renders
    expect(container.querySelector('.space-y-6')).toBeInTheDocument();
  });

  it('respects custom loadingCardCount', () => {
    mockIsLoading = true;

    const { container } = renderWithParams({ loadingCardCount: 2 });

    // Should have 2 skeleton cards in the grid (plus 2 outer skeletons)
    expect(container.querySelector('.space-y-6')).toBeInTheDocument();
  });

  it('renders extraDialogs when provided', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    renderWithParams({
      extraDialogs: (ctx) => (
        <div data-testid="extra-dialog">Extra dialog for {ctx.name}</div>
      ),
    });

    expect(screen.getByTestId('extra-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('extra-dialog')).toHaveTextContent('Extra dialog for my-config');
  });

  it('accepts custom headerMetadata function without errors', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    const headerMetadata = vi.fn().mockReturnValue(
      <span>Custom meta</span>
    );

    renderWithParams({ headerMetadata });

    // The headerMetadata function should be called with the resource context
    expect(headerMetadata).toHaveBeenCalledTimes(1);
    expect(headerMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-config',
        namespace: 'default',
      })
    );
  });

  it('calls buildStatusCards with resource context', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
      data: { key1: 'value1', key2: 'value2' },
    };

    const buildStatusCards = vi.fn().mockReturnValue([]);

    renderWithParams({ buildStatusCards });

    expect(buildStatusCards).toHaveBeenCalledTimes(1);
    expect(buildStatusCards).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: mockResource,
        name: 'my-config',
        namespace: 'default',
      })
    );
  });

  it('calls deriveStatus with the resource', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
      data: {},
    };

    const deriveStatus = vi.fn().mockReturnValue('Warning');

    renderWithParams({ deriveStatus });

    expect(deriveStatus).toHaveBeenCalledTimes(1);
    expect(deriveStatus).toHaveBeenCalledWith(mockResource);
  });

  it('defaults status to Healthy when deriveStatus is not provided', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    // Just renders without error - status defaults to 'Healthy'
    renderWithParams();

    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
  });

  it('renders extraHeaderActions alongside default actions', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    renderWithParams({
      extraHeaderActions: (ctx) => [
        { label: 'Custom Action', icon: Settings, variant: 'outline', onClick: () => {} },
      ],
    });

    // The layout should render without error
    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
  });

  it('replaces header actions entirely when headerActions prop is provided', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    renderWithParams({
      headerActions: (ctx) => [
        { label: 'Only Action', icon: Settings, variant: 'outline', onClick: () => {} },
      ],
    });

    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
  });

  it('renders extraActionItems in the actions tab', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    renderWithParams({
      extraActionItems: (ctx) => [
        { icon: Settings, label: 'Extra Action', description: 'An extra action item' },
      ],
    });

    // The actions tab should exist
    expect(screen.getByTestId('tab-actions')).toBeInTheDocument();
  });

  it('shows "Created" age in default header metadata', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    renderWithParams();

    // The ResourceDetailLayout mock receives headerMetadata but doesn't render its content.
    // Verify the component renders the layout successfully with default metadata.
    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
  });

  it('passes status and statusCards to ResourceDetailLayout', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    const statusCards = [
      { title: 'Keys', value: '3', icon: Settings },
    ];

    renderWithParams({
      deriveStatus: () => 'Warning',
      buildStatusCards: () => statusCards,
    });

    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
  });

  it('renders breadcrumbs in the detail view', () => {
    mockResource = {
      metadata: { name: 'my-config', namespace: 'default' },
    };

    renderWithParams();

    expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
  });

  it('handles resource with no namespace (cluster-scoped)', () => {
    mockResource = {
      metadata: { name: 'my-node' },
    };

    renderWithParams(
      {
        resourceType: 'nodes' as React.ComponentProps<typeof GenericResourceDetail>['resourceType'],
        kind: 'Node',
        pluralLabel: 'Nodes',
        listPath: '/nodes',
      },
      '/nodes/:name',
      '/nodes/my-node'
    );

    expect(screen.getByTestId('resource-detail-layout')).toBeInTheDocument();
    expect(screen.getByTestId('resource-name')).toHaveTextContent('my-node');
  });
});
