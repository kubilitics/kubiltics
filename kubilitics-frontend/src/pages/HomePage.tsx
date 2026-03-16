import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Boxes,
  Cpu,
  FolderKanban,
  Download,
  Focus,
  HardDrive,
  Loader2,
  MoreVertical,
  Plus,
  Server,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { useProjectStore } from '@/stores/projectStore';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useClusterOverview } from '@/hooks/useClusterOverview';
import { useClusterUtilization } from '@/hooks/useClusterUtilization';
import { useHealthScore } from '@/hooks/useHealthScore';
import { HealthRing } from '@/components/HealthRing';
import { AISetupModal } from '@/features/ai/AISetupModal';
import { loadLLMProviderConfig } from '@/services/aiService';
import { getProjects, deleteCluster, deleteProject, type BackendProject, type BackendCluster } from '@/services/backendApiClient';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog';
import { cn } from '@/lib/utils';

/* ─── Animation Presets ─── */
const stagger = {
  container: {
    animate: { transition: { staggerChildren: 0.06 } },
  },
  item: {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

/* ─── Section Header (matches DashboardLayout) ─── */
function SectionHeader({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-5">
      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-lg bg-muted/80 dark:bg-muted/40 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-semibold text-foreground/80 tracking-wide uppercase">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = useMemo(() => getEffectiveBackendBaseUrl(storedBackendUrl), [storedBackendUrl]);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const setActiveCluster = useClusterStore((s) => s.setActiveCluster);

  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [settingsProject, setSettingsProject] = useState<any>(null);
  const [clusterToRemove, setClusterToRemove] = useState<BackendCluster | null>(null);
  const [projectToRemove, setProjectToRemove] = useState<BackendProject | null>(null);
  const queryClient = useQueryClient();
  const aiConfig = loadLLMProviderConfig();
  const isAiEnabled = !!(aiConfig && aiConfig.provider && aiConfig.provider !== ('none' as any));

  const { data: clustersFromBackend } = useClustersFromBackend();
  const clusters = useMemo(() => clustersFromBackend || [], [clustersFromBackend]);

  const circuitOpen = useBackendCircuitOpen();
  const currentClusterId = useActiveClusterId();
  const { data: overview } = useClusterOverview(currentClusterId ?? undefined);
  const { utilization: clusterUtil } = useClusterUtilization(currentClusterId ?? undefined);
  const health = useHealthScore();

  const deleteClusterMutation = useMutation({
    mutationFn: async (cluster: BackendCluster) => {
      await deleteCluster(backendBaseUrl, cluster.id);
    },
    onSuccess: (_, cluster) => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters', backendBaseUrl] });
      if (cluster.id === currentClusterId) {
        const remaining = clusters.filter((c) => c.id !== cluster.id);
        setCurrentClusterId(remaining[0]?.id ?? null);
        if (remaining[0]) {
          setActiveCluster(backendClusterToCluster(remaining[0]));
        }
      }
      setClusterToRemove(null);
      toast.success('Cluster removed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to remove cluster: ${err.message}`);
    },
  });

  const { data: projectsFromBackend, isLoading: isProjectsLoading, isError: isProjectsError, error: projectsError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => getProjects(backendBaseUrl),
    enabled: isBackendConfigured && !circuitOpen,
  });
  const projects = useMemo(() => projectsFromBackend || [], [projectsFromBackend]);

  const deleteProjectMutation = useMutation({
    mutationFn: async (project: BackendProject) => {
      await deleteProject(backendBaseUrl, project.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectToRemove(null);
      toast.success('Project removed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to remove project: ${err.message}`);
    },
  });

  const filteredClusters = useMemo(() => {
    return clusters.filter(
      (c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.provider?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [clusters, searchQuery]);

  const activeClusters = clusters.length;
  const activeNodes = useMemo(
    () => clusters.reduce((acc, c) => acc + (c.node_count || 0), 0),
    [clusters]
  );
  const cpuUtil = clusterUtil?.metricsAvailable ? clusterUtil.cpuPercent : null;
  const memUtil = clusterUtil?.metricsAvailable ? clusterUtil.memoryPercent : null;

  /* ─── Color Helpers ─── */
  const cpuBarColor = (cpuUtil ?? 0) > 80 ? 'bg-rose-500' : (cpuUtil ?? 0) > 50 ? 'bg-amber-500' : 'bg-blue-500';
  const memBarColor = (memUtil ?? 0) > 80 ? 'bg-rose-500' : (memUtil ?? 0) > 50 ? 'bg-amber-500' : 'bg-indigo-500';

  /* ─── Cluster card click handler ─── */
  const handleClusterClick = (cluster: BackendCluster) => {
    setCurrentClusterId(cluster.id);
    setActiveCluster(backendClusterToCluster(cluster));
    navigate('/dashboard');
  };

  return (
    <div className="page-container" role="main" aria-label="Systems overview page">
      <div className="page-inner">

        {/* ════════════ Hero Header ════════════ */}
        <motion.header
          className="page-header"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-lg">
            Here's what's happening across your clusters and projects.
          </p>
        </motion.header>

        {/* ════════════ Metrics Strip ════════════ */}
        <motion.section
          className="page-section"
          initial="initial"
          animate="animate"
          variants={stagger.container}
          role="region"
          aria-label="Health metrics dashboard"
          aria-live="polite"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

            {/* ── Health Score ── */}
            <motion.div
              variants={stagger.item}
              className={cn(
                "relative bg-white dark:bg-[hsl(228,14%,11%)]",
                "border border-slate-200 dark:border-slate-700 rounded-2xl",
                "shadow p-5",
              )}
              role="status"
              aria-label={`Health score: ${health.score} out of 100`}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <HealthRing score={health.score} size={72} strokeWidth={6} aria-valuenow={health.score} aria-valuemin={0} aria-valuemax={100} />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Health</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{health.insight}</p>
                </div>
              </div>
            </motion.div>

            {/* ── Clusters ── */}
            <motion.div
              variants={stagger.item}
              className={cn(
                "relative bg-white dark:bg-[hsl(228,14%,11%)]",
                "border border-slate-200 dark:border-slate-700 rounded-2xl",
                "shadow p-5 flex items-center gap-4",
              )}
              role="status"
              aria-label={`${activeClusters} active clusters`}
            >
              <div className="h-11 w-11 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                <Server className="h-5 w-5 text-blue-500 dark:text-blue-400" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Clusters</p>
                <p className="text-2xl font-bold tabular-nums text-foreground mt-0.5 leading-none">{activeClusters}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Active
                </p>
              </div>
            </motion.div>

            {/* ── Nodes ── */}
            <motion.div
              variants={stagger.item}
              className={cn(
                "relative bg-white dark:bg-[hsl(228,14%,11%)]",
                "border border-slate-200 dark:border-slate-700 rounded-2xl",
                "shadow p-5 flex items-center gap-4",
              )}
              role="status"
              aria-label={`${activeNodes} active nodes`}
            >
              <div className="h-11 w-11 rounded-xl bg-teal-50 dark:bg-teal-500/10 flex items-center justify-center shrink-0">
                <Activity className="h-5 w-5 text-teal-600 dark:text-teal-400" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nodes</p>
                <p className="text-2xl font-bold tabular-nums text-foreground mt-0.5 leading-none">{activeNodes}</p>
                <p className="text-xs text-muted-foreground mt-1">Provisioned</p>
              </div>
            </motion.div>

            {/* ── CPU Usage ── */}
            <motion.div
              variants={stagger.item}
              className={cn(
                "relative rounded-2xl shadow overflow-hidden",
                cpuUtil != null
                  ? "bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200 dark:border-slate-700 p-5"
                  : "bg-gradient-to-br from-blue-50 via-white to-sky-50 dark:from-blue-950/40 dark:via-[hsl(228,14%,11%)] dark:to-sky-950/30 border border-blue-200/50 dark:border-blue-500/20 p-5 cursor-pointer group hover:shadow-md hover:border-blue-300/60 dark:hover:border-blue-500/30 transition-all duration-300",
              )}
              role="status"
              aria-label={cpuUtil != null ? `CPU usage at ${Math.round(cpuUtil)} percent` : 'CPU usage unavailable — click to install metrics-server'}
              {...(cpuUtil == null ? {
                onClick: () => navigate('/addons?search=metrics-server'),
                tabIndex: 0,
                onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && navigate('/addons?search=metrics-server'),
              } : {})}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center",
                  cpuUtil != null ? "bg-blue-50 dark:bg-blue-500/10" : "bg-blue-100/80 dark:bg-blue-500/20"
                )}>
                  <Cpu className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" strokeWidth={1.75} />
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">CPU Usage</p>
                {cpuUtil != null && (
                  <span className="ml-auto text-sm font-bold tabular-nums text-foreground">{Math.round(cpuUtil)}%</span>
                )}
              </div>
              {cpuUtil != null ? (
                <>
                  <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, cpuUtil)}%` }}
                      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                      className={cn("h-full rounded-full", cpuBarColor)}
                      role="progressbar"
                      aria-valuenow={Math.round(cpuUtil)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                    <span>{(clusterUtil!.cpuUsedMillicores / 1000).toFixed(1)} Cores</span>
                    <span>of {(clusterUtil!.cpuTotalMillicores / 1000).toFixed(1)} Cores</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="relative h-[52px] w-[52px] shrink-0">
                      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-blue-100 dark:text-blue-900/50" />
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="97.4 97.4" strokeDashoffset="97.4" strokeLinecap="round" className="text-blue-300/50 dark:text-blue-600/40 animate-pulse" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-blue-400/60 dark:text-blue-500/50">—</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-snug">
                        Metrics server not detected
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                        Required for live CPU data
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-blue-600 dark:text-blue-400 group-hover:gap-2.5 transition-all duration-300">
                    <Download className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                    <span className="text-[11px] font-semibold">Install metrics-server</span>
                    <ArrowRight className="h-3 w-3 shrink-0 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" strokeWidth={2.5} />
                  </div>
                </>
              )}
            </motion.div>

            {/* ── Memory Usage ── */}
            <motion.div
              variants={stagger.item}
              className={cn(
                "relative rounded-2xl shadow overflow-hidden",
                memUtil != null
                  ? "bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200 dark:border-slate-700 p-5"
                  : "bg-gradient-to-br from-violet-50 via-white to-purple-50 dark:from-violet-950/40 dark:via-[hsl(228,14%,11%)] dark:to-purple-950/30 border border-violet-200/50 dark:border-violet-500/20 p-5 cursor-pointer group hover:shadow-md hover:border-violet-300/60 dark:hover:border-violet-500/30 transition-all duration-300",
              )}
              role="status"
              aria-label={memUtil != null ? `Memory usage at ${Math.round(memUtil)} percent` : 'Memory usage unavailable — click to install metrics-server'}
              {...(memUtil == null ? {
                onClick: () => navigate('/addons?search=metrics-server'),
                tabIndex: 0,
                onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && navigate('/addons?search=metrics-server'),
              } : {})}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center",
                  memUtil != null ? "bg-violet-50 dark:bg-violet-500/10" : "bg-violet-100/80 dark:bg-violet-500/20"
                )}>
                  <HardDrive className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" strokeWidth={1.75} />
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Memory Usage</p>
                {memUtil != null && (
                  <span className="ml-auto text-sm font-bold tabular-nums text-foreground">{Math.round(memUtil)}%</span>
                )}
              </div>
              {memUtil != null ? (
                <>
                  <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, memUtil)}%` }}
                      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                      className={cn("h-full rounded-full", memBarColor)}
                      role="progressbar"
                      aria-valuenow={Math.round(memUtil)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                    <span>{(clusterUtil!.memoryUsedBytes / (1024 ** 3)).toFixed(1)} GiB</span>
                    <span>of {(clusterUtil!.memoryTotalBytes / (1024 ** 3)).toFixed(1)} GiB</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="relative h-[52px] w-[52px] shrink-0">
                      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-violet-100 dark:text-violet-900/50" />
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="97.4 97.4" strokeDashoffset="97.4" strokeLinecap="round" className="text-violet-300/50 dark:text-violet-600/40 animate-pulse" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-violet-400/60 dark:text-violet-500/50">—</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-snug">
                        Metrics server not detected
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                        Required for live memory data
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-violet-600 dark:text-violet-400 group-hover:gap-2.5 transition-all duration-300">
                    <Download className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                    <span className="text-[11px] font-semibold">Install metrics-server</span>
                    <ArrowRight className="h-3 w-3 shrink-0 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" strokeWidth={2.5} />
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </motion.section>

        {/* ════════════ Clusters Section ════════════ */}
        <motion.section
          className="page-section pt-10"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Clusters section"
        >
          <SectionHeader icon={Server} title="Clusters">
            <p className="text-xs text-muted-foreground hidden sm:block">
              Select a cluster to view its dashboard
            </p>
          </SectionHeader>

          {filteredClusters.length === 0 ? (
            <div className="empty-state-container">
              <div className="empty-state-icon-box">
                <Server className="h-7 w-7 text-slate-400" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-foreground">No clusters connected</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                Connect your first cluster to start monitoring workloads and health.
              </p>
              <Button
                className="mt-6 rounded-xl font-semibold shadow-sm press-effect"
                onClick={() => navigate('/setup/kubeconfig')}
                aria-label="Add a new cluster"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Cluster
              </Button>
            </div>
          ) : (
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4"
              initial="initial"
              animate="animate"
              variants={stagger.container}
            >
              {filteredClusters.map((cluster) => (
                <motion.div key={cluster.id} variants={stagger.item} className="h-full min-w-0">
                  <div
                    className={cn(
                      "group relative flex flex-col h-full",
                      "bg-white dark:bg-[hsl(228,14%,11%)]",
                      "border border-slate-200 dark:border-slate-700",
                      "rounded-2xl overflow-hidden p-5",
                      "shadow cursor-pointer",
                      "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
                      "hover:border-blue-200 dark:hover:border-blue-900",
                      "hover:shadow-[var(--shadow-3)] hover:-translate-y-[2px]",
                      "active:translate-y-0 active:shadow",
                    )}
                    onClick={() => handleClusterClick(cluster)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClusterClick(cluster);
                      }
                    }}
                    aria-label={`Open cluster ${cluster.name}`}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="h-11 w-11 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                        <Server className="h-5 w-5 text-blue-500 dark:text-blue-400" strokeWidth={1.75} />
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-all duration-300 press-effect"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`More options for ${cluster.name}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border border-border bg-popover p-1.5 shadow-lg min-w-[170px]" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive focus:bg-destructive/10 rounded-lg h-9 px-3 text-sm font-medium cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClusterToRemove(cluster);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2.5" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex items-center gap-2 mb-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider truncate">
                        {cluster.provider || 'Core'}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-foreground leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300 line-clamp-2 break-all" title={cluster.name}>
                      {cluster.name}
                    </h3>

                    <div className="mt-auto pt-4 flex items-end justify-between border-t border-border/50 mt-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Nodes</span>
                        <span className="text-xl font-bold tabular-nums text-foreground">{cluster.node_count ?? 0}</span>
                      </div>
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 group-hover:bg-blue-500 transition-colors duration-300">
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors duration-300" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.section>

        {/* ════════════ Projects Section ════════════ */}
        <motion.section
          className="px-8 pt-10 pb-12"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Projects section"
        >
          <SectionHeader icon={FolderKanban} title="Projects">
            <CreateProjectDialog>
              <Button size="sm" className="rounded-xl font-semibold shrink-0 shadow-sm press-effect h-8 px-3 text-xs" aria-label="Create a new project">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New project
              </Button>
            </CreateProjectDialog>
          </SectionHeader>

          {isProjectsLoading ? (
            <div className="rounded-2xl border border-border bg-card/50 py-20 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading projects" />
                <p className="text-sm text-muted-foreground">Loading projects...</p>
              </div>
            </div>
          ) : circuitOpen ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 py-16 px-6 text-center">
              <div className="h-14 w-14 rounded-2xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <Activity className="h-7 w-7 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-foreground">Backend connection suspended</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                Connectivity is currently throttled due to recent failures.
                Project data will reappear automatically once the connection is restored.
              </p>
            </div>
          ) : isProjectsError ? (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 py-16 px-6 text-center">
              <div className="h-14 w-14 rounded-2xl bg-red-100 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <Focus className="h-7 w-7 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-foreground">Query failed</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                {(projectsError as any)?.message || "Internal system sync failed"}
              </p>
            </div>
          ) : projects.length > 0 ? (
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4"
              initial="initial"
              animate="animate"
              variants={stagger.container}
            >
              {projects.map((project) => (
                <motion.div key={project.id} variants={stagger.item}>
                  <ProjectCard
                    project={project}
                    onClick={() => navigate(`/projects/${project.id}/dashboard`)}
                    onSettingsClick={() => setSettingsProject(project)}
                    onDeleteClick={() => setProjectToRemove(project)}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <div className="empty-state-container">
              <div className="empty-state-icon-box">
                <Focus className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-foreground">No projects yet</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                Create a project to group workloads and apply governance.
              </p>
              <CreateProjectDialog>
                <Button size="default" className="mt-6 rounded-xl font-semibold shadow-sm press-effect" aria-label="Create a new project">
                  <Plus className="h-4 w-4 mr-2" />
                  New project
                </Button>
              </CreateProjectDialog>
            </div>
          )}
        </motion.section>
      </div>

      {/* ════════════ Dialogs ════════════ */}
      <AlertDialog open={!!clusterToRemove} onOpenChange={(open) => !open && setClusterToRemove(null)}>
        <AlertDialogContent className="rounded-2xl border border-border bg-card p-8 shadow-lg max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold text-foreground">Remove cluster?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed">
              This will unregister <strong className="text-foreground">{clusterToRemove?.name ?? ''}</strong> from Kubilitics. The cluster will be
              removed from the app and from any projects. This does not modify your kubeconfig file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-3">
            <AlertDialogCancel
              disabled={deleteClusterMutation.isPending}
              className="rounded-xl h-10 px-5 font-medium border-border hover:bg-muted press-effect"
            >
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => clusterToRemove && deleteClusterMutation.mutate(clusterToRemove)}
              disabled={deleteClusterMutation.isPending}
              className="rounded-xl h-10 px-5 font-medium shadow-sm press-effect"
            >
              {deleteClusterMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Removing...</>
              ) : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!projectToRemove} onOpenChange={(open) => !open && setProjectToRemove(null)}>
        <AlertDialogContent className="rounded-2xl border border-border bg-card p-8 shadow-lg max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold text-foreground">Delete project?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed">
              This action is <span className="text-destructive font-semibold">irreversible</span>.
              All cluster associations and resource links for <strong className="text-foreground">{projectToRemove?.name}</strong> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-3">
            <AlertDialogCancel
              className="rounded-xl h-10 px-5 font-medium border-border hover:bg-muted press-effect"
              disabled={deleteProjectMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              className="rounded-xl h-10 px-5 font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-sm press-effect"
              onClick={() => projectToRemove && deleteProjectMutation.mutate(projectToRemove)}
              disabled={deleteProjectMutation.isPending}
            >
              {deleteProjectMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Deleting...</>
              ) : 'Confirm Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AISetupModal open={isAiModalOpen} onOpenChange={setIsAiModalOpen} />
      {settingsProject && (
        <ProjectSettingsDialog
          project={settingsProject}
          open={!!settingsProject}
          onOpenChange={(open) => !open && setSettingsProject(null)}
        />
      )}
    </div>
  );
}
