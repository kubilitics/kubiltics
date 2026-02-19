import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  Star,
} from 'lucide-react';
import { KubernetesLogo } from '@/components/icons/KubernetesIcons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useKubeConfigStore, ParsedCluster } from '@/stores/kubeConfigStore';
import { useClusterStore, Cluster } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { addCluster, getClusterSummary, type BackendCluster } from '@/services/backendApiClient';
import { backendClusterToCluster as adapterBackendClusterToCluster, inferRegion } from '@/lib/backendClusterAdapter';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

/** Display shape for cluster list (kubeconfig or backend). */
interface ClusterWithHealth extends ParsedCluster {
  isChecking: boolean;
  lastChecked?: Date;
  version?: string;
  nodeCount?: number;
  provider?: string;
}

function mapBackendStatus(status?: string): 'healthy' | 'warning' | 'error' {
  if (status === 'connected') return 'healthy';
  if (status === 'disconnected') return 'warning';
  return 'error';
}

function inferProvider(server?: string): string {
  if (!server) return 'On-Prem';
  if (server.includes('eks') || server.includes('amazonaws')) return 'EKS';
  if (server.includes('gke') || server.includes('google')) return 'GKE';
  if (server.includes('aks') || server.includes('azure')) return 'AKS';
  if (server.includes('192.168') || server.includes('localhost') || server.includes('minikube')) return 'Minikube';
  if (server.includes('kind')) return 'Kind';
  return 'On-Prem';
}

function backendClusterToDisplay(b: BackendCluster): ClusterWithHealth {
  const server = b.server_url ?? b.server ?? '';
  return {
    id: b.id,
    name: b.name,
    server,
    context: b.context,
    user: '',
    namespace: 'default',
    isConnected: b.status === 'connected',
    status: mapBackendStatus(b.status) as ParsedCluster['status'],
    isChecking: false,
    version: b.version,
    nodeCount: b.node_count,
    provider: b.provider || inferProvider(server),
  };
}

function backendClusterToCluster(b: BackendCluster): Cluster {
  return adapterBackendClusterToCluster(b);
}

