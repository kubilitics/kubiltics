import { Suspense, lazy, useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useClusterStore } from "@/stores/clusterStore";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { getClusters } from "@/services/backendApiClient";
import { backendClusterToCluster } from "@/lib/backendClusterAdapter";
import { AIAssistant } from "@/components/ai";
import { Loader2 } from "lucide-react";

// Loading Fallback Component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh] w-full" data-testid="page-loader">
    <Loader2 className="h-8 w-8 animate-spin text-blue-500 opacity-50" />
  </div>
);

// Pages - Entry & Setup
const SettingsPage = lazy(() => import("./pages/Settings"));
const ModeSelection = lazy(() => import("./pages/ModeSelection"));
const ClusterConnect = lazy(() => import("./pages/ClusterConnect"));
const ConnectedRedirect = lazy(() => import("./pages/ConnectedRedirect"));
const KubeConfigSetup = lazy(() => import("./pages/KubeConfigSetup"));
const ClusterSelection = lazy(() => import("./pages/ClusterSelection"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
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
const AddOns = lazy(() => import("./pages/AddOns"));
const AddOnDetail = lazy(() => import("./pages/AddOnDetail"));

// Custom Resources & Admission Control
const CustomResourceDefinitions = lazy(() => import("./pages/CustomResourceDefinitions"));
const CustomResourceDefinitionDetail = lazy(() => import("./pages/CustomResourceDefinitionDetail"));
const CustomResources = lazy(() => import("./pages/CustomResources"));
const MutatingWebhooks = lazy(() => import("./pages/MutatingWebhooks"));
const MutatingWebhookDetail = lazy(() => import("./pages/MutatingWebhookDetail"));
const ValidatingWebhooks = lazy(() => import("./pages/ValidatingWebhooks"));
const ValidatingWebhookDetail = lazy(() => import("./pages/ValidatingWebhookDetail"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Topology = lazy(() => import("./pages/Topology"));

// Analytics Dashboards
const AnalyticsOverview = lazy(() => import("./pages/AnalyticsOverview").then(m => ({ default: m.AnalyticsOverview })));
const MLAnalyticsDashboard = lazy(() => import("./pages/MLAnalyticsDashboard").then(m => ({ default: m.MLAnalyticsDashboard })));

import { useResourceLiveUpdates } from "./hooks/useResourceLiveUpdates";

// Layout
import { AppLayout } from "./components/layout/AppLayout";

// Global React Query defaults: optimistic UI, background refresh, no aggressive polling
// Headlamp/Lens style: show cached data immediately, refresh silently in background
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry with exponential backoff: 1s, 2s, 4s
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      // Allow stale data for 60 seconds - show cached data immediately
      staleTime: 60_000,
      // Keep data in cache for 5 minutes
      gcTime: 5 * 60_000,
      // Don't refetch on window focus (prevents refetch storms)
      refetchOnWindowFocus: false,
      // Refetch when connection restored (user reconnects)
      refetchOnReconnect: true,
      // Don't refetch on mount if data is fresh (within staleTime)
      refetchOnMount: false,
    },
  },
});

