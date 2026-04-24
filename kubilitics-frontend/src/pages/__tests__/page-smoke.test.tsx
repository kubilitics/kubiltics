/**
 * Smoke tests for major Kubilitics frontend pages.
 *
 * Goal: verify each page renders without crashing and shows basic content.
 * All external hooks/stores are mocked to avoid network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Shared mocks — keep minimal, just enough to prevent crashes
// ---------------------------------------------------------------------------

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target, prop) => {
      // Return a forwardRef component for any HTML element (div, section, etc.)
      return React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLElement>) => {
        const { variants, initial, animate, whileHover, whileTap, whileInView, exit, layout, layoutId, transition, ...rest } = props;
        const Tag = String(prop) as keyof JSX.IntrinsicElements;
        return React.createElement(Tag, { ...rest, ref });
      });
    },
  }),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useInView: () => true,
}));

// Backend config store
vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      backendBaseUrl: 'http://localhost:8190',
      currentClusterId: 'test-cluster-id',
      setBackendBaseUrl: vi.fn(),
      setCurrentClusterId: vi.fn(),
      isBackendConfigured: () => true,
    };
    return selector ? selector(state) : state;
  },
  getEffectiveBackendBaseUrl: () => 'http://localhost:8190',
}));

// Cluster store — both the legacy and presence flavours are mocked so pages
// migrated to `useActiveCluster()` keep seeing the test cluster.
vi.mock('@/stores/clusterStore', () => ({
  useClusterStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      activeCluster: { id: 'test-cluster-id', name: 'test-cluster', context: 'test-context' },
      clusters: [{ id: 'test-cluster-id', name: 'test-cluster', context: 'test-context' }],
      setActiveCluster: vi.fn(),
      setClusters: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
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
  useClusterPresenceStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      discovered: [],
      registered: [],
      connected: [],
      availableClusters: () => [],
      activeLogicalIdentity: { name: 'test-cluster', serverUrl: 'https://test' },
      isReady: true,
      setActiveByLogicalIdentity: vi.fn(),
      applySnapshot: vi.fn(),
      activeCluster: () => null,
    };
    return selector ? selector(state) : state;
  },
  setActiveClusterBySessionId: vi.fn(),
  __resetForTest: vi.fn(),
}));

// Theme store
vi.mock('@/stores/themeStore', () => ({
  useThemeStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      theme: 'system' as const,
      setTheme: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

// Cluster organization store (FleetDashboard)
vi.mock('@/stores/clusterOrganizationStore', () => ({
  useClusterOrganizationStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state: Record<string, unknown> = {
      favorites: new Set<string>(),
      envTags: {} as Record<string, string>,
      groups: {} as Record<string, unknown>,
      toggleFavorite: vi.fn(),
      setEnvTag: vi.fn(),
      addToGroup: vi.fn(),
      removeFromGroup: vi.fn(),
      addGroup: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
  ENV_DOT_COLORS: {},
  ENV_LABELS: {},
  ENV_BADGE_CLASSES: {},
  GROUP_COLORS: ['#3b82f6'],
}));

// Connection status
vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ isConnected: true }),
}));

// Resource counts
vi.mock('@/hooks/useResourceCounts', () => ({
  useResourceCounts: () => ({
    counts: { pods: 10, deployments: 5, services: 3, nodes: 2 },
    isLoading: false,
    isInitialLoad: false,
    isConnected: true,
  }),
}));

// Cluster overview (Dashboard)
vi.mock('@/hooks/useClusterOverview', () => ({
  useClusterOverview: () => ({
    data: { health: 'healthy', nodeCount: 2, podCount: 10 },
    isLoading: false,
    error: null,
    isError: false,
  }),
}));

// Fleet overview (FleetDashboard)
vi.mock('@/hooks/useFleetOverview', () => ({
  useFleetOverview: () => ({
    clusters: [],
    aggregates: { totalNodes: 0, totalPods: 0, healthyClusters: 0, warningClusters: 0, errorClusters: 0 },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// Active cluster ID
vi.mock('@/hooks/useActiveClusterId', () => ({
  useActiveClusterId: () => 'test-cluster-id',
}));

// Namespaces
vi.mock('@/hooks/useNamespacesFromCluster', () => ({
  useNamespacesFromCluster: () => ({
    namespaces: ['default', 'kube-system'],
    isLoading: false,
  }),
}));

// K8s resource list (RBACAnalyzer)
vi.mock('@/hooks/useKubernetes', () => ({
  useK8sResourceList: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// Backend circuit breaker
vi.mock('@/hooks/useBackendCircuitOpen', () => ({
  useBackendCircuitOpen: () => false,
}));

// Clusters from backend (Settings)
vi.mock('@/hooks/useClustersFromBackend', () => ({
  useClustersFromBackend: () => ({
    data: [],
    isLoading: false,
  }),
}));

// Backend API client
vi.mock('@/services/backendApiClient', () => ({
  getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
  deleteCluster: vi.fn().mockResolvedValue(undefined),
  getProjects: vi.fn().mockResolvedValue([]),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  searchResources: vi.fn().mockResolvedValue([]),
}));

// Resources API
vi.mock('@/services/api/resources', () => ({
  applyManifest: vi.fn().mockResolvedValue({ ok: true }),
}));

// Toast notifications
vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Tauri detection
vi.mock('@/lib/tauri', () => ({
  isTauri: () => false,
}));

// Backend constants
vi.mock('@/lib/backendConstants', () => ({
  DEFAULT_BACKEND_BASE_URL: 'http://localhost:8190',
  isLocalHostname: () => true,
}));

// Backend cluster adapter
vi.mock('@/lib/backendClusterAdapter', () => ({
  backendClusterToCluster: (c: unknown) => c,
}));

// Dashboard tour (Dashboard page)
vi.mock('@/components/onboarding/DashboardTour', () => ({
  DashboardTour: () => null,
  useDashboardTour: () => ({ showTour: false, completeTour: vi.fn(), skipTour: vi.fn() }),
}));

// Dashboard sub-components — stub them out to isolate page-level rendering
vi.mock('@/components/dashboard/LiveSignalStrip', () => ({
  LiveSignalStrip: () => <div data-testid="live-signal-strip">LiveSignalStrip</div>,
}));
vi.mock('@/components/dashboard/DashboardHero', () => ({
  DashboardHero: () => <div data-testid="dashboard-hero">DashboardHero</div>,
}));
vi.mock('@/components/dashboard/IntelligencePanel', () => ({
  IntelligencePanel: () => <div data-testid="intelligence-panel">IntelligencePanel</div>,
}));
vi.mock('@/features/dashboard/components/ClusterOverviewPanel', () => ({
  ClusterOverviewPanel: () => <div data-testid="cluster-overview-panel">ClusterOverviewPanel</div>,
}));
vi.mock('@/components/dashboard/ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed">ActivityFeed</div>,
}));
vi.mock('@/components/dashboard/WorkloadCapacitySnapshot', () => ({
  WorkloadCapacitySnapshot: () => <div data-testid="workload-capacity">WorkloadCapacitySnapshot</div>,
}));
vi.mock('@/components/dashboard/HealthScoreCard', () => ({
  HealthScoreCard: () => <div data-testid="health-score-card">HealthScoreCard</div>,
}));
vi.mock('@/components/dashboard/ClusterDetailsPanel', () => ({
  ClusterDetailsPanel: () => <div data-testid="cluster-details">ClusterDetailsPanel</div>,
}));

// Code editor (ResourceTemplates)
vi.mock('@/components/editor/CodeEditor', () => ({
  CodeEditor: () => <div data-testid="code-editor">CodeEditor</div>,
}));

// Project components (Settings)
vi.mock('@/components/projects/CreateProjectDialog', () => ({
  CreateProjectDialog: () => null,
}));
vi.mock('@/components/projects/ProjectCard', () => ({
  ProjectCard: () => <div>ProjectCard</div>,
}));
vi.mock('@/components/projects/ProjectSettingsDialog', () => ({
  ProjectSettingsDialog: () => null,
}));
vi.mock('@/components/settings/ClusterAppearance', () => ({
  ClusterAppearanceSettings: () => <div data-testid="cluster-appearance">ClusterAppearance</div>,
}));

// StatusBadge (FleetDashboard)
vi.mock('@/components/ui/status-badge', () => ({
  StatusBadge: ({ status, children }: { status?: string; children?: React.ReactNode }) => <span data-testid="status-badge">{children || status}</span>,
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderPage(ui: React.ReactElement, { route = '/' } = {}) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Polyfill window.matchMedia for jsdom (used by Settings page)
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Page smoke tests
// ---------------------------------------------------------------------------

describe('Page smoke tests', () => {
  describe('Dashboard', () => {
    it('renders without crashing and shows key content', async () => {
      const Dashboard = (await import('@/pages/Dashboard')).default;
      const { container } = renderPage(<Dashboard />);
      expect(container).toBeTruthy();
      // Dashboard shows "Gateway" heading when cluster is active
      expect(screen.getByText('Gateway')).toBeInTheDocument();
    });

    it('shows "No cluster selected" when no active cluster', async () => {
      // Temporarily override BOTH legacy and presence mocks — Dashboard reads
      // the presence view via `useActiveCluster()`, but some transitively
      // imported hooks still dip into `useClusterStore` during the transition.
      const legacy = (await import('@/stores/clusterStore')) as unknown as Record<string, unknown>;
      const presence = (await import('@/stores/clusterPresenceStore')) as unknown as Record<string, unknown>;

      const origLegacy = legacy.useClusterStore;
      legacy.useClusterStore = (selector?: (s: Record<string, unknown>) => unknown) => {
        const state: Record<string, unknown> = {
          activeCluster: null,
          clusters: [],
          setActiveCluster: vi.fn(),
          setClusters: vi.fn(),
        };
        return selector ? selector(state) : state;
      };
      const origUseActive = presence.useActiveCluster;
      presence.useActiveCluster = () => null;

      const Dashboard = (await import('@/pages/Dashboard')).default;
      renderPage(<Dashboard />);
      expect(screen.getByText('No cluster selected')).toBeInTheDocument();

      legacy.useClusterStore = origLegacy;
      presence.useActiveCluster = origUseActive;
    });
  });

  describe('FleetDashboard', () => {
    it('renders without crashing and shows Fleet Overview heading', async () => {
      const FleetDashboard = (await import('@/pages/FleetDashboard')).default;
      const { container } = renderPage(<FleetDashboard />, { route: '/fleet' });
      expect(container).toBeTruthy();
      expect(screen.getByText('Fleet Overview')).toBeInTheDocument();
    });

    it('shows empty state when no clusters', async () => {
      const FleetDashboard = (await import('@/pages/FleetDashboard')).default;
      renderPage(<FleetDashboard />, { route: '/fleet' });
      // With 0 clusters, should show the connect prompt
      expect(screen.getByText(/Connect your first cluster/)).toBeInTheDocument();
    });
  });

  describe('ResourceTemplates', () => {
    it('renders without crashing and shows heading', async () => {
      const ResourceTemplates = (await import('@/pages/ResourceTemplates')).default;
      const { container } = renderPage(<ResourceTemplates />);
      expect(container).toBeTruthy();
      expect(screen.getByText('Resource Templates')).toBeInTheDocument();
    });

    it('shows search input', async () => {
      const ResourceTemplates = (await import('@/pages/ResourceTemplates')).default;
      renderPage(<ResourceTemplates />);
      expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
    });
  });

  describe('RBACAnalyzer', () => {
    it('renders without crashing and shows RBAC Analyzer heading', async () => {
      const RBACAnalyzer = (await import('@/pages/RBACAnalyzer')).default;
      const { container } = renderPage(<RBACAnalyzer />);
      expect(container).toBeTruthy();
      expect(screen.getByText('RBAC Analyzer')).toBeInTheDocument();
    });

    it('shows tab navigation', async () => {
      const RBACAnalyzer = (await import('@/pages/RBACAnalyzer')).default;
      renderPage(<RBACAnalyzer />);
      // RBACAnalyzer has tabs — "Permission Matrix" may appear in both tab trigger and content
      expect(screen.getAllByText('Permission Matrix').length).toBeGreaterThan(0);
    });
  });

  describe('Settings', () => {
    it('renders without crashing and shows Settings heading', async () => {
      const Settings = (await import('@/pages/Settings')).default;
      const { container } = renderPage(<Settings />);
      expect(container).toBeTruthy();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });
});