export default function ClusterSelection() {
  const navigate = useNavigate();
  const { parsedClusters, selectCluster, setAuthenticated } = useKubeConfigStore();
  const { setDemo, setClusters, setActiveCluster } = useClusterStore();
  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const clustersFromBackend = useClustersFromBackend();

  const queryClient = useQueryClient();
  const [clusters, setClustersState] = useState<ClusterWithHealth[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [primaryClusterId, setPrimaryClusterId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showAddCluster, setShowAddCluster] = useState(false);
  const [addKubeconfigPath, setAddKubeconfigPath] = useState('');
  const [addContext, setAddContext] = useState('');
  const [isAddingCluster, setIsAddingCluster] = useState(false);

  // P2-11: Per-cluster health from GET /api/v1/clusters/{id}/summary (no direct readyz / no-cors).
  const [summaryHealth, setSummaryHealth] = useState<Record<string, 'healthy' | 'warning' | 'error' | undefined>>({});

  // When backend is configured: use cluster list from GET /api/v1/clusters (A3.2)
  const backendClusters: ClusterWithHealth[] =
    isBackendConfigured && clustersFromBackend.data
      ? clustersFromBackend.data.map((b) => {
          const base = backendClusterToDisplay(b);
          const fromSummary = summaryHealth[b.id];
          return {
            ...base,
            status: (fromSummary ?? base.status) as ParsedCluster['status'],
            isChecking: fromSummary === undefined && !!clustersFromBackend.data?.length,
          };
        })
      : [];

  // Clusters to display: from backend when configured, else from local state (kubeconfig or demo)
  const displayClusters =
    isBackendConfigured && clustersFromBackend.data
      ? backendClusters
      : clusters;

  // P2-11: When backend is configured, health = GET /api/v1/clusters/{id}/summary (200 = reachable).
  useEffect(() => {
    if (!isBackendConfigured || !backendBaseUrl || !clustersFromBackend.data?.length) return;
    const list = clustersFromBackend.data;
    list.forEach((cluster, index) => {
      const id = cluster.id;
      setTimeout(async () => {
        try {
          await getClusterSummary(backendBaseUrl!, id);
          setSummaryHealth((prev) => ({ ...prev, [id]: 'healthy' }));
        } catch {
          setSummaryHealth((prev) => ({ ...prev, [id]: 'error' }));
        }
      }, index * 300);
    });
  }, [isBackendConfigured, backendBaseUrl, clustersFromBackend.data]);

  // When NOT using backend: no direct readyz (no-cors is opaque; CORS blocks in browser). Show unknown/warning.
  useEffect(() => {
    if (backendBaseUrl) return;
    if (parsedClusters.length === 0) {
      setClustersState([]);
      return;
    }
    setClustersState(
      parsedClusters.map((c) => ({
        ...c,
        isChecking: false,
        status: 'warning' as ParsedCluster['status'],
      }))
    );
  }, [parsedClusters, backendBaseUrl]);

  const detectProvider = (server: string): string => {
    if (server.includes('eks') || server.includes('amazonaws')) return 'EKS';
    if (server.includes('gke') || server.includes('google')) return 'GKE';
    if (server.includes('aks') || server.includes('azure')) return 'AKS';
    if (server.includes('192.168') || server.includes('localhost')) return 'Minikube';
    return 'On-Prem';
  };

  const handleRetry = (clusterId: string) => {
    if (isBackendConfigured && backendBaseUrl) {
      setSummaryHealth((prev) => {
        const next = { ...prev };
        delete next[clusterId];
        return next;
      });
      getClusterSummary(backendBaseUrl, clusterId)
        .then(() => {
          setSummaryHealth((prev) => ({ ...prev, [clusterId]: 'healthy' }));
          toast.success('Connection successful!');
        })
        .catch(() => {
          setSummaryHealth((prev) => ({ ...prev, [clusterId]: 'error' }));
          toast.error('Cluster unreachable');
        });
      return;
    }
    setClustersState((prev) =>
      prev.map((c) => (c.id === clusterId ? { ...c, isChecking: true, status: 'unknown' as ParsedCluster['status'] } : c))
    );
    setTimeout(() => {
      setClustersState((prev) =>
        prev.map((c) => (c.id === clusterId ? { ...c, isChecking: false, status: 'healthy' as ParsedCluster['status'], lastChecked: new Date() } : c))
      );
      toast.success('Connection successful!');
    }, 2000);
  };

  const handleRemove = (clusterId: string) => {
    if (isBackendConfigured) {
      if (selectedClusterId === clusterId) setSelectedClusterId(null);
      if (primaryClusterId === clusterId) setPrimaryClusterId(null);
      toast.info('Remove cluster via backend or settings');
      return;
    }
    setClustersState((prev) => prev.filter((c) => c.id !== clusterId));
    if (selectedClusterId === clusterId) setSelectedClusterId(null);
    if (primaryClusterId === clusterId) setPrimaryClusterId(null);
    toast.success('Cluster removed');
  };

  const handleSetPrimary = (clusterId: string) => {
    setPrimaryClusterId(clusterId);
    toast.success('Primary cluster set');
  };

  const handleConnect = async () => {
    if (!selectedClusterId) return;

    setIsConnecting(true);
    const useBackend = isBackendConfigured && clustersFromBackend.data;
    const displayItem = displayClusters.find((c) => c.id === selectedClusterId);
    const backendItem = useBackend ? clustersFromBackend.data?.find((c) => c.id === selectedClusterId) : null;

    if (useBackend && backendItem) {
      setCurrentClusterId(backendItem.id);
      const activeCluster = backendClusterToCluster(backendItem);
      setClusters(clustersFromBackend.data!.map(backendClusterToCluster));
      setActiveCluster(activeCluster);
      setDemo(false);
      setAuthenticated(true);
      setIsConnecting(false);
      navigate('/dashboard');
      return;
    }

    if (displayItem) {
      await new Promise((r) => setTimeout(r, 1500));
      selectCluster(displayItem.id);
      setAuthenticated(true);
      const server = displayItem.server ?? '';
      const region = inferRegion(server) || '';
      const provider = (displayItem.provider?.toLowerCase() || 'on-prem') as Cluster['provider'];
      const normalized: Cluster['provider'] = ['eks', 'gke', 'aks', 'minikube', 'kind', 'on-prem'].includes(provider) ? provider : 'on-prem';
      const activeCluster: Cluster = {
        id: displayItem.id,
        name: displayItem.name,
        context: displayItem.context,
        version: displayItem.version?.trim() ? displayItem.version : '—',
        status: displayItem.status === 'error' ? 'error' : displayItem.status === 'warning' ? 'warning' : 'healthy',
        region,
        provider: normalized,
        nodes: displayItem.nodeCount ?? 0,
        namespaces: 0,
        pods: { running: 0, pending: 0, failed: 0 },
        cpu: { used: 0, total: 100 },
        memory: { used: 0, total: 100 },
      };
      setCurrentClusterId(displayItem.id);
      setActiveCluster(activeCluster);
      setDemo(false);
    }
    setIsConnecting(false);
    navigate('/dashboard');
  };

  const healthyCount = displayClusters.filter((c) => c.status === 'healthy').length;
  const warningCount = displayClusters.filter((c) => c.status === 'warning').length;
  const errorCount = displayClusters.filter((c) => c.status === 'error').length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8"
        >
          <div className="flex items-center gap-3">
            <KubernetesLogo size={32} className="text-primary" />
            <span className="text-xl font-semibold">Kubilitics Setup</span>
          </div>
          <Button variant="ghost" onClick={() => navigate('/setup/kubeconfig')}>
            Back
          </Button>
        </motion.div>

        {/* Progress Steps */}
        <div className="max-w-2xl mx-auto mb-12">
          <div className="flex items-center justify-center gap-4">
            {['Upload', 'Select Cluster', 'Connect'].map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                    i < 1 ? 'bg-primary text-primary-foreground' :
                    i === 1 ? 'bg-primary/20 text-primary border-2 border-primary' :
                    'bg-muted text-muted-foreground'
                  )}
                >
                  {i < 1 ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className={cn(
                  "text-sm font-medium",
                  i === 1 ? 'text-foreground' : 'text-muted-foreground'
                )}>
                  {label}
                </span>
                {i < 2 && <div className="w-8 h-px bg-border mx-2" />}
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl mx-auto"
        >
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">Select Cluster</h1>
            <p className="text-muted-foreground">
              Choose which cluster to connect to. You can switch clusters anytime.
            </p>
          </div>

          {/* Summary stats */}
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-muted-foreground">{healthyCount} Healthy</span>
            </div>
            {warningCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-muted-foreground">{warningCount} Warning</span>
              </div>
            )}
            {errorCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-error" />
                <span className="text-muted-foreground">{errorCount} Unreachable</span>
              </div>
            )}
          </div>

          {/* Backend loading / error */}
          {isBackendConfigured && (
            <>
              {clustersFromBackend.isLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Loading clusters from backend…</span>
                </div>
              )}
              {clustersFromBackend.error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-6 flex items-center justify-between gap-4">
                  <span className="text-sm text-destructive">
                    {clustersFromBackend.error instanceof Error
                      ? clustersFromBackend.error.message
                      : 'Failed to load clusters from backend'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => clustersFromBackend.refetch()}
                    disabled={clustersFromBackend.isFetching}
                  >
                    <RefreshCw className={cn('h-4 w-4 mr-1', clustersFromBackend.isFetching && 'animate-spin')} />
                    Retry
                  </Button>
                </div>
              )}
              {isBackendConfigured && clustersFromBackend.data && clustersFromBackend.data.length === 0 && (
                <div className="rounded-lg border bg-muted/50 p-4 mb-6">
                  <p className="text-sm text-muted-foreground text-center mb-4">
                    No clusters registered. Add your cluster (e.g. Docker Desktop) by providing the kubeconfig path on the backend server and context name.
                  </p>
                  {!showAddCluster ? (
                    <div className="flex justify-center">
                      <Button onClick={() => setShowAddCluster(true)} className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add cluster
                      </Button>
                    </div>
                  ) : (
                    <form
                      className="space-y-3 max-w-md mx-auto"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!backendBaseUrl?.trim()) return;
                        setIsAddingCluster(true);
                        try {
                          const path = addKubeconfigPath.trim() || '';
                          const contextName = addContext.trim();
                          if (!contextName) {
                            toast.error('Context name is required (e.g. docker-desktop)');
                            setIsAddingCluster(false);
                            return;
                          }
                          await addCluster(backendBaseUrl, path, contextName);
                          toast.success('Cluster added');
                          setShowAddCluster(false);
                          setAddKubeconfigPath('');
                          setAddContext('');
                          queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
                          clustersFromBackend.refetch();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Failed to add cluster');
                        } finally {
                          setIsAddingCluster(false);
                        }
                      }}
                    >
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Kubeconfig path (on backend server)</label>
                        <input
                          type="text"
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          placeholder="e.g. /Users/you/.kube/config or leave empty for default"
                          value={addKubeconfigPath}
                          onChange={(e) => setAddKubeconfigPath(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Context name</label>
                        <input
                          type="text"
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                          placeholder="e.g. docker-desktop or default"
                          value={addContext}
                          onChange={(e) => setAddContext(e.target.value)}
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button type="button" variant="outline" onClick={() => setShowAddCluster(false)}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={isAddingCluster}>
                          {isAddingCluster ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add cluster'}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </>
          )}

          {/* Empty state when no backend and no kubeconfig */}
          {!isBackendConfigured && displayClusters.length === 0 && (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center mb-8">
              <p className="text-muted-foreground mb-4">No clusters available. Set the backend URL in Settings (e.g. {DEFAULT_BACKEND_BASE_URL}) to use Docker Desktop or other clusters, or go back to add kubeconfig.</p>
              <div className="flex gap-2 justify-center flex-wrap">
                <Button variant="outline" onClick={() => navigate('/settings')}>Settings</Button>
                <Button variant="outline" onClick={() => navigate('/setup/kubeconfig')}>Back to kubeconfig</Button>
              </div>
            </div>
          )}
          {/* Cluster List */}
          <div className="space-y-3 mb-8">
            {(!isBackendConfigured || !clustersFromBackend.isLoading) && displayClusters.map((cluster) => (
              <Card
                key={cluster.id}
                className={cn(
                  "cursor-pointer transition-all",
                  selectedClusterId === cluster.id
                    ? 'ring-2 ring-primary border-primary'
                    : 'hover:border-primary/50',
                  cluster.status === 'error' && 'opacity-75'
                )}
                onClick={() => cluster.status !== 'error' && setSelectedClusterId(cluster.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Status icon */}
                    <div className={cn(
                      "p-2.5 rounded-lg",
                      cluster.isChecking ? 'bg-muted' :
                      cluster.status === 'healthy' ? 'bg-success/10' :
                      cluster.status === 'warning' ? 'bg-warning/10' : 'bg-error/10'
                    )}>
                      {cluster.isChecking ? (
                        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                      ) : cluster.status === 'healthy' ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : cluster.status === 'warning' ? (
                        <AlertCircle className="h-5 w-5 text-warning" />
                      ) : (
                        <XCircle className="h-5 w-5 text-error" />
                      )}
                    </div>

                    {/* Cluster info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{cluster.name}</span>
                        {primaryClusterId === cluster.id && (
                          <Badge variant="secondary" className="text-[10px] gap-0.5">
                            <Star className="h-2.5 w-2.5" />
                            Primary
                          </Badge>
                        )}
                        {cluster.provider && (
                          <Badge variant="outline" className="text-[10px]">
                            {cluster.provider}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {cluster.version && <span>{cluster.version}</span>}
                        {cluster.nodeCount && <span>{cluster.nodeCount} nodes</span>}
                        <span className="font-mono truncate">{cluster.server}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {cluster.status === 'error' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); handleRetry(cluster.id); }}
                          disabled={cluster.isChecking}
                        >
                          <RefreshCw className={cn("h-4 w-4 mr-1", cluster.isChecking && "animate-spin")} />
                          Retry
                        </Button>
                      ) : (
                        <>
                          {primaryClusterId !== cluster.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); handleSetPrimary(cluster.id); }}
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleRemove(cluster.id); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Selection indicator */}
                    {selectedClusterId === cluster.id && (
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button 
              variant="outline" 
              onClick={() => navigate('/setup/kubeconfig')}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Another Cluster
            </Button>
            
            <Button
              onClick={handleConnect}
              disabled={!selectedClusterId || isConnecting}
              className="gap-2 min-w-[150px]"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Connect
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
