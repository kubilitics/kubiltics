import { Suspense, lazy, useState, useEffect, type ReactNode } from "react";
import { useAppZoom } from "@/hooks/useAppZoom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { Loader2 } from "lucide-react";

// Lazy-load heavy API modules to prevent TDZ (Temporal Dead Zone) crashes.
// backendApiClient pulls in topology-engine, stores, and other heavy deps —
// eagerly importing it into the root chunk causes initialization order issues
// in Rollup's bundled output.
const lazyBackendApi = () => import("@/services/backendApiClient");
const lazyAdapter = () => import("@/lib/backendClusterAdapter");

// Loading Fallback Component — uses a skeleton that mirrors typical list page layout
// instead of a blank screen with a spinner, preventing the "white flash" problem.
import { PageSkeleton } from "@/components/loading";

const PageLoader = () => (
  <div className="p-6 w-full" data-testid="page-loader">
    <PageSkeleton statCount={4} columnCount={6} rowCount={6} />
  </div>
);

// Pages - Entry & Setup
// Settings is eagerly imported to avoid Tauri WebView lazy-load failures
import SettingsPage from "./pages/Settings";
const ModeSelection = lazy(() => import("./pages/ModeSelection"));
const ClusterConnect = lazy(() => import("./pages/ClusterConnect"));
const ConnectedRedirect = lazy(() => import("./pages/ConnectedRedirect"));
const KubeConfigSetup = lazy(() => import("./pages/KubeConfigSetup"));
const ClusterSelection = lazy(() => import("./pages/ClusterSelection"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FleetDashboard = lazy(() => import("./pages/FleetDashboard"));
// HomePage removed — cluster/project management moved to Settings; Dashboard is the landing page
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const ProjectDashboardPage = lazy(() => import("./pages/ProjectDashboardPage"));

// Workloads
const Pods = lazy(() => import("./pages/Pods"));
const PodDetail = lazy(() => import("./pages/PodDetail"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Deployments = lazy(() => import("./pages/Deployments"));
const DeploymentDetail = lazy(() => import("./pages/DeploymentDetail"));
const ReplicaSets = lazy(() => import("./pages/ReplicaSets"));
const ReplicaSetDetail = lazy(() => import("./pages/ReplicaSetDetail"));
const StatefulSets = lazy(() => import("./pages/StatefulSets"));
const StatefulSetDetail = lazy(() => import("./pages/StatefulSetDetail"));
const DaemonSets = lazy(() => import("./pages/DaemonSets"));
const DaemonSetDetail = lazy(() => import("./pages/DaemonSetDetail"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetail = lazy(() => import("./pages/JobDetail"));
const CronJobs = lazy(() => import("./pages/CronJobs"));
const CronJobDetail = lazy(() => import("./pages/CronJobDetail"));
const ReplicationControllers = lazy(() => import("./pages/ReplicationControllers"));
const ReplicationControllerDetail = lazy(() => import("./pages/ReplicationControllerDetail"));
const PodTemplates = lazy(() => import("./pages/PodTemplates"));
const PodTemplateDetail = lazy(() => import("./pages/PodTemplateDetail"));
const ControllerRevisions = lazy(() => import("./pages/ControllerRevisions"));
const ControllerRevisionDetail = lazy(() => import("./pages/ControllerRevisionDetail"));
const ResourceSlices = lazy(() => import("./pages/ResourceSlices"));
const ResourceSliceDetail = lazy(() => import("./pages/ResourceSliceDetail"));
const DeviceClasses = lazy(() => import("./pages/DeviceClasses"));
const DeviceClassDetail = lazy(() => import("./pages/DeviceClassDetail"));
const IPAddressPools = lazy(() => import("./pages/IPAddressPools"));
const IPAddressPoolDetail = lazy(() => import("./pages/IPAddressPoolDetail"));
const BGPPeers = lazy(() => import("./pages/BGPPeers"));
const BGPPeerDetail = lazy(() => import("./pages/BGPPeerDetail"));
const WorkloadsOverview = lazy(() => import("./pages/WorkloadsOverview"));

// Networking
const Services = lazy(() => import("./pages/Services"));
const ServiceDetail = lazy(() => import("./pages/ServiceDetail"));
const Endpoints = lazy(() => import("./pages/Endpoints"));
const EndpointDetail = lazy(() => import("./pages/EndpointDetail"));
const EndpointSlices = lazy(() => import("./pages/EndpointSlices"));
const EndpointSliceDetail = lazy(() => import("./pages/EndpointSliceDetail"));
const Ingresses = lazy(() => import("./pages/Ingresses"));
const IngressDetail = lazy(() => import("./pages/IngressDetail"));
const IngressClasses = lazy(() => import("./pages/IngressClasses"));
const IngressClassDetail = lazy(() => import("./pages/IngressClassDetail"));
const NetworkPolicies = lazy(() => import("./pages/NetworkPolicies"));
const NetworkPolicyDetail = lazy(() => import("./pages/NetworkPolicyDetail"));
const NetworkingOverview = lazy(() => import("./pages/NetworkingOverview"));

// Storage & Config
const ConfigMaps = lazy(() => import("./pages/ConfigMaps"));
const ConfigMapDetail = lazy(() => import("./pages/ConfigMapDetail"));
const Secrets = lazy(() => import("./pages/Secrets"));
const SecretDetail = lazy(() => import("./pages/SecretDetail"));
const PersistentVolumes = lazy(() => import("./pages/PersistentVolumes"));
const PersistentVolumeDetail = lazy(() => import("./pages/PersistentVolumeDetail"));
const PersistentVolumeClaims = lazy(() => import("./pages/PersistentVolumeClaims"));
const PersistentVolumeClaimDetail = lazy(() => import("./pages/PersistentVolumeClaimDetail"));
const StorageClasses = lazy(() => import("./pages/StorageClasses"));
const StorageClassDetail = lazy(() => import("./pages/StorageClassDetail"));
const VolumeAttachments = lazy(() => import("./pages/VolumeAttachments"));
const VolumeAttachmentDetail = lazy(() => import("./pages/VolumeAttachmentDetail"));
const VolumeSnapshots = lazy(() => import("./pages/VolumeSnapshots"));
const VolumeSnapshotDetail = lazy(() => import("./pages/VolumeSnapshotDetail"));
const VolumeSnapshotClasses = lazy(() => import("./pages/VolumeSnapshotClasses"));
const VolumeSnapshotClassDetail = lazy(() => import("./pages/VolumeSnapshotClassDetail"));
const VolumeSnapshotContents = lazy(() => import("./pages/VolumeSnapshotContents"));
const VolumeSnapshotContentDetail = lazy(() => import("./pages/VolumeSnapshotContentDetail"));
const StorageOverview = lazy(() => import("./pages/StorageOverview"));
const ClusterOverview = lazy(() => import("./pages/ClusterOverview"));
const ResourcesOverview = lazy(() => import("./pages/ResourcesOverview"));
const ScalingOverview = lazy(() => import("./pages/ScalingOverview"));
const CRDsOverview = lazy(() => import("./pages/CRDsOverview"));
const AdmissionOverview = lazy(() => import("./pages/AdmissionOverview"));

// Cluster
const Nodes = lazy(() => import("./pages/Nodes"));
const NodeDetail = lazy(() => import("./pages/NodeDetail"));
const Namespaces = lazy(() => import("./pages/Namespaces"));
const NamespaceDetail = lazy(() => import("./pages/NamespaceDetail"));
const Events = lazy(() => import("./pages/Events"));
const EventDetail = lazy(() => import("./pages/EventDetail"));
const ComponentStatuses = lazy(() => import("./pages/ComponentStatuses"));
const ComponentStatusDetail = lazy(() => import("./pages/ComponentStatusDetail"));
const APIServices = lazy(() => import("./pages/APIServices"));
const APIServiceDetail = lazy(() => import("./pages/APIServiceDetail"));
const Leases = lazy(() => import("./pages/Leases"));
const LeaseDetail = lazy(() => import("./pages/LeaseDetail"));
const RuntimeClasses = lazy(() => import("./pages/RuntimeClasses"));
const RuntimeClassDetail = lazy(() => import("./pages/RuntimeClassDetail"));

// RBAC
const ServiceAccounts = lazy(() => import("./pages/ServiceAccounts"));
const ServiceAccountDetail = lazy(() => import("./pages/ServiceAccountDetail"));
const Roles = lazy(() => import("./pages/Roles"));
const RoleDetail = lazy(() => import("./pages/RoleDetail"));
const RoleBindings = lazy(() => import("./pages/RoleBindings"));
const RoleBindingDetail = lazy(() => import("./pages/RoleBindingDetail"));
const ClusterRoles = lazy(() => import("./pages/ClusterRoles"));
const ClusterRoleDetail = lazy(() => import("./pages/ClusterRoleDetail"));
const ClusterRoleBindings = lazy(() => import("./pages/ClusterRoleBindings"));
const ClusterRoleBindingDetail = lazy(() => import("./pages/ClusterRoleBindingDetail"));
const PodSecurityPolicies = lazy(() => import("./pages/PodSecurityPolicies"));
const PodSecurityPolicyDetail = lazy(() => import("./pages/PodSecurityPolicyDetail"));
const RBACAnalyzer = lazy(() => import("./pages/RBACAnalyzer"));

// Autoscaling & Resource Management
const HorizontalPodAutoscalers = lazy(() => import("./pages/HorizontalPodAutoscalers"));
const HorizontalPodAutoscalerDetail = lazy(() => import("./pages/HorizontalPodAutoscalerDetail"));
const VerticalPodAutoscalers = lazy(() => import("./pages/VerticalPodAutoscalers"));
const VerticalPodAutoscalerDetail = lazy(() => import("./pages/VerticalPodAutoscalerDetail"));
const PodDisruptionBudgets = lazy(() => import("./pages/PodDisruptionBudgets"));
const PodDisruptionBudgetDetail = lazy(() => import("./pages/PodDisruptionBudgetDetail"));
const ResourceQuotas = lazy(() => import("./pages/ResourceQuotas"));
const ResourceQuotaDetail = lazy(() => import("./pages/ResourceQuotaDetail"));
const LimitRanges = lazy(() => import("./pages/LimitRanges"));
const LimitRangeDetail = lazy(() => import("./pages/LimitRangeDetail"));
const PriorityClasses = lazy(() => import("./pages/PriorityClasses"));
const PriorityClassDetail = lazy(() => import("./pages/PriorityClassDetail"));

// Custom Resources & Admission Control
const CustomResourceDefinitions = lazy(() => import("./pages/CustomResourceDefinitions"));
const CustomResourceDefinitionDetail = lazy(() => import("./pages/CustomResourceDefinitionDetail"));
const CustomResources = lazy(() => import("./pages/CustomResources"));
const MutatingWebhooks = lazy(() => import("./pages/MutatingWebhooks"));
const MutatingWebhookDetail = lazy(() => import("./pages/MutatingWebhookDetail"));
const ValidatingWebhooks = lazy(() => import("./pages/ValidatingWebhooks"));
const ValidatingWebhookDetail = lazy(() => import("./pages/ValidatingWebhookDetail"));
const Topology = lazy(() => import("./pages/Topology"));
const ResourceTemplates = lazy(() => import("./pages/ResourceTemplates"));

// Intelligence Layer
const HealthDashboard = lazy(() => import("./pages/HealthDashboard"));
const RiskRanking = lazy(() => import("./pages/RiskRanking"));
const SPOFInventory = lazy(() => import("./pages/SPOFInventory"));
const ReportSchedules = lazy(() => import("./pages/ReportSchedules"));


import { useResourceLiveUpdates } from "./hooks/useResourceLiveUpdates";

// Layout
import { AppLayout } from "./components/layout/AppLayout";

// Global React Query defaults: cache-first architecture (Headlamp uses 3min staleTime).
// With informer cache on the backend (<1ms reads) and WebSocket invalidation as the
// primary update mechanism, we can be generous with staleTime — data is always fresh
// from the informer cache, and WebSocket events trigger targeted refetches instantly.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline resilience: serve cached data first, then revalidate in background.
      // Without this, queries fail immediately when the network is down.
      networkMode: 'offlineFirst',
      // Retry with backoff: 5s between retries to avoid hammering a dead endpoint.
      // 2 retries (not 3) — faster failure acknowledgment when cluster is truly gone.
      retry: 2,
      retryDelay: 5000,
      // 60s stale time: data from informer cache is always consistent.
      // WebSocket invalidation triggers refetch when resources actually change.
      // Headlamp uses 3min; 60s is a good balance for Kubilitics.
      staleTime: 60_000,
      // Keep data in cache for 10 minutes after last subscriber unmounts
      // (Headlamp uses 10min TTL on backend cache; align frontend GC)
      gcTime: 10 * 60_000,
      // Don't refetch on window focus — WebSocket handles freshness.
      // (Headlamp also sets refetchOnWindowFocus: false)
      refetchOnWindowFocus: false,
      // Refetch when connection restored (user reconnects)
      refetchOnReconnect: true,
      // Only refetch on mount if data is stale (>60s old)
      refetchOnMount: true,
    },
    mutations: {
      // Mutations should not fire when offline — queue until reconnected
      networkMode: 'offlineFirst',
    },
  },
});

// Restore activeCluster from backend when currentClusterId is persisted (e.g. after refresh).
// So the user stays on the current URL instead of being sent to "/".
//
// Always restore the persisted cluster ID regardless of how many clusters are registered.
// The user already made a choice — respect it. This prevents the jarring experience of
// being sent to the connect page on every refresh when multiple clusters exist.
function useRestoreClusterFromBackend() {
  const { activeCluster, setActiveCluster, setClusters, setDemo } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    if (activeCluster != null || restoreAttempted || !currentClusterId || !isBackendConfigured) {
      if (activeCluster == null && restoreAttempted && currentClusterId) setRestoreFailed(true);
      return;
    }
    const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
    if (!baseUrl) {
      setRestoreAttempted(true);
      setRestoreFailed(true);
      return;
    }
    setRestoreAttempted(true);
    Promise.all([lazyBackendApi(), lazyAdapter()])
      .then(([{ getClusters }, { backendClusterToCluster }]) =>
        getClusters(baseUrl).then((list) => {
          const backendCluster = list.find((c) => c.id === currentClusterId);
          if (!backendCluster) {
            setRestoreFailed(true);
            return;
          }
          const connectedCluster = backendClusterToCluster(backendCluster);
          const connectedClusters = list.map(backendClusterToCluster);
          setClusters(connectedClusters);
          setActiveCluster(connectedCluster);
          setDemo(false);
        })
      )
      .catch(() => setRestoreFailed(true));
  }, [
    activeCluster,
    currentClusterId,
    backendBaseUrl,
    isBackendConfigured,
    restoreAttempted,
    setClusters,
    setActiveCluster,
    setDemo,
  ]);

  return { restoreAttempted, restoreFailed };
}

