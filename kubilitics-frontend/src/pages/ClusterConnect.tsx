/**
 * Cluster Connect Page
 * Entry point for the Kubilitics application (Desktop & Helm modes).
 * Uses backend cluster list when configured; no mock data.
 *
 * Desktop landing: For Tauri, this is the canonical landing (cluster list + add cluster).
 * Banners (BackendStatusBanner, ConnectionRequiredBanner) live in AppLayout only; do not
 * embed backend/connection error content here so that banner changes don't replace this view.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import yaml from 'js-yaml';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Upload,
  Server,
  Zap,
  ArrowRight,
  Check,
  Loader2,
  AlertCircle,
  RefreshCw,
  Monitor,
  Cloud,
  Terminal,
  Folder,
  CheckCircle2,
  XCircle,
  Circle,
  Settings,
  ClipboardPaste,
  FolderOpen,
  Copy,
  ExternalLink,
  Package,
  Shield,
  Globe,
  BookOpen,
  ChevronRight,
  Database,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useDiscoverClusters } from '@/hooks/useDiscoverClusters';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { addCluster, addClusterWithUpload, resetBackendCircuit, getClusterOverview, type BackendCluster } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { toast } from '@/components/ui/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { WelcomeAddCluster } from '@/components/connect/WelcomeAddCluster';
import { isTauri } from '@/lib/tauri';
import { useAutoConnect } from '@/hooks/useAutoConnect';
import { ContextPicker } from '@/components/cluster/ContextPicker';

interface DetectedCluster {
  id: string;
  name: string;
  context: string;
  server: string;
  status: 'checking' | 'healthy' | 'unhealthy' | 'unknown';
  namespace?: string;
  isCurrent?: boolean;
  /** Optional kubeconfig path on backend (used for registration). */
  kubeconfigPath?: string;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

function mapBackendStatus(s?: string): DetectedCluster['status'] {
  if (s === 'connected') return 'healthy';
  if (s === 'disconnected') return 'unhealthy';
  return 'unknown';
}

function backendToDetected(b: BackendCluster): DetectedCluster {
  const server = b.server_url ?? b.server ?? '';
  return {
    id: b.id,
    name: b.name,
    context: b.context,
    server,
    status: mapBackendStatus(b.status),
    isCurrent: b.is_current,
    kubeconfigPath: b.kubeconfig_path,
  };
}

// Common kubeconfig locations (informational only when backend is used)
const kubeconfigLocations = [
  { path: '~/.kube/config', desc: 'Default location' },
  { path: '~/.config/k3s/k3s.yaml', desc: 'K3s config' },
  { path: '$KUBECONFIG', desc: 'Environment variable' },
  { path: '~/.kube/config.d/*', desc: 'Config directory' },
];

function extractContextFromKubeconfig(text: string): string {
  try {
    const currentMatch = text.match(/current-context:\s*(\S+)/);
    if (currentMatch) return currentMatch[1].trim();
    const nameMatch = text.match(/contexts:\s*[\s\S]*?name:\s*(\S+)/);
    return nameMatch ? nameMatch[1].trim() : 'default';
  } catch {
    return 'default';
  }
}

/** Safe target after connect: use returnUrl only if it's a relative app path (no open redirect). */
function getPostConnectPath(returnUrl: string | null): string {
  if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) return '/dashboard';
  if (returnUrl === '/' || returnUrl === '/connect' || returnUrl.startsWith('/connect?') || returnUrl === '/mode-selection') return '/dashboard';
  return returnUrl;
}

