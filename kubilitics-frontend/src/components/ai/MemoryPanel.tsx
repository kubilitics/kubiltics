/**
 * MemoryPanel — World-class Memory / World Model Explorer UI for A-CORE-009.
 *
 * Four sub-tabs:
 *   Overview   — cluster stats, resource kind distribution, recent changes
 *   Explorer   — searchable/filterable resource browser
 *   Timeline   — temporal change feed per resource
 *   Search     — vector/keyword semantic search across investigations/docs
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  Search,
  Clock,
  Activity,
  RefreshCw,
  Layers,
  Cpu,
  ChevronRight,
  Box,
  FileText,
  AlertCircle,
  CheckCircle2,
  PlusCircle,
  MinusCircle,
  Edit3,
  Loader2,
  BookOpen,
  Sparkles,
  TrendingUp,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  useMemoryOverview,
  useMemoryResources,
  useMemoryChanges,
  useTemporalWindow,
  useTemporalChanges,
  useVectorSearch,
  useVectorStats,
  type ChangeRecord,
  type ResourceSummary,
  type TemporalChange,
  type VectorResult,
  type VectorSearchType,
} from '@/hooks/useMemory';

// ─── Sub-tab type ─────────────────────────────────────────────────────────────

type MemoryTab = 'overview' | 'explorer' | 'timeline' | 'search';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const UPDATE_TYPE_CONFIG = {
  ADDED: { label: 'Added', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', icon: PlusCircle },
  MODIFIED: { label: 'Modified', color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/20', icon: Edit3 },
  DELETED: { label: 'Deleted', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30', icon: MinusCircle },
};

function UpdateTypeBadge({ type }: { type: string }) {
  const cfg = UPDATE_TYPE_CONFIG[type as keyof typeof UPDATE_TYPE_CONFIG] ?? UPDATE_TYPE_CONFIG.MODIFIED;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border', cfg.bg, cfg.color, cfg.border)}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const icons: Record<string, typeof Box> = {
    Pod: Box,
    Deployment: Layers,
    Service: Activity,
    Node: Cpu,
    ConfigMap: FileText,
    Secret: Eye,
  };
  const Icon = icons[kind] ?? Box;
  return <Icon className="w-3.5 h-3.5 shrink-0" />;
}

function formatTime(ts: string | undefined): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

// Suppress unused import warnings — types are used via generics only
type _unused = ChangeRecord | ResourceSummary | TemporalChange | VectorResult;

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, loading, error, refresh } = useMemoryOverview(15_000);
  const { changes } = useMemoryChanges('10m', 8_000);

  const topKinds = useMemo(() => {
    if (!data?.cluster_stats?.kind_counts) return [];
    return Object.entries(data.cluster_stats.kind_counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [data]);

  const maxKindCount = topKinds[0]?.[1] ?? 1;

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-sm text-zinc-400">Cannot reach AI server</p>
        <p className="text-xs text-zinc-600">{error}</p>
        <Button variant="outline" size="sm" onClick={refresh} className="border-white/10 text-xs">
          <RefreshCw className="w-3 h-3 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }

  const stats = data?.cluster_stats;

  return (
    <div className="p-4 space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {stats?.bootstrapped ? (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" /> World Model Active
            </Badge>
          ) : (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Not bootstrapped
            </Badge>
          )}
          {stats?.last_sync && (
            <span className="text-[11px] text-zinc-600">Sync: {formatTime(stats.last_sync)}</span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="h-7 w-7 p-0 text-zinc-400">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
          <div className="text-2xl font-bold text-zinc-100">{(stats?.total_resources ?? 0).toLocaleString()}</div>
          <div className="text-xs text-zinc-500 mt-0.5">Resources</div>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
          <div className="text-2xl font-bold text-zinc-100">{stats?.total_kinds ?? 0}</div>
          <div className="text-xs text-zinc-500 mt-0.5">Kinds</div>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
          <div className="text-2xl font-bold text-zinc-100">{stats?.total_namespaces ?? 0}</div>
          <div className="text-xs text-zinc-500 mt-0.5">Namespaces</div>
        </div>
      </div>

      {/* Kind distribution */}
      {topKinds.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-violet-400" />
            Resource Distribution
          </p>
          <div className="space-y-2">
            {topKinds.map(([kind, count]) => (
              <div key={kind} className="flex items-center gap-2">
                <KindIcon kind={kind} />
                <span className="w-28 text-xs text-zinc-400 truncate">{kind}</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-violet-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(3, (count / maxKindCount) * 100)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <span className="w-10 text-right text-xs text-zinc-500 shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Namespace pills */}
      {stats?.namespace_counts && Object.keys(stats.namespace_counts).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(stats.namespace_counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([ns, count]) => (
              <span key={ns} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 text-xs border border-blue-500/20">
                <Cpu className="w-2.5 h-2.5" />
                {ns}
                <span className="text-blue-500/60">({count})</span>
              </span>
            ))}
        </div>
      )}

      {/* Recent changes */}
      {changes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            Recent Changes
            <span className="text-zinc-600 font-normal">({changes.length} in 10m)</span>
          </p>
          <div className="space-y-1">
            {changes.slice(0, 8).map((c, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                <KindIcon kind={c.kind} />
                <span className="text-xs text-zinc-400 truncate flex-1">
                  {c.kind}/{c.namespace ? `${c.namespace}/` : ''}{c.name}
                </span>
                <UpdateTypeBadge type={c.update_type} />
                <span className="text-[11px] text-zinc-600 shrink-0">{formatTime(c.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!stats && !loading && (
        <div className="flex flex-col items-center py-12 gap-3 text-center">
          <Database className="w-12 h-12 text-zinc-700" />
          <p className="text-sm text-zinc-500">World model not bootstrapped</p>
          <p className="text-xs text-zinc-600">Connect to a Kubernetes cluster to populate the world model.</p>
        </div>
      )}
    </div>
  );
}

// ─── Explorer tab ─────────────────────────────────────────────────────────────

function ExplorerTab() {
  const [kind, setKind] = useState('');
  const [namespace, setNamespace] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const { resources, count, loading } = useMemoryResources({
    kind,
    namespace,
    search: debouncedSearch,
    limit: 200,
  });

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setTimeout(() => setDebouncedSearch(v), 400);
  };

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    resources.forEach((r) => { counts[r.kind] = (counts[r.kind] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [resources]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="p-4 space-y-3 border-b border-white/10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search resources by name, kind, labels…"
            className="w-full pl-9 pr-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="Kind (Pod, Service…)"
            className="flex-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
          <input
            type="text"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="Namespace"
            className="flex-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
        </div>
      </div>

      {/* Kind summary chips */}
      {kindCounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-white/10">
          {kindCounts.slice(0, 6).map(([k, n]) => (
            <button
              key={k}
              onClick={() => setKind(kind === k ? '' : k)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors',
                kind === k
                  ? 'bg-violet-500/30 text-violet-300 border-violet-500/50'
                  : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10'
              )}
            >
              <KindIcon kind={k} />
              {k} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {loading && resources.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
            </div>
          )}

          {!loading && resources.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Box className="w-10 h-10 text-zinc-700" />
              <p className="text-sm text-zinc-500">No resources found</p>
              <p className="text-xs text-zinc-600">Try adjusting your filters or connecting a cluster.</p>
            </div>
          )}

          {resources.map((r, i) => (
            <motion.div
              key={`${r.kind}/${r.namespace}/${r.name}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.01, 0.3) }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group cursor-pointer"
            >
              <KindIcon kind={r.kind} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-zinc-300 truncate">{r.name}</span>
                  {r.phase && (
                    <span className={cn(
                      'text-[10px] px-1.5 py-0 rounded',
                      r.phase === 'Running' ? 'bg-emerald-500/20 text-emerald-400' :
                      r.phase === 'Pending' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    )}>{r.phase}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-zinc-600">{r.kind}</span>
                  {r.namespace && <span className="text-[11px] text-zinc-600">· {r.namespace}</span>}
                  {r.labels && Object.keys(r.labels).length > 0 && (
                    <span className="text-[11px] text-zinc-700">
                      · {Object.entries(r.labels).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </motion.div>
          ))}
        </div>
      </ScrollArea>

      <div className="px-4 py-2 border-t border-white/10 text-xs text-zinc-600">
        {count} resource{count !== 1 ? 's' : ''}
        {loading && <Loader2 className="inline w-3 h-3 ml-1.5 animate-spin" />}
      </div>
    </div>
  );
}

// ─── Timeline tab ─────────────────────────────────────────────────────────────

function TimelineTab() {
  const [kind, setKind] = useState('Pod');
  const [namespace, setNamespace] = useState('default');
  const [name, setName] = useState('');
  const [query, setQuery] = useState({ kind: '', namespace: '', name: '' });

  const { window: retWindow } = useTemporalWindow();
  const { changes, loading, error } = useTemporalChanges(query.kind, query.namespace, query.name, !!query.kind && !!query.name);

  const handleSearch = () => setQuery({ kind, namespace, name });

  return (
    <div className="flex flex-col h-full">
      {/* Retention window badge */}
      <div className="px-4 pt-4 pb-2">
        {retWindow?.available ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Clock className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span>Retention: {retWindow.oldest ? new Date(retWindow.oldest).toLocaleDateString() : '?'}</span>
            <span>→</span>
            <span>{retWindow.newest ? new Date(retWindow.newest).toLocaleDateString() : '?'}</span>
            <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 text-[10px]">{retWindow.retention}</Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <Clock className="w-3.5 h-3.5" />
            <span>No snapshots yet — retention window not available</span>
          </div>
        )}
      </div>

      {/* Resource selector */}
      <div className="px-4 pb-3 space-y-2 border-b border-white/10">
        <div className="flex gap-2">
          <input
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="Kind"
            className="w-24 px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
          <input
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="Namespace"
            className="flex-1 px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="flex-1 px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
          <Button size="sm" onClick={handleSearch} disabled={!kind || !name} className="h-7 bg-violet-600 hover:bg-violet-700 text-xs px-3">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Query'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">{error}</div>
          )}

          {!query.kind && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <Clock className="w-10 h-10 text-zinc-700" />
              <p className="text-sm text-zinc-500">Time-travel query</p>
              <p className="text-xs text-zinc-600">Enter a resource kind + name to query its change history.</p>
            </div>
          )}

          {query.kind && !loading && changes.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <CheckCircle2 className="w-8 h-8 text-zinc-700" />
              <p className="text-sm text-zinc-500">No changes found</p>
              <p className="text-xs text-zinc-600">No changes recorded for {query.kind}/{query.name} in the retention window.</p>
            </div>
          )}

          {/* Timeline */}
          {changes.length > 0 && (
            <div className="relative pl-5">
              {/* Vertical line */}
              <div className="absolute left-2 top-2 bottom-2 w-px bg-white/10" />
              <div className="space-y-3">
                {changes.map((c, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="relative"
                  >
                    {/* Dot on timeline */}
                    <div className={cn(
                      'absolute -left-3.5 top-1 w-2 h-2 rounded-full border border-zinc-800',
                      c.update_type === 'ADDED' ? 'bg-emerald-500' :
                      c.update_type === 'DELETED' ? 'bg-red-500' : 'bg-blue-500'
                    )} />
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <UpdateTypeBadge type={c.update_type} />
                        <span className="text-[11px] text-zinc-600">{formatTime(c.timestamp)}</span>
                      </div>
                      {c.after && (
                        <div className="text-xs text-zinc-400">
                          {c.after.phase && <span className="mr-2">Phase: <span className="text-zinc-200">{c.after.phase}</span></span>}
                          {c.after.uid && <span className="text-zinc-600 font-mono text-[10px]">{c.after.uid.slice(0, 8)}…</span>}
                        </div>
                      )}
                      {c.before && c.update_type === 'DELETED' && (
                        <div className="text-xs text-zinc-500">Previously: {c.before.phase ?? 'unknown phase'}</div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Search tab ───────────────────────────────────────────────────────────────

const SEARCH_TYPES: { value: VectorSearchType; label: string; icon: typeof Sparkles }[] = [
  { value: 'investigations', label: 'Investigations', icon: Sparkles },
  { value: 'error_patterns', label: 'Error Patterns', icon: AlertCircle },
  { value: 'documentation', label: 'Documentation', icon: BookOpen },
];

function SearchTab() {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<VectorSearchType>('investigations');
  const { results, loading, error, search } = useVectorSearch();
  const { stats } = useVectorStats();

  const handleSearch = () => { if (query.trim()) search(query, searchType, 10); };
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-3 border-b border-white/10">
        {/* Vector store status */}
        {stats && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className={cn('text-xs', stats.available ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30')}>
                {stats.available ? <CheckCircle2 className="w-3 h-3 mr-1 inline" /> : <AlertCircle className="w-3 h-3 mr-1 inline" />}
                {stats.available ? 'Vector Store Online' : 'Offline'}
              </Badge>
              {stats.stats && (
                <span className="text-xs text-zinc-600">{stats.stats.total_items} items · {stats.stats.backend}</span>
              )}
            </div>
            {stats.stats && (
              <div className="flex items-center gap-1.5">
                {Object.entries(stats.stats.type_counts ?? {}).map(([type, n]) => (
                  <span key={type} className="text-[11px] text-zinc-600">{type}: {n}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Type selector */}
        <div className="flex gap-1">
          {SEARCH_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.value}
                onClick={() => setSearchType(t.value)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                  searchType === t.value
                    ? 'bg-violet-500/25 text-violet-300 border-violet-500/40'
                    : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Search bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Search ${searchType.replace('_', ' ')}…`}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <Button size="sm" onClick={handleSearch} disabled={!query.trim() || loading} className="h-8 bg-violet-600 hover:bg-violet-700 text-xs px-4">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">{error}</div>
          )}

          {!loading && results.length === 0 && query && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Search className="w-8 h-8 text-zinc-700" />
              <p className="text-sm text-zinc-500">No results found</p>
              <p className="text-xs text-zinc-600">Try different search terms or index some {searchType}.</p>
            </div>
          )}

          {!query && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <Sparkles className="w-10 h-10 text-zinc-700" />
              <p className="text-sm text-zinc-500">Semantic Memory Search</p>
              <p className="text-xs text-zinc-600 max-w-52">
                Search past investigations, error patterns, and K8s documentation using keyword similarity.
              </p>
            </div>
          )}

          <AnimatePresence>
            {results.map((result, i) => (
              <motion.div
                key={result.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="text-xs font-semibold text-zinc-200">Match #{i + 1}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] text-zinc-500">Score</span>
                    <span className={cn(
                      'text-xs font-bold px-1.5 py-0.5 rounded',
                      result.score >= 2 ? 'bg-emerald-500/20 text-emerald-400' :
                      result.score >= 1 ? 'bg-amber-500/20 text-amber-400' : 'bg-white/5 text-zinc-400'
                    )}>
                      {result.score.toFixed(1)}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3">{result.text}</p>
                <span className="text-[11px] text-zinc-600">{formatTime(result.created_at)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function MemoryPanel() {
  const [activeTab, setActiveTab] = useState<MemoryTab>('overview');

  const tabs: { id: MemoryTab; label: string; icon: typeof Database }[] = [
    { id: 'overview', label: 'Overview', icon: Database },
    { id: 'explorer', label: 'Explorer', icon: Layers },
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'search', label: 'Search', icon: Search },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-violet-500/20">
            <Database className="w-4 h-4 text-violet-400" />
          </div>
          <span className="text-sm font-semibold text-zinc-200">Memory</span>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                activeTab === t.id
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="h-full overflow-hidden"
          >
            <ScrollArea className="h-full">
              {activeTab === 'overview' && <OverviewTab />}
              {activeTab === 'explorer' && <ExplorerTab />}
              {activeTab === 'timeline' && <TimelineTab />}
              {activeTab === 'search' && <SearchTab />}
            </ScrollArea>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
