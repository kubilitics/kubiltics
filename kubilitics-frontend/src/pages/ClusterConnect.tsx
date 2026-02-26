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
import yaml from 'js-yaml';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
} from 'lucide-react';
import { KubiliticsLogo, KubiliticsText } from '@/components/icons/KubernetesIcons';
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
import { addCluster, addClusterWithUpload, resetBackendCircuit, type BackendCluster } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { WelcomeAddCluster } from '@/components/connect/WelcomeAddCluster';
import { isTauri } from '@/lib/tauri';

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
  if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) return '/home';
  if (returnUrl === '/' || returnUrl === '/connect' || returnUrl.startsWith('/connect?') || returnUrl === '/mode-selection') return '/home';
  return returnUrl;
}

export default function ClusterConnect() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get('returnUrl');
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUploadedFile(file);
  }, []);

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

      import('@/services/backendApiClient').then(({ getClusterOverview }) => {
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
        import('@/services/backendApiClient').then(({ getClusterOverview }) => {
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
    currentClusterId,
    logoutFlag,
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

  const submitClusterWithContext = async (base64: string, contextName: string) => {
    await addClusterWithUpload(backendBaseUrl, base64, contextName);
    await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
    await clustersFromBackend.refetch();
    discoveredClustersRes.refetch();
    setTabMode('auto');
    toast.success('Cluster added successfully', { description: `Context: ${contextName}` });
  };

  const handleUploadedFile = async (file: File) => {
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
      toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

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
      toast.error(err instanceof Error ? err.message : 'Failed to register cluster');
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

    const targetCluster = backendItem ? backendClusterToCluster(backendItem) : (cluster as any);

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
      toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
    } finally {
      setIsPasting(false);
    }
  }, [pasteContent, backendBaseUrl, isBackendConfigured, queryClient, clustersFromBackend, discoveredClustersRes]);

  // P0-C: In Tauri mode, do NOT show the spinner and block the connect page based on
  // a persisted activeCluster — user must always be able to pick a (live) cluster.
  // In browser mode, remove blocking spinner - let redirect happen in background
  // Show UI immediately instead of blocking

  // P2-1: Don't block UI during auto-connect - show cluster list immediately
  // Auto-connect happens in background, user can see clusters and manually connect if needed
  // This matches Headlamp/Lens pattern - never block the UI

  // Show UI immediately - never block on loading
  // Empty states in the UI will handle no data scenarios gracefully
  // This matches Headlamp/Lens pattern - UI renders immediately, data loads progressively

  // Specialized view for In-Cluster mode
  if (appMode === 'in-cluster') {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl text-center">
          <div className="p-4 rounded-2xl bg-purple-500/10 w-fit mx-auto mb-8">
            <Cloud className="h-10 w-10 text-purple-400" />
          </div>
          <h1 className="text-3xl font-bold mb-4 tracking-tight">In-Cluster Connection</h1>
          <p className="text-muted-foreground mb-10 leading-relaxed">
            Kubilitics is running inside your cluster. We'll use the pod's service account to discover resources automatically.
          </p>

          <Card className="bg-card border-border p-8 mb-8 backdrop-blur-xl">
            <div className="flex items-center gap-4 text-left mb-6">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="text-emerald-400" />
              </div>
              <div>
                <p className="font-semibold">Service Account Detected</p>
                <p className="text-xs text-muted-foreground">Automatically authenticated via kubernetes.default.svc</p>
              </div>
            </div>

            <Button
              onClick={() => handleConnect({
                id: 'in-cluster',
                name: 'In-Cluster',
                context: 'service-account',
                server: 'kubernetes.default.svc',
                status: 'healthy'
              })}
              className="w-full bg-purple-600 hover:bg-purple-500 h-12 text-base font-medium"
            >
              Initialize In-Cluster Access
              <ArrowRight className="ml-2" size={18} />
            </Button>
          </Card>

          <button onClick={() => navigate('/')} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Go back to mode selection
          </button>
        </motion.div>
      </div>
    );
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
              <KubiliticsText height={40} className="text-foreground bg-clip-text" />
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
                      style={isTauri() ? { background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.2)' } : { background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                    >
                      {isTauri() ? (
                        <>
                          <AlertCircle className="h-5 w-5 shrink-0 text-blue-400" />
                          <span className="text-sm font-medium text-foreground flex-1">Couldn&apos;t load clusters. You can add a cluster by pasting or uploading your kubeconfig below.</span>
                          <Button variant="outline" size="sm" className="border-border hover:bg-muted" onClick={handleRefreshClusters} disabled={health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching}>
                            <RefreshCw className={health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching ? 'h-4 w-4 animate-spin mr-1.5' : 'h-4 w-4 mr-1.5'} />
                            Retry
                          </Button>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
                          <span className="text-sm font-medium text-red-400 flex-1">Connection failed. Check that the backend is running, or add a cluster by pasting or uploading your kubeconfig below.</span>
                          <Button variant="outline" size="sm" className="border-red-800 hover:bg-red-900/20" onClick={handleRefreshClusters} disabled={health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching}>
                            <RefreshCw className={health.isFetching || clustersFromBackend.isFetching || discoveredClustersRes.isFetching ? 'h-4 w-4 animate-spin mr-1.5' : 'h-4 w-4 mr-1.5'} />
                            Retry
                          </Button>
                        </>
                      )}
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
                              <div>
                                <p className="font-medium text-foreground">{cluster.name}</p>
                                <p className="text-xs text-muted-foreground font-mono tracking-wider">
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
                  toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
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

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
