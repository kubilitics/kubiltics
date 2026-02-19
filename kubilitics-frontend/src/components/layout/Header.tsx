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
  Bell,
  ChevronDown,
  Command,
  Terminal,
  FileDown,
  Settings,
  LogOut,
  Plus,
  Unplug,
  Zap,
} from 'lucide-react';
import { KubernetesLogo } from '../icons/KubernetesIcons';
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
import { getClusterKubeconfig } from '@/services/backendApiClient';
import { getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAIStatus } from '@/hooks/useAIStatus';
import { useAINotifications } from '@/hooks/useAINotifications';
import { useApprovals } from '@/hooks/useAutonomy';

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
  'h-12 px-6 rounded-2xl',
  'inline-flex items-center justify-center gap-3',
  'text-base font-semibold leading-none',
  'border border-slate-200/60 bg-white/50 text-slate-700',
  'hover:bg-white hover:border-slate-300 hover:shadow-sm hover:translate-y-[-1px]',
  'transition-all duration-300 ease-out',
  'active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
);

/** Feature actions — Shell, Kubeconfig: clear button treatment and value proposition */
const FEATURE_BTN = cn(
  'h-12 px-6 rounded-2xl',
  'inline-flex items-center justify-center gap-3',
  'text-base font-bold leading-none',
  'border border-slate-200/50 bg-slate-50/50 text-slate-800',
  'hover:bg-white hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 hover:translate-y-[-1px]',
  'transition-all duration-300 ease-out',
  'active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
);

/** Icon or labelled button (Notifications, etc.) */
const ICON_BTN = cn(
  'h-12 min-w-[3rem] rounded-2xl',
  'inline-flex items-center justify-center gap-3',
  'text-slate-500',
  'hover:bg-slate-100/80 hover:text-slate-900 hover:translate-y-[-1px]',
  'transition-all duration-300 ease-out',
  'active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
);

