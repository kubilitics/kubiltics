import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Cpu,
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

/* ─── Utilization Color Helpers ─── */
function utilGradient(value: number, baseFrom: string, baseTo: string) {
  if (value > 80) return 'from-red-500 to-orange-500';
  if (value > 50) return 'from-amber-500 to-yellow-500';
  return `from-${baseFrom} to-${baseTo}`;
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
  const cpuColor = (cpuUtil ?? 0) > 80 ? 'from-red-500 to-orange-500' : (cpuUtil ?? 0) > 50 ? 'from-amber-500 to-yellow-500' : 'from-blue-500 to-indigo-500';
  const memColor = (memUtil ?? 0) > 80 ? 'from-red-500 to-orange-500' : (memUtil ?? 0) > 50 ? 'from-amber-500 to-yellow-500' : 'from-violet-500 to-purple-500';

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
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-h1 text-slate-900">
                Welcome back
              </h1>
              <p className="text-body-sm text-slate-500 mt-2 max-w-lg">
                Here's what's happening across your clusters and projects.
              </p>
            </div>
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">

            {/* ── Health Score ── */}
            <motion.div
              variants={stagger.item}
              className="group metric-card"
              role="status"
              aria-label={`Health score: ${health.score} out of 100`}
            >
              <div className="metric-gradient bg-gradient-to-br from-blue-50/40 to-transparent" />
              <div className="relative flex flex-col items-center text-center gap-3">
                <HealthRing score={health.score} size={72} strokeWidth={6} aria-valuenow={health.score} aria-valuemin={0} aria-valuemax={100} />
                <div>
                  <p className="label-xs">Health</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">{health.insight}</p>
                </div>
              </div>
            </motion.div>

            {/* ── Clusters ── */}
            <motion.div
              variants={stagger.item}
              className="group metric-card"
              role="status"
              aria-label={`${activeClusters} active clusters`}
            >
              <div className="metric-gradient bg-gradient-to-br from-blue-50/40 to-transparent" />
              <div className="relative flex items-center gap-4">
                <div className="icon-box-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/20">
                  <Server className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="label-xs">Clusters</p>
                  <p className="text-2xl font-bold tabular-nums text-slate-900 mt-0.5 leading-none">{activeClusters}</p>
                  <p className="text-xs text-emerald-600 font-semibold mt-1 flex items-center gap-1.5">
                    <span className="status-dot-live" />
                    Active
                  </p>
                </div>
              </div>
            </motion.div>

            {/* ── Nodes ── */}
            <motion.div
              variants={stagger.item}
              className="group metric-card"
              role="status"
              aria-label={`${activeNodes} active nodes`}
            >
              <div className="metric-gradient bg-gradient-to-br from-emerald-50/40 to-transparent" />
              <div className="relative flex items-center gap-4">
                <div className="icon-box-lg bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/20">
                  <Activity className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="label-xs">Nodes</p>
                  <p className="text-2xl font-bold tabular-nums text-slate-900 mt-0.5 leading-none">{activeNodes}</p>
                  <p className="text-xs text-slate-500 mt-1">Provisioned</p>
                </div>
              </div>
            </motion.div>

            {/* ── CPU Usage ── */}
            <motion.div
              variants={stagger.item}
              className="group metric-card"
              role="status"
              aria-label={cpuUtil != null ? `CPU usage at ${Math.round(cpuUtil)} percent` : 'CPU usage unavailable'}
            >
              <div className="metric-gradient bg-gradient-to-br from-indigo-50/40 to-transparent" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/15">
                    <Cpu className="h-3.5 w-3.5 text-white" />
                  </div>
                  <p className="label-xs">CPU</p>
                </div>
                {cpuUtil != null ? (
                  <>
                    <p className="text-2xl font-bold tabular-nums text-slate-900 leading-none">
                      {Math.round(cpuUtil)}<span className="text-sm text-slate-400 ml-0.5">%</span>
                    </p>
                    <div className="progress-track mt-3">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, cpuUtil)}%` }}
                        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                        className={`progress-fill bg-gradient-to-r ${cpuColor}`}
                        role="progressbar"
                        aria-valuenow={Math.round(cpuUtil)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">Cluster average</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-300 leading-none">—</p>
                    <div className="progress-track mt-3" />
                    <p className="text-xs text-slate-400 mt-1.5">No metrics available</p>
                  </>
                )}
              </div>
            </motion.div>

            {/* ── Memory Usage ── */}
            <motion.div
              variants={stagger.item}
              className="group metric-card"
              role="status"
              aria-label={memUtil != null ? `Memory usage at ${Math.round(memUtil)} percent` : 'Memory usage unavailable'}
            >
              <div className="metric-gradient bg-gradient-to-br from-violet-50/40 to-transparent" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-md shadow-violet-500/15">
                    <HardDrive className="h-3.5 w-3.5 text-white" />
                  </div>
                  <p className="label-xs">Memory</p>
                </div>
                {memUtil != null ? (
                  <>
                    <p className="text-2xl font-bold tabular-nums text-slate-900 leading-none">
                      {Math.round(memUtil)}<span className="text-sm text-slate-400 ml-0.5">%</span>
                    </p>
                    <div className="progress-track mt-3">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, memUtil)}%` }}
                        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                        className={`progress-fill bg-gradient-to-r ${memColor}`}
                        role="progressbar"
                        aria-valuenow={Math.round(memUtil)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">Cluster average</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-slate-300 leading-none">—</p>
                    <div className="progress-track mt-3" />
                    <p className="text-xs text-slate-400 mt-1.5">No metrics available</p>
                  </>
                )}
              </div>
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-h4 text-slate-900">Clusters</h2>
              <p className="text-body-sm text-slate-500 mt-1">
                Connected clusters and their status. Select one to view details.
              </p>
            </div>
          </div>

          {filteredClusters.length === 0 ? (
            <div className="empty-state-container">
              <div className="empty-state-icon-box">
                <Server className="h-7 w-7 text-slate-400" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-slate-800">No clusters connected</h3>
              <p className="text-body-sm text-slate-500 mt-1.5 max-w-sm mx-auto">
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
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5"
              initial="initial"
              animate="animate"
              variants={stagger.container}
            >
              {filteredClusters.map((cluster) => (
                <motion.div key={cluster.id} variants={stagger.item} className="h-full min-w-0">
                  <div
                    className="entity-card group"
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
                    {/* Hover gradient */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    <div className="relative">
                      <div className="flex justify-between items-start mb-5">
                        <div className="icon-box-md bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/20 group-hover:shadow-xl group-hover:shadow-blue-500/30 transition-shadow duration-500">
                          <Server className="h-5 w-5 text-white" />
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all duration-300 press-effect"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`More options for ${cluster.name}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-apple-lg min-w-[170px]" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-700 focus:bg-red-50 rounded-lg h-9 px-3 text-sm font-medium cursor-pointer"
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

                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="status-dot-live" />
                        <span className="label-xs text-emerald-600 normal-case tracking-wider truncate">{cluster.provider || 'Core'}</span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 leading-snug group-hover:text-blue-700 transition-colors duration-300 line-clamp-2 break-all" title={cluster.name}>
                        {cluster.name}
                      </h3>
                    </div>

                    <div className="relative mt-auto pt-5 flex items-end justify-between">
                      <div className="flex flex-col gap-0.5">
                        <span className="label-xs">Nodes</span>
                        <span className="text-xl font-bold tabular-nums text-slate-900">{cluster.node_count ?? 0}</span>
                      </div>
                      <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:shadow-lg group-hover:shadow-blue-500/25 transition-all duration-500 ease-out">
                        <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-white transition-colors duration-300" />
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-h4 text-slate-900">Projects</h2>
              <p className="text-body-sm text-slate-500 mt-1">
                Logical scopes for workloads and policy. Open a project to see its dashboard.
              </p>
            </div>
            <CreateProjectDialog>
              <Button size="default" className="rounded-xl font-semibold shrink-0 shadow-sm press-effect" aria-label="Create a new project">
                <Plus className="h-4 w-4 mr-2" />
                New project
              </Button>
            </CreateProjectDialog>
          </div>

          {isProjectsLoading ? (
            <div className="section-card py-20 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-label="Loading projects" />
                <p className="text-body-sm text-slate-400">Loading projects...</p>
              </div>
            </div>
          ) : circuitOpen ? (
            <div className="rounded-[var(--card-radius)] border border-amber-200 bg-amber-50/50 py-16 px-6 text-center">
              <div className="h-14 w-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <Activity className="h-7 w-7 text-amber-600" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-slate-800">Backend connection suspended</h3>
              <p className="text-body-sm text-slate-500 mt-1.5 max-w-sm mx-auto">
                Connectivity is currently throttled due to recent failures.
                Project data will reappear automatically once the connection is restored.
              </p>
            </div>
          ) : isProjectsError ? (
            <div className="rounded-[var(--card-radius)] border border-red-200 bg-red-50/50 py-16 px-6 text-center">
              <div className="h-14 w-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Focus className="h-7 w-7 text-red-600" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-slate-800">Query failed</h3>
              <p className="text-body-sm text-slate-500 mt-1.5 max-w-sm mx-auto">
                {(projectsError as any)?.message || "Internal system sync failed"}
              </p>
            </div>
          ) : projects.length > 0 ? (
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5"
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
                <Focus className="h-7 w-7 text-slate-400" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-slate-800">No projects yet</h3>
              <p className="text-body-sm text-slate-500 mt-1.5 max-w-sm mx-auto">
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
        <AlertDialogContent className="rounded-2xl border border-slate-200 bg-white p-8 shadow-apple-xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold text-slate-900">Remove cluster?</AlertDialogTitle>
            <AlertDialogDescription className="text-body-sm text-slate-500 mt-2 leading-relaxed">
              This will unregister <strong className="text-slate-700">{clusterToRemove?.name ?? ''}</strong> from Kubilitics. The cluster will be
              removed from the app and from any projects. This does not modify your kubeconfig file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-3">
            <AlertDialogCancel
              disabled={deleteClusterMutation.isPending}
              className="rounded-xl h-10 px-5 font-medium border-slate-200 hover:bg-slate-50 press-effect"
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
        <AlertDialogContent className="rounded-2xl border border-slate-200 bg-white p-8 shadow-apple-xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold text-slate-900">Delete project?</AlertDialogTitle>
            <AlertDialogDescription className="text-body-sm text-slate-500 mt-2 leading-relaxed">
              This action is <span className="text-red-600 font-semibold">irreversible</span>.
              All cluster associations and resource links for <strong className="text-slate-700">{projectToRemove?.name}</strong> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-3">
            <AlertDialogCancel
              className="rounded-xl h-10 px-5 font-medium border-slate-200 hover:bg-slate-50 press-effect"
              disabled={deleteProjectMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              className="rounded-xl h-10 px-5 font-medium bg-red-600 hover:bg-red-700 text-white shadow-sm press-effect"
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