// Protected route: requires active cluster only (Headlamp/Lens model — no login wall).
// On refresh, activeCluster is not persisted; we restore it from backend using persisted currentClusterId
// so the user stays on the current page instead of being redirected to "/".
// When redirecting to connect, we preserve the current URL in returnUrl so after reconnect the user lands back.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const [isHydrated, setIsHydrated] = useState(false);
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);
  const [restoreTimedOut, setRestoreTimedOut] = useState(false);
  const { restoreAttempted, restoreFailed } = useRestoreClusterFromBackend();

  useEffect(() => {
    const checkHydration = () => {
      const clusterHydrated = useClusterStore.persist.hasHydrated();
      const configHydrated = useBackendConfigStore.persist.hasHydrated();
      if (clusterHydrated && configHydrated) {
        setIsHydrated(true);
      }
    };

    checkHydration();
    const unsubCluster = useClusterStore.persist.onFinishHydration(checkHydration);
    const unsubConfig = useBackendConfigStore.persist.onFinishHydration(checkHydration);

    return () => {
      unsubCluster();
      unsubConfig();
    };
  }, []);

  // Safety timeout: if hydration takes more than 3 seconds, stop waiting
  // This prevents a permanent skeleton if localStorage is broken or persist middleware fails
  useEffect(() => {
    const timer = setTimeout(() => setHydrationTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Safety timeout: if restore takes more than 8 seconds, stop waiting
  useEffect(() => {
    const timer = setTimeout(() => setRestoreTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  // Settings page is always accessible — never gated by hydration, restore, or cluster state.
  // It's a configuration page that must render instantly regardless of app state.
  const isSettingsPage = location.pathname === '/settings';
  if (isSettingsPage) return <>{children}</>;

  // Never block on hydration forever — if it times out, proceed with defaults
  if (!isHydrated && !hydrationTimedOut) return <PageLoader />;

  // If we have a persisted cluster ID but no activeCluster yet, wait for restore (or show loader until it fails).
  const canRestore = currentClusterId && isBackendConfigured;
  if (!activeCluster && canRestore && !restoreFailed && !restoreTimedOut) {
    return <PageLoader />;
  }

  if (!activeCluster) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={returnUrl ? `/connect?returnUrl=${returnUrl}` : '/connect'} replace />;
  }

  return <>{children}</>;
}

// Initial navigation logic.
// Tauri (desktop app) → always 'desktop' mode (auto-set, skip mode selection).
// Browser (first visit, no mode persisted) → show ModeSelection so the user can
//   choose Personal (desktop/kubeconfig) or Team Server (in-cluster Helm).
// Browser (returning visit, mode persisted) → straight to /connect.
function ModeSelectionEntryPoint() {
  const { appMode, setAppMode } = useClusterStore();

  // Tauri is always desktop mode — no need for mode selection
  useEffect(() => {
    if (!appMode && isTauri()) {
      setAppMode('desktop');
    }
  }, [appMode, setAppMode]);

  // If mode is already chosen (or auto-set by Tauri), go to connect
  if (appMode) return <Navigate to="/connect" replace />;

  // Browser with no mode chosen yet → show mode selection page
  if (!isTauri()) return <Navigate to="/mode-selection" replace />;

  // Brief loading while Tauri mode auto-detects (< 1 frame)
  return null;
}

import { GlobalErrorBoundary, RouteErrorBoundary } from "@/components/GlobalErrorBoundary";
import { AnalyticsConsentDialog } from "@/components/AnalyticsConsentDialog";
import { KubeconfigContextDialog } from "@/components/KubeconfigContextDialog";
import { BackendStartupOverlay, BrowserStartupBanner } from "@/components/BackendStartupOverlay";
import { BackendStatusBanner } from "@/components/layout/BackendStatusBanner";
import { CircuitBreakerBanner } from "@/components/loading";
import { BackendClusterValidator } from "@/components/BackendClusterValidator";
import { useOverviewStream } from "@/hooks/useOverviewStream";
import { isTauri, invokeWithRetry, openExternal } from "@/lib/tauri";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import { FirstRunWizard } from "@/components/onboarding/FirstRunWizard";

// Error tracking is initialized in main.tsx (before React mounts).

// Tauri uses tauri://localhost/index.html as its origin, so window.location.pathname
// is "/index.html" — BrowserRouter's HTML5 history routing sees a non-root path and
// renders nothing. MemoryRouter starts at "/" regardless of the actual URL and is the
// correct router for embedded webviews / Electron-style apps.
const AppRouter = isTauri() ? MemoryRouter : BrowserRouter;

/**
 * ClusterOverviewStream — mounts a single persistent WebSocket to
 * /api/v1/clusters/{id}/overview/stream for the active cluster.
 * Incoming frames are written into the React Query cache so all
 * useClusterOverview consumers update in real-time without polling.
 * Renders nothing — purely a side-effect component.
 */
function ClusterOverviewStream() {
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  useOverviewStream(currentClusterId ?? undefined);
  return null;
}

/**
 * ResourceLiveUpdates — mounts a persistent WebSocket to /ws/resources
 * for the active cluster. Incoming events trigger React Query cache
 * invalidations for the corresponding resource types.
 */
function ResourceLiveUpdates() {
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  useResourceLiveUpdates({ clusterId: currentClusterId });
  return null;
}

/**
 * PERMANENT FIX (TASK-NET-001 + P0-B):
 *
 * Two-layer defense to ensure backendBaseUrl is always http://localhost:8190 in Tauri:
 *
 * Layer 1 (build-time, in backendConfigStore.ts):
 *   __VITE_IS_TAURI_BUILD__ constant baked by vite.config.ts → initialState uses
 *   DEFAULT_BACKEND_BASE_URL instead of '' → correct from the very first render.
 *
 * Layer 2 (runtime, this component):
 *   Fires on mount (by which time __TAURI_INTERNALS__ IS injected). Checks isTauri()
 *   AND __VITE_IS_TAURI_BUILD__ and writes the correct URL if still empty. This heals
 *   any persisted '' from a previous broken build or localStorage corruption.
 */
function SyncBackendUrl() {
  const setBackendBaseUrl = useBackendConfigStore((s) => s.setBackendBaseUrl);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  useEffect(() => {
    // Use build-time constant OR runtime check — belt-and-suspenders
    const isDesktop = (typeof __VITE_IS_TAURI_BUILD__ !== 'undefined' && __VITE_IS_TAURI_BUILD__) || isTauri();
    if (!isDesktop) return;
    const expectedUrl = `http://localhost:${import.meta.env.VITE_BACKEND_PORT || 8190}`;
    // Always ensure the stored URL is correct for Tauri — heal persisted '' values
    if (!backendBaseUrl || backendBaseUrl === '') {
      setBackendBaseUrl(expectedUrl);
    }
    // Run once on mount — backendBaseUrl intentionally excluded to avoid re-running on every change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBackendBaseUrl]);
  return null;
}

/**
 * Wraps children in a RouteErrorBoundary that resets automatically when the
 * route changes. Without the key, the boundary stays in error state after
 * the user navigates away and back. Using the pathname as key ensures a fresh
 * boundary on every route transition.
 */
function RouteErrorBoundaryWithReset({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary key={pathname}>
      {children}
    </RouteErrorBoundary>
  );
}

/**
 * TauriMenuHandler -- listens for native menu events emitted by the Rust backend
 * (menu-refresh, menu-docs, menu-about) and performs the corresponding actions.
 * Must be inside AppRouter because it uses useNavigate for the "about" action.
 */
function TauriMenuHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      if (cancelled) return;

      const u1 = await listen('menu-refresh', () => {
        window.location.reload();
      });
      const u2 = await listen('menu-docs', () => {
        openExternal('https://kubilitics.dev/docs');
      });
      const u3 = await listen('menu-about', () => {
        navigate('/settings');
      });

      unlisteners.push(u1, u2, u3);
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [navigate]);

  return null;
}

/** P2-6: Listens for auth-logout (e.g. 401 from backend). Navigates to / via React Router so MemoryRouter works in Tauri. */
function AuthLogoutListener({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = () => navigate('/', { replace: true });
    window.addEventListener('auth-logout', handler);
    return () => window.removeEventListener('auth-logout', handler);
  }, [navigate]);
  return <>{children}</>;
}

function AnalyticsConsentWrapper({ children }: { children: React.ReactNode }) {
  const [showConsent, setShowConsent] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    const checkConsent = async () => {
      try {
        const hasBeenAsked = await invokeWithRetry<boolean>('has_analytics_consent_been_asked');
        if (!hasBeenAsked) {
          setShowConsent(true);
        }
      } catch (error) {
        console.error('Failed to check analytics consent:', error);
      }
    };

    checkConsent();
  }, []);

  const handleConsent = async (consent: boolean) => {
    setShowConsent(false);
    // P2-9: AnalyticsConsentDialog calls invoke('set_analytics_consent', { consent }) before onConsent; no need to save here.
  };

  return (
    <>
      {children}
      <AnalyticsConsentDialog open={showConsent} onConsent={handleConsent} />
    </>
  );
}

function KubeconfigContextWrapper({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const [showDialog, setShowDialog] = useState(false);
  const [contexts, setContexts] = useState<Array<{ name: string; cluster: string; user: string; namespace?: string }>>([]);
  const [kubeconfigPath, setKubeconfigPath] = useState<string>('');

  useEffect(() => {
    if (!isTauri()) return;

    const checkFirstLaunch = async () => {
      try {
        const isFirstLaunch = await invokeWithRetry<boolean>('is_first_launch');

        if (isFirstLaunch) {
          const kubeconfigInfo = await invokeWithRetry<{
            path: string;
            current_context?: string;
            contexts: Array<{ name: string; cluster: string; user: string; namespace?: string }>;
          }>('get_kubeconfig_info', { path: null });

          if (kubeconfigInfo.contexts.length > 0) {
            setKubeconfigPath(kubeconfigInfo.path || '');
            setContexts(kubeconfigInfo.contexts);
            setShowDialog(true);
          } else {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('mark_first_launch_complete');
          }
        }
      } catch (error) {
        console.error('Failed to check first launch:', error);
      }
    };

    checkFirstLaunch();
  }, []);

  const handleSelect = async (selectedContexts: string[]) => {
    setShowDialog(false);
    // P1-5: Register each selected context with the backend, then mark first launch complete and go to connect.
    if (!isTauri() || selectedContexts.length === 0) return;
    try {
      const baseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);
      const path = kubeconfigPath || '';
      for (const contextName of selectedContexts) {
        const { addCluster } = await lazyBackendApi();
        await addCluster(baseUrl, path, contextName);
      }
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('mark_first_launch_complete');
      navigate('/connect', { replace: true });
    } catch (error) {
      console.error('Failed to register contexts:', error);
    }
  };

  const handleCancel = async () => {
    setShowDialog(false);
    // User cancelled - mark as complete anyway to not show again
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('mark_first_launch_complete');
      } catch (error) {
        console.error('Failed to mark first launch complete:', error);
      }
    }
  };

  return (
    <>
      {children}
      <KubeconfigContextDialog
        open={showDialog}
        contexts={contexts}
        onSelect={handleSelect}
        onCancel={handleCancel}
      />
    </>
  );
}