export default function ClusterConnect() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get('returnUrl');
  const isAddClusterMode = searchParams.get('addCluster') === 'true';
  const postConnectPath = getPostConnectPath(returnUrl);
  const { activeCluster, setActiveCluster, setClusters, setDemo, appMode, setAppMode, signOut } = useClusterStore();
  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const logoutFlag = useBackendConfigStore((s) => s.logoutFlag);
  const setLogoutFlag = useBackendConfigStore((s) => s.setLogoutFlag);
  const queryClient = useQueryClient();
  // Performance optimization: Run all queries in parallel instead of sequentially
  // Removed gateOnHealth to allow parallel execution - circuit breaker handles backend down scenarios
  const health = useBackendHealth({ enabled: true });
  const clustersFromBackend = useClustersFromBackend();
  const discoveredClustersRes = useDiscoverClusters();

  const [tabMode, setTabMode] = useState<'auto' | 'upload'>('auto');
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isAddingDiscovered, setIsAddingDiscovered] = useState<string | null>(null);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isPasting, setIsPasting] = useState(false);
  const [autoConnectTimeout, setAutoConnectTimeout] = useState(false);
  const autoConnectDoneRef = useRef(false);
  const sessionRestoreDoneRef = useRef(false);
  // Multi-context selection: when an uploaded kubeconfig has multiple contexts
  const [multiContextDialogOpen, setMultiContextDialogOpen] = useState(false);
  const [multiContextOptions, setMultiContextOptions] = useState<string[]>([]);
  const [multiContextCurrentContext, setMultiContextCurrentContext] = useState<string>('');
  const [multiContextBase64, setMultiContextBase64] = useState<string>('');
  const [multiContextSelectedContext, setMultiContextSelectedContext] = useState<string>('');

  const showClusterErrorToast = useCallback((err: unknown, fallbackTitle: string) => {
    const description =
      err instanceof Error
        ? err.message
        : err != null
          ? String(err)
          : '';

    if (description && description !== fallbackTitle) {
      toast.error(fallbackTitle, { id: 'cluster-connect-error', description });
    } else {
      toast.error(fallbackTitle, { id: 'cluster-connect-error' });
    }
  }, []);

  // handleDrop moved after handleUploadedFile to avoid TDZ

  // If no mode selected yet, redirect to selection (browser/Helm only). Desktop always lands here with appMode set to 'desktop'.
  useEffect(() => {
    if (isTauri()) {
      if (!appMode) setAppMode('desktop');
      return;
    }
    if (!appMode) navigate('/', { replace: true });
  }, [appMode, navigate, setAppMode]);

  // P0-C: In Tauri (desktop), ClusterConnect is the startup screen.
  // NEVER auto-redirect away from it based on a persisted activeCluster — the cluster
  // must be re-confirmed against the live backend on every launch.
  // Browser mode: Let auto-connect and session restore effects handle navigation after validation.

  // Consolidated auto-connect and session restore logic
  // Priority: 1) Single-cluster auto-connect, 2) Session restore (if not logged out)
  // IMPORTANT: Test cluster accessibility before connecting/restoring to prevent 503 errors.
  // Performance optimization: Removed sequential dependencies - queries run in parallel
  // Only wait for clusters data, not health check (circuit breaker handles backend down)
  useEffect(() => {
    // Don't wait for health check - clusters query runs in parallel
    // Show UI immediately - don't block on data loading
    // Only proceed with auto-connect/session restore if data is available
    if (!clustersFromBackend.data) {
      // If query is disabled or failed, don't wait - show UI immediately
      if (!clustersFromBackend.isLoading && !clustersFromBackend.isFetching) {
        // Query is done (either succeeded with empty data or failed) - proceed to show UI
        return;
      }
      // Still loading - wait a bit but don't block UI forever
      return;
    }

    // Don't restore session if user explicitly logged out
    if (logoutFlag) {
      setLogoutFlag(false); // Clear flag after checking
      return;
    }

    // Don't auto-redirect when user explicitly clicked "Add Cluster" — they want to stay on this page
    if (isAddClusterMode) return;

    const registered = clustersFromBackend.data.map(backendToDetected);
    const cid = currentClusterId?.trim();

    // Priority 1: Single-cluster auto-connect (if exactly one registered cluster and it's current)
    /* 
    DEACTIVATED per user request to allow manual confirmed selection on onboarding.
    if (registered.length === 1 && registered[0].isCurrent) {
      if (autoConnectDoneRef.current) return;

      const cluster = registered[0];
      const backendItem = clustersFromBackend.data.find((c) => c.id === cluster.id || c.context === cluster.context);
      if (!backendItem) return;

      autoConnectDoneRef.current = true;
      setIsConnecting(true);

      // Test cluster accessibility before auto-connecting with timeout
      const clusterCheckTimeout = setTimeout(() => {
        console.warn(`[ClusterConnect] Auto-connect timeout: cluster check took too long`);
        setIsConnecting(false);
        autoConnectDoneRef.current = false;
        setAutoConnectTimeout(true);
      }, 5_000); // 5 second timeout for cluster check

      Promise.resolve().then(() => {
        const backendBaseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);
        return Promise.race([
          getClusterOverview(backendBaseUrl, backendItem.id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5_000))
        ]);
      }).then(() => {
        clearTimeout(clusterCheckTimeout);
        // Cluster is accessible - proceed with auto-connect
        setCurrentClusterId(backendItem.id);
        setClusters(clustersFromBackend.data.map(backendClusterToCluster));
        setActiveCluster(backendClusterToCluster(backendItem));
        setDemo(false);
        setIsConnecting(false);
        navigate(postConnectPath, { replace: true });
      }).catch((error) => {
        clearTimeout(clusterCheckTimeout);
        // Cluster exists but is not accessible - don't auto-connect
        console.warn(`[ClusterConnect] Auto-connect skipped: cluster ${backendItem.id} is not accessible (${error instanceof Error ? error.message : 'unknown error'})`);
        setIsConnecting(false);
        autoConnectDoneRef.current = false; // Allow retry if user manually connects
        // Clear connecting state immediately - don't leave user stuck
        setAutoConnectTimeout(true);
      });
      return;
    }
    */

    // Priority 2: Session restore (if currentClusterId is set and single-cluster auto-connect doesn't apply)
    if (cid && !sessionRestoreDoneRef.current) {
      sessionRestoreDoneRef.current = true;
      const backendItem = clustersFromBackend.data.find((c) => c.id === cid);

      if (backendItem) {
        // Test cluster accessibility before restoring
        Promise.resolve().then(() => {
          const backendBaseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);
          return getClusterOverview(backendBaseUrl, cid);
        }).then(() => {
          // Cluster is accessible - restore session
          setClusters(clustersFromBackend.data.map(backendClusterToCluster));
          setActiveCluster(backendClusterToCluster(backendItem));
          setDemo(false);
          navigate(postConnectPath, { replace: true });
        }).catch((error) => {
          // Cluster exists but is not accessible - clear it
          console.warn(`[ClusterConnect] Session restore failed: cluster ${cid} is not accessible (${error instanceof Error ? error.message : 'unknown error'})`);
          setCurrentClusterId(null);
          signOut();
          // Ensure UI is shown even if session restore fails
        });
      } else {
        // Cluster ID doesn't exist in backend list - clear it
        setCurrentClusterId(null);
        signOut();
      }
    }
  }, [
    clustersFromBackend.data,
    clustersFromBackend.isLoading,
    clustersFromBackend.isFetching,
    currentClusterId,
    logoutFlag,
    isAddClusterMode,
    storedBackendUrl,
    setCurrentClusterId,
    setClusters,
    setActiveCluster,
    setDemo,
    setLogoutFlag,
    signOut,
    navigate,
    postConnectPath,
  ]);

  // Clusters from backend API
  const registeredClusters: DetectedCluster[] =
    isBackendConfigured && clustersFromBackend.data
      ? clustersFromBackend.data.map(backendToDetected)
      : [];

  // Discovered (not yet registered) clusters
  const discoveredClusters: DetectedCluster[] =
    isBackendConfigured && discoveredClustersRes.data
      ? discoveredClustersRes.data.map(backendToDetected)
      : [];

  /**
   * Extract context names from kubeconfig YAML text.
   * Uses js-yaml to parse the document properly so only the `contexts[].name`
   * fields are returned — not cluster names or user names, which share the same
   * `- name: ...` YAML structure and would confuse the regex approach.
   */
  const parseKubeconfigContexts = (text: string): { contexts: string[]; currentContext: string } => {
    try {
      const doc = yaml.load(text) as Record<string, unknown> | null;
      if (!doc || typeof doc !== 'object') return { contexts: [], currentContext: '' };

      const currentContext = typeof doc['current-context'] === 'string' ? doc['current-context'] : '';

      const contextsRaw = doc['contexts'];
      const contexts: string[] = [];
      if (Array.isArray(contextsRaw)) {
        for (const entry of contextsRaw) {
          if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['name'] === 'string') {
            const name = ((entry as Record<string, unknown>)['name'] as string).trim();
            if (name && !contexts.includes(name)) contexts.push(name);
          }
        }
      }
      return { contexts, currentContext };
    } catch {
      // Fallback: kubeconfig is not valid YAML — return empty so backend handles it
      return { contexts: [], currentContext: '' };
    }
  };

  /** Encode bytes to standard base64 (with padding). Compatible with Go's base64.StdEncoding. */
  const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  const submitClusterWithContext = useCallback(async (base64: string, contextName: string) => {
    await addClusterWithUpload(backendBaseUrl, base64, contextName);
    await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
    await clustersFromBackend.refetch();
    discoveredClustersRes.refetch();
    setTabMode('auto');
    toast.success('Cluster added successfully', { description: `Context: ${contextName}` });
  }, [backendBaseUrl, queryClient, clustersFromBackend, discoveredClustersRes]);

  const handleUploadedFile = useCallback(async (file: File) => {
    const effectiveConfigured = isBackendConfigured || isTauri();
    if (!effectiveConfigured) {
      toast.error('Set backend URL in Settings first');
      return;
    }
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setUploadProgress(30);
      const base64 = bytesToBase64(bytes);
      setUploadProgress(60);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const { contexts, currentContext } = parseKubeconfigContexts(text);

      if (contexts.length === 0) {
        // No "name:" entries found — pass empty context, backend will use current-context
        setUploadProgress(80);
        await submitClusterWithContext(base64, currentContext || '');
        setUploadProgress(100);
        return;
      }

      if (contexts.length === 1) {
        setUploadProgress(80);
        await submitClusterWithContext(base64, contexts[0]);
        setUploadProgress(100);
        return;
      }

      // Multiple contexts: show selection dialog
      setUploadProgress(100);
      setMultiContextOptions(contexts);
      setMultiContextCurrentContext(currentContext);
      setMultiContextSelectedContext(currentContext || contexts[0]);
      setMultiContextBase64(base64);
      setMultiContextDialogOpen(true);
    } catch (err) {
      showClusterErrorToast(err, 'Failed to add cluster');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [isBackendConfigured, submitClusterWithContext, showClusterErrorToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUploadedFile(file);
  }, [handleUploadedFile]);

  const handleAddDiscovered = async (cluster: DetectedCluster) => {
    // Same semantics as handleUploadedFile: in dev on localhost an empty
    // backendBaseUrl is valid (proxy mode), so we only gate on the configured flag.
    if (!isBackendConfigured) {
      toast.error('Set backend URL in Settings first');
      return;
    }
    // For discovered clusters, the backend already includes the kubeconfig path it
    // scanned (KUBECONFIG or ~/.kube/config). Pass that through so the AddCluster
    // handler satisfies its "kubeconfig_path or kubeconfig_base64" requirement.
    const kubeconfigPath = cluster.kubeconfigPath ?? '';
    if (!kubeconfigPath) {
      toast.error('Backend did not provide kubeconfig path for this context');
      return;
    }
    setIsAddingDiscovered(cluster.name);
    try {
      const newBackendCluster = await addCluster(backendBaseUrl, kubeconfigPath, cluster.context);
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters', 'discover'] });

      // Auto-connect after registration
      const detected = backendToDetected(newBackendCluster);
      handleConnect(detected, true); // True means skip refetch waiting

      toast.success('Cluster registered', { description: `Context: ${cluster.context}` });
    } catch (err) {
      showClusterErrorToast(err, 'Failed to register cluster');
    } finally {
      setIsAddingDiscovered(null);
    }
  };

  const handleConnect = (cluster: DetectedCluster, isNew: boolean = false) => {
    if (!isBackendConfigured) return;

    // If it's a new cluster, we might not have it in the react-query cache yet.
    // We try to find it or use the passed cluster directly.
    const backendItem = clustersFromBackend.data?.find((c) => c.id === cluster.id || c.context === cluster.context);

    if (!backendItem && !isNew) return;

    setIsConnecting(true);
    setSelectedClusterId(cluster.id);

    // Build cluster list for store
    const connectedClusters = clustersFromBackend.data
      ? clustersFromBackend.data.map(backendClusterToCluster)
      : [backendClusterToCluster(cluster as unknown as BackendCluster)]; // Fallback for new

    const targetCluster = backendItem ? backendClusterToCluster(backendItem) : (cluster as unknown as BackendCluster);

    setCurrentClusterId(cluster.id);
    setClusters(connectedClusters);
    setActiveCluster(targetCluster);
    setDemo(false);
    setIsConnecting(false);

    if (!isNew) {
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      clustersFromBackend.refetch();
    }

    toast.success(`Connected to ${cluster.name}`, { description: `Context: ${cluster.context}` });
    navigate(postConnectPath, { replace: true });
  };

  const handleDemoMode = () => {
    setDemo(true);
    navigate('/dashboard', { replace: true });
  };

  const getStatusIcon = (status: DetectedCluster['status'] | 'detected') => {
    switch (status) {
      case 'checking':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-rose-500" />;
      case 'detected':
        return <Monitor className="h-4 w-4 text-blue-400" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const handleRefreshClusters = () => {
    resetBackendCircuit();
    queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
    health.refetch().then(() => {
      clustersFromBackend.refetch();
      discoveredClustersRes.refetch();
    });
  };

  const handlePasteSubmit = useCallback(async () => {
    const trimmed = pasteContent.trim();
    if (!trimmed) {
      toast.error('Paste your kubeconfig content first');
      return;
    }
    const effectiveConfigured = isBackendConfigured || isTauri();
    if (!effectiveConfigured) {
      toast.error('Set backend URL in Settings first');
      return;
    }
    setIsPasting(true);
    try {
      // Encode as UTF-8 bytes then base64 — compatible with Go's base64.StdEncoding.
      const encoder = new TextEncoder();
      const bytes = encoder.encode(trimmed);
      const base64 = bytesToBase64(bytes);
      const { contexts, currentContext } = parseKubeconfigContexts(trimmed);

      if (contexts.length > 1) {
        // Multiple contexts in pasted kubeconfig — show selection dialog
        setMultiContextOptions(contexts);
        setMultiContextCurrentContext(currentContext);
        setMultiContextSelectedContext(currentContext || contexts[0]);
        setMultiContextBase64(base64);
        setPasteDialogOpen(false);
        setPasteContent('');
        setMultiContextDialogOpen(true);
        return;
      }

      const contextName = contexts[0] || currentContext || 'default';
      await submitClusterWithContext(base64, contextName);
      setPasteDialogOpen(false);
      setPasteContent('');
    } catch (err) {
      showClusterErrorToast(err, 'Failed to add cluster');
    } finally {
      setIsPasting(false);
    }
  }, [pasteContent, submitClusterWithContext, showClusterErrorToast, isBackendConfigured]);

  // If already connected (e.g., after wizard or page refresh), go straight to dashboard.
  // The user can always switch clusters from Settings > Clusters.
  if (activeCluster && !isAddClusterMode) {
    return <Navigate to={postConnectPath} replace />;
  }

  // TASK-CORE-001: Auto-Connect Desktop Mode
  // In Tauri desktop mode, auto-detect kubeconfig contexts and either auto-connect
  // (single context) or show the ContextPicker (multiple contexts).
  const autoConnect = useAutoConnect();

  // While auto-connect is in progress (single context → auto-connecting), show a
  // minimal loading state so the user sees immediate feedback.
  if (autoConnect.isDesktopMode && autoConnect.isAutoConnecting && !autoConnect.isResolved) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50/30 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 gap-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Loader2 className="h-6 w-6 text-white animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Detecting clusters...</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Scanning kubeconfig</p>
          </div>
        </motion.div>
      </div>
    );
  }

  // Multiple contexts detected in desktop mode: show the ContextPicker
  if (autoConnect.isDesktopMode && autoConnect.isResolved && autoConnect.contexts.length > 1) {
    return (
      <ContextPicker
        contexts={autoConnect.contexts}
        selectedContext={autoConnect.selectedContext}
        onSelect={autoConnect.setSelectedContext}
        onConnect={() => autoConnect.connect()}
        onCancel={() => navigate('/')}
        isConnecting={autoConnect.isAutoConnecting}
        error={autoConnect.error}
      />
    );
  }

  // Specialized view for In-Cluster / Helm mode
  if (appMode === 'in-cluster') {
    return <InClusterSetupView
      isBackendConfigured={isBackendConfigured}
      health={health}
      handleConnect={handleConnect}
      navigate={navigate}
    />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
        <motion.div
          initial="hidden"
          animate="show"
          variants={container}
          className="w-full max-w-2xl py-12"
        >
          <motion.div variants={item} className="text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-6">
              <BrandLogo height={40} className="drop-shadow-sm" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-3">
              Connect Your Cluster
            </h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              Choose how you'd like to connect to your Kubernetes environment.
            </p>
          </motion.div>

          <motion.div variants={item}>
            <Tabs value={tabMode} onValueChange={(v) => setTabMode(v as typeof tabMode)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-8 bg-muted border-border p-1">
                <TabsTrigger value="auto" className="gap-2 text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  <Zap className="h-4 w-4" />
                  Auto-Detect
                </TabsTrigger>
                <TabsTrigger value="upload" className="gap-2 text-muted-foreground data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                  <Upload className="h-4 w-4" />
                  Upload Config
                </TabsTrigger>
              </TabsList>

              <TabsContent value="auto" className="mt-0">
                <Card className="p-6 bg-card border-border backdrop-blur-xl">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-semibold text-lg text-foreground">Local Environments</h3>
                      <p className="text-sm text-muted-foreground">
                        {isBackendConfigured
                          ? (health.isLoading || !health.isSuccess || clustersFromBackend.isLoading || discoveredClustersRes.isLoading)
                            ? 'Scanning for local clusters…'
                            : 'Registered and detected contexts from ~/.kube/config'
                          : 'Set backend URL in Settings to see clusters'}
                      </p>
                    </div>
                    {isBackendConfigured && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={handleRefreshClusters}
                        disabled={health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching}
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching ? 'animate-spin' : ''}`}
                        />
                      </Button>
                    )}
                  </div>

                  {isBackendConfigured && (health.error || clustersFromBackend.error || discoveredClustersRes.error) && registeredClusters.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mb-6 p-4 rounded-xl border flex items-center gap-3 flex-wrap"
                      style={{ background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.2)' }}
                    >
                      <AlertCircle className="h-5 w-5 shrink-0 text-blue-400" />
                      <span className="text-sm font-medium text-foreground flex-1">
                        Couldn&apos;t load clusters yet. You can add a cluster by pasting or uploading your kubeconfig below.
                      </span>
                      <Button variant="outline" size="sm" className="border-border hover:bg-muted" onClick={handleRefreshClusters} disabled={health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching}>
                        <RefreshCw className={health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching ? 'h-4 w-4 animate-spin mr-1.5' : 'h-4 w-4 mr-1.5'} />
                        Retry
                      </Button>
                    </motion.div>
                  )}

                  {!isBackendConfigured && !isTauri() && (
                    <div className="text-center py-12">
                      <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground mb-6 max-w-xs mx-auto">
                        Configure the Kubilitics backend URL in Settings to see your clusters.
                      </p>
                      <Button variant="outline" className="border-input hover:bg-muted" onClick={() => navigate('/settings')}>
                        Open Settings
                      </Button>
                    </div>
                  )}

                  {(isBackendConfigured || isTauri()) && (clustersFromBackend.isLoading || discoveredClustersRes.isLoading) && (
                    <div className="space-y-3 mb-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-16 bg-muted/40 animate-pulse rounded-xl" />
                      ))}
                    </div>
                  )}

                  {(isBackendConfigured || isTauri()) && !clustersFromBackend.isLoading && !discoveredClustersRes.isLoading && (
                    <div className="space-y-4">
                      {/* Registered Clusters */}
                      {registeredClusters.map((cluster) => (
                        <motion.div
                          key={cluster.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`
                            group p-4 rounded-xl border transition-all cursor-pointer
                            ${selectedClusterId === cluster.id
                              ? 'border-blue-500/50 bg-blue-500/5'
                              : 'border-border hover:border-border/80 bg-card hover:bg-muted/50'}
                            ${cluster.status === 'unhealthy' ? 'opacity-70' : ''}
                          `}
                          onClick={() => setSelectedClusterId(cluster.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-lg ${cluster.status === 'healthy' ? 'bg-emerald-500/10' : 'bg-muted'}`}>
                                {getStatusIcon(cluster.status)}
                              </div>
                              <div className="min-w-0 max-w-[320px]">
                                <p className="font-medium text-foreground truncate">{cluster.name}</p>
                                <p className="text-xs text-muted-foreground font-mono tracking-wider truncate">
                                  {cluster.server || 'LOCAL ENGINE'}
                                </p>
                              </div>
                              {cluster.isCurrent && (
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-none ml-2">Active</Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant={cluster.status === 'unhealthy' ? 'outline' : 'default'}
                              className={cluster.status === 'healthy' ? 'bg-blue-600 hover:bg-blue-500 text-white' : ''}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConnect(cluster);
                              }}
                              disabled={isConnecting}
                            >
                              {isConnecting && selectedClusterId === cluster.id ? (
                                <Loader2 className="h-4 w-4 animate-spin text-white" />
                              ) : (
                                <>
                                  {cluster.status === 'unhealthy' ? 'Try Connect' : 'Connect'}
                                  <ArrowRight className="h-4 w-4 ml-1.5 transition-transform group-hover:translate-x-1" />
                                </>
                              )}
                            </Button>
                          </div>
                        </motion.div>
                      ))}

                      {/* Discovered (New) Clusters */}
                      {discoveredClusters.map((cluster) => (
                        <motion.div
                          key={cluster.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="group p-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.02] border-dashed hover:border-blue-500/40 hover:bg-blue-500/[0.04] transition-all cursor-pointer"
                          onClick={() => handleAddDiscovered(cluster)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="p-2 rounded-lg bg-blue-500/10">
                                {isAddingDiscovered === cluster.name ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                                ) : (
                                  <Monitor className="h-4 w-4 text-blue-400" />
                                )}
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{cluster.name}</p>
                                <p className="text-xs text-blue-500/60">New local context detected</p>
                              </div>
                              {cluster.isCurrent && (
                                <Badge className="bg-blue-500/20 text-blue-400 border-none ml-2">Active</Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddDiscovered(cluster);
                              }}
                              disabled={isAddingDiscovered === cluster.name}
                            >
                              {isAddingDiscovered === cluster.name ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  Register Context
                                  <Zap className="h-4 w-4 ml-1.5" />
                                </>
                              )}
                            </Button>
                          </div>
                        </motion.div>
                      ))}

                      {/* Empty state: prominent cards */}
                      {registeredClusters.length === 0 && discoveredClusters.length === 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-8">
                          <Card
                            className="p-6 bg-card border-border cursor-pointer hover:border-blue-500/50 hover:bg-muted/40 transition-all"
                            onClick={() => setPasteDialogOpen(true)}
                          >
                            <div className="flex flex-col items-center text-center gap-4">
                              <div className="p-3 rounded-xl bg-blue-500/10">
                                <ClipboardPaste className="h-8 w-8 text-blue-400" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">Paste kubeconfig</p>
                                <p className="text-sm text-muted-foreground mt-1">Paste YAML from clipboard</p>
                              </div>
                              <Button variant="outline" size="sm">
                                Paste kubeconfig
                              </Button>
                            </div>
                          </Card>
                          <Card
                            className="p-6 bg-card border-border cursor-pointer hover:border-blue-500/50 hover:bg-muted/40 transition-all"
                            onClick={() => setTabMode('upload')}
                          >
                            <div className="flex flex-col items-center text-center gap-4">
                              <div className="p-3 rounded-xl bg-blue-500/10">
                                <FolderOpen className="h-8 w-8 text-blue-400" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">Upload file</p>
                                <p className="text-sm text-muted-foreground mt-1">Select or drag a kubeconfig file</p>
                              </div>
                              <Button variant="outline" size="sm">
                                Upload Kubeconfig
                              </Button>
                            </div>
                          </Card>
                        </div>
                      )}

                      {/* When clusters exist: always show add-cluster actions */}
                      {(registeredClusters.length > 0 || discoveredClusters.length > 0) && (
                        <div className="mt-4 pt-4 border-t border-border/50">
                          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Add from different kubeconfig</p>
                          <div className="flex items-center gap-3">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => setPasteDialogOpen(true)}
                            >
                              <ClipboardPaste className="h-4 w-4" />
                              Paste kubeconfig
                            </Button>
                            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-input bg-background hover:bg-muted text-sm font-medium transition-colors cursor-pointer h-9">
                              <FolderOpen className="h-4 w-4" />
                              Upload file
                              <input
                                type="file"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleUploadedFile(e.target.files[0])}
                              />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="upload" className="mt-0">
                <Card className="p-1 bg-card border-border backdrop-blur-xl">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="relative rounded-xl border-2 border-dashed border-border p-12 text-center hover:border-blue-500/50 hover:bg-blue-500/[0.02] transition-all"
                  >
                    {isUploading ? (
                      <div className="space-y-4">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
                        <p className="font-medium text-foreground">Processing Kubeconfig…</p>
                        <div className="w-48 h-1.5 bg-muted rounded-full mx-auto overflow-hidden">
                          <motion.div
                            className="h-full bg-blue-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="p-4 rounded-2xl bg-blue-500/10 w-fit mx-auto mb-6">
                          <Upload className="h-8 w-8 text-blue-400" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">Drop your Kubeconfig</h3>
                        <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
                          Upload your cluster credentials to register them with the backend.
                        </p>
                        <div className="flex items-center gap-3 justify-center flex-wrap">
                          <label className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors cursor-pointer">
                            Select File
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => e.target.files?.[0] && handleUploadedFile(e.target.files[0])}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setPasteDialogOpen(true)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-input bg-background hover:bg-muted text-foreground text-sm font-medium transition-colors"
                          >
                            <ClipboardPaste className="h-4 w-4" />
                            Paste kubeconfig
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="mt-8 pt-8 border-t border-border/50 flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                <div className="h-[1px] w-8 bg-border" />
                <span>Alternate Options</span>
                <div className="h-[1px] w-8 bg-border" />
              </div>
              <div className="flex gap-4">
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  onClick={handleDemoMode}
                >
                  Explore Demo Mode
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  onClick={() => navigate('/settings')}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Backend Settings
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Side Panel (Desktop only) */}
      <div className="hidden xl:flex w-[400px] bg-card/60 border-l border-border p-12 flex-col justify-between">
        <div>
          <div className="p-3 rounded-2xl bg-blue-500/10 w-fit mb-8">
            <Monitor className="h-6 w-6 text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold mb-4">Desktop OS Engine</h2>
          <p className="text-muted-foreground leading-relaxed mb-10">
            Kubilitics Desktop runs as your local Kubernetes control center, providing deep visibility and management for all your clusters.
          </p>

          <div className="space-y-6">
            {[
              { icon: Zap, title: 'Instant Discovery', text: 'Auto-detects Docker Desktop, orbstack, and local contexts.' },
              { icon: Server, title: 'Multi-Cluster', text: 'Switch between production and local dev in real-time.' },
              { icon: CheckCircle2, title: 'Private & Secure', text: 'All credentials remain stored in your local engine.' },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
                className="flex gap-4"
              >
                <div className="mt-1">
                  <feature.icon className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{feature.title}</p>
                  <p className="text-sm text-muted-foreground">{feature.text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

      </div>

      <Dialog open={pasteDialogOpen} onOpenChange={setPasteDialogOpen}>
        <DialogContent className="w-[90vw] max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5 text-blue-500" />
              Paste kubeconfig
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              Paste the full contents of your kubeconfig file below. Run{' '}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">kubectl config view --raw</code>{' '}
              to get it, or open <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">~/.kube/config</code> directly.
            </DialogDescription>
          </div>

          {/* Textarea — fills available space */}
          <div className="flex-1 px-6 py-4 min-h-0">
            <Textarea
              placeholder={`apiVersion: v1
kind: Config
clusters:
  - cluster:
      server: https://your-cluster-endpoint
      certificate-authority-data: DATA+OMITTED
    name: my-cluster
contexts:
  - context:
      cluster: my-cluster
      user: my-user
    name: my-cluster
current-context: my-cluster
users:
  - name: my-user
    user:
      token: your-token`}
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              className="h-[42vh] min-h-[280px] w-full font-mono text-xs resize-none leading-relaxed"
              autoFocus
            />
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 pt-2 border-t border-border shrink-0 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Supports EKS, GKE, AKS, k3s, Kind, Rancher, and any CNCF-compliant cluster.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" onClick={() => { setPasteDialogOpen(false); setPasteContent(''); }}>
                Cancel
              </Button>
              <Button onClick={handlePasteSubmit} disabled={isPasting || !pasteContent.trim()} className="min-w-[120px]">
                {isPasting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {isPasting ? 'Adding…' : 'Add Cluster'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Multi-context selection dialog — shown when uploaded kubeconfig has multiple contexts */}
      <Dialog open={multiContextDialogOpen} onOpenChange={setMultiContextDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select Context</DialogTitle>
            <DialogDescription>
              Your kubeconfig contains {multiContextOptions.length} contexts. Choose one to register.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {multiContextOptions.map((ctx) => (
              <button
                key={ctx}
                type="button"
                onClick={() => setMultiContextSelectedContext(ctx)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-all text-sm font-mono ${
                  multiContextSelectedContext === ctx
                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                    : 'border-input bg-muted/40 hover:border-border text-foreground'
                }`}
              >
                <span className="truncate block">{ctx}</span>
                {ctx === multiContextCurrentContext && (
                  <span className="text-xs text-emerald-400 font-sans">current-context</span>
                )}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMultiContextDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={!multiContextSelectedContext || isUploading}
              onClick={async () => {
                setMultiContextDialogOpen(false);
                setIsUploading(true);
                try {
                  await submitClusterWithContext(multiContextBase64, multiContextSelectedContext);
                } catch (err) {
                  showClusterErrorToast(err, 'Failed to add cluster');
                } finally {
                  setIsUploading(false);
                }
              }}
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Add Cluster
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  In-Cluster / Helm Setup View                               */
/* ─────────────────────────────────────────────────────────── */

interface InClusterSetupViewProps {
  isBackendConfigured: boolean;
  health: ReturnType<typeof useBackendHealth>;
  handleConnect: (cluster: DetectedCluster, isNew?: boolean) => void;
  navigate: ReturnType<typeof useNavigate>;
}

function InClusterSetupView({ isBackendConfigured, health, handleConnect, navigate }: InClusterSetupViewProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [backendUrl, setBackendUrl] = useState('');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const { setBackendBaseUrl } = useBackendConfigStore();
  const [copied, setCopied] = useState<string | null>(null);

  const isBackendHealthy = isBackendConfigured && health.isSuccess;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleTestConnection = async () => {
    if (!backendUrl.trim()) return;
    setIsTestingConnection(true);
    setConnectionStatus('idle');
    try {
      const url = backendUrl.replace(/\/$/, '');
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        setBackendBaseUrl(url);
        setConnectionStatus('success');
        toast.success('Backend connected', { description: url });
      } else {
        setConnectionStatus('error');
        toast.error('Backend unreachable', { id: 'backend-health-check', description: `HTTP ${res.status}` });
      }
    } catch (err) {
      setConnectionStatus('error');
      toast.error('Connection failed', { id: 'backend-health-check', description: String(err) });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const helmCommands = {
    installBasic: `helm install kubilitics \\
  oci://ghcr.io/kubilitics/charts/kubilitics \\
  --version 1.0.0 \\
  --namespace kubilitics --create-namespace`,
    installFromSource: `# Or install directly from the source repo
git clone https://github.com/kubilitics/kubilitics.git
helm install kubilitics ./deploy/helm/kubilitics \\
  --namespace kubilitics --create-namespace`,
    installWithIngress: `helm install kubilitics \\
  oci://ghcr.io/kubilitics/charts/kubilitics \\
  --version 1.0.0 \\
  --namespace kubilitics --create-namespace \\
  --set ingress.enabled=true \\
  --set ingress.hosts[0].host=kubilitics.example.com \\
  --set config.allowedOrigins="https://kubilitics.example.com"`,
    installWithAI: `helm install kubilitics \\
  oci://ghcr.io/kubilitics/charts/kubilitics \\
  --version 1.0.0 \\
  --namespace kubilitics --create-namespace \\
  --set ai.enabled=true \\
  --set ai.secret.enabled=true \\
  --set ai.secret.anthropicApiKey="sk-ant-..."`,
    verify: `kubectl get pods -n kubilitics
kubectl get svc -n kubilitics`,
    portForward: `kubectl port-forward -n kubilitics svc/kubilitics 8190:8190`,
  };

  const steps = [
    { label: 'Install', icon: Package, description: 'Deploy via Helm' },
    { label: 'Connect', icon: Globe, description: 'Configure backend URL' },
    { label: 'Access', icon: Shield, description: 'Initialize cluster' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          {/* Header */}
          <div className="text-center mb-10">
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-purple-500/10 to-violet-500/10 w-fit mx-auto mb-5 border border-purple-200/30 dark:border-purple-800/30">
              <Cloud className="h-9 w-9 text-purple-500" />
            </div>
            <h1 className="text-3xl font-bold mb-2 tracking-tight">Team Server Setup</h1>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Deploy Kubilitics to your Kubernetes cluster via Helm and access it from your browser.
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-10">
            {steps.map((step, i) => {
              const StepIcon = step.icon;
              const isActive = i === activeStep;
              const isDone = i < activeStep || (i === 2 && isBackendHealthy);
              return (
                <button
                  key={step.label}
                  onClick={() => setActiveStep(i)}
                  className={cn(
                    'flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300',
                    isActive
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                      : isDone
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/50'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                  )}
                >
                  {isDone && !isActive ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="text-xs opacity-70 hidden md:inline">— {step.description}</span>
                </button>
              );
            })}
          </div>

          {/* Step 1: Helm Installation */}
          {activeStep === 0 && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              {/* Prerequisites */}
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-purple-500" />
                  Prerequisites
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { name: 'Kubernetes', version: '≥ 1.24', icon: Server },
                    { name: 'Helm', version: '≥ 3.x', icon: Package },
                    { name: 'kubectl', version: 'configured', icon: Terminal },
                  ].map((req) => (
                    <div key={req.name} className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                      <req.icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{req.name}</p>
                        <p className="text-xs text-muted-foreground">{req.version}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Quick Start */}
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Zap className="h-5 w-5 text-amber-500" />
                  Quick Start
                </h3>

                <div className="space-y-4">
                  <InClusterCodeBlock
                    label="1. Install Kubilitics (OCI registry)"
                    code={helmCommands.installBasic}
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                  <InClusterCodeBlock
                    label="Or install from source"
                    code={helmCommands.installFromSource}
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                  <InClusterCodeBlock
                    label="2. Verify installation"
                    code={helmCommands.verify}
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                </div>

                <div className="mt-4 p-3.5 rounded-xl bg-purple-500/5 border border-purple-200/40 dark:border-purple-800/40">
                  <p className="text-xs text-purple-600 dark:text-purple-400">
                    Charts are published as OCI artifacts to <code className="bg-purple-500/10 px-1.5 py-0.5 rounded">ghcr.io/kubilitics/charts</code>. No <code className="bg-purple-500/10 px-1.5 py-0.5 rounded">helm repo add</code> needed — Helm 3.8+ pulls OCI charts directly.
                  </p>
                </div>
              </Card>

              {/* Advanced Options */}
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Settings className="h-5 w-5 text-slate-500" />
                  Advanced Installation Options
                </h3>

                <div className="space-y-4">
                  <InClusterCodeBlock
                    label="With Ingress & custom domain"
                    code={helmCommands.installWithIngress}
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                  <InClusterCodeBlock
                    label="With AI backend (Claude/OpenAI)"
                    code={helmCommands.installWithAI}
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                </div>

                <div className="mt-5 p-4 rounded-xl bg-blue-500/5 border border-blue-200/40 dark:border-blue-800/40">
                  <p className="text-sm text-blue-700 dark:text-blue-300 font-medium mb-1">Configuration reference</p>
                  <p className="text-xs text-blue-600/70 dark:text-blue-400/70">
                    Full list of values: <code className="bg-blue-500/10 px-1.5 py-0.5 rounded text-xs">helm show values oci://ghcr.io/kubilitics/charts/kubilitics --version 1.0.0</code>.
                    Includes database (SQLite/PostgreSQL), RBAC, TLS, autoscaling, backup, Prometheus/Grafana, and more.
                  </p>
                </div>
              </Card>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => navigate('/mode-selection')}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Back to mode selection
                </button>
                <Button onClick={() => setActiveStep(1)} className="bg-purple-600 hover:bg-purple-700 text-white">
                  Next: Connect Backend
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Connect Backend */}
          {activeStep === 1 && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <Globe className="h-5 w-5 text-purple-500" />
                  Backend URL
                </h3>
                <p className="text-sm text-muted-foreground mb-5">
                  Enter the URL where Kubilitics backend is accessible. This is the Service or Ingress endpoint from your Helm installation.
                </p>

                {/* Port-forward hint */}
                <div className="mb-5 p-4 rounded-xl bg-amber-500/5 border border-amber-200/40 dark:border-amber-800/40">
                  <p className="text-sm text-amber-700 dark:text-amber-300 font-medium mb-2 flex items-center gap-1.5">
                    <Terminal className="h-4 w-4" />
                    For local testing (port-forward)
                  </p>
                  <InClusterCodeBlock
                    code={helmCommands.portForward}
                    copied={copied}
                    onCopy={copyToClipboard}
                  />
                  <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-2">
                    Then use <code className="bg-amber-500/10 px-1.5 py-0.5 rounded">http://localhost:8190</code> as the backend URL below.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={backendUrl}
                      onChange={(e) => { setBackendUrl(e.target.value); setConnectionStatus('idle'); }}
                      placeholder="http://localhost:8190 or https://kubilitics.example.com"
                      className="flex-1 px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 placeholder:text-muted-foreground/50"
                    />
                    <Button
                      onClick={handleTestConnection}
                      disabled={!backendUrl.trim() || isTestingConnection}
                      className={cn(
                        'px-5 rounded-xl',
                        connectionStatus === 'success'
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-purple-600 hover:bg-purple-700'
                      )}
                    >
                      {isTestingConnection ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : connectionStatus === 'success' ? (
                        <><CheckCircle2 className="h-4 w-4 mr-1" /> Connected</>
                      ) : (
                        'Test'
                      )}
                    </Button>
                  </div>

                  {connectionStatus === 'error' && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-200/40 dark:border-rose-800/40">
                      <XCircle className="h-4 w-4 text-rose-500 flex-shrink-0" />
                      <p className="text-sm text-rose-600 dark:text-rose-400">
                        Could not reach backend. Verify the URL and ensure port-forwarding or ingress is configured.
                      </p>
                    </div>
                  )}

                  {connectionStatus === 'success' && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-200/40 dark:border-emerald-800/40">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                      <p className="text-sm text-emerald-600 dark:text-emerald-400">
                        Backend is healthy and connected.
                      </p>
                    </div>
                  )}
                </div>

                {/* Already configured notice */}
                {isBackendHealthy && (
                  <div className="mt-5 flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-200/40 dark:border-emerald-800/40">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">
                      Backend already configured and healthy. You can proceed to the next step.
                    </p>
                  </div>
                )}
              </Card>

              {/* Common URLs help */}
              <Card className="p-5 bg-card border-border">
                <p className="text-sm font-medium mb-3 text-muted-foreground">Common backend URLs</p>
                <div className="space-y-2">
                  {[
                    { url: 'http://localhost:8190', desc: 'Port-forwarded (local testing)' },
                    { url: 'http://kubilitics.kubilitics.svc:8190', desc: 'In-cluster Service DNS' },
                    { url: 'https://kubilitics.example.com', desc: 'Ingress endpoint (production)' },
                  ].map((item) => (
                    <button
                      key={item.url}
                      onClick={() => { setBackendUrl(item.url); setConnectionStatus('idle'); }}
                      className="w-full flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/60 border border-transparent hover:border-border/50 transition-all text-left group"
                    >
                      <div>
                        <p className="text-sm font-mono text-foreground">{item.url}</p>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </Card>

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => setActiveStep(0)}>
                  ← Installation
                </Button>
                <Button
                  onClick={() => setActiveStep(2)}
                  disabled={!isBackendHealthy && connectionStatus !== 'success'}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  Next: Initialize Access
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Initialize Cluster Access */}
          {activeStep === 2 && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <Card className="p-8 bg-card border-border text-center">
                <div className="p-3 rounded-2xl bg-emerald-500/10 w-fit mx-auto mb-6">
                  <Shield className="h-8 w-8 text-emerald-500" />
                </div>
                <h3 className="text-xl font-bold mb-2">Ready to Connect</h3>
                <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                  The backend is deployed and accessible. Initialize in-cluster access to start monitoring your Kubernetes resources.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
                  {[
                    { label: 'Backend', status: isBackendHealthy ? 'Healthy' : 'Not configured', ok: isBackendHealthy, icon: Server },
                    { label: 'Service Account', status: 'Auto-detected', ok: true, icon: Shield },
                    { label: 'RBAC', status: 'Configured by Helm', ok: true, icon: Database },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3 p-3.5 rounded-xl bg-muted/50 border border-border/50">
                      <div className={cn('p-2 rounded-lg', item.ok ? 'bg-emerald-500/10' : 'bg-amber-500/10')}>
                        <item.icon className={cn('h-4 w-4', item.ok ? 'text-emerald-500' : 'text-amber-500')} />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className={cn('text-xs', item.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                          {item.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={() => handleConnect({
                    id: 'in-cluster',
                    name: 'In-Cluster',
                    context: 'service-account',
                    server: 'kubernetes.default.svc',
                    status: 'healthy',
                  })}
                  disabled={!isBackendHealthy}
                  className="w-full max-w-sm mx-auto bg-purple-600 hover:bg-purple-500 h-12 text-base font-semibold rounded-xl shadow-lg shadow-purple-600/20"
                >
                  Initialize In-Cluster Access
                  <ArrowRight className="ml-2" size={18} />
                </Button>

                {!isBackendHealthy && (
                  <p className="text-xs text-amber-500 mt-3">
                    Backend is not reachable. Go back to Step 2 to configure the connection.
                  </p>
                )}
              </Card>

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => setActiveStep(1)}>
                  ← Backend URL
                </Button>
                <button
                  onClick={() => navigate('/mode-selection')}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Switch to Personal mode
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/* Code block with copy button for Helm commands */
function InClusterCodeBlock({
  label,
  code,
  copied,
  onCopy,
}: {
  label?: string;
  code: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
}) {
  const id = label ?? code.slice(0, 30);
  return (
    <div>
      {label && <p className="text-sm font-medium mb-1.5 text-foreground">{label}</p>}
      <div className="relative group">
        <pre className="p-4 rounded-xl bg-slate-950 dark:bg-slate-900/80 text-slate-200 text-sm leading-relaxed overflow-x-auto border border-slate-800/60 font-mono">
          {code}
        </pre>
        <button
          onClick={() => onCopy(code, id)}
          className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-all"
          title="Copy to clipboard"
        >
          {copied === id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

