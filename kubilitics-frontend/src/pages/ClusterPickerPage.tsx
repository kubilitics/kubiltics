// ClusterPickerPage — new /clusters landing (onboarding-v2).
//
// Reads clusters from clusterPresenceStore (single source of truth). Clicking
// a card sets the active logical identity + navigates to /dashboard. A search
// input filters by cluster name or server URL (case-insensitive). Ordering:
// connected first, then alphabetical. (Last-used + starred ordering deferred;
// see Phase 5 notes.)
//
// Behind FEATURE_PRESENCE_V2 — the route is wired in App.tsx (Task 5.3).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';

import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
import type {
  DiscoveredCluster,
  LogicalIdentity,
  RegisteredCluster,
} from '@/types/resilient';
import { logicalIdentityKey } from '@/types/resilient';

type Reachability = 'reachable' | 'unreachable' | 'unknown';

interface MergedCluster {
  identity: LogicalIdentity;
  source: DiscoveredCluster['source'];
  reachability: Reachability;
  isConnected: boolean;
  connectedAt?: string;
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

  const discovered = useClusterPresenceStore((s) => s.discovered);
  const registered = useClusterPresenceStore((s) => s.registered);
  const connected = useClusterPresenceStore((s) => s.connected);
  const setActiveByLogicalIdentity = useClusterPresenceStore(
    (s) => s.setActiveByLogicalIdentity,
  );

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

  const handlePick = (id: LogicalIdentity) => {
    setActiveByLogicalIdentity(id);
    navigate('/dashboard');
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
                      onClick={() => handlePick(c.identity)}
                      className={cn(
                        'w-full text-left p-5 flex items-center gap-4',
                        'hover:bg-muted/40 focus-visible:outline-none',
                        'focus-visible:ring-2 focus-visible:ring-primary/30',
                        'transition-colors duration-150',
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
