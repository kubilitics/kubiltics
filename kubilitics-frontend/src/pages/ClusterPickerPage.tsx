// ClusterPickerPage — new /clusters landing (onboarding-v2).
//
// Reads clusters from clusterPresenceStore (single source of truth). Clicking
// a card sets the active logical identity + navigates to /dashboard. A search
// input filters by cluster name or server URL (case-insensitive). Ordering:
// connected first, then alphabetical. (Last-used + starred ordering deferred;
// see Phase 5 notes.)
//
// Wired as "/clusters" in App.tsx (Phase 7: unconditional).
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { motion } from 'framer-motion';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';

import { AddClusterDialog } from '@/components/cluster/AddClusterDialog';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';
import type {
  DiscoveredCluster,
  LogicalIdentity,
  PresenceSnapshot,
  RegisteredCluster,
} from '@/types/resilient';
import { logicalIdentityKey } from '@/types/resilient';
import { addCluster } from '@/services/api/clusters';
import { toast } from 'sonner';
import { getProviderLogo, getProviderLabel } from '@/topology/icons/providerLogoMap';

type Reachability = 'reachable' | 'unreachable' | 'unknown';

interface MergedCluster {
  identity: LogicalIdentity;
  source: DiscoveredCluster['source'];
  reachability: Reachability;
  isConnected: boolean;
  connectedAt?: string;
  /** Passed through from the underlying DiscoveredCluster when available;
   *  used to auto-register kubeconfig-sourced clusters on click. */
  kubeconfigPath?: string;
  /** Provider classification (eks/aks/gke/docker-desktop/kind/...) — used
   *  to render the cloud-provider logo on the card. */
  provider?: string;
}

// Normalize the backend's provider string (e.g. "Kind", "AWS", "Docker Desktop")
// to the lowercase keys the providerLogoMap expects.
function normalizeProvider(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  // Backend emits "AWS" for EKS, "Azure" for AKS, "GCP" for GKE — translate.
  if (v === 'aws') return 'eks';
  if (v === 'azure') return 'aks';
  if (v === 'gcp' || v === 'google') return 'gke';
  if (v === 'docker desktop' || v === 'docker-desktop') return 'docker-desktop';
  return v;
}

// inferProviderFromName — best-effort classification for kubeconfig-discovered
// clusters (which only carry a context name, no provider field). Matches the
// heuristics from the pre-Phase-7 ClusterConnect flow so users see familiar
// EKS/AKS/GKE/Docker/Kind badges even before they click a cluster.
function inferProviderFromName(name: string): string | undefined {
  const n = name.toLowerCase();
  if (n.includes('docker-desktop') || n.includes('docker-for-desktop')) return 'docker-desktop';
  if (n.startsWith('kind-') || n === 'kind') return 'kind';
  if (n.includes('minikube')) return 'minikube';
  if (n.startsWith('arn:aws:eks') || n.includes('eks') || n.endsWith('.eks') || n.endsWith('-eks')) return 'eks';
  if (n.endsWith('.aks') || n.includes('aks') || n.includes('azure')) return 'aks';
  if (n.startsWith('gke_') || n.includes('gke') || n.includes('gcp')) return 'gke';
  if (n.includes('openshift') || n.includes('-ocp')) return 'openshift';
  if (n.includes('rancher') || n.includes('rke')) return 'rancher';
  if (n.includes('k3s') || n.includes('k3d')) return 'k3s';
  return undefined;
}

function mergeClusters(
  discovered: DiscoveredCluster[],
  registered: RegisteredCluster[],
  connectedKeys: Set<string>,
  connectedAtMap: Map<string, string>,
): MergedCluster[] {
  const byKey = new Map<string, MergedCluster>();

  for (const d of discovered) {
    const k = logicalIdentityKey(d.identity);
    byKey.set(k, {
      identity: d.identity,
      source: d.source,
      reachability: 'unknown',
      isConnected: connectedKeys.has(k),
      connectedAt: connectedAtMap.get(k),
      kubeconfigPath: d.kubeconfig_path,
      provider: normalizeProvider(d.provider) ?? inferProviderFromName(d.identity.name),
    });
  }
  for (const r of registered) {
    const k = logicalIdentityKey(r.identity);
    const prev = byKey.get(k);
    byKey.set(k, {
      identity: r.identity,
      source: r.source,
      reachability: r.reachable ? 'reachable' : 'unreachable',
      isConnected: connectedKeys.has(k) || prev?.isConnected || false,
      connectedAt: connectedAtMap.get(k) ?? prev?.connectedAt,
      kubeconfigPath: r.kubeconfig_path ?? prev?.kubeconfigPath,
      provider: normalizeProvider(r.provider) ?? prev?.provider ?? inferProviderFromName(r.identity.name),
    });
  }
  return Array.from(byKey.values());
}

