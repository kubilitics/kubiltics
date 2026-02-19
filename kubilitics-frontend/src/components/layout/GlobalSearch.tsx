import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Command, Box, Server, Layers, Globe, Container, Key, FileCode, Database, Clock, Network, Shield, ArrowRight, Loader2, WifiOff } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { searchResources, type SearchResultItem as ApiSearchResult } from '@/services/backendApiClient';
import { getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';

const SEARCH_DEBOUNCE_MS = 300;

interface SearchResult {
  id: string;
  name: string;
  namespace?: string;
  type: string;
  path: string;
  status?: 'healthy' | 'warning' | 'error' | 'pending';
}

const resourceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  pod: Box,
  deployment: Container,
  service: Globe,
  node: Server,
  configmap: FileCode,
  secret: Key,
  namespace: Network,
  replicaset: Layers,
  statefulset: Database,
  daemonset: Server,
  job: Clock,
  cronjob: Clock,
  ingress: Globe,
  pvc: Database,
  pv: Database,
  serviceaccount: Shield,
  role: Shield,
  clusterrole: Shield,
};

const statusColors = {
  healthy: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  error: 'bg-error text-error-foreground',
  pending: 'bg-muted text-muted-foreground',
};

// Quick actions
const quickActions = [
  { id: 'nav-dashboard', name: 'Go to Dashboard', icon: Server, path: '/dashboard' },
  { id: 'nav-pods', name: 'View All Pods', icon: Box, path: '/pods' },
  { id: 'nav-deployments', name: 'View All Deployments', icon: Container, path: '/deployments' },
  { id: 'nav-services', name: 'View All Services', icon: Globe, path: '/services' },
  { id: 'nav-topology', name: 'Open Topology View', icon: Network, path: '/topology' },
  { id: 'nav-settings', name: 'Settings', icon: Shield, path: '/settings' },
];

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function apiResultToSearchResult(item: ApiSearchResult): SearchResult {
  return {
    id: `${item.kind}/${item.namespace ?? ''}/${item.name}`,
    name: item.name,
    namespace: item.namespace,
    type: item.kind,
    path: item.path,
  };
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);

  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;
  const canSearchLive = isBackendConfigured() && !!clusterId && !!backendBaseUrl;

  // Debounce search input for API calls
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading: isQueryLoading, isFetching } = useQuery({
    queryKey: ['globalSearch', clusterId ?? '', debouncedQuery],
    queryFn: () => searchResources(backendBaseUrl!, clusterId!, debouncedQuery, 30),
    enabled: canSearchLive && debouncedQuery.length >= 1,
    staleTime: 30_000,
  });

  const apiResults = useMemo(() => (data?.results ?? []).map(apiResultToSearchResult), [data?.results]);

  const filteredResources = useMemo(() => {
    if (!selectedFilter) return apiResults;
    return apiResults.filter((r) => r.type === selectedFilter);
  }, [apiResults, selectedFilter]);

  const groupedResources = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    filteredResources.forEach((resource) => {
      if (!groups[resource.type]) groups[resource.type] = [];
      groups[resource.type].push(resource);
    });
    return groups;
  }, [filteredResources]);

  const handleSelect = useCallback(
    (path: string) => {
      navigate(path);
      onOpenChange(false);
      setSearch('');
      setSelectedFilter(null);
    },
    [navigate, onOpenChange]
  );

  const isLoading = search.length >= 1 && (isQueryLoading || isFetching);
  const hasSearchText = search.trim().length >= 1;
  const showConnectHint = hasSearchText && !canSearchLive;
  const showNoResults = hasSearchText && canSearchLive && !isLoading && filteredResources.length === 0;
  const resourceTypes = ['pod', 'deployment', 'service', 'node', 'configmap', 'secret', 'namespace', 'ingress', 'statefulset', 'daemonset', 'job', 'cronjob'];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search… (Cmd+K or /)"
          className="flex h-12 w-full bg-transparent py-3 px-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      
      {/* Filter chips — only when searching with live results */}
      {hasSearchText && canSearchLive && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto">
          <span className="text-xs text-muted-foreground shrink-0">Filter:</span>
          <Badge
            variant={selectedFilter === null ? 'default' : 'outline'}
            className="cursor-pointer text-xs"
            onClick={() => setSelectedFilter(null)}
          >
            All
          </Badge>
          {resourceTypes.map((type) => {
          const Icon = resourceIcons[type] || Box;
          return (
            <Badge
              key={type}
              variant={selectedFilter === type ? 'default' : 'outline'}
              className="cursor-pointer text-xs gap-1 capitalize"
              onClick={() => setSelectedFilter(selectedFilter === type ? null : type)}
            >
              <Icon className="h-3 w-3" />
              {type}s
            </Badge>
          );
        })}
        </div>
      )}

      <CommandList className="max-h-[400px]">
        {!hasSearchText && (
          <CommandGroup heading="Quick Actions">
            {quickActions.map((action) => (
              <CommandItem
                key={action.id}
                onSelect={() => handleSelect(action.path)}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="p-1.5 rounded-md bg-primary/10">
                  <action.icon className="h-4 w-4 text-primary" />
                </div>
                <span className="flex-1">{action.name}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hasSearchText && showConnectHint && (
          <CommandEmpty className="py-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="p-4 rounded-full bg-muted">
                <WifiOff className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Connect cluster to search resources</p>
              <p className="text-xs text-muted-foreground max-w-[260px]">
                Configure the backend and connect a cluster to search by name, namespace, or kind.
              </p>
            </div>
          </CommandEmpty>
        )}

        {hasSearchText && showNoResults && (
          <CommandEmpty className="py-12 text-center">
            <div className="flex flex-col items-center gap-2">
              <Search className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No resources found for &quot;{search.trim()}&quot;</p>
              <p className="text-xs text-muted-foreground">Try name, namespace, or kind</p>
            </div>
          </CommandEmpty>
        )}

        {Object.entries(groupedResources).map(([type, resources]) => {
          const Icon = resourceIcons[type] || Box;
          return (
            <CommandGroup
              key={type}
              heading={
                <div className="flex items-center gap-2 capitalize">
                  <Icon className="h-4 w-4" />
                  {type}s
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {resources.length}
                  </Badge>
                </div>
              }
            >
              {resources.map((resource) => (
                <CommandItem
                  key={resource.id}
                  onSelect={() => handleSelect(resource.path)}
                  className="flex items-center gap-3 py-2.5"
                >
                  <div
                    className={cn(
                      'p-1.5 rounded-md',
                      resource.status === 'healthy' && 'bg-success/10',
                      resource.status === 'warning' && 'bg-warning/10',
                      resource.status === 'error' && 'bg-error/10',
                      !resource.status && 'bg-muted'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        resource.status === 'healthy' && 'text-success',
                        resource.status === 'warning' && 'text-warning',
                        resource.status === 'error' && 'text-error',
                        !resource.status && 'text-muted-foreground'
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{resource.name}</p>
                    {resource.namespace && (
                      <p className="text-xs text-muted-foreground">Namespace: {resource.namespace}</p>
                    )}
                  </div>
                  {resource.status && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] capitalize',
                        resource.status === 'healthy' && 'bg-success/10 text-success',
                        resource.status === 'warning' && 'bg-warning/10 text-warning',
                        resource.status === 'error' && 'bg-error/10 text-error'
                      )}
                    >
                      {resource.status}
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
      
      {/* Footer with keyboard hints */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded">↵</kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded">↑</kbd>
            <kbd className="px-1.5 py-0.5 bg-muted rounded">↓</kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded">Esc</kbd>
            Close
          </span>
        </div>
        <span className="flex items-center gap-1">
          <Command className="h-3 w-3" />K to open search
        </span>
      </div>
    </CommandDialog>
  );
}
