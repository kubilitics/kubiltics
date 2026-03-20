/**
 * Kubilitics Header — Clean, balanced navigation bar.
 *
 * Layout: Logo zone (sidebar column) | Search | Cluster · Shell · Kubeconfig · Connect | Notifications | Profile
 * - Logo zone: w-72, sidebar-style background, fills header height
 * - Search resources: always-visible trigger in header (core feature)
 * - All controls sized for clarity; labels visible; Notifications and Profile are real controls
 */
import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { isTauri } from '@/lib/tauri';
import { useClusterStore } from '@/stores/clusterStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { GlobalSearch } from './GlobalSearch';
import { ClusterShellPanel } from '@/components/shell';
import { DeploymentWizard, ServiceWizard, ConfigMapWizard, SecretWizard } from '@/components/wizards';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { getClusterKubeconfig } from '@/services/backendApiClient';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOfflineMode } from '@/hooks/useOfflineMode';
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

/** Header height — keep in sync with Sidebar's calc(100vh - 5rem) */
export const HEADER_HEIGHT_CLASS = 'h-20';

/* ─── Design tokens: balanced, readable controls ─── */

/** Secondary action — Cluster (same treatment) */
const BTN = cn(
  'h-11 px-5 rounded-xl',
  'inline-flex items-center justify-center gap-2.5',
  'text-[13px] font-semibold leading-none',
  'border border-slate-200/50 bg-white/40 text-slate-700',
  'dark:border-slate-700/50 dark:bg-slate-800/40 dark:text-slate-200',
  'hover:bg-white hover:border-slate-300 hover:shadow-apple hover:translate-y-[-0.5px]',
  'dark:hover:bg-slate-700/60 dark:hover:border-slate-600',
  'transition-all duration-300 ease-spring',
  'active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
);

/** Feature actions — Shell, Kubeconfig: clear button treatment and value proposition */
const FEATURE_BTN = cn(
  'h-11 px-5 rounded-xl',
  'inline-flex items-center justify-center gap-2.5',
  'text-[13px] font-bold leading-none',
  'border border-slate-200/40 bg-slate-50/40 text-slate-800',
  'dark:border-slate-700/40 dark:bg-slate-800/40 dark:text-slate-200',
  'hover:bg-white hover:border-primary/20 hover:shadow-apple-lg hover:translate-y-[-0.5px]',
  'dark:hover:bg-slate-700/60 dark:hover:border-primary/30',
  'transition-all duration-300 ease-spring',
  'active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
);

