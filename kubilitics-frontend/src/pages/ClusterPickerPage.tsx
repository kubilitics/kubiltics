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
import { Layers, Plus } from 'lucide-react';

import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      className="page-container"
      role="main"
      aria-label="Clusters"
    >
      <div className="page-inner p-6 gap-6 flex flex-col">
        <SectionOverviewHeader
          title="Clusters"
          description="Select a cluster to view its dashboard."
          icon={Layers}
          extraActions={
            <Button
              type="button"
              onClick={() => setAddOpen(true)}
              className="gap-2 h-10"
              aria-label="Add cluster"
            >
              <Plus className="h-4 w-4" />
              Add cluster
            </Button>
          }
        />

        <AddClusterDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onAdded={() => { void refreshSnapshot(); }}
        />

        <div className="flex flex-col gap-4">
          <Input
            type="search"
            placeholder="Search clusters by name or URL…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search clusters"
            className="max-w-md"
          />

          {filtered.length === 0 ? (
            <Card className="border-none soft-shadow glass-panel p-8 text-center text-muted-foreground">
              {clusters.length === 0
                ? 'No clusters available yet. Add a cluster to get started.'
                : 'No clusters match your search.'}
            </Card>
          ) : (
            <div
              className="flex flex-col gap-3 max-h-[calc(100vh-260px)] overflow-auto pr-1"
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
                      <span
                        className={cn(
                          'h-2.5 w-2.5 rounded-full shrink-0',
                          reachabilityDotClass(c.reachability),
                        )}
                        role="img"
                        aria-label={reachabilityTitle(c.reachability)}
                        title={reachabilityTitle(c.reachability)}
                      />
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
        </div>
      </div>
    </div>
  );
}

export default ClusterPickerPage;
