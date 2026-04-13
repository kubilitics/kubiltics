/**
 * Kubilitics Header — Clean, balanced navigation bar.
 *
 * Layout: Logo zone (sidebar column) | Search | Cluster · Shell · Kubeconfig · Connect | Notifications | Profile
 * - Logo zone: w-72, sidebar-style background, fills header height
 * - Search resources: always-visible trigger in header (core feature)
 * - All controls sized for clarity; labels visible; Notifications and Profile are real controls
 */
import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ChevronDown,
  Command,
  Terminal,
  FileDown,
  Settings,
  LogOut,
  Plus,
  Unplug,
  Star,
  Layers,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { isTauri } from '@/lib/tauri';
import { useClusterStore, getClusterAppearance, getEnvBadgeLabel, getEnvBadgeClasses } from '@/stores/clusterStore';
import {
  useClusterOrganizationStore,
  fuzzyMatch,
  ENV_DOT_COLORS,
  ENV_LABELS,
  ENV_BADGE_CLASSES,
  type EnvironmentTag,
} from '@/stores/clusterOrganizationStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GlobalSearch } from './GlobalSearch';
// PERF: ClusterShellPanel pulls in xterm (~150KB). Lazy-load so it's only
// fetched when the user actually opens the terminal panel.
const ClusterShellPanel = lazy(() =>
  import('@/components/shell/ClusterShellPanel').then(m => ({ default: m.ClusterShellPanel }))
);
// Wizards removed — resource creation handled by ResourceCreator in list pages
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { ActivePortForwardsIndicator } from '@/components/resources/ActivePortForwards';
import { PipelineHealthIndicator } from '@/components/events/PipelineHealthIndicator';
import { TracingStatusPill } from '@/components/observability/TracingStatusPill';
import { getClusterKubeconfig } from '@/services/backendApiClient';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useOfflineMode } from '@/hooks/useOfflineMode';
import { getProviderLogo } from '@/topology/icons/providerLogoMap';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const statusColors: Record<string, string> = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

/** Header height — keep in sync with Sidebar's top offset */
export const HEADER_HEIGHT_CLASS = 'h-[60px]';

/* ─── Design tokens: Branded header (Docker Desktop style) ─── */

/** Text button on branded bg — white text, subtle white hover */
const HEADER_BTN = cn(
  'h-9 px-3.5 rounded-lg',
  'inline-flex items-center justify-center gap-2',
  'text-[13px] font-medium leading-none',
  'text-white/80',
  'hover:bg-white/10',
  'transition-colors duration-150',
  'active:scale-[0.97]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30'
);

/** Icon button on branded bg */
const HEADER_ICON = cn(
  'h-9 w-9 rounded-lg',
  'inline-flex items-center justify-center',
  'text-white/90',
  'hover:bg-white/15 hover:text-white',
  'transition-colors duration-150',
  'active:scale-[0.97]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30'
);

// Aliases for backward compatibility
const BTN = HEADER_BTN;
const FEATURE_BTN = HEADER_BTN;
const ICON_BTN = HEADER_ICON;

