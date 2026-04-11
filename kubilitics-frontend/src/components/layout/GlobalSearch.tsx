import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Command,
  Box,
  Server,
  Layers,
  Globe,
  Container,
  Key,
  FileCode,
  Database,
  Clock,
  Network,
  Shield,
  ArrowRight,
  Loader2,
  LayoutDashboard,
  Activity,
  Settings,
  Gauge,
  Scale,
  ListChecks,
  FileText,
  HardDrive,
  Workflow,
  BarChart3,
  Users,
  Blocks,
  Webhook,
  ScrollText,
  Waypoints,
  MonitorCheck,
  Cpu,
  X,
  Trash2,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { searchResources, type SearchResultItem as ApiSearchResult } from '@/services/backendApiClient';
import { getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useSearchHistory } from '@/hooks/useSearchHistory';

const SEARCH_DEBOUNCE_MS = 250;

// --- Category colors ---
const categoryColors: Record<string, { bg: string; text: string; selectedBg: string }> = {
  'General':            { bg: 'bg-blue-50 dark:bg-blue-900/30',    text: 'text-blue-500 dark:text-blue-400',    selectedBg: 'bg-blue-100 dark:bg-blue-800/40' },
  'Workloads':          { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-500 dark:text-emerald-400', selectedBg: 'bg-emerald-100 dark:bg-emerald-800/40' },
  'Networking':         { bg: 'bg-violet-50 dark:bg-violet-900/30',  text: 'text-violet-500 dark:text-violet-400',  selectedBg: 'bg-violet-100 dark:bg-violet-800/40' },
  'Storage & Config':   { bg: 'bg-amber-50 dark:bg-amber-900/30',   text: 'text-amber-500 dark:text-amber-400',   selectedBg: 'bg-amber-100 dark:bg-amber-800/40' },
  'Cluster':            { bg: 'bg-sky-50 dark:bg-sky-900/30',     text: 'text-sky-500 dark:text-sky-400',     selectedBg: 'bg-sky-100 dark:bg-sky-800/40' },
  'Access Control':     { bg: 'bg-rose-50 dark:bg-rose-900/30',    text: 'text-rose-500 dark:text-rose-400',    selectedBg: 'bg-rose-100 dark:bg-rose-800/40' },
  'Scaling & Resources':{ bg: 'bg-orange-50 dark:bg-orange-900/30',  text: 'text-orange-500 dark:text-orange-400',  selectedBg: 'bg-orange-100 dark:bg-orange-800/40' },
  'Extensions':         { bg: 'bg-indigo-50 dark:bg-indigo-900/30',  text: 'text-indigo-500 dark:text-indigo-400',  selectedBg: 'bg-indigo-100 dark:bg-indigo-800/40' },
};

const defaultCatColor = { bg: 'bg-slate-50 dark:bg-slate-800', text: 'text-slate-500 dark:text-slate-400', selectedBg: 'bg-slate-100 dark:bg-slate-700' };

// --- Navigation catalog ---

interface NavItem {
  id: string;
  name: string;
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  category: string;
}

const navigationItems: NavItem[] = [
  // Overview & Dashboard
  { id: 'dashboard', name: 'Dashboard', keywords: ['home', 'overview', 'main'], icon: LayoutDashboard, path: '/dashboard', category: 'General' },
  { id: 'topology', name: 'Topology', keywords: ['graph', 'map', 'network', 'diagram'], icon: Waypoints, path: '/topology', category: 'General' },
  { id: 'settings', name: 'Settings', keywords: ['config', 'preferences', 'options'], icon: Settings, path: '/settings', category: 'General' },

  // Workloads
  { id: 'workloads', name: 'Workloads', keywords: ['overview', 'controllers'], icon: Activity, path: '/workloads', category: 'Workloads' },
  { id: 'pods', name: 'Pods', keywords: ['container', 'running', 'application'], icon: Box, path: '/pods', category: 'Workloads' },
  { id: 'deployments', name: 'Deployments', keywords: ['deploy', 'rollout', 'replica'], icon: Container, path: '/deployments', category: 'Workloads' },
  { id: 'replicasets', name: 'ReplicaSets', keywords: ['replica', 'scale'], icon: Layers, path: '/replicasets', category: 'Workloads' },
  { id: 'statefulsets', name: 'StatefulSets', keywords: ['stateful', 'persistent', 'database'], icon: Database, path: '/statefulsets', category: 'Workloads' },
  { id: 'daemonsets', name: 'DaemonSets', keywords: ['daemon', 'node', 'agent'], icon: Server, path: '/daemonsets', category: 'Workloads' },
  { id: 'jobs', name: 'Jobs', keywords: ['batch', 'task', 'run'], icon: Clock, path: '/jobs', category: 'Workloads' },
  { id: 'cronjobs', name: 'CronJobs', keywords: ['schedule', 'periodic', 'cron', 'timer'], icon: Clock, path: '/cronjobs', category: 'Workloads' },
  { id: 'podtemplates', name: 'Pod Templates', keywords: ['template'], icon: FileText, path: '/podtemplates', category: 'Workloads' },
  { id: 'controllerrevisions', name: 'Controller Revisions', keywords: ['revision', 'history'], icon: Workflow, path: '/controllerrevisions', category: 'Workloads' },

  // Networking
  { id: 'networking', name: 'Networking', keywords: ['overview', 'traffic'], icon: Globe, path: '/networking', category: 'Networking' },
  { id: 'services', name: 'Services', keywords: ['svc', 'load balancer', 'clusterip', 'nodeport'], icon: Globe, path: '/services', category: 'Networking' },
  { id: 'ingresses', name: 'Ingresses', keywords: ['ingress', 'route', 'url', 'domain', 'host'], icon: Globe, path: '/ingresses', category: 'Networking' },
  { id: 'ingressclasses', name: 'Ingress Classes', keywords: ['nginx', 'traefik', 'controller'], icon: Globe, path: '/ingressclasses', category: 'Networking' },
  { id: 'endpoints', name: 'Endpoints', keywords: ['ip', 'address', 'backend'], icon: Network, path: '/endpoints', category: 'Networking' },
  { id: 'endpointslices', name: 'Endpoint Slices', keywords: ['slice'], icon: Network, path: '/endpointslices', category: 'Networking' },
  { id: 'networkpolicies', name: 'Network Policies', keywords: ['policy', 'firewall', 'security', 'egress'], icon: Shield, path: '/networkpolicies', category: 'Networking' },

  // Storage & Config
  { id: 'storage', name: 'Storage', keywords: ['overview', 'volumes', 'disk'], icon: HardDrive, path: '/storage', category: 'Storage & Config' },
  { id: 'configmaps', name: 'ConfigMaps', keywords: ['config', 'configuration', 'env', 'environment'], icon: FileCode, path: '/configmaps', category: 'Storage & Config' },
  { id: 'secrets', name: 'Secrets', keywords: ['secret', 'password', 'token', 'tls', 'certificate', 'credentials'], icon: Key, path: '/secrets', category: 'Storage & Config' },
  { id: 'persistentvolumes', name: 'Persistent Volumes', keywords: ['pv', 'disk', 'storage', 'nfs', 'ebs'], icon: HardDrive, path: '/persistentvolumes', category: 'Storage & Config' },
  { id: 'persistentvolumeclaims', name: 'Persistent Volume Claims', keywords: ['pvc', 'claim', 'storage request'], icon: HardDrive, path: '/persistentvolumeclaims', category: 'Storage & Config' },
  { id: 'storageclasses', name: 'Storage Classes', keywords: ['sc', 'provisioner', 'gp2', 'ssd'], icon: HardDrive, path: '/storageclasses', category: 'Storage & Config' },

  // Cluster
  { id: 'cluster-overview', name: 'Cluster Overview', keywords: ['cluster', 'health', 'nodes'], icon: MonitorCheck, path: '/cluster-overview', category: 'Cluster' },
  { id: 'nodes', name: 'Nodes', keywords: ['node', 'worker', 'master', 'machine', 'host'], icon: Server, path: '/nodes', category: 'Cluster' },
  { id: 'namespaces', name: 'Namespaces', keywords: ['namespace', 'ns', 'project', 'tenant'], icon: Layers, path: '/namespaces', category: 'Cluster' },
  { id: 'events', name: 'Events', keywords: ['event', 'warning', 'error', 'log'], icon: Activity, path: '/events', category: 'Cluster' },

  // RBAC & Security
  { id: 'serviceaccounts', name: 'Service Accounts', keywords: ['sa', 'identity', 'principal'], icon: Users, path: '/serviceaccounts', category: 'Access Control' },
  { id: 'roles', name: 'Roles', keywords: ['role', 'permission', 'rbac'], icon: Shield, path: '/roles', category: 'Access Control' },
  { id: 'clusterroles', name: 'Cluster Roles', keywords: ['cluster', 'rbac', 'global'], icon: Shield, path: '/clusterroles', category: 'Access Control' },

  // Scaling & Resources
  { id: 'scaling', name: 'Scaling', keywords: ['autoscale', 'overview'], icon: Scale, path: '/scaling', category: 'Scaling & Resources' },
  { id: 'resources', name: 'Resources', keywords: ['overview', 'quota', 'limits'], icon: Gauge, path: '/resources', category: 'Scaling & Resources' },
  { id: 'horizontalpodautoscalers', name: 'Horizontal Pod Autoscalers', keywords: ['hpa', 'autoscale', 'cpu', 'memory'], icon: Scale, path: '/horizontalpodautoscalers', category: 'Scaling & Resources' },
  { id: 'poddisruptionbudgets', name: 'Pod Disruption Budgets', keywords: ['pdb', 'disruption', 'availability'], icon: Shield, path: '/poddisruptionbudgets', category: 'Scaling & Resources' },
  { id: 'resourcequotas', name: 'Resource Quotas', keywords: ['quota', 'limit', 'namespace'], icon: Gauge, path: '/resourcequotas', category: 'Scaling & Resources' },
  { id: 'limitranges', name: 'Limit Ranges', keywords: ['limit', 'range', 'default'], icon: Gauge, path: '/limitranges', category: 'Scaling & Resources' },
  { id: 'priorityclasses', name: 'Priority Classes', keywords: ['priority', 'preemption', 'scheduling'], icon: ListChecks, path: '/priorityclasses', category: 'Scaling & Resources' },

  // CRDs & Admission
  { id: 'crds', name: 'CRDs', keywords: ['custom resource', 'overview', 'api extension'], icon: Blocks, path: '/crds', category: 'Extensions' },
  { id: 'admission', name: 'Admission', keywords: ['webhook', 'overview', 'validation', 'mutation'], icon: Webhook, path: '/admission', category: 'Extensions' },
  { id: 'customresourcedefinitions', name: 'Custom Resource Definitions', keywords: ['crd', 'custom', 'api'], icon: Blocks, path: '/customresourcedefinitions', category: 'Extensions' },
  { id: 'mutatingwebhooks', name: 'Mutating Webhooks', keywords: ['mutate', 'admission', 'webhook'], icon: Webhook, path: '/mutatingwebhooks', category: 'Extensions' },
  { id: 'validatingwebhooks', name: 'Validating Webhooks', keywords: ['validate', 'admission', 'webhook'], icon: Webhook, path: '/validatingwebhooks', category: 'Extensions' },
];

// --- Backend search result types ---

interface SearchResult {
  id: string;
  name: string;
  namespace?: string;
  type: string;
  path: string;
}

const resourceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  pod: Box, Pod: Box,
  deployment: Container, Deployment: Container,
  service: Globe, Service: Globe,
  node: Server, Node: Server,
  configmap: FileCode, ConfigMap: FileCode,
  secret: Key, Secret: Key,
  namespace: Layers, Namespace: Layers,
  replicaset: Layers, ReplicaSet: Layers,
  statefulset: Database, StatefulSet: Database,
  daemonset: Server, DaemonSet: Server,
  job: Clock, Job: Clock,
  cronjob: Clock, CronJob: Clock,
  ingress: Globe, Ingress: Globe,
  persistentvolumeclaim: HardDrive, PersistentVolumeClaim: HardDrive,
  persistentvolume: HardDrive, PersistentVolume: HardDrive,
  serviceaccount: Users, ServiceAccount: Users,
  role: Shield, Role: Shield,
  clusterrole: Shield, ClusterRole: Shield,
  horizontalpodautoscaler: Scale, HorizontalPodAutoscaler: Scale,
  event: Activity, Event: Activity,
};