/** Gate: unified onboarding flow for first-time users.
 *  Desktop (Tauri): shows the 4-step FirstRunWizard on first launch.
 *  Browser / in-cluster: shows the FirstRunWizard if not completed, falls back to WelcomeScreen.
 *  All modes: if onboarding is complete, user proceeds directly. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const hasCompletedWelcome = useOnboardingStore((s) => s.hasCompletedWelcome);
  const hasCompletedFirstRun = useOnboardingStore((s) => s.hasCompletedFirstRun);

  // Show the FirstRunWizard if user hasn't completed it yet
  if (!hasCompletedFirstRun) return <FirstRunWizard />;

  // Legacy fallback: if somehow welcome wasn't marked but first-run was
  if (!hasCompletedWelcome) return <WelcomeScreen />;

  return <>{children}</>;
}

function AppZoom({ children }: { children: ReactNode }) {
  useAppZoom();
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AppZoom>
      <Sonner />
      <GlobalErrorBoundary>
        {/* Startup overlay: shown while the Go sidecar is starting up.
            Disappears automatically once the backend emits 'backend-status: ready'.
            Prevents the user from seeing a broken/empty UI on cold start. */}
        <BackendStartupOverlay />
        {/* Validates and clears stale cluster IDs when backend becomes ready */}
        <BackendClusterValidator />
        {/* Single persistent WebSocket per active cluster — pushes overview
            updates into React Query cache in real-time (Headlamp/Lens model) */}
        <ClusterOverviewStream />
        {/* Global WebSocket for resource events — invalidates list queries */}
        <ResourceLiveUpdates />
        <ThemeProvider />
        <SyncBackendUrl />
        <OnboardingGate>
        <AnalyticsConsentWrapper>
          <AppRouter>
            <TauriMenuHandler />
            <AuthLogoutListener>
              {/* KubeconfigContextWrapper must be inside AppRouter because it calls
                  useNavigate() — hooks that use Router context cannot be rendered
                  outside the Router provider or they throw with no message. */}
              <KubeconfigContextWrapper>
                {/* Browser/in-cluster: shows banner if backend is unreachable */}
                <BrowserStartupBanner />
                {/* P2-3: Banner at App level so it's visible on /connect and all routes */}
                <BackendStatusBanner className="rounded-none border-x-0 border-t-0" />
                {/* P1: Circuit breaker countdown — shows immediately when circuit opens */}
                <CircuitBreakerBanner compact className="rounded-none border-x-0 border-t-0" />
                <RouteErrorBoundaryWithReset>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      {/* Entry and setup (no login — Headlamp/Lens model) */}
                      <Route element={<ModeSelectionEntryPoint />} path="/" />
                      <Route element={<ModeSelection />} path="/mode-selection" />
                      <Route element={<ClusterConnect />} path="/connect" />
                      <Route element={<ConnectedRedirect />} path="/connected" />
                      <Route element={<Navigate to="/connect?addCluster=true" replace />} path="/setup/kubeconfig" />
                      <Route element={<ClusterSelection />} path="/setup/clusters" />

                      {/* App routes — require cluster connection only */}
                      <Route
                        element={
                          <ProtectedRoute>
                            <AppLayout />
                          </ProtectedRoute>
                        }
                      >
                        {/* /home redirects to /dashboard — HomePage eliminated */}
                        <Route path="/home" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                        <Route path="/projects/:projectId/dashboard" element={<ProjectDashboardPage />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/fleet" element={<FleetDashboard />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        {/* Cluster Topology */}
                        <Route path="/topology" element={<Topology />} />
                        {/* Resource Templates */}
                        <Route path="/templates" element={<ResourceTemplates />} />

                        {/* Intelligence Layer */}
                        <Route path="/health" element={<HealthDashboard />} />
                        <Route path="/risk-ranking" element={<RiskRanking />} />
                        <Route path="/spof-inventory" element={<SPOFInventory />} />
                        <Route path="/report-schedules" element={<ReportSchedules />} />
                        {/* Security Scanner — disabled until backend APIs are implemented */}

                        {/* Workloads */}
                        <Route path="/workloads" element={<WorkloadsOverview />} />
                        <Route path="/pods" element={<Pods />} />
                        <Route path="/pods/:namespace/:name" element={<PodDetail />} />
                        <Route path="/deployments" element={<Deployments />} />
                        <Route path="/deployments/:namespace/:name" element={<DeploymentDetail />} />
                        <Route path="/replicasets" element={<ReplicaSets />} />
                        <Route path="/replicasets/:namespace/:name" element={<ReplicaSetDetail />} />
                        <Route path="/statefulsets" element={<StatefulSets />} />
                        <Route path="/statefulsets/:namespace/:name" element={<StatefulSetDetail />} />
                        <Route path="/daemonsets" element={<DaemonSets />} />
                        <Route path="/daemonsets/:namespace/:name" element={<DaemonSetDetail />} />
                        <Route path="/jobs" element={<Jobs />} />
                        <Route path="/jobs/:namespace/:name" element={<JobDetail />} />
                        <Route path="/cronjobs" element={<CronJobs />} />
                        <Route path="/cronjobs/:namespace/:name" element={<CronJobDetail />} />
                        <Route path="/replicationcontrollers" element={<ReplicationControllers />} />
                        <Route path="/replicationcontrollers/:namespace/:name" element={<ReplicationControllerDetail />} />
                        <Route path="/podtemplates" element={<PodTemplates />} />
                        <Route path="/podtemplates/:namespace/:name" element={<PodTemplateDetail />} />
                        <Route path="/controllerrevisions" element={<ControllerRevisions />} />
                        <Route path="/controllerrevisions/:namespace/:name" element={<ControllerRevisionDetail />} />
                        <Route path="/resourceslices" element={<ResourceSlices />} />
                        <Route path="/resourceslices/:name" element={<ResourceSliceDetail />} />
                        <Route path="/deviceclasses" element={<DeviceClasses />} />
                        <Route path="/deviceclasses/:name" element={<DeviceClassDetail />} />
                        <Route path="/ipaddresspools" element={<IPAddressPools />} />
                        <Route path="/ipaddresspools/:namespace/:name" element={<IPAddressPoolDetail />} />
                        <Route path="/bgppeers" element={<BGPPeers />} />
                        <Route path="/bgppeers/:namespace/:name" element={<BGPPeerDetail />} />

                        {/* Networking */}
                        <Route path="/networking" element={<NetworkingOverview />} />
                        <Route path="/services" element={<Services />} />
                        <Route path="/services/:namespace/:name" element={<ServiceDetail />} />
                        <Route path="/endpoints" element={<Endpoints />} />
                        <Route path="/endpoints/:namespace/:name" element={<EndpointDetail />} />
                        <Route path="/endpointslices" element={<EndpointSlices />} />
                        <Route path="/endpointslices/:namespace/:name" element={<EndpointSliceDetail />} />
                        <Route path="/ingresses" element={<Ingresses />} />
                        <Route path="/ingresses/:namespace/:name" element={<IngressDetail />} />
                        <Route path="/ingressclasses" element={<IngressClasses />} />
                        <Route path="/ingressclasses/:name" element={<IngressClassDetail />} />
                        <Route path="/networkpolicies" element={<NetworkPolicies />} />
                        <Route path="/networkpolicies/:namespace/:name" element={<NetworkPolicyDetail />} />

                        {/* Storage & Config */}
                        <Route path="/storage" element={<StorageOverview />} />
                        <Route path="/configmaps" element={<ConfigMaps />} />
                        <Route path="/configmaps/:namespace/:name" element={<ConfigMapDetail />} />
                        <Route path="/secrets" element={<Secrets />} />
                        <Route path="/secrets/:namespace/:name" element={<SecretDetail />} />
                        <Route path="/persistentvolumes" element={<PersistentVolumes />} />
                        <Route path="/persistentvolumes/:name" element={<PersistentVolumeDetail />} />
                        <Route path="/persistentvolumeclaims" element={<PersistentVolumeClaims />} />
                        <Route path="/persistentvolumeclaims/:namespace/:name" element={<PersistentVolumeClaimDetail />} />
                        <Route path="/storageclasses" element={<StorageClasses />} />
                        <Route path="/storageclasses/:name" element={<StorageClassDetail />} />
                        <Route path="/volumeattachments" element={<VolumeAttachments />} />
                        <Route path="/volumeattachments/:name" element={<VolumeAttachmentDetail />} />
                        <Route path="/volumesnapshots" element={<VolumeSnapshots />} />
                        <Route path="/volumesnapshots/:namespace/:name" element={<VolumeSnapshotDetail />} />
                        <Route path="/volumesnapshotclasses" element={<VolumeSnapshotClasses />} />
                        <Route path="/volumesnapshotclasses/:name" element={<VolumeSnapshotClassDetail />} />
                        <Route path="/volumesnapshotcontents" element={<VolumeSnapshotContents />} />
                        <Route path="/volumesnapshotcontents/:name" element={<VolumeSnapshotContentDetail />} />

                        {/* Cluster */}
                        <Route path="/cluster" element={<ClusterOverview />} />
                        <Route path="/cluster-overview" element={<ClusterOverview />} />
                        <Route path="/nodes" element={<Nodes />} />
                        <Route path="/nodes/:name" element={<NodeDetail />} />
                        <Route path="/namespaces" element={<Namespaces />} />
                        <Route path="/namespaces/:name" element={<NamespaceDetail />} />
                        <Route path="/events" element={<Events />} />
                        <Route path="/events/:namespace/:name" element={<EventDetail />} />
                        <Route path="/componentstatuses" element={<ComponentStatuses />} />
                        <Route path="/componentstatuses/:name" element={<ComponentStatusDetail />} />
                        <Route path="/apiservices" element={<APIServices />} />
                        <Route path="/apiservices/:name" element={<APIServiceDetail />} />
                        <Route path="/leases" element={<Leases />} />
                        <Route path="/leases/:namespace/:name" element={<LeaseDetail />} />
                        <Route path="/runtimeclasses" element={<RuntimeClasses />} />
                        <Route path="/runtimeclasses/:name" element={<RuntimeClassDetail />} />

                        {/* RBAC / Security */}
                        <Route path="/serviceaccounts" element={<ServiceAccounts />} />
                        <Route path="/serviceaccounts/:namespace/:name" element={<ServiceAccountDetail />} />
                        <Route path="/roles" element={<Roles />} />
                        <Route path="/roles/:namespace/:name" element={<RoleDetail />} />
                        <Route path="/rolebindings" element={<RoleBindings />} />
                        <Route path="/rolebindings/:namespace/:name" element={<RoleBindingDetail />} />
                        <Route path="/clusterroles" element={<ClusterRoles />} />
                        <Route path="/clusterroles/:name" element={<ClusterRoleDetail />} />
                        <Route path="/clusterrolebindings" element={<ClusterRoleBindings />} />
                        <Route path="/clusterrolebindings/:name" element={<ClusterRoleBindingDetail />} />
                        <Route path="/podsecuritypolicies" element={<PodSecurityPolicies />} />
                        <Route path="/podsecuritypolicies/:name" element={<PodSecurityPolicyDetail />} />
                        <Route path="/rbac-analyzer" element={<RBACAnalyzer />} />

                        {/* Autoscaling & Resource Management */}
                        <Route path="/resources" element={<ResourcesOverview />} />
                        <Route path="/scaling" element={<ScalingOverview />} />
                        <Route path="/horizontalpodautoscalers" element={<HorizontalPodAutoscalers />} />
                        <Route path="/horizontalpodautoscalers/:namespace/:name" element={<HorizontalPodAutoscalerDetail />} />
                        <Route path="/verticalpodautoscalers" element={<VerticalPodAutoscalers />} />
                        <Route path="/verticalpodautoscalers/:namespace/:name" element={<VerticalPodAutoscalerDetail />} />
                        <Route path="/poddisruptionbudgets" element={<PodDisruptionBudgets />} />
                        <Route path="/poddisruptionbudgets/:namespace/:name" element={<PodDisruptionBudgetDetail />} />
                        <Route path="/resourcequotas" element={<ResourceQuotas />} />
                        <Route path="/resourcequotas/:namespace/:name" element={<ResourceQuotaDetail />} />
                        <Route path="/limitranges" element={<LimitRanges />} />
                        <Route path="/limitranges/:namespace/:name" element={<LimitRangeDetail />} />
                        <Route path="/priorityclasses" element={<PriorityClasses />} />
                        <Route path="/priorityclasses/:name" element={<PriorityClassDetail />} />

                        {/* Custom Resources & Admission Control */}
                        <Route path="/crds" element={<CRDsOverview />} />
                        <Route path="/admission" element={<AdmissionOverview />} />
                        <Route path="/customresourcedefinitions" element={<CustomResourceDefinitions />} />
                        <Route path="/customresourcedefinitions/:name" element={<CustomResourceDefinitionDetail />} />
                        <Route path="/customresources" element={<CustomResources />} />
                        <Route path="/mutatingwebhooks" element={<MutatingWebhooks />} />
                        <Route path="/mutatingwebhooks/:name" element={<MutatingWebhookDetail />} />
                        <Route path="/validatingwebhooks" element={<ValidatingWebhooks />} />
                        <Route path="/validatingwebhooks/:name" element={<ValidatingWebhookDetail />} />

                        {/* Add-ons — removed from UI, will be re-introduced with reliability plan */}

                        {/* 404 */}
                        <Route path="*" element={<NotFound />} />
                      </Route>
                    </Routes>
                  </Suspense>
                </RouteErrorBoundaryWithReset>
              </KubeconfigContextWrapper>
            </AuthLogoutListener>
          </AppRouter>
        </AnalyticsConsentWrapper>
        </OnboardingGate>
      </GlobalErrorBoundary>
      </AppZoom>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