export function Header() {
  const collapsed = useUIStore((s) => s.isSidebarCollapsed);
  const navigate = useNavigate();
  const activeProject = useProjectStore((s) => s.activeProject);
  const { activeCluster, clusters, setActiveCluster, isDemo, signOut } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const clearBackend = useBackendConfigStore((s) => s.clearBackend);
  const setLogoutFlag = useBackendConfigStore((s) => s.setLogoutFlag);
  const [searchOpen, setSearchOpen] = useState(false);
  const setShellOpenStore = useUIStore((s) => s.setShellOpen);
  const [shellOpen, _setShellOpen] = useState(false);
  const setShellOpen = useCallback((open: boolean) => {
    _setShellOpen(open);
    setShellOpenStore(open);
  }, [setShellOpenStore]);
  // Wizards removed — resource creation handled by ResourceCreator in list pages
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [prodConfirmCluster, setProdConfirmCluster] = useState<import('@/stores/clusterStore').Cluster | null>(null);
  const [clusterSearch, setClusterSearch] = useState('');
  const clusterSearchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Cluster organization
  const orgFavorites = useClusterOrganizationStore((s) => s.favorites);
  const orgEnvTags = useClusterOrganizationStore((s) => s.envTags);
  const orgGroups = useClusterOrganizationStore((s) => s.groups);
  const toggleFavorite = useClusterOrganizationStore((s) => s.toggleFavorite);

  // Week 7: Cluster appearance — re-read on change events
  const [appearanceTick, setAppearanceTick] = useState(0);
  useEffect(() => {
    const onChanged = () => setAppearanceTick((t) => t + 1);
    window.addEventListener('cluster-appearance-changed', onChanged);
    return () => window.removeEventListener('cluster-appearance-changed', onChanged);
  }, []);
  const activeAppearance = activeCluster ? getClusterAppearance(activeCluster.id) : null;
  // Suppress unused-var lint — appearanceTick is read implicitly to trigger re-render
  void appearanceTick;
  const activeDisplayName = activeAppearance?.alias || activeCluster?.name;
  const activeEnvLabel = activeAppearance ? getEnvBadgeLabel(activeAppearance.environment) : null;
  const activeEnvClasses = activeAppearance ? getEnvBadgeClasses(activeAppearance.environment) : '';

  // ─── Cluster switching with production confirmation ──────────────────
  const doSwitchCluster = useCallback((cluster: import('@/stores/clusterStore').Cluster) => {
    const isSwitching = cluster.id !== (currentClusterId ?? activeCluster?.id);
    setActiveCluster(cluster);
    if (!isDemo) setCurrentClusterId(cluster.id);
    if (isSwitching) {
      // Clear ALL cached data from the previous cluster to prevent stale data flash.
      // Previously only cleared specific query keys, missing clusterOverview, metrics,
      // topology, health, etc. — causing the dashboard to briefly show old cluster data.
      queryClient.removeQueries({ queryKey: ['k8s'] });
      queryClient.removeQueries({ queryKey: ['backend'] });
      navigate('/dashboard');
    }
  }, [currentClusterId, activeCluster?.id, setActiveCluster, isDemo, setCurrentClusterId, queryClient, navigate]);

  const handleClusterSelect = useCallback((cluster: import('@/stores/clusterStore').Cluster) => {
    const env = orgEnvTags[cluster.id];
    if (env === 'production' && cluster.id !== activeCluster?.id) {
      setProdConfirmCluster(cluster);
    } else {
      doSwitchCluster(cluster);
    }
  }, [orgEnvTags, activeCluster?.id, doSwitchCluster]);

  // ─── Filtered + grouped clusters for dropdown ───────────────────────
  const organizedClusters = useMemo(() => {
    // Filter by search
    let filtered = clusters;
    if (clusterSearch.trim()) {
      filtered = clusters
        .map((c) => {
          const appearance = getClusterAppearance(c.id);
          const displayName = appearance.alias || c.name;
          const env = orgEnvTags[c.id] || '';
          const target = `${displayName} ${c.region} ${c.provider} ${env}`;
          const result = fuzzyMatch(clusterSearch.trim(), target);
          return { cluster: c, ...result };
        })
        .filter((r) => r.matches)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.cluster);
    }

    const favoriteSet = new Set(orgFavorites);
    const favoriteClusters = filtered.filter((c) => favoriteSet.has(c.id));
    const nonFavorites = filtered.filter((c) => !favoriteSet.has(c.id));

    // Group non-favorites by environment tag
    const byEnv: Record<string, typeof clusters> = {};
    const ungrouped: typeof clusters = [];

    for (const c of nonFavorites) {
      const env = orgEnvTags[c.id];
      if (env) {
        (byEnv[env] ??= []).push(c);
      } else {
        ungrouped.push(c);
      }
    }

    return { favoriteClusters, byEnv, ungrouped, total: filtered.length };
  }, [clusters, clusterSearch, orgFavorites, orgEnvTags]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // Clear React Query cache
      queryClient.clear();

      // Set logout flag to prevent session restore
      setLogoutFlag(true);

      // Clear all cluster and backend state
      signOut();
      clearBackend();

      // Small delay to ensure state is cleared
      await new Promise(resolve => setTimeout(resolve, 100));

      toast.success('Logged out successfully');
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('Failed to logout. Please try again.');
    } finally {
      setIsLoggingOut(false);
      setLogoutConfirmOpen(false);
    }
  };

  // Backend health status indicator — uses useOfflineMode as single source of truth.
  // Previous approach fired a separate useBackendHealth query that showed red dots
  // immediately on transient failures. useOfflineMode requires 6+ failures over 90s.
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const { backendReachable } = useOfflineMode();

  // Determine backend status: healthy or unreachable (no intermediate "warning" — avoids flicker)
  const backendStatus =
    !isBackendConfigured ? null :
      backendReachable ? 'healthy' : 'error';

  // handleWizardSubmit removed — wizards deleted, creation in list pages

  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);

  const handleDownloadKubeconfig = async (clusterId: string, clusterName: string) => {
    try {
      const { blob, filename } = await getClusterKubeconfig(backendBaseUrl, clusterId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success(`Downloaded ${filename}`);
    } catch (error) {
      toast.error('Failed to download kubeconfig');
      console.error(error);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  useEffect(() => {
    const onOpenSearch = () => setSearchOpen(true);
    window.addEventListener('openGlobalSearch', onOpenSearch);
    return () => window.removeEventListener('openGlobalSearch', onOpenSearch);
  }, []);

  return (
    <>
      <header
        className={cn(HEADER_HEIGHT_CLASS, 'bg-[hsl(221,83%,53%)] dark:bg-[hsl(221,70%,35%)] shrink-0 sticky top-0 z-[var(--z-sticky,50)] select-none')}
        role="banner"
        data-tauri-drag-region
        onDoubleClick={(e) => {
          // macOS: double-click anywhere on header toggles maximize,
          // UNLESS the click target is an interactive element.
          const target = e.target as HTMLElement;
          const interactive = target.closest('button, input, a, [role="menuitem"], [role="combobox"], [data-no-drag]');
          if (interactive) return;
          if (isTauri()) {
            import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
              getCurrentWindow().toggleMaximize();
            }).catch(() => {});
          }
        }}
      >
        <div className="flex items-center h-full w-full" data-tauri-drag-region>

          {/* ──── Left: Brand ──── */}
          <div className="shrink-0 flex items-center h-full pl-[78px]" data-tauri-drag-region>
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2.5 group focus:outline-none rounded-lg py-1 -my-1 transition-opacity hover:opacity-80"
              aria-label="Go to Dashboard"
            >
              <BrandLogo
                mark
                height={26}
                className="shrink-0 rounded-[7px]"
              />
              <span className="text-[15px] font-semibold tracking-[0.02em] text-white whitespace-nowrap">
                KUBILITICS
              </span>
            </button>
          </div>

          {/* ──── Center: drag region (empty space) ──── */}
          <div className="flex-1" data-tauri-drag-region />

          {/* ──── Right: Search + Cluster + Tools + Profile ──── */}
          <div className="shrink-0 flex items-center gap-3 pr-5" data-tauri-drag-region>
            {/* Search resources — global search: refined command palette trigger */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={cn(
                'w-56 md:w-72 lg:w-96 shrink-0 h-[36px] px-3.5 flex items-center gap-2.5 rounded-lg',
                'bg-white/15 text-white/60',
                'hover:bg-white/20',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
                'transition-colors duration-150'
              )}
            >
              <Search className="h-4 w-4 shrink-0 text-white/50" />
              <span className="flex-1 text-left text-[13px] text-white/50 hidden md:block">Search</span>
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/50 bg-white/10 border border-white/10">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>

            {/* Cluster selector */}
                {activeCluster && (
                  <DropdownMenu onOpenChange={(open) => { if (open) { setClusterSearch(''); setTimeout(() => clusterSearchRef.current?.focus(), 50); } }}>
                    <DropdownMenuTrigger asChild>
                      <button className={cn(HEADER_BTN, 'shrink-0 max-w-[180px] lg:max-w-[280px] group')} aria-label="Select cluster">
                        {activeCluster && getProviderLogo(activeCluster.provider) && (
                          <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center shrink-0 shadow-sm">
                            <img
                              src={getProviderLogo(activeCluster.provider)!}
                              alt=""
                              className="w-5 h-5"
                              draggable={false}
                            />
                          </div>
                        )}
                        <span
                          className="block w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: backendStatus === 'error' ? '#ef4444' :
                              backendStatus === 'warning' ? '#f59e0b' :
                              orgEnvTags[activeCluster.id] ? ENV_DOT_COLORS[orgEnvTags[activeCluster.id]] :
                              (activeAppearance?.color ?? undefined),
                          }}
                        />
                        <span className="truncate text-[13px] font-medium text-white/90">{activeDisplayName}</span>
                        {(orgEnvTags[activeCluster.id] || activeEnvLabel) && (
                          <span className={cn(
                            'text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0',
                            orgEnvTags[activeCluster.id]
                              ? ENV_BADGE_CLASSES[orgEnvTags[activeCluster.id]]
                              : activeEnvClasses
                          )}>
                            {orgEnvTags[activeCluster.id] ? ENV_LABELS[orgEnvTags[activeCluster.id]] : activeEnvLabel}
                          </span>
                        )}
                        <ChevronDown className="h-3.5 w-3.5 text-white/40 shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[360px] rounded-[2.5rem] p-4 border-none shadow-2xl mt-2 animate-in fade-in zoom-in-95 duration-200 elevation-2 max-h-[70vh] overflow-hidden flex flex-col">
                      {/* Search input */}
                      <div className="px-2 pb-3">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                          <input
                            ref={clusterSearchRef}
                            type="text"
                            value={clusterSearch}
                            onChange={(e) => setClusterSearch(e.target.value)}
                            placeholder="Search clusters..."
                            className="w-full h-9 pl-9 pr-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>

                      <div className="overflow-y-auto flex-1 min-h-0">
                        {/* Favorites section */}
                        {organizedClusters.favoriteClusters.length > 0 && (
                          <>
                            <div className="px-4 py-2">
                              <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em] flex items-center gap-1.5">
                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                Favorites
                              </p>
                            </div>
                            {organizedClusters.favoriteClusters.map((cluster) => {
                              const ca = getClusterAppearance(cluster.id);
                              const envTag = orgEnvTags[cluster.id];
                              const displayName = ca.alias || cluster.name;
                              return (
                                <DropdownMenuItem
                                  key={cluster.id}
                                  onClick={() => handleClusterSelect(cluster)}
                                  className="flex items-center gap-3 py-3 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group"
                                >
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleFavorite(cluster.id); }}
                                    className="shrink-0 p-0.5 hover:scale-110 transition-transform"
                                    aria-label="Remove from favorites"
                                  >
                                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                  </button>
                                  {getProviderLogo(cluster.provider) && (
                                    <img
                                      src={getProviderLogo(cluster.provider)!}
                                      alt=""
                                      className="w-5 h-5 shrink-0"
                                      draggable={false}
                                    />
                                  )}
                                  <span
                                    className="block w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: envTag ? ENV_DOT_COLORS[envTag] : ca.color }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-foreground tracking-tight flex items-center gap-2 flex-wrap">
                                      {displayName}
                                      {envTag && (
                                        <span className={cn('text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border', ENV_BADGE_CLASSES[envTag])}>
                                          {ENV_LABELS[envTag]}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] font-bold text-muted-foreground mt-0.5">{cluster.region} · {cluster.provider}</div>
                                  </div>
                                  {cluster.id === activeCluster.id && (
                                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                    </div>
                                  )}
                                </DropdownMenuItem>
                              );
                            })}
                            <DropdownMenuSeparator className="my-2 bg-border/60" />
                          </>
                        )}

                        {/* Environment-grouped sections */}
                        {(['production', 'staging', 'development', 'testing'] as EnvironmentTag[]).map((env) => {
                          const envClusters = organizedClusters.byEnv[env];
                          if (!envClusters?.length) return null;
                          return (
                            <div key={env}>
                              <div className="px-4 py-2">
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5" style={{ color: ENV_DOT_COLORS[env] }}>
                                  <span className="block w-2 h-2 rounded-full" style={{ backgroundColor: ENV_DOT_COLORS[env] }} />
                                  {ENV_LABELS[env]}
                                </p>
                              </div>
                              {envClusters.map((cluster) => {
                                const ca = getClusterAppearance(cluster.id);
                                const displayName = ca.alias || cluster.name;
                                const isFav = orgFavorites.includes(cluster.id);
                                return (
                                  <DropdownMenuItem
                                    key={cluster.id}
                                    onClick={() => handleClusterSelect(cluster)}
                                    className="flex items-center gap-3 py-3 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group"
                                  >
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleFavorite(cluster.id); }}
                                      className="shrink-0 p-0.5 hover:scale-110 transition-transform"
                                      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                                    >
                                      <Star className={cn('h-3.5 w-3.5', isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600 hover:text-amber-400')} />
                                    </button>
                                    {getProviderLogo(cluster.provider) && (
                                      <img
                                        src={getProviderLogo(cluster.provider)!}
                                        alt=""
                                        className="w-5 h-5 shrink-0"
                                        draggable={false}
                                      />
                                    )}
                                    <span
                                      className="block w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: ENV_DOT_COLORS[env] }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-bold text-foreground tracking-tight flex items-center gap-2 flex-wrap">
                                        {displayName}
                                        <span className={cn('text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border', ENV_BADGE_CLASSES[env])}>
                                          {ENV_LABELS[env]}
                                        </span>
                                      </div>
                                      <div className="text-[11px] font-bold text-muted-foreground mt-0.5">{cluster.region} · {cluster.provider}</div>
                                    </div>
                                    {cluster.id === activeCluster.id && (
                                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                      </div>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </div>
                          );
                        })}

                        {/* Ungrouped clusters */}
                        {organizedClusters.ungrouped.length > 0 && (
                          <>
                            {Object.keys(organizedClusters.byEnv).length > 0 && (
                              <div className="px-4 py-2">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Other Clusters</p>
                              </div>
                            )}
                            {organizedClusters.ungrouped.map((cluster) => {
                              const ca = getClusterAppearance(cluster.id);
                              const displayName = ca.alias || cluster.name;
                              const isFav = orgFavorites.includes(cluster.id);
                              return (
                                <DropdownMenuItem
                                  key={cluster.id}
                                  onClick={() => handleClusterSelect(cluster)}
                                  className="flex items-center gap-3 py-3 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group"
                                >
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleFavorite(cluster.id); }}
                                    className="shrink-0 p-0.5 hover:scale-110 transition-transform"
                                    aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                                  >
                                    <Star className={cn('h-3.5 w-3.5', isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600 hover:text-amber-400')} />
                                  </button>
                                  {getProviderLogo(cluster.provider) && (
                                    <img
                                      src={getProviderLogo(cluster.provider)!}
                                      alt=""
                                      className="w-5 h-5 shrink-0"
                                      draggable={false}
                                    />
                                  )}
                                  <div className="relative shrink-0">
                                    <div className="relative w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ca.color }} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-foreground tracking-tight flex items-center gap-2 flex-wrap">
                                      {displayName}
                                      {cluster.provider && (
                                        <span className="text-[9px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-muted-foreground font-black uppercase tracking-widest rounded-full">
                                          {cluster.provider.replace(/-/g, ' ')}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] font-bold text-muted-foreground mt-0.5">{cluster.region} · {cluster.version}</div>
                                  </div>
                                  {cluster.id === activeCluster.id && (
                                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                    </div>
                                  )}
                                </DropdownMenuItem>
                              );
                            })}
                          </>
                        )}

                        {/* No results */}
                        {organizedClusters.total === 0 && clusterSearch.trim() && (
                          <div className="px-4 py-6 text-center">
                            <p className="text-sm text-muted-foreground">No clusters match "{clusterSearch}"</p>
                          </div>
                        )}
                      </div>

                      {/* Footer actions */}
                      <DropdownMenuSeparator className="my-2 bg-border/60" />
                      <DropdownMenuItem onClick={() => navigate('/connect?addCluster=true')} className="gap-3 cursor-pointer py-3 px-4 rounded-2xl text-muted-foreground hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <div className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <span className="text-sm font-bold tracking-tight">Add Cluster</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/fleet')} className="gap-3 cursor-pointer py-3 px-4 rounded-2xl text-muted-foreground hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <div className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <span className="text-sm font-bold tracking-tight">Manage Clusters</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Separator between cluster and tools */}
                <div className="w-px h-4 bg-white/20 mx-1.5 shrink-0" />

                {/* Shell */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      data-testid="shell-trigger"
                      onClick={() => setShellOpen(true)}
                      disabled={!activeCluster}
                      className={HEADER_ICON}
                      aria-label="Open cluster terminal"
                    >
                      <Terminal className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>Cluster Shell</TooltipContent>
                </Tooltip>

                {/* Kubeconfig */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <button className={HEADER_ICON} aria-label="Download kubeconfig">
                          <FileDown className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>Kubeconfig</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-72 rounded-[2rem] p-3 border-none shadow-2xl mt-2 elevation-2">
                    <div className="px-4 py-3 mb-2">
                      <p className="text-[11px] font-black text-muted-foreground uppercase tracking-widest">Download Assets</p>
                    </div>
                    {clusters.map((cluster) => (
                      <DropdownMenuItem
                        key={cluster.id}
                        onClick={() => handleDownloadKubeconfig(cluster.id, cluster.name)}
                        className="flex items-center gap-4 py-4 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className={cn('w-2 h-2 rounded-full shrink-0 shadow-sm', statusColors[cluster.status])} />
                        <span className="flex-1 text-sm font-bold text-foreground/80 truncate">{cluster.name}</span>
                        <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                          <FileDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Tracing pipeline status — click to open setup page */}
                <TracingStatusPill />

                {/* Events Pipeline Health — colored dot with tooltip */}
                <PipelineHealthIndicator />

                {/* Theme Toggle — Light/Dark/System */}
                <ThemeToggle />

                {/* Active Port Forwards — shows count + expandable list with stop buttons */}
                <ActivePortForwardsIndicator />

                {/* Notifications */}
                <NotificationCenter clusterId={currentClusterId} />

                {/* Separator before profile */}
                <div className="w-px h-4 bg-white/20 mx-1.5 shrink-0" />

                {/* Profile */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={cn(
                        'h-9 pl-1 pr-2.5 rounded-lg',
                        'inline-flex items-center gap-2',
                        'hover:bg-white/10',
                        'transition-colors duration-150',
                        'active:scale-[0.97]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30'
                      )}
                      aria-label="User menu"
                    >
                      <Avatar className="h-6 w-6 shrink-0 rounded-md">
                        <AvatarImage src="" />
                        <AvatarFallback className="bg-primary/5 text-[10px] font-black text-primary uppercase">
                          AD
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[12px] font-medium hidden lg:inline text-white/80">Admin</span>
                      <ChevronDown className="h-3 w-3 text-white/40 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 elevation-2">
                    <div className="px-3 py-2.5 border-b border-border/50 dark:border-border/50">
                      <p className="text-sm font-medium text-foreground">Admin User</p>
                      <p className="text-xs text-muted-foreground mt-0.5">admin@kubilitics.com</p>
                    </div>
                    <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 py-2.5 cursor-pointer">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/connect?addCluster=true')} className="gap-2 py-2.5 cursor-pointer">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Add Cluster</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 py-2.5 cursor-pointer text-destructive focus:text-destructive"
                      onClick={() => setLogoutConfirmOpen(true)}
                      disabled={isLoggingOut}
                    >
                      <LogOut className="h-4 w-4" />
                      <span className="text-sm">{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

          </div>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Logout confirmation dialog */}
      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign Out</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out? This will disconnect from all clusters and clear your session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoggingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoggingOut ? 'Signing out...' : 'Sign Out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Production cluster confirmation dialog */}
      <AlertDialog open={!!prodConfirmCluster} onOpenChange={(open) => { if (!open) setProdConfirmCluster(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="block w-3 h-3 rounded-full bg-red-500" />
              Production Cluster
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are switching to <span className="font-semibold text-foreground">{prodConfirmCluster?.name}</span>, which is tagged as a <span className="font-semibold text-red-600 dark:text-red-400">production</span> cluster. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (prodConfirmCluster) doSwitchCluster(prodConfirmCluster);
                setProdConfirmCluster(null);
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Switch to Production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {activeCluster && currentClusterId && shellOpen && (
        <Suspense fallback={null}>
          <ClusterShellPanel
            open={shellOpen}
            onOpenChange={setShellOpen}
            clusterId={currentClusterId}
            clusterName={activeCluster.name}
            backendBaseUrl={backendBaseUrl}
          />
        </Suspense>
      )}

      {/* Wizards removed — resource creation handled by ResourceCreator in list pages */}

    </>
  );
}