function sortClusters(list: MergedCluster[]): MergedCluster[] {
  return [...list].sort((a, b) => {
    // Connected first.
    if (a.isConnected !== b.isConnected) {
      return a.isConnected ? -1 : 1;
    }
    // Within connected bucket: most recent connectedAt first (last-used).
    if (a.isConnected && b.isConnected) {
      const ta = a.connectedAt ?? '';
      const tb = b.connectedAt ?? '';
      if (ta !== tb) return ta < tb ? 1 : -1;
    }
    // Tie-break: alphabetical by name.
    return a.identity.name.localeCompare(b.identity.name);
  });
}

function sourceBadgeLabel(source: DiscoveredCluster['source']): string {
  switch (source) {
    case 'kubeconfig':
      return 'kubeconfig';
    case 'secret':
      return 'secret';
    case 'manual':
      return 'manual';
    default:
      return source;
  }
}

function reachabilityTitle(r: Reachability): string {
  if (r === 'reachable') return 'reachable';
  if (r === 'unreachable') return 'unreachable';
  return 'reachability unknown';
}

function reachabilityDotClass(r: Reachability): string {
  if (r === 'reachable') return 'bg-[hsl(var(--success))]';
  if (r === 'unreachable') return 'bg-[hsl(var(--destructive))]';
  return 'bg-muted-foreground/40';
}