function apiResultToSearchResult(item: ApiSearchResult): SearchResult {
  return {
    id: `${item.kind}/${item.namespace ?? ''}/${item.name}`,
    name: item.name,
    namespace: item.namespace,
    type: item.kind,
    path: item.path,
  };
}

// Helper: highlight matching portion of text
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-blue-600 font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

// --- Component ---

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Search history
  const { history: searchHistory, addSearch, removeSearch, clearHistory } = useSearchHistory();

  // Cluster / backend state
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const setActiveNamespace = useClusterStore((s) => s.setActiveNamespace);
  const activeNamespace = useClusterStore((s) => s.activeNamespace);

  const clusterId = currentClusterId ?? activeCluster?.id ?? null;
  const canSearchLive = isBackendConfigured && !!clusterId && !!backendBaseUrl;

  // Debounce for backend search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Backend resource search
  const { data: apiData, isFetching } = useQuery({
    queryKey: ['globalSearch', clusterId ?? '', debouncedQuery],
    queryFn: () => searchResources(backendBaseUrl!, clusterId!, debouncedQuery, 25),
    enabled: canSearchLive && debouncedQuery.length >= 1,
    staleTime: 30_000,
  });

  const liveResults = useMemo(
    () => (apiData?.results ?? []).map(apiResultToSearchResult),
    [apiData?.results]
  );

  // Client-side navigation filtering
  const filteredNav = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase().trim();
    return navigationItems.filter((item) => {
      if (item.name.toLowerCase().includes(q)) return true;
      if (item.category.toLowerCase().includes(q)) return true;
      return item.keywords.some((kw) => kw.includes(q));
    });
  }, [search]);

  // Group navigation results by category
  const groupedNav = useMemo(() => {
    const groups: Record<string, NavItem[]> = {};
    filteredNav.forEach((item) => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredNav]);

  // Group live results by type
  const groupedLive = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    liveResults.forEach((r) => {
      if (!groups[r.type]) groups[r.type] = [];
      groups[r.type].push(r);
    });
    return groups;
  }, [liveResults]);

  // Flatten all selectable items for keyboard navigation
  const allItems = useMemo(() => {
    const items: { type: 'nav' | 'live' | 'quick' | 'history'; path: string; id: string; query?: string; namespace?: string; resultType?: string }[] = [];
    if (!search.trim()) {
      // Show history entries first, then quick navigation
      searchHistory.forEach((h, i) => items.push({ type: 'history', path: '', id: `history-${i}`, query: h.query, resultType: h.resultType }));
      navigationItems.slice(0, 8).forEach((n) => items.push({ type: 'quick', path: n.path, id: n.id }));
    } else {
      filteredNav.forEach((n) => items.push({ type: 'nav', path: n.path, id: n.id }));
      liveResults.forEach((r) => items.push({ type: 'live', path: r.path, id: r.id, namespace: r.namespace, resultType: r.type }));
    }
    return items;
  }, [search, filteredNav, liveResults, searchHistory]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [allItems.length]);

  const handleSelect = useCallback(
    (path: string, resultType?: string, namespace?: string) => {
      // Record search in history
      if (search.trim()) {
        addSearch(search.trim(), resultType);
      }
      // Switch namespace if the result is in a different namespace
      if (namespace && namespace !== activeNamespace) {
        setActiveNamespace(namespace);
      }
      navigate(path);
      onOpenChange(false);
      setSearch('');
    },
    [navigate, onOpenChange, search, addSearch, activeNamespace, setActiveNamespace]
  );

  const handleHistorySelect = useCallback(
    (query: string) => {
      setSearch(query);
      inputRef.current?.focus();
    },
    []
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && allItems[selectedIndex]) {
        e.preventDefault();
        const item = allItems[selectedIndex];
        if (item.type === 'history') {
          handleHistorySelect(item.query!);
        } else {
          handleSelect(item.path, item.resultType, item.namespace);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [allItems, selectedIndex, handleSelect, handleHistorySelect, onOpenChange]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const hasSearchText = search.trim().length > 0;
  const isLoading = hasSearchText && isFetching;
  const hasNavResults = filteredNav.length > 0;
  const hasLiveResults = liveResults.length > 0;
  const noResults = hasSearchText && !hasNavResults && !hasLiveResults && !isLoading;

  let flatIndex = 0;

  const renderNavItem = (item: NavItem, showCategory = false) => {
    const isSelected = flatIndex === selectedIndex;
    const idx = flatIndex++;
    const colors = categoryColors[item.category] || defaultCatColor;
    return (
      <button
        key={item.id}
        data-index={idx}
        onClick={() => handleSelect(item.path, item.id)}
        onMouseEnter={() => setSelectedIndex(idx)}
        className={cn(
          'flex items-center gap-3 w-full px-3 py-2 mx-1 rounded-xl text-left transition-all duration-150',
          isSelected
            ? 'bg-blue-50 dark:bg-blue-900/30 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800'
        )}
        style={{ width: 'calc(100% - 8px)' }}
      >
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
          isSelected ? colors.selectedBg : colors.bg,
          colors.text
        )}>
          <item.icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <span className={cn('text-sm font-medium', isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300')}>
            <HighlightMatch text={item.name} query={search.trim()} />
          </span>
          {showCategory && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-2">{item.category}</span>
          )}
        </div>
        <ArrowRight className={cn('h-3.5 w-3.5 transition-colors', isSelected ? 'text-blue-400' : 'text-slate-200 dark:text-slate-600')} />
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        overlayClassName="bg-black/60 dark:bg-black/70"
        className="overflow-hidden p-0 shadow-2xl border border-slate-200 dark:border-slate-700 max-w-[640px] rounded-2xl gap-0 bg-white dark:bg-slate-900"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 border-b border-slate-200 dark:border-slate-800" onKeyDown={handleKeyDown}>
          <Search className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pages, resources..."
            className="flex h-12 w-full bg-transparent text-[15px] font-medium text-slate-900 dark:text-slate-100 outline-none ring-0 border-none focus:outline-none focus:ring-0 placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:font-normal"
            autoComplete="off"
            spellCheck={false}
          />
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
          <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200/80 dark:border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto overscroll-contain py-2 px-1.5">
          {/* Default state: search history + popular pages */}
          {!hasSearchText && (
            <>
              {/* Recent searches */}
              {searchHistory.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-4 pb-1 pt-0.5">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent searches</p>
                    <button
                      onClick={clearHistory}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear
                    </button>
                  </div>
                  {searchHistory.map((entry, i) => {
                    const isSelected = flatIndex === selectedIndex;
                    const idx = flatIndex++;
                    return (
                      <button
                        key={`history-${i}`}
                        data-index={idx}
                        onClick={() => handleHistorySelect(entry.query)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          'flex items-center gap-3 w-full px-3 py-2 mx-1 rounded-xl text-left transition-all duration-150 group',
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/30 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                        )}
                        style={{ width: 'calc(100% - 8px)' }}
                      >
                        <div className={cn(
                          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
                          isSelected ? 'bg-slate-200 dark:bg-slate-700' : 'bg-slate-100 dark:bg-slate-800'
                        )}>
                          <Clock className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={cn('text-sm font-medium', isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300')}>
                            {entry.query}
                          </span>
                          {entry.resultType && (
                            <span className="text-[10px] text-slate-400 ml-2">{entry.resultType}</span>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeSearch(entry.query); }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-all"
                          title="Remove from history"
                        >
                          <X className="h-3 w-3 text-slate-400" />
                        </button>
                      </button>
                    );
                  })}
                  <div className="h-px bg-slate-100 dark:bg-slate-700 mx-3 my-2" />
                </>
              )}

              <div className="px-4 pb-1 pt-0.5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quick navigation</p>
              </div>
              {navigationItems.slice(0, 8).map((item) => renderNavItem(item))}
            </>
          )}

          {/* Navigation results */}
          {hasSearchText && hasNavResults && (
            <>
              {Object.entries(groupedNav).map(([category, items]) => {
                const colors = categoryColors[category] || defaultCatColor;
                return (
                  <div key={category} className="mb-1">
                    <div className="flex items-center gap-2 px-4 pt-2 pb-1">
                      <div className={cn('w-1.5 h-1.5 rounded-full', colors.bg.replace('bg-', 'bg-').replace('-50', '-400'))} />
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{category}</span>
                    </div>
                    {items.map((item) => renderNavItem(item, true))}
                  </div>
                );
              })}
            </>
          )}

          {/* Live cluster resource results */}
          {hasSearchText && hasLiveResults && (
            <>
              {hasNavResults && <div className="h-px bg-slate-100 dark:bg-slate-700 mx-3 my-2" />}
              <div className="flex items-center gap-2 px-4 pt-1 pb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cluster resources</span>
                <span className="text-[10px] text-slate-300 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-full px-1.5">{liveResults.length}</span>
              </div>
              {Object.entries(groupedLive).map(([type, resources]) => {
                const Icon = resourceIcons[type] || resourceIcons[type.toLowerCase()] || Box;
                return (
                  <div key={type} className="mb-1">
                    <div className="flex items-center gap-1.5 px-4 py-0.5">
                      <Icon className="h-3 w-3 text-slate-300" />
                      <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">{type}s</span>
                    </div>
                    {resources.map((resource) => {
                      const isSelected = flatIndex === selectedIndex;
                      const idx = flatIndex++;
                      const ResIcon = resourceIcons[resource.type] || resourceIcons[resource.type.toLowerCase()] || Box;
                      return (
                        <button
                          key={resource.id}
                          data-index={idx}
                          onClick={() => handleSelect(resource.path, resource.type, resource.namespace)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={cn(
                            'flex items-center gap-3 w-full px-3 py-2 mx-1 rounded-xl text-left transition-all duration-150',
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/30 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                          )}
                          style={{ width: 'calc(100% - 8px)' }}
                        >
                          <div className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-lg',
                            isSelected ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 dark:text-emerald-400'
                          )}>
                            <ResIcon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn('text-sm truncate font-medium', isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300')}>
                              <HighlightMatch text={resource.name} query={search.trim()} />
                            </p>
                            {resource.namespace && (
                              <p className="text-xs text-slate-400 truncate">{resource.namespace}</p>
                            )}
                          </div>
                          <ArrowRight className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-blue-400' : 'text-slate-200')} />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}

          {/* Loading state for backend search */}
          {hasSearchText && isLoading && !hasLiveResults && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              <span className="text-sm text-slate-400">Searching cluster...</span>
            </div>
          )}

          {/* Empty state */}
          {noResults && (
            <div className="flex flex-col items-center gap-2.5 py-12">
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800">
                <Search className="h-5 w-5 text-slate-300 dark:text-slate-600" />
              </div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No results for &ldquo;{search.trim()}&rdquo;</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Try a different search term</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-5 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200/80 dark:border-slate-700 text-[10px] font-medium">↵</kbd>
              Open
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200/80 dark:border-slate-700 text-[10px] font-medium">↑↓</kbd>
              Navigate
            </span>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <Command className="h-3 w-3" />K
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