export function Header() {
  const navigate = useNavigate();
  const { activeCluster, clusters, setActiveCluster, isDemo } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState<'deployment' | 'service' | 'configmap' | 'secret' | null>(null);

  // E-PLAT-004: AI status indicator
  const aiStatus = useAIStatus();
  // E-PLAT-005: Proactive AI anomaly notifications
  useAINotifications();
  // E-PLAT-003: Real pending AI action approval count
  const { pendingCount } = useApprovals('default', 30_000);

  const handleWizardSubmit = (yaml: string) => {
    console.log('Created resource:', yaml);
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
      URL.revokeObjectURL(url);
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
      <header className={cn(HEADER_HEIGHT_CLASS, 'border-b border-slate-100 bg-white/70 backdrop-blur-2xl sticky top-0 z-50 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-300')}>
        <div className="flex items-center h-full w-full">

          {/* ──── Logo zone: prominent Kubilitics branding ──── */}
          <div className="w-[300px] shrink-0 flex items-center justify-center h-full bg-slate-50/40 border-r border-slate-100/60 px-6">
            <button
              onClick={() => navigate('/home')}
              className="flex items-center gap-5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-2xl p-2 -m-2 transition-all"
              aria-label="Go to Home"
            >
              <div className="relative group/logo">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative flex items-center justify-center w-[52px] h-[52px] rounded-2xl bg-primary shadow-2xl shadow-primary/20 group-hover:scale-105 transition-all duration-500">
                  <KubernetesLogo size={32} className="text-white group-hover:rotate-12 transition-transform duration-500" />
                </div>
              </div>
              <span className="text-2xl font-black tracking-[-0.03em] text-primary select-none transition-colors">
                Kubilitics
              </span>
            </button>
          </div>

          {/* ──── Main bar ──── */}
          <div className="flex-1 min-w-0 flex items-center gap-6 pl-10 pr-10">
            {/* Search resources — global search: refined command palette trigger */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={cn(
                'flex-1 max-w-xl h-12 px-5 flex items-center gap-4 rounded-2xl',
                'bg-slate-100/50 border border-slate-200/40 text-slate-400',
                'hover:bg-slate-100 hover:border-slate-300 hover:text-slate-600',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/10',
                'transition-all duration-300 group'
              )}
            >
              <Search className="h-5 w-5 shrink-0 group-hover:text-primary transition-colors duration-300" />
              <span className="flex-1 text-left text-sm font-bold tracking-tight">Search resources...</span>
              <kbd className="hidden sm:inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 font-mono text-[10px] font-black text-slate-400 shrink-0 shadow-sm">
                <Command className="h-3 w-3" />K
              </kbd>
            </button>

            {/* Right group: pushed to the edge with even spacing between items */}
            <div className="flex items-center gap-4 shrink-0 ml-auto">
              <TooltipProvider delayDuration={300}>

                {/* Cluster selector */}
                {activeCluster && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className={cn(BTN, 'shrink-0 max-w-[280px] group')}>
                        <div className="relative">
                          <span className={cn('absolute inset-0 blur-sm opacity-50 rounded-full', statusColors[activeCluster.status])} />
                          <span className={cn('relative block w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white', statusColors[activeCluster.status])} />
                        </div>
                        <span className="truncate text-base font-bold tracking-tight">{activeCluster.name}</span>
                        <ChevronDown className="h-5 w-5 text-slate-400 group-hover:text-slate-600 transition-colors shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[320px] rounded-[2.5rem] p-4 border-none shadow-2xl mt-2 animate-in fade-in zoom-in-95 duration-200">
                      <div className="px-4 py-3 mb-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Compute Context</p>
                      </div>
                      {clusters.map((cluster) => (
                        <DropdownMenuItem
                          key={cluster.id}
                          onClick={() => {
                            setActiveCluster(cluster);
                            if (!isDemo) setCurrentClusterId(cluster.id);
                          }}
                          className="flex items-center gap-4 py-4 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 transition-all group"
                        >
                          <div className="relative shrink-0">
                            <div className={cn('absolute inset-0 blur-[4px] opacity-40 rounded-full', statusColors[cluster.status])} />
                            <div className={cn('relative w-3 h-3 rounded-full border-2 border-white', statusColors[cluster.status])} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-2">
                              {cluster.name}
                              {cluster.provider && (
                                <span className="text-[9px] px-2 py-0.5 bg-slate-100 text-slate-500 font-black uppercase tracking-widest rounded-full">
                                  {cluster.provider.replace(/-/g, ' ')}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-bold text-slate-400 mt-0.5">{cluster.region} · {cluster.version}</div>
                          </div>
                          {cluster.id === activeCluster.id && (
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                            </div>
                          )}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator className="my-2 bg-slate-100/60" />
                      <DropdownMenuItem onClick={() => navigate('/setup/kubeconfig')} className="gap-3 cursor-pointer py-4 px-4 rounded-2xl text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors">
                        <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center">
                          <Plus className="h-4 w-4" />
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
                      className={FEATURE_BTN}
                    >
                      <Terminal className="h-5 w-5 shrink-0 text-primary/70" />
                      <span>Shell</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>Open cluster terminal</TooltipContent>
                </Tooltip>

                {/* Kubeconfig — clear feature button */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <button className={FEATURE_BTN}>
                          <FileDown className="h-5 w-5 shrink-0 text-primary/70" />
                          <span>Kubeconfig</span>
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>Download kubeconfig</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-72 rounded-[2rem] p-3 border-none shadow-2xl mt-2">
                    <div className="px-4 py-3 mb-2">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Download Assets</p>
                    </div>
                    {clusters.map((cluster) => (
                      <DropdownMenuItem
                        key={cluster.id}
                        onClick={() => handleDownloadKubeconfig(cluster.id, cluster.name)}
                        className="flex items-center gap-4 py-4 px-4 cursor-pointer rounded-2xl hover:bg-slate-50 transition-colors"
                      >
                        <div className={cn('w-2 h-2 rounded-full shrink-0 shadow-sm', statusColors[cluster.status])} />
                        <span className="flex-1 text-sm font-bold text-slate-700 truncate">{cluster.name}</span>
                        <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center">
                          <FileDown className="h-4 w-4 text-slate-500" />
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* AI Status Indicator — E-PLAT-004 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(
                        'inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold transition-all duration-200 border select-none',
                        aiStatus.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                          : aiStatus.status === 'unconfigured'
                            ? 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700'
                            : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'
                      )}
                      aria-label={`AI status: ${aiStatus.status}`}
                      onClick={() => navigate('/settings')}
                    >
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full shrink-0',
                          aiStatus.checking
                            ? 'bg-slate-300 animate-pulse'
                            : aiStatus.status === 'active'
                              ? 'bg-emerald-500'
                              : aiStatus.status === 'unconfigured'
                                ? 'bg-slate-400'
                                : 'bg-red-500'
                        )}
                      />
                      <Zap className="h-3 w-3 shrink-0" />
                      <span className="hidden sm:inline">
                        {aiStatus.status === 'active'
                          ? 'AI Active'
                          : aiStatus.status === 'unconfigured'
                            ? 'AI Setup'
                            : 'AI Off'}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>
                    {aiStatus.status === 'active'
                      ? `AI Active — ${aiStatus.provider ?? 'LLM'} ${aiStatus.model ? `(${aiStatus.model})` : ''}`
                      : aiStatus.status === 'unconfigured'
                        ? 'AI not configured — click to set up in Settings'
                        : `AI unavailable${aiStatus.errorMessage ? `: ${aiStatus.errorMessage}` : ''}`}
                  </TooltipContent>
                </Tooltip>

                {/* Notifications — pending AI actions badge (E-PLAT-003) */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(ICON_BTN, 'px-4')}
                      aria-label={pendingCount > 0 ? `${pendingCount} pending AI actions` : 'Notifications'}
                      onClick={() => navigate('/settings?tab=autonomy')}
                    >
                      <div className="relative shrink-0 flex items-center justify-center h-9 w-9 rounded-xl bg-slate-100 group-hover:bg-white transition-colors">
                        <Bell className="h-4 w-4" />
                        {pendingCount > 0 ? (
                          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-amber-500 border-2 border-white shadow-sm flex items-center justify-center text-[9px] font-black text-white px-0.5">
                            {pendingCount > 9 ? '9+' : pendingCount}
                          </span>
                        ) : (
                          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
                        )}
                      </div>
                      <span className="hidden xl:inline text-sm font-bold tracking-tight">
                        {pendingCount > 0 ? `${pendingCount} Pending` : 'Updates'}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>
                    {pendingCount > 0
                      ? `${pendingCount} AI action${pendingCount > 1 ? 's' : ''} awaiting approval`
                      : 'System Notifications'}
                  </TooltipContent>
                </Tooltip>

                {/* Profile — avatar + label + chevron, real account control */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={cn(
                        'h-12 pl-2 pr-4 rounded-2xl',
                        'inline-flex items-center gap-3 group',
                        'bg-white border border-slate-200 shadow-sm hover:shadow-md hover:border-primary/20',
                        'hover:translate-y-[-1px] transition-all duration-300 ease-out',
                        'active:scale-[0.98]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20'
                      )}
                      aria-label="User menu"
                    >
                      <Avatar className="h-9 w-9 shrink-0 rounded-[0.9rem] border border-slate-100 shadow-sm">
                        <AvatarImage src="" />
                        <AvatarFallback className="bg-primary/5 text-[10px] font-black text-primary uppercase">
                          AD
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs font-black tracking-widest hidden sm:inline uppercase text-slate-700 group-hover:text-primary transition-colors">Admin</span>
                      <ChevronDown className="h-4 w-4 text-slate-400 shrink-0 group-hover:text-primary transition-colors" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-3 py-2.5 border-b border-border/50">
                      <p className="text-sm font-medium text-foreground">Admin User</p>
                      <p className="text-xs text-muted-foreground mt-0.5">admin@kubilitics.com</p>
                    </div>
                    <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 py-2.5 cursor-pointer">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/setup/kubeconfig')} className="gap-2 py-2.5 cursor-pointer">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Add Cluster</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 py-2.5 cursor-pointer text-destructive focus:text-destructive"
                      onClick={() => {
                        const { signOut } = useClusterStore.getState();
                        const { clearBackend } = useBackendConfigStore.getState();
                        signOut();
                        clearBackend();
                        navigate('/');
                      }}
                    >
                      <LogOut className="h-4 w-4" />
                      <span className="text-sm">Sign Out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

              </TooltipProvider>
            </div>
          </div>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

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