// Restore activeCluster from backend when currentClusterId is persisted (e.g. after refresh).
// So the user stays on the current URL instead of being sent to "/".
function useRestoreClusterFromBackend() {
  const { activeCluster, setActiveCluster, setClusters, setDemo } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    if (activeCluster != null || restoreAttempted || !currentClusterId || !isBackendConfigured()) {
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
    getClusters(baseUrl)
      .then((list) => {
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
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const [isHydrated, setIsHydrated] = useState(false);
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

  if (!isHydrated) return <PageLoader />;

  // If we have a persisted cluster ID but no activeCluster yet, wait for restore (or show loader until it fails).
  const canRestore = currentClusterId && isBackendConfigured();
  if (!activeCluster && canRestore && !restoreFailed) {
    return <PageLoader />;
  }

  if (!activeCluster) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={returnUrl ? `/connect?returnUrl=${returnUrl}` : '/connect'} replace />;
  }

  return <>{children}</>;
}

// Initial navigation logic. Desktop (Tauri): landing = Connect (cluster list + add cluster). Browser/Helm: Mode Selection -> Connect -> Dashboard. See ClusterConnect.tsx for landing definition.
function ModeSelectionEntryPoint() {
  const { appMode, activeCluster, setAppMode } = useClusterStore();

  // Desktop (Headlamp/Lens style): ALWAYS go to Connect on startup.
  // P0-A: Do NOT redirect to /home based on a persisted activeCluster — the cluster
  // must be re-validated against the live backend on every launch. A stale activeCluster
  // (e.g. from demo mode) would cause all resource hooks to fire against a non-existent
  // cluster ID (e.g. 'prod-us-east'), triggering CORS/404 errors and opening the circuit.
  //
  // FIX TASK-002: setAppMode must be called from useEffect, not during render.
  // Calling a Zustand setter during render is a state mutation during render — React
  // Strict Mode calls renders twice and this causes a state update loop that crashes React.
  useEffect(() => {
    if (isTauri() && !appMode) setAppMode('desktop');
  }, [appMode, setAppMode]);

  if (isTauri()) {
    return <Navigate to="/connect" replace />;
  }

  // Browser/Helm: Let ClusterConnect page handle all cluster validation and navigation
  // Don't navigate early based on activeCluster - it may be stale and needs backend validation
  // Browser/Helm: if mode selected but not connected, go to connect page
  if (appMode) return <Navigate to="/connect" replace />;

  // Default: Choose mode (browser only)
  return <ModeSelection />;
}

import { GlobalErrorBoundary, RouteErrorBoundary } from "@/components/GlobalErrorBoundary";
import { ErrorTracker } from "@/lib/errorTracker";
import { AnalyticsConsentDialog } from "@/components/AnalyticsConsentDialog";
import { KubeconfigContextDialog } from "@/components/KubeconfigContextDialog";
import { BackendStartupOverlay } from "@/components/BackendStartupOverlay";
import { BackendStatusBanner } from "@/components/layout/BackendStatusBanner";
import { BackendClusterValidator } from "@/components/BackendClusterValidator";
import { useOverviewStream } from "@/hooks/useOverviewStream";
import { isTauri } from "@/lib/tauri";
import { useAiAvailableStore } from "@/stores/aiAvailableStore";
import { invokeWithRetry } from "@/lib/tauri";

// Initialize Error Tracking
ErrorTracker.init();

// Tauri uses tauri://localhost/index.html as its origin, so window.location.pathname
// is "/index.html" — BrowserRouter's HTML5 history routing sees a non-root path and
// renders nothing. MemoryRouter starts at "/" regardless of the actual URL and is the
// correct router for embedded webviews / Electron-style apps.
const AppRouter = isTauri() ? MemoryRouter : BrowserRouter;

const AI_STATUS_POLL_MS = 30_000;

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
 * Two-layer defense to ensure backendBaseUrl is always http://localhost:819 in Tauri:
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
    const expectedUrl = `http://localhost:${import.meta.env.VITE_BACKEND_PORT || 819}`;
    // Always ensure the stored URL is correct for Tauri — heal persisted '' values
    if (!backendBaseUrl || backendBaseUrl === '') {
      setBackendBaseUrl(expectedUrl);
    }
    // Run once on mount — backendBaseUrl intentionally excluded to avoid re-running on every change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBackendBaseUrl]);
  return null;
}

/** P2-8: In Tauri, sync get_ai_status().available into store so aiService and useAIStatus skip requests when AI is not available. */
function SyncAIAvailable() {
  const setAIAvailable = useAiAvailableStore((s) => s.setAIAvailable);
  useEffect(() => {
    if (!isTauri()) return;
    let earlyRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      try {
        const status = await invokeWithRetry<{ available: boolean }>('get_ai_status');
        setAIAvailable(status.available);
        // If AI is not yet available on first check, retry quickly (3s, 6s, 10s)
        // — the sidecar adoption happens async and may take a few seconds.
        if (!status.available && earlyRetryTimer === null) {
          let delay = 3000;
          const retry = () => {
            earlyRetryTimer = setTimeout(async () => {
              try {
                const s = await invokeWithRetry<{ available: boolean }>('get_ai_status');
                setAIAvailable(s.available);
                if (!s.available && delay < 15000) {
                  delay = Math.min(delay * 2, 15000);
                  retry();
                }
              } catch { /* ignore */ }
            }, delay);
          };
          retry();
        }
      } catch {
        setAIAvailable(false);
      }
    };
    run();
    const t = setInterval(run, AI_STATUS_POLL_MS);
    return () => {
      clearInterval(t);
      if (earlyRetryTimer) clearTimeout(earlyRetryTimer);
    };
  }, [setAIAvailable]);
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
  const [checked, setChecked] = useState(false);

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
      const { addCluster } = await import('@/services/backendApiClient');
      const path = kubeconfigPath || '';
      for (const contextName of selectedContexts) {
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
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
        <SyncBackendUrl />
        <SyncAIAvailable />
        <AnalyticsConsentWrapper>
          <AppRouter>
            <AuthLogoutListener>
              {/* KubeconfigContextWrapper must be inside AppRouter because it calls
                  useNavigate() — hooks that use Router context cannot be rendered
                  outside the Router provider or they throw with no message. */}
              <KubeconfigContextWrapper>
                {/* P2-3: Banner at App level so it's visible on /connect and all routes */}
                <BackendStatusBanner className="rounded-none border-x-0 border-t-0" />
                <AIAssistant />
                <RouteErrorBoundaryWithReset>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      {/* Entry and setup (no login — Headlamp/Lens model) */}
                      <Route element={<ModeSelectionEntryPoint />} path="/" />
                      <Route element={<ModeSelection />} path="/mode-selection" />
                      <Route element={<ClusterConnect />} path="/connect" />
                      <Route element={<ConnectedRedirect />} path="/connected" />
                      <Route element={<KubeConfigSetup />} path="/setup/kubeconfig" />
                      <Route element={<ClusterSelection />} path="/setup/clusters" />

                      {/* App routes — require cluster connection only */}
                      <Route
                        element={
                          <ProtectedRoute>
                            <AppLayout />
                          </ProtectedRoute>
                        }
                      >
                        <Route path="/home" element={<HomePage />} />
                        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                        <Route path="/projects/:projectId/dashboard" element={<ProjectDashboardPage />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/audit-log" element={<AuditLog />} />

                        {/* Analytics Dashboards */}
                        <Route path="/analytics" element={<AnalyticsOverview />} />
                        <Route path="/ml-analytics" element={<MLAnalyticsDashboard />} />

                        {/* Cluster Topology */}
                        <Route path="/topology" element={<Topology />} />

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
                        <Route path="/replication-controllers/:namespace/:name" element={<ReplicationControllerDetail />} />
                        <Route path="/podtemplates" element={<PodTemplates />} />
                        <Route path="/podtemplates/:namespace/:name" element={<PodTemplateDetail />} />
                        <Route path="/controllerrevisions" element={<ControllerRevisions />} />
                        <Route path="/controllerrevisions/:namespace/:name" element={<ControllerRevisionDetail />} />
                        <Route path="/resourceslices" element={<ResourceSlices />} />
                        <Route path="/resourceslices/:name" element={<ResourceSliceDetail />} />
                        <Route path="/deviceclasses" element={<DeviceClasses />} />
                        <Route path="/deviceclasses/:name" element={<DeviceClassDetail />} />
                        <Route path="/device-classes" element={<DeviceClasses />} />
                        <Route path="/device-classes/:name" element={<DeviceClassDetail />} />
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
                        <Route path="/volume-snapshots" element={<VolumeSnapshots />} />
                        <Route path="/volume-snapshots/:namespace/:name" element={<VolumeSnapshotDetail />} />
                        <Route path="/volumesnapshotclasses" element={<VolumeSnapshotClasses />} />
                        <Route path="/volumesnapshotclasses/:name" element={<VolumeSnapshotClassDetail />} />
                        <Route path="/volume-snapshot-classes" element={<VolumeSnapshotClasses />} />
                        <Route path="/volume-snapshot-classes/:name" element={<VolumeSnapshotClassDetail />} />
                        <Route path="/volumesnapshotcontents" element={<VolumeSnapshotContents />} />
                        <Route path="/volumesnapshotcontents/:name" element={<VolumeSnapshotContentDetail />} />
                        <Route path="/volume-snapshot-contents" element={<VolumeSnapshotContents />} />
                        <Route path="/volume-snapshot-contents/:name" element={<VolumeSnapshotContentDetail />} />

                        {/* Cluster */}
                        <Route path="/cluster-overview" element={<ClusterOverview />} />
                        <Route path="/nodes" element={<Nodes />} />
                        <Route path="/nodes/:name" element={<NodeDetail />} />
                        <Route path="/namespaces" element={<Namespaces />} />
                        <Route path="/namespaces/:name" element={<NamespaceDetail />} />
                        <Route path="/events" element={<Events />} />
                        <Route path="/events/:namespace/:name" element={<EventDetail />} />
                        <Route path="/componentstatuses" element={<ComponentStatuses />} />
                        <Route path="/componentstatuses/:name" element={<ComponentStatusDetail />} />
                        <Route path="/component-statuses/:name" element={<ComponentStatusDetail />} />
                        <Route path="/apiservices" element={<APIServices />} />
                        <Route path="/apiservices/:name" element={<APIServiceDetail />} />
                        <Route path="/leases" element={<Leases />} />
                        <Route path="/leases/:namespace/:name" element={<LeaseDetail />} />
                        <Route path="/runtimeclasses" element={<RuntimeClasses />} />
                        <Route path="/runtimeclasses/:name" element={<RuntimeClassDetail />} />
                        <Route path="/runtime-classes/:name" element={<RuntimeClassDetail />} />

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
                        <Route path="/pod-security-policies/:name" element={<PodSecurityPolicyDetail />} />

                        {/* Autoscaling & Resource Management */}
                        <Route path="/resources" element={<ResourcesOverview />} />
                        <Route path="/scaling" element={<ScalingOverview />} />
                        <Route path="/horizontalpodautoscalers" element={<HorizontalPodAutoscalers />} />
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
                        <Route path="/admission" element={<AdmissionOverview />} />
                        <Route path="/customresourcedefinitions" element={<CustomResourceDefinitions />} />
                        <Route path="/customresourcedefinitions/:name" element={<CustomResourceDefinitionDetail />} />
                        <Route path="/custom-resource-definitions/:name" element={<CustomResourceDefinitionDetail />} />
                        <Route path="/customresources" element={<CustomResources />} />
                        <Route path="/mutatingwebhooks" element={<MutatingWebhooks />} />
                        <Route path="/mutatingwebhooks/:name" element={<MutatingWebhookDetail />} />
                        <Route path="/validatingwebhooks" element={<ValidatingWebhooks />} />
                        <Route path="/validatingwebhooks/:name" element={<ValidatingWebhookDetail />} />

                        {/* Add-ons */}
                        <Route path="/addons" element={<AddOns />} />
                        <Route path="/addons/:addonId" element={<AddOnDetail />} />

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
      </GlobalErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