export function ClusterPickerPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const discovered = useClusterPresenceStore((s) => s.discovered);
  const registered = useClusterPresenceStore((s) => s.registered);
  const connected = useClusterPresenceStore((s) => s.connected);
  const setActiveByLogicalIdentity = useClusterPresenceStore(
    (s) => s.setActiveByLogicalIdentity,
  );
  const applySnapshot = useClusterPresenceStore((s) => s.applySnapshot);
  const backendBaseUrl = useBackendConfigStore((s) => getEffectiveBackendBaseUrl(s.backendBaseUrl));

  // Force-refresh the presence snapshot after a successful add — the SSE
  // stream typically fires first, but don't rely on it: a single fetch
  // guarantees the new cluster shows up on the picker before the user
  // blinks. Best-effort; silent on failure.
  const refreshSnapshot = useCallback(async () => {
    try {
      const url = `${backendBaseUrl}/api/v1/presence`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const snap: PresenceSnapshot = await res.json();
      applySnapshot(snap);
    } catch {
      // best-effort; SSE will catch up eventually.
    }
  }, [backendBaseUrl, applySnapshot]);

  const clusters = useMemo<MergedCluster[]>(() => {
    const connectedKeys = new Set(connected.map((c) => logicalIdentityKey(c.identity)));
    const connectedAtMap = new Map(
      connected.map((c) => [logicalIdentityKey(c.identity), c.connected_at]),
    );
    return sortClusters(mergeClusters(discovered, registered, connectedKeys, connectedAtMap));
  }, [discovered, registered, connected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clusters;
    return clusters.filter((c) => {
      const name = c.identity.name.toLowerCase();
      const url = c.identity.serverUrl.toLowerCase();
      return name.includes(q) || url.includes(q);
    });
  }, [clusters, query]);

  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // Auto-register kubeconfig-sourced clusters that haven't been added to the
  // backend yet. The presence layer discovers every kubeconfig context but
  // only promotes ManualSource entries to Registered (with a session_id).
  // For dashboard queries to work we need that session_id, so clicking a
  // discovered-only card triggers AddCluster before navigating.
  const handlePick = async (cluster: MergedCluster) => {
    const key = logicalIdentityKey(cluster.identity);
    const isKubeconfigOnly = cluster.source === 'kubeconfig' && !cluster.isConnected;

    if (!isKubeconfigOnly) {
      setActiveByLogicalIdentity(cluster.identity);
      navigate('/dashboard');
      return;
    }

    if (pendingKey === key) return; // debounce double-clicks
    setPendingKey(key);
    try {
      // Register via legacy cluster API — backend creates the K8s client,
      // assigns a session_id. The DiscoveryManager's snapshot cache won't
      // reflect the new registration until its 60s defensive refresh, so
      // we inject the result into presenceStore directly (best-effort the
      // store will reconcile naturally on next refresh), then navigate.
      const kubeconfigPath = cluster.kubeconfigPath ?? '~/.kube/config';
      const added = await addCluster(backendBaseUrl, kubeconfigPath, cluster.identity.name);
      // Inject so activeCluster() finds it immediately on /dashboard.
      const store = useClusterPresenceStore.getState();
      const identity = {
        name: added.name ?? cluster.identity.name,
        serverUrl: (added as unknown as { server_url?: string }).server_url ?? cluster.identity.serverUrl,
      };
      const registeredEntry = {
        identity,
        source: 'kubeconfig' as const,
        context_name: added.context ?? cluster.identity.name,
        kubeconfig_path: added.kubeconfig_path ?? kubeconfigPath,
        registered_at: added.created_at ?? new Date().toISOString(),
        reachable: added.status === 'connected',
        session_id: added.id,
        provider: added.provider,
      };
      const connectedEntry = {
        ...registeredEntry,
        connected_at: added.last_connected ?? new Date().toISOString(),
      };
      store.applySnapshot({
        discovered: store.discovered,
        registered: [
          ...store.registered.filter((r) => r.identity.name !== identity.name),
          registeredEntry,
        ],
        connected: [
          ...store.connected.filter((c) => c.identity.name !== identity.name),
          connectedEntry,
        ],
        last_used: null,
      });
      setActiveByLogicalIdentity(identity);
      // Kick off a background presence refresh — by the time the user
      // clicks something on the dashboard the SSE stream + 60s refresh
      // will have caught up.
      void refreshSnapshot();
      navigate('/dashboard');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't connect to ${cluster.identity.name}`, { description: msg });
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div
      className="page-container min-h-screen flex flex-col"
      role="main"
      aria-label="Clusters"
    >
      {/* Minimal brand — centered, large. No sidebar, no app header. */}
      <header className="w-full px-6 pt-14 pb-6 flex flex-col items-center gap-3">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <BrandLogo mark height={72} className="rounded-2xl shadow-sm" />
        </motion.div>
        <span className="text-[20px] font-semibold tracking-[0.12em] text-foreground">
          KUBILITICS
        </span>
      </header>

      <div className="flex-1 flex items-start justify-center px-6 pb-12">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <div className="flex flex-col gap-2 items-center text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Your clusters
            </h1>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <span>Pick one to open its dashboard.</span>
              <Badge variant="secondary" className="font-normal">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5" />
                Live
              </Badge>
            </div>
          </div>

          <AddClusterDialog
            open={addOpen}
            onClose={() => setAddOpen(false)}
            onAdded={() => { void refreshSnapshot(); }}
          />

          <div className="flex flex-col gap-4">
            <div className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search clusters by name or URL…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search clusters"
                className={cn(
                  'w-full h-12 pl-11 pr-4 rounded-2xl',
                  'bg-background/70 backdrop-blur border border-border/60',
                  'text-sm text-foreground placeholder:text-muted-foreground/70',
                  'shadow-[var(--shadow-1)]',
                  'transition-[border-color,box-shadow,background-color] duration-200',
                  'hover:border-border',
                  'focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary/50 focus:bg-background',
                )}
              />
            </div>

            {filtered.length === 0 ? (
              <Card className="border-none soft-shadow glass-panel p-8 text-center text-muted-foreground">
                {clusters.length === 0
                  ? 'No clusters available yet. Add a cluster to get started.'
                  : 'No clusters match your search.'}
              </Card>
            ) : (
              <div
                className="flex flex-col gap-3 max-h-[calc(100vh-340px)] overflow-auto pr-1"
                role="list"
                aria-label="Available clusters"
              >
                {filtered.map((c) => {
                  const key = logicalIdentityKey(c.identity);
                  return (
                    <Card
                      key={key}
                      className="border-none soft-shadow glass-panel p-0 overflow-hidden"
                      data-testid="cluster-picker-card"
                    >
                      <button
                        type="button"
                        onClick={() => { void handlePick(c); }}
                        disabled={pendingKey === key}
                        className={cn(
                          'w-full text-left p-5 flex items-center gap-4',
                          'hover:bg-muted/40 focus-visible:outline-none',
                          'focus-visible:ring-2 focus-visible:ring-primary/30',
                          'transition-colors duration-150',
                          pendingKey === key && 'opacity-60 cursor-wait',
                        )}
                        aria-label={`Open cluster ${c.identity.name}`}
                      >
                        <div className="relative shrink-0">
                          <div className="h-12 w-12 rounded-xl bg-muted/40 border border-border/40 flex items-center justify-center overflow-hidden">
                            {getProviderLogo(c.provider) ? (
                              <img
                                src={getProviderLogo(c.provider) as string}
                                alt={getProviderLabel(c.provider)}
                                className="h-8 w-8 object-contain"
                              />
                            ) : (
                              <span className="text-lg font-semibold text-muted-foreground">
                                {c.identity.name.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <span
                            className={cn(
                              'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background',
                              reachabilityDotClass(c.reachability),
                            )}
                            role="img"
                            aria-label={reachabilityTitle(c.reachability)}
                            title={reachabilityTitle(c.reachability)}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-semibold truncate">
                              {c.identity.name}
                            </span>
                            {c.isConnected && (
                              <Badge
                                variant="secondary"
                                className="bg-primary/10 text-primary border-primary/20"
                              >
                                Connected
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs font-mono text-muted-foreground truncate mt-0.5">
                            {c.identity.serverUrl}
                          </div>
                          {c.provider && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {getProviderLabel(c.provider)}
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0 font-normal">
                          {sourceBadgeLabel(c.source)}
                        </Badge>
                      </button>
                    </Card>
                  );
                })}
              </div>
            )}

            <div className="flex justify-center pt-2">
              <Button
                type="button"
                onClick={() => setAddOpen(true)}
                className={cn(
                  'gap-2 h-11 px-5 rounded-xl',
                  'bg-primary hover:bg-primary/90 text-primary-foreground',
                  'shadow-[var(--shadow-2)] hover:shadow-[var(--shadow-3)]',
                  'transition-all duration-200',
                )}
                aria-label="Add cluster"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
                  <Plus className="h-3.5 w-3.5" />
                </span>
                Add cluster
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClusterPickerPage;