/** Icon or labelled button (Notifications, etc.) */
const ICON_BTN = cn(
  'h-11 min-w-[2.75rem] rounded-xl',
  'inline-flex items-center justify-center gap-2.5',
  'text-slate-500 dark:text-slate-400',
  'hover:bg-slate-100/60 hover:text-slate-900 hover:translate-y-[-0.5px]',
  'dark:hover:bg-slate-700/60 dark:hover:text-slate-100',
  'transition-all duration-300 ease-spring',
  'active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
);

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
  const [shellOpen, setShellOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState<'deployment' | 'service' | 'configmap' | 'secret' | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const queryClient = useQueryClient();

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
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const { backendReachable } = useOfflineMode();

  // Determine backend status: healthy or unreachable (no intermediate "warning" — avoids flicker)
  const backendStatus =
    !isBackendConfigured() ? null :
      backendReachable ? 'healthy' : 'error';

  const handleWizardSubmit = (_yaml: string) => {
    toast.success('Resource YAML generated successfully!');
    setWizardOpen(null);
  };

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
      <header className={cn(HEADER_HEIGHT_CLASS, 'border-b border-slate-100 dark:border-slate-800 bg-white/60 dark:bg-[hsl(228,14%,9%)]/80 backdrop-blur-3xl shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all duration-300 sticky top-0 z-50')} role="banner" data-tauri-drag-region>
        <div className="flex items-center h-full w-full">

          {/* ──── Logo zone: icon mark + wordmark, Apple-quality sizing ──── */}
          {/* Tauri overlay title bar: extra left padding for macOS traffic lights */}
          <div className={cn(
            'shrink-0 flex items-center h-full bg-slate-50/20 dark:bg-slate-900/20 border-r border-slate-100/60 dark:border-slate-800/60 transition-all duration-300',
            collapsed ? 'w-[5.5rem] justify-center px-0' : 'w-72 justify-start px-5',
            isTauri() && 'pl-[78px]'
          )} data-tauri-drag-region>
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-xl p-1.5 transition-all press-effect"
              aria-label="Go to Dashboard"
            >
              <BrandLogo
                mark
                height={40}
                className="shrink-0 rounded-[10px] shadow-sm group-hover:shadow-md group-hover:scale-[1.04] transition-all duration-300"
              />
              {!collapsed && (
                <span className="text-[15px] font-semibold tracking-[0.08em] text-slate-700 dark:text-slate-200 whitespace-nowrap select-none transition-opacity duration-300">
                  KUBILITICS
                </span>
              )}
            </button>
          </div>

          {/* ──── Main bar ──── */}
          <div className="flex-1 min-w-0 flex items-center gap-2 md:gap-4 px-3 md:px-6">
            {/* Search resources — global search: refined command palette trigger */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={cn(
                'flex-1 max-w-[140px] sm:max-w-xs md:max-w-md lg:max-w-xl h-11 px-3 md:px-5 flex items-center gap-3 md:gap-4 rounded-xl',
                'bg-slate-100/40 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 text-slate-400 dark:text-slate-500',
                'hover:bg-slate-100/60 hover:border-slate-200 hover:text-slate-600 dark:hover:bg-slate-700/40 dark:hover:border-slate-600 dark:hover:text-slate-300',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/10',
                'transition-all duration-300 group press-effect'
              )}
            >
              <Search className="h-4 w-4 shrink-0 group-hover:text-primary transition-colors duration-300" />
              <span className="flex-1 text-left text-[13px] font-semibold tracking-tight hidden md:block">Search resources...</span>
              <kbd className="hidden sm:inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200/60 bg-white px-2.5 font-mono text-[9px] font-bold text-slate-400 shrink-0 shadow-sm">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>

            {/* Project context badge when in project scope */}
            {activeProject && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20">
                <span className="text-xs font-semibold text-primary truncate max-w-[120px]" title={activeProject.name}>
                  {activeProject.name}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Project</span>
              </div>
            )}

            {/* Right group: pushed to the edge with even spacing between items */}
            <div className="flex items-center gap-2 lg:gap-4 shrink-0 ml-auto">
              <TooltipProvider delayDuration={300}>

                {/* Cluster selector — single status dot (unified cluster + backend) */}
                {activeCluster && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className={cn(BTN, 'shrink-0 max-w-[160px] lg:max-w-[240px] group press-effect')} aria-label="Select cluster">
                        <span className={cn(
                          'block w-2 h-2 rounded-full shrink-0',
                          // If backend is unhealthy, show that; otherwise show cluster status
                          backendStatus === 'error' ? 'bg-red-500' :
                            backendStatus === 'warning' ? 'bg-amber-500' :
                              statusColors[activeCluster.status]
                        )} />
                        <span className="truncate text-base font-bold tracking-tight">{activeCluster.name}</span>
                        <ChevronDown className="h-5 w-5 text-slate-400 group-hover:text-slate-600 transition-colors shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[320px] rounded-[2.5rem] p-4 border-none shadow-2xl mt-2 animate-in fade-in zoom-in-95 duration-200 elevation-2">
                      <div className="px-4 py-3 mb-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Compute Context</p>
                      </div>
                      {clusters.map((cluster) => (
                        <DropdownMenuItem
                          key={cluster.id}
                          onClick={() => {
                            const isSwitching = cluster.id !== (currentClusterId ?? activeCluster?.id);
                            setActiveCluster(cluster);
                            if (!isDemo) setCurrentClusterId(cluster.id);
                            // When switching clusters: clear stale queries and navigate to
                            // dashboard so we don't stay on a detail page referencing the
                            // old cluster's resources (which would 404).
                            if (isSwitching) {
                              queryClient.removeQueries({ queryKey: ['k8s'] });
                              queryClient.removeQueries({ queryKey: ['backend', 'resources'] });
                              queryClient.removeQueries({ queryKey: ['backend', 'resource'] });
                              queryClient.removeQueries({ queryKey: ['backend', 'events'] });
                              navigate('/dashboard');
                            }
                          }}
                          className="flex items-center gap-4 py-4 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group"
                        >
                          <div className="relative shrink-0">
                            <div className={cn('absolute inset-0 blur-[4px] opacity-40 rounded-full', statusColors[cluster.status])} />
                            <div className={cn('relative w-3 h-3 rounded-full border-2 border-white', statusColors[cluster.status])} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
                              {cluster.name}
                              {cluster.provider && (
                                <span className="text-[9px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest rounded-full">
                                  {cluster.provider.replace(/-/g, ' ')}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">{cluster.region} · {cluster.version}</div>
                          </div>
                          {cluster.id === activeCluster.id && (
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                            </div>
                          )}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator className="my-2 bg-slate-100/60 dark:bg-slate-700/60" />
                      <DropdownMenuItem onClick={() => navigate('/connect?addCluster=true')} className="gap-3 cursor-pointer py-4 px-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                          <Plus className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        </div>
                        <span className="text-sm font-bold tracking-tight">Add Cluster</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Shell — clear feature button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      data-testid="shell-trigger"
                      onClick={() => setShellOpen(true)}
                      disabled={!activeCluster}
                      className={cn(FEATURE_BTN, 'press-effect')}
                      aria-label="Open cluster terminal (Shell)"
                    >
                      <Terminal className="h-5 w-5 shrink-0 text-primary/70" />
                      <span className="hidden xl:inline">Shell</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>Open cluster terminal</TooltipContent>
                </Tooltip>

                {/* Kubeconfig — clear feature button */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <button className={cn(FEATURE_BTN, 'press-effect')} aria-label="Download kubeconfig">
                          <FileDown className="h-5 w-5 shrink-0 text-primary/70" />
                          <span className="hidden xl:inline">Kubeconfig</span>
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>Download kubeconfig</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-72 rounded-[2rem] p-3 border-none shadow-2xl mt-2 elevation-2">
                    <div className="px-4 py-3 mb-2">
                      <p className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Download Assets</p>
                    </div>
                    {clusters.map((cluster) => (
                      <DropdownMenuItem
                        key={cluster.id}
                        onClick={() => handleDownloadKubeconfig(cluster.id, cluster.name)}
                        className="flex items-center gap-4 py-4 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <div className={cn('w-2 h-2 rounded-full shrink-0 shadow-sm', statusColors[cluster.status])} />
                        <span className="flex-1 text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{cluster.name}</span>
                        <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                          <FileDown className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Theme Toggle — Light/Dark/System */}
                <ThemeToggle />

                {/* Notifications */}
                <NotificationCenter clusterId={currentClusterId} />

                {/* Profile — avatar + label + chevron, real account control */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={cn(
                        'h-12 pl-2 pr-4 rounded-2xl',
                        'inline-flex items-center gap-3 group',
                        'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-primary/20 dark:hover:border-primary/30',
                        'hover:translate-y-[-1px] transition-all duration-300 ease-out',
                        'active:scale-[0.98]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 press-effect'
                      )}
                      aria-label="User menu"
                    >
                      <Avatar className="h-9 w-9 shrink-0 rounded-[0.9rem] border border-slate-100 shadow-sm">
                        <AvatarImage src="" />
                        <AvatarFallback className="bg-primary/5 text-[10px] font-black text-primary uppercase">
                          AD
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs font-black tracking-widest hidden xl:inline uppercase text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors">Admin</span>
                      <ChevronDown className="h-4 w-4 text-slate-400 shrink-0 group-hover:text-primary transition-colors" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 elevation-2">
                    <div className="px-3 py-2.5 border-b border-border/50 dark:border-border/50">
                      <p className="text-sm font-medium text-foreground">Admin User</p>
                      <p className="text-xs text-muted-foreground dark:text-slate-400 mt-0.5">admin@kubilitics.com</p>
                    </div>
                    <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 py-2.5 cursor-pointer">
                      <Settings className="h-4 w-4 text-muted-foreground dark:text-slate-400" />
                      <span className="text-sm">Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/connect?addCluster=true')} className="gap-2 py-2.5 cursor-pointer">
                      <Plus className="h-4 w-4 text-muted-foreground dark:text-slate-400" />
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

              </TooltipProvider>
            </div>
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

      {activeCluster && currentClusterId && (
        <ClusterShellPanel
          open={shellOpen}
          onOpenChange={setShellOpen}
          clusterId={currentClusterId}
          clusterName={activeCluster.name}
          backendBaseUrl={backendBaseUrl}
        />
      )}

      {wizardOpen === 'deployment' && <DeploymentWizard onClose={() => setWizardOpen(null)} onSubmit={handleWizardSubmit} />}
      {wizardOpen === 'service' && <ServiceWizard onClose={() => setWizardOpen(null)} onSubmit={handleWizardSubmit} />}
      {wizardOpen === 'configmap' && <ConfigMapWizard onClose={() => setWizardOpen(null)} onSubmit={handleWizardSubmit} />}
      {wizardOpen === 'secret' && <SecretWizard onClose={() => setWizardOpen(null)} onSubmit={handleWizardSubmit} />}

    </>
  );
}
