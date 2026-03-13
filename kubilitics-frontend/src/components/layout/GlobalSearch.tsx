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
  Lock,
  Users,
  Tag,
  Blocks,
  Webhook,
  ScrollText,
  Waypoints,
  MonitorCheck,
  Cpu,
  MemoryStick,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { searchResources, type SearchResultItem as ApiSearchResult } from '@/services/backendApiClient';
import { getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';

const SEARCH_DEBOUNCE_MS = 250;

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
  { id: 'audit-log', name: 'Audit Log', keywords: ['history', 'events', 'trail'], icon: ScrollText, path: '/audit-log', category: 'General' },
  { id: 'analytics', name: 'Analytics', keywords: ['metrics', 'charts', 'reports', 'ai'], icon: BarChart3, path: '/analytics', category: 'General' },

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
  { id: 'replicationcontrollers', name: 'Replication Controllers', keywords: ['legacy', 'rc'], icon: Layers, path: '/replicationcontrollers', category: 'Workloads' },

  // Networking
  { id: 'networking', name: 'Networking', keywords: ['overview', 'traffic'], icon: Globe, path: '/networking', category: 'Networking' },
  { id: 'services', name: 'Services', keywords: ['svc', 'load balancer', 'clusterip', 'nodeport'], icon: Globe, path: '/services', category: 'Networking' },
  { id: 'ingresses', name: 'Ingresses', keywords: ['ingress', 'route', 'url', 'domain', 'host'], icon: Globe, path: '/ingresses', category: 'Networking' },
  { id: 'ingressclasses', name: 'Ingress Classes', keywords: ['nginx', 'traefik', 'controller'], icon: Globe, path: '/ingressclasses', category: 'Networking' },
  { id: 'endpoints', name: 'Endpoints', keywords: ['ip', 'address', 'backend'], icon: Network, path: '/endpoints', category: 'Networking' },
  { id: 'endpointslices', name: 'Endpoint Slices', keywords: ['slice'], icon: Network, path: '/endpointslices', category: 'Networking' },
  { id: 'networkpolicies', name: 'Network Policies', keywords: ['policy', 'firewall', 'security', 'egress', 'ingress'], icon: Shield, path: '/networkpolicies', category: 'Networking' },

  // Storage & Config
  { id: 'storage', name: 'Storage', keywords: ['overview', 'volumes', 'disk'], icon: HardDrive, path: '/storage', category: 'Storage & Config' },
  { id: 'configmaps', name: 'ConfigMaps', keywords: ['config', 'configuration', 'env', 'environment'], icon: FileCode, path: '/configmaps', category: 'Storage & Config' },
  { id: 'secrets', name: 'Secrets', keywords: ['secret', 'password', 'token', 'tls', 'certificate', 'credentials'], icon: Key, path: '/secrets', category: 'Storage & Config' },
  { id: 'persistentvolumes', name: 'Persistent Volumes', keywords: ['pv', 'disk', 'storage', 'nfs', 'ebs'], icon: HardDrive, path: '/persistentvolumes', category: 'Storage & Config' },
  { id: 'persistentvolumeclaims', name: 'Persistent Volume Claims', keywords: ['pvc', 'claim', 'storage request'], icon: HardDrive, path: '/persistentvolumeclaims', category: 'Storage & Config' },
  { id: 'storageclasses', name: 'Storage Classes', keywords: ['sc', 'provisioner', 'gp2', 'ssd'], icon: HardDrive, path: '/storageclasses', category: 'Storage & Config' },
  { id: 'volumeattachments', name: 'Volume Attachments', keywords: ['attach', 'mount'], icon: HardDrive, path: '/volumeattachments', category: 'Storage & Config' },
  { id: 'volumesnapshots', name: 'Volume Snapshots', keywords: ['snapshot', 'backup'], icon: HardDrive, path: '/volumesnapshots', category: 'Storage & Config' },

  // Cluster
  { id: 'cluster-overview', name: 'Cluster Overview', keywords: ['cluster', 'health', 'nodes'], icon: MonitorCheck, path: '/cluster-overview', category: 'Cluster' },
  { id: 'nodes', name: 'Nodes', keywords: ['node', 'worker', 'master', 'machine', 'host'], icon: Server, path: '/nodes', category: 'Cluster' },
  { id: 'namespaces', name: 'Namespaces', keywords: ['namespace', 'ns', 'project', 'tenant'], icon: Layers, path: '/namespaces', category: 'Cluster' },
  { id: 'events', name: 'Events', keywords: ['event', 'warning', 'error', 'log'], icon: Activity, path: '/events', category: 'Cluster' },
  { id: 'apiservices', name: 'API Services', keywords: ['api', 'aggregation'], icon: Blocks, path: '/apiservices', category: 'Cluster' },
  { id: 'leases', name: 'Leases', keywords: ['leader', 'election', 'lock'], icon: Clock, path: '/leases', category: 'Cluster' },
  { id: 'runtimeclasses', name: 'Runtime Classes', keywords: ['runtime', 'container', 'gvisor', 'kata'], icon: Cpu, path: '/runtimeclasses', category: 'Cluster' },

  // RBAC & Security
  { id: 'serviceaccounts', name: 'Service Accounts', keywords: ['sa', 'identity', 'principal'], icon: Users, path: '/serviceaccounts', category: 'Access Control' },
  { id: 'roles', name: 'Roles', keywords: ['role', 'permission', 'rbac'], icon: Shield, path: '/roles', category: 'Access Control' },
  { id: 'rolebindings', name: 'Role Bindings', keywords: ['binding', 'rbac'], icon: Shield, path: '/rolebindings', category: 'Access Control' },
  { id: 'clusterroles', name: 'Cluster Roles', keywords: ['cluster', 'rbac', 'global'], icon: Shield, path: '/clusterroles', category: 'Access Control' },
  { id: 'clusterrolebindings', name: 'Cluster Role Bindings', keywords: ['binding', 'rbac', 'global'], icon: Shield, path: '/clusterrolebindings', category: 'Access Control' },

  // Scaling & Resources
  { id: 'scaling', name: 'Scaling', keywords: ['autoscale', 'overview'], icon: Scale, path: '/scaling', category: 'Scaling & Resources' },
  { id: 'resources', name: 'Resources', keywords: ['overview', 'quota', 'limits'], icon: Gauge, path: '/resources', category: 'Scaling & Resources' },
  { id: 'horizontalpodautoscalers', name: 'Horizontal Pod Autoscalers', keywords: ['hpa', 'autoscale', 'scale out', 'cpu', 'memory'], icon: Scale, path: '/horizontalpodautoscalers', category: 'Scaling & Resources' },
  { id: 'verticalpodautoscalers', name: 'Vertical Pod Autoscalers', keywords: ['vpa', 'right-size', 'resource'], icon: Scale, path: '/verticalpodautoscalers', category: 'Scaling & Resources' },
  { id: 'poddisruptionbudgets', name: 'Pod Disruption Budgets', keywords: ['pdb', 'disruption', 'budget', 'availability'], icon: Shield, path: '/poddisruptionbudgets', category: 'Scaling & Resources' },
  { id: 'resourcequotas', name: 'Resource Quotas', keywords: ['quota', 'limit', 'namespace'], icon: Gauge, path: '/resourcequotas', category: 'Scaling & Resources' },
  { id: 'limitranges', name: 'Limit Ranges', keywords: ['limit', 'range', 'default'], icon: Gauge, path: '/limitranges', category: 'Scaling & Resources' },
  { id: 'priorityclasses', name: 'Priority Classes', keywords: ['priority', 'preemption', 'scheduling'], icon: ListChecks, path: '/priorityclasses', category: 'Scaling & Resources' },

  // CRDs & Admission
  { id: 'crds', name: 'CRDs', keywords: ['custom resource', 'overview', 'api extension'], icon: Blocks, path: '/crds', category: 'Extensions' },
  { id: 'admission', name: 'Admission', keywords: ['webhook', 'overview', 'validation', 'mutation'], icon: Webhook, path: '/admission', category: 'Extensions' },
  { id: 'customresourcedefinitions', name: 'Custom Resource Definitions', keywords: ['crd', 'custom', 'api'], icon: Blocks, path: '/customresourcedefinitions', category: 'Extensions' },
  { id: 'customresources', name: 'Custom Resources', keywords: ['cr', 'custom', 'instance'], icon: Blocks, path: '/customresources', category: 'Extensions' },
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

// --- Component ---

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Cluster / backend state
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);

  // Use activeCluster.id as fallback when currentClusterId is not set
  const clusterId = currentClusterId ?? activeCluster?.id ?? null;
  const canSearchLive = isBackendConfigured() && !!clusterId && !!backendBaseUrl;

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
      // Small delay to let dialog render
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
    const items: { type: 'nav' | 'live' | 'quick'; path: string; id: string }[] = [];
    if (!search.trim()) {
      // Show default quick nav items
      navigationItems.slice(0, 8).forEach((n) => items.push({ type: 'quick', path: n.path, id: n.id }));
    } else {
      filteredNav.forEach((n) => items.push({ type: 'nav', path: n.path, id: n.id }));
      liveResults.forEach((r) => items.push({ type: 'live', path: r.path, id: r.id }));
    }
    return items;
  }, [search, filteredNav, liveResults]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allItems.length]);

  const handleSelect = useCallback(
    (path: string) => {
      navigate(path);
      onOpenChange(false);
      setSearch('');
    },
    [navigate, onOpenChange]
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
        handleSelect(allItems[selectedIndex].path);
      }
    },
    [allItems, selectedIndex, handleSelect]
  );

  const hasSearchText = search.trim().length > 0;
  const isLoading = hasSearchText && isFetching;
  const hasNavResults = filteredNav.length > 0;
  const hasLiveResults = liveResults.length > 0;
  const noResults = hasSearchText && !hasNavResults && !hasLiveResults && !isLoading;

  // Track flat index for highlight
  let flatIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-2xl border-slate-200/80 max-w-[560px] rounded-2xl gap-0">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-slate-100" onKeyDown={handleKeyDown}>
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pages, resources, and more..."
            className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            autoComplete="off"
            spellCheck={false}
          />
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-100 rounded border border-slate-200">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto overscroll-contain py-1">
          {/* Default state: popular pages */}
          {!hasSearchText && (
            <>
              <div className="px-3 py-1.5">
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider px-1">Go to</p>
              </div>
              {navigationItems.slice(0, 8).map((item) => {
                const isSelected = flatIndex === selectedIndex;
                const idx = flatIndex++;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.path)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      'flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors',
                      isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                    )}
                  >
                    <div className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-lg',
                      isSelected ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                    )}>
                      <item.icon className="h-4 w-4" />
                    </div>
                    <span className="flex-1 text-sm text-slate-700 font-medium">{item.name}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                  </button>
                );
              })}
            </>
          )}

          {/* Navigation results */}
          {hasSearchText && hasNavResults && (
            <>
              <div className="px-3 py-1.5">
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider px-1">Pages</p>
              </div>
              {Object.entries(groupedNav).map(([category, items]) => (
                <div key={category}>
                  <div className="px-4 py-1">
                    <span className="text-[10px] font-medium text-slate-300 uppercase tracking-wider">{category}</span>
                  </div>
                  {items.map((item) => {
                    const isSelected = flatIndex === selectedIndex;
                    const idx = flatIndex++;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item.path)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          'flex items-center gap-3 w-full px-4 py-2 text-left transition-colors',
                          isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                        )}
                      >
                        <div className={cn(
                          'flex items-center justify-center w-7 h-7 rounded-lg',
                          isSelected ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                        )}>
                          <item.icon className="h-3.5 w-3.5" />
                        </div>
                        <span className="flex-1 text-sm text-slate-700">{item.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}

          {/* Live cluster resource results */}
          {hasSearchText && hasLiveResults && (
            <>
              {hasNavResults && <div className="h-px bg-slate-100 mx-3 my-1" />}
              <div className="px-3 py-1.5">
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider px-1">
                  Cluster Resources
                  <Badge variant="secondary" className="ml-2 text-[9px] px-1.5 py-0 bg-slate-100 text-slate-500 font-normal">
                    {liveResults.length}
                  </Badge>
                </p>
              </div>
              {Object.entries(groupedLive).map(([type, resources]) => {
                const Icon = resourceIcons[type] || resourceIcons[type.toLowerCase()] || Box;
                return (
                  <div key={type}>
                    <div className="px-4 py-1 flex items-center gap-1.5">
                      <Icon className="h-3 w-3 text-slate-400" />
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{type}s</span>
                      <span className="text-[10px] text-slate-300">({resources.length})</span>
                    </div>
                    {resources.map((resource) => {
                      const isSelected = flatIndex === selectedIndex;
                      const idx = flatIndex++;
                      const ResIcon = resourceIcons[resource.type] || resourceIcons[resource.type.toLowerCase()] || Box;
                      return (
                        <button
                          key={resource.id}
                          onClick={() => handleSelect(resource.path)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={cn(
                            'flex items-center gap-3 w-full px-4 py-2 text-left transition-colors',
                            isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                          )}
                        >
                          <div className={cn(
                            'flex items-center justify-center w-7 h-7 rounded-lg',
                            isSelected ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                          )}>
                            <ResIcon className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-700 truncate font-medium">{resource.name}</p>
                            {resource.namespace && (
                              <p className="text-[11px] text-slate-400 truncate">{resource.namespace}</p>
                            )}
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
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
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              <span className="text-sm text-slate-400">Searching cluster...</span>
            </div>
          )}

          {/* Empty state */}
          {noResults && (
            <div className="flex flex-col items-center gap-2 py-10">
              <Search className="h-8 w-8 text-slate-200" />
              <p className="text-sm text-slate-500">No results for &ldquo;{search.trim()}&rdquo;</p>
              <p className="text-xs text-slate-400">Try a different search term</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white rounded border border-slate-200 text-[10px]">↵</kbd>
              Open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white rounded border border-slate-200 text-[10px]">↑↓</kbd>
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
