import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  Container,
  FolderKanban,
  Focus,
  Globe,
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
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useK8sResourceList } from '@/hooks/useKubernetes';
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

/* ─── Section Header ─── */
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

/* ─── Time Ago Helper ─── */
function getTimeAgo(timestamp: string): string {
  try {
    const diff = Date.now() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

export default function HomePage() {
  const navigate = useNavigate();

  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = useMemo(() => getEffectiveBackendBaseUrl(storedBackendUrl), [storedBackendUrl]);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const setActiveCluster = useClusterStore((s) => s.setActiveCluster);

  const [settingsProject, setSettingsProject] = useState<BackendProject | null>(null);
  const [clusterToRemove, setClusterToRemove] = useState<BackendCluster | null>(null);
  const [projectToRemove, setProjectToRemove] = useState<BackendProject | null>(null);
  const queryClient = useQueryClient();

  const { data: clustersFromBackend } = useClustersFromBackend();
  const clusters = useMemo(() => clustersFromBackend || [], [clustersFromBackend]);

  const circuitOpen = useBackendCircuitOpen();
  const currentClusterId = useActiveClusterId();
  const { isConnected } = useConnectionStatus();
  const { data: overview } = useClusterOverview(currentClusterId ?? undefined);

  // Resource counts for the active cluster
  const podsList = useK8sResourceList('pods', undefined, { enabled: isConnected, limit: 5000 });
  const deploymentsList = useK8sResourceList('deployments', undefined, { enabled: isConnected });
  const servicesList = useK8sResourceList('services', undefined, { enabled: isConnected });

  const podStats = useMemo(() => {
    if (overview?.pod_status) {
      const ps = overview.pod_status;
      return { running: ps.running, pending: ps.pending, failed: ps.failed, total: ps.running + ps.pending + ps.failed + ps.succeeded };
    }
    const items = (podsList.data?.items ?? []) as Array<{ status?: { phase?: string } }>;
    let running = 0, pending = 0, failed = 0;
    for (const pod of items) {
      const phase = (pod?.status?.phase ?? '').toLowerCase();
      if (phase === 'running') running++;
      else if (phase === 'pending') pending++;
      else if (phase === 'failed' || phase === 'unknown') failed++;
    }
    return { running, pending, failed, total: items.length };
  }, [overview?.pod_status, podsList.data?.items]);

  const deploymentCount = (deploymentsList.data?.items ?? []).length;
  const serviceCount = (servicesList.data?.items ?? []).length;

  // Recent events for the active cluster
  const eventsList = useK8sResourceList('events', undefined, { enabled: isConnected, limit: 200 });
  const recentEvents = useMemo(() => {
    const items = (eventsList.data?.items ?? []) as Array<{
      type?: string;
      reason?: string;
      message?: string;
      metadata?: { name?: string; creationTimestamp?: string };
      involvedObject?: { kind?: string; name?: string };
      lastTimestamp?: string;
    }>;
    return items
      .sort((a, b) => {
        const ta = a.lastTimestamp || a.metadata?.creationTimestamp || '';
        const tb = b.lastTimestamp || b.metadata?.creationTimestamp || '';
        return tb.localeCompare(ta);
      })
      .slice(0, 8);
  }, [eventsList.data?.items]);

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

  const activeClusters = clusters.length;
  const activeNodes = useMemo(
    () => clusters.reduce((acc, c) => acc + (c.node_count || 0), 0),
    [clusters]
  );

  /* ─── Cluster card click handler ─── */
  const handleClusterClick = (cluster: BackendCluster) => {
    setCurrentClusterId(cluster.id);
    setActiveCluster(backendClusterToCluster(cluster));
    navigate('/dashboard');
  };

  return (
    <div className="page-container" role="main" aria-label="Systems overview page">
      <div className="page-inner">

        {/* ════════════ Clusters Section — The heart of the Home page ════════════ */}
        <motion.section
          className="page-section"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Clusters section"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Clusters
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {activeClusters > 0
                  ? `${activeClusters} cluster${activeClusters > 1 ? 's' : ''} · ${activeNodes} node${activeNodes !== 1 ? 's' : ''} total`
                  : 'No clusters connected yet'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl font-semibold shadow-sm press-effect"
              onClick={() => navigate('/connect?addCluster=true')}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Cluster
            </Button>
          </div>

          {clusters.length === 0 ? (
            <div className="empty-state-container">
              <div className="empty-state-icon-box">
                <Server className="h-7 w-7 text-slate-400" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-foreground">No clusters connected</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                Connect your first Kubernetes cluster to start monitoring workloads, health, and capacity.
              </p>
              <Button
                className="mt-6 rounded-xl font-semibold shadow-sm press-effect"
                onClick={() => navigate('/connect?addCluster=true')}
              >
                <Plus className="h-4 w-4 mr-2" />
                Connect Cluster
              </Button>
            </div>
          ) : (
            <motion.div
              className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4"
              initial="initial"
              animate="animate"
              variants={stagger.container}
            >
              {clusters.map((cluster) => {
                const isActive = cluster.id === currentClusterId;
                const nodeCount = cluster.node_count ?? 0;
                return (
                  <motion.div key={cluster.id} variants={stagger.item} className="h-full min-w-0">
                    <div
                      className={cn(
                        "group relative flex flex-col h-full",
                        "bg-white dark:bg-[hsl(228,14%,11%)]",
                        "border rounded-2xl overflow-hidden",
                        "shadow-sm cursor-pointer",
                        "transition-all duration-300",
                        "hover:shadow-md hover:-translate-y-[2px]",
                        "active:translate-y-0 active:shadow-sm",
                        isActive
                          ? "border-primary/50 dark:border-primary/40 ring-1 ring-primary/20"
                          : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600",
                      )}
                      style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
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
                      {/* Card header */}
                      <div className="p-5 pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={cn(
                              "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                              isActive ? "bg-primary/10" : "bg-blue-50 dark:bg-blue-500/10"
                            )}>
                              <Server className={cn(
                                "h-5 w-5",
                                isActive ? "text-primary" : "text-blue-500 dark:text-blue-400"
                              )} strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider truncate">
                                  {cluster.provider || 'Kubernetes'}
                                </span>
                                {isActive && (
                                  <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
                                    Current
                                  </span>
                                )}
                              </div>
                              <h3 className="text-sm font-semibold text-foreground leading-snug group-hover:text-primary transition-colors truncate" title={cluster.name}>
                                {cluster.name}
                              </h3>
                            </div>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Options for ${cluster.name}`}
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive focus:bg-destructive/10 rounded-lg text-sm font-medium cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setClusterToRemove(cluster);
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Cluster stats row */}
                      <div className="p-5 pt-4 mt-auto">
                        <div className="flex items-center gap-5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <Server className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-bold tabular-nums text-foreground">{nodeCount}</span>
                            <span className="text-muted-foreground">node{nodeCount !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            <span className="text-muted-foreground">Connected</span>
                          </div>
                          <div className="ml-auto">
                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary transition-colors duration-300">
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary-foreground transition-colors duration-300" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </motion.section>

        {/* ════════════ Resource Summary + Recent Events ════════════ */}
        {isConnected && activeClusters > 0 && (
          <motion.section
            className="page-section pt-8"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Resource summary cards */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Active Cluster Resources</h3>

                {/* Pods */}
                <div
                  className="flex items-center gap-3 p-3.5 rounded-xl bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                  onClick={() => navigate('/pods')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate('/pods')}
                >
                  <div className="h-9 w-9 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Box className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{podStats.total} Pods</p>
                    <p className="text-xs text-muted-foreground">
                      {podStats.running} running
                      {podStats.pending > 0 && <span className="text-amber-500"> · {podStats.pending} pending</span>}
                      {podStats.failed > 0 && <span className="text-rose-500"> · {podStats.failed} failed</span>}
                    </p>
                  </div>
                  {podStats.failed > 0 && <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />}
                </div>

                {/* Deployments */}
                <div
                  className="flex items-center gap-3 p-3.5 rounded-xl bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                  onClick={() => navigate('/deployments')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate('/deployments')}
                >
                  <div className="h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Container className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{deploymentCount} Deployments</p>
                  </div>
                </div>

                {/* Services */}
                <div
                  className="flex items-center gap-3 p-3.5 rounded-xl bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                  onClick={() => navigate('/services')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate('/services')}
                >
                  <div className="h-9 w-9 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 flex items-center justify-center shrink-0">
                    <Globe className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{serviceCount} Services</p>
                  </div>
                </div>
              </div>

              {/* Recent events */}
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Events</h3>
                  <button
                    onClick={() => navigate('/events')}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    View all
                  </button>
                </div>
                <div className="rounded-xl bg-white dark:bg-[hsl(228,14%,11%)] border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                  {recentEvents.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-sm text-muted-foreground">No recent events</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {recentEvents.map((event, i) => {
                        const isWarning = event.type === 'Warning';
                        const timestamp = event.lastTimestamp || event.metadata?.creationTimestamp || '';
                        const timeAgo = timestamp ? getTimeAgo(timestamp) : '';
                        return (
                          <div key={event.metadata?.name || i} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                            <div className={cn(
                              "h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                              isWarning ? "bg-amber-100 dark:bg-amber-500/10" : "bg-slate-100 dark:bg-slate-800"
                            )}>
                              {isWarning
                                ? <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                                : <Activity className="h-3 w-3 text-muted-foreground" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-wider",
                                  isWarning ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                                )}>
                                  {event.reason || event.type}
                                </span>
                                {event.involvedObject && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {event.involvedObject.kind}/{event.involvedObject.name}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-foreground/80 line-clamp-1">{event.message}</p>
                            </div>
                            {timeAgo && (
                              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 mt-1">{timeAgo}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* ════════════ Projects Section ════════════ */}
        <motion.section
          className="page-section pt-10 pb-12"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Projects section"
        >
          <SectionHeader icon={FolderKanban} title="Projects">
            <CreateProjectDialog>
              <Button size="sm" className="rounded-xl font-semibold shrink-0 shadow-sm press-effect h-8 px-3 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New project
              </Button>
            </CreateProjectDialog>
          </SectionHeader>

          {isProjectsLoading ? (
            <div className="rounded-2xl border border-border bg-card/50 py-20 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading projects...</p>
              </div>
            </div>
          ) : circuitOpen ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 py-16 px-6 text-center">
              <div className="h-14 w-14 rounded-2xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <Activity className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-base font-semibold text-foreground">Backend connection suspended</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                Project data will reappear once the connection is restored.
              </p>
            </div>
          ) : isProjectsError ? (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 py-16 px-6 text-center">
              <div className="h-14 w-14 rounded-2xl bg-red-100 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-7 w-7 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-base font-semibold text-foreground">Failed to load projects</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                {(projectsError as unknown as Record<string, unknown>)?.message || "Internal system sync failed"}
              </p>
            </div>
          ) : projects.length > 0 ? (
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
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
                <Focus className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold text-foreground">No projects yet</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                Create a project to group workloads and apply governance.
              </p>
              <CreateProjectDialog>
                <Button size="default" className="mt-6 rounded-xl font-semibold shadow-sm press-effect">
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
              This will unregister <strong className="text-foreground">{clusterToRemove?.name ?? ''}</strong> from Kubilitics.
              This does not modify your kubeconfig file.
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
