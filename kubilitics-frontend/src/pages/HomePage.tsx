import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Focus,
  Loader2,
  MoreVertical,
  Plus,
  Server,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
import { useHealthScore } from '@/hooks/useHealthScore';
import { HealthRing } from '@/components/HealthRing';
import { AISetupModal } from '@/features/ai/AISetupModal';
import { loadLLMProviderConfig } from '@/services/aiService';
import { getProjects, deleteCluster, deleteProject, type BackendProject, type BackendCluster } from '@/services/backendApiClient';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog';

const pageMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25 },
};

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
  const cpuUtil = overview?.utilization?.cpu_percent ?? 0;

  return (
    <div className="min-h-screen bg-background pb-12">
      <div className="flex flex-col gap-6 p-6 w-full">
        {/* Page Header — Apple-style SF Pro vibe */}
        <motion.div {...pageMotion} className="pt-8 pb-4">
          <h1 className="apple-title text-4xl mb-2 tracking-tight">Systems Overview</h1>
          <p className="apple-description text-base max-w-2xl">
            Real-time intelligence across your global infrastructure. Orchestrating clusters and project logical environments with precision.
          </p>
        </motion.div>

        <div className="space-y-10 w-full">
          {/* Metrics strip — full-width grid like Workloads Overview */}
          {/* Metrics strip — Apple-style Glass Cards */}
          <motion.section {...pageMotion} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-8" role="region" aria-live="polite" aria-label="Health metrics dashboard">
            <motion.div
              className="glass-card elevation-2 hover:elevation-3 p-8 flex items-center gap-8 group hover:translate-y-[-6px] transition-all duration-700 ease-spring"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0, duration: 0.4 }}
              role="status"
            >
              <div className="relative shrink-0">
                <div className="absolute inset-x-0 -inset-y-4 bg-blue-500/10 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                <HealthRing score={health.score} size={72} strokeWidth={8} aria-valuenow={health.score} aria-valuemin={0} aria-valuemax={100} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em]">Health Index</p>
                <p className="text-4xl font-bold tabular-nums text-slate-900 mt-1">{health.score}</p>
                <p className="text-[11px] text-slate-500 font-semibold mt-1.5 truncate leading-relaxed">{health.insight}</p>
              </div>
            </motion.div>

            <motion.div
              className="glass-card elevation-2 hover:elevation-3 p-8 flex items-center gap-8 group hover:translate-y-[-6px] transition-all duration-700 ease-spring"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.4 }}
              role="status"
            >
              <div className="h-16 w-16 rounded-[1.5rem] bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:shadow-xl group-hover:shadow-blue-500/20 transition-all duration-700 ease-spring shadow-sm border border-white">
                <Server className="h-8 w-8 text-blue-600 group-hover:text-white transition-colors duration-500" aria-label="Clusters icon" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em]">Clusters</p>
                <p className="text-4xl font-bold tabular-nums text-slate-900 mt-1">{activeClusters}</p>
                <p className="text-[11px] text-emerald-600 font-bold mt-1.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-label="Distributed status indicator" />
                  Distributed
                </p>
              </div>
            </motion.div>

            <motion.div
              className="glass-card elevation-2 hover:elevation-3 p-8 flex items-center gap-8 group hover:translate-y-[-6px] transition-all duration-700 ease-spring"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              role="status"
            >
              <div className="h-16 w-16 rounded-[1.5rem] bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:shadow-xl group-hover:shadow-emerald-500/20 transition-all duration-700 ease-spring shadow-sm border border-white">
                <Activity className="h-8 w-8 text-emerald-600 group-hover:text-white transition-colors duration-500" aria-label="Nodes icon" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em]">Nodes</p>
                <p className="text-4xl font-bold tabular-nums text-slate-900 mt-1">{activeNodes}</p>
                <p className="text-[11px] text-slate-500 font-semibold mt-1.5">Provisioned</p>
              </div>
            </motion.div>

            <motion.div
              className="glass-card elevation-2 hover:elevation-3 p-8 flex flex-col justify-center relative group overflow-hidden hover:translate-y-[-6px] transition-all duration-700 ease-spring"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              role="status"
            >
              <div className="flex justify-between items-end mb-3">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.25em]">System Load</p>
                  <p className="text-4xl font-bold tabular-nums text-slate-900 mt-1">{Math.round(cpuUtil)}<span className="text-xl text-slate-400 ml-0.5">%</span></p>
                </div>
              </div>
              <div className="relative h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, cpuUtil)}%` }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full"
                  role="progressbar"
                  aria-valuenow={Math.round(cpuUtil)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="System load progress"
                />
              </div>

              <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-x-4 group-hover:translate-x-0">
                <Button variant="ghost" size="sm" className="h-10 rounded-full text-[10px] font-bold tracking-[0.15em] uppercase hover:bg-white bg-white/50 shadow-sm px-6 press-effect" onClick={() => navigate('/nodes')} aria-label="View detailed nodes">
                  Observe <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          </motion.section>

          {/* Clusters */}
          <motion.section {...pageMotion} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Clusters</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Connected clusters and their status. Select one to view details.
                </p>
              </div>
            </div>
            {filteredClusters.length === 0 ? (
              <Card className="border-dashed border-2 border-muted-foreground/20 bg-muted/30">
                <CardContent className="py-16 px-6 text-center">
                  <div className="empty-state-icon h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                    <Server className="h-8 w-8 text-muted-foreground" aria-label="No clusters icon" />
                  </div>
                  <h3 className="empty-state-title text-base font-semibold text-foreground">No clusters connected</h3>
                  <p className="empty-state-description text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    Connect your first cluster to start monitoring workloads and health.
                  </p>
                  <Button
                    className="mt-6 rounded-xl font-medium press-effect"
                    onClick={() => navigate('/setup/kubeconfig')}
                    aria-label="Add a new cluster"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Cluster
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                {filteredClusters.map((cluster, idx) => (
                  <motion.div
                    key={cluster.id}
                    className="h-full min-w-0"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05, duration: 0.4 }}
                  >
                    <div
                      className="glass-card elevation-2 hover:elevation-3 glass-card-hover group cursor-pointer p-6 h-full flex flex-col justify-between min-h-[220px] overflow-hidden press-effect"
                      onClick={() => {
                        setCurrentClusterId(cluster.id);
                        setActiveCluster(backendClusterToCluster(cluster));
                        navigate('/dashboard');
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setCurrentClusterId(cluster.id);
                          setActiveCluster(backendClusterToCluster(cluster));
                          navigate('/dashboard');
                        }
                      }}
                      aria-label={`Open cluster ${cluster.name}`}
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div className="h-12 w-12 rounded-2xl bg-slate-50 group-hover:bg-blue-600 group-hover:shadow-xl group-hover:shadow-blue-500/20 flex items-center justify-center transition-all duration-700 ease-spring shadow-sm border border-white shrink-0">
                          <Server className="h-6 w-6 text-slate-400 group-hover:text-white transition-colors duration-500" aria-label="Cluster server icon" />
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 rounded-full text-slate-400 hover:text-slate-900 group-hover:bg-white/80 shadow-sm transition-all press-effect"
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`More options for ${cluster.name}`}
                            >
                              <MoreVertical className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="glass-card border-none p-2 shadow-2xl min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive rounded-xl h-11 px-4 font-bold text-xs uppercase tracking-widest"
                              onClick={(e) => {
                                e.stopPropagation();
                                setClusterToRemove(cluster);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-3" />
                              Remove Cluster
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5 mb-2.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse shrink-0" />
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-[0.2em] truncate">{cluster.provider || 'Core'} Engine</span>
                        </div>
                        <h3 className="apple-title text-lg leading-tight group-hover:text-blue-700 transition-colors duration-500 line-clamp-2 break-all" title={cluster.name}>{cluster.name}</h3>
                      </div>

                      <div className="mt-auto pt-6 flex items-end justify-between">
                        <div className="flex flex-col gap-1 min-w-0">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Compute Units</span>
                          <span className="text-2xl font-bold tabular-nums text-slate-900">{cluster.node_count ?? 0}</span>
                        </div>

                        <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:shadow-xl group-hover:shadow-blue-500/25 group-hover:translate-x-1.5 transition-all duration-700 ease-spring shadow-sm border border-white">
                          <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-white transition-colors duration-500" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.section>

          {/* Projects */}
          <motion.section {...pageMotion} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Projects</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
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
              <Card className="border-border/60">
                <CardContent className="py-20 flex items-center justify-center">
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground skeleton-shimmer" aria-label="Loading projects" />
                </CardContent>
              </Card>
            ) : circuitOpen ? (
              <Card className="border-amber-500/20 bg-amber-50/10">
                <CardContent className="py-16 px-6 text-center">
                  <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                    <Activity className="h-8 w-8 text-amber-600" aria-label="Connection throttled warning" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Backend connection suspended</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    Connectivity is currently throttled due to recent failures.
                    Project data will reappear automatically once the connection is restored.
                  </p>
                </CardContent>
              </Card>
            ) : isProjectsError ? (
              <Card className="border-destructive/20 bg-destructive/5">
                <CardContent className="py-16 px-6 text-center">
                  <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                    <Focus className="h-8 w-8 text-destructive" aria-label="Error icon" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Query failed</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    {(projectsError as any)?.message || "Internal system sync failed"}
                  </p>
                </CardContent>
              </Card>
            ) : projects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                {projects.map((project, idx) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <ProjectCard
                      project={project}
                      onClick={() => navigate(`/projects/${project.id}/dashboard`)}
                      onSettingsClick={() => setSettingsProject(project)}
                      onDeleteClick={() => setProjectToRemove(project)}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <Card className="border-dashed border-2 border-muted-foreground/20 bg-muted/30">
                <CardContent className="empty-state py-16 px-6 text-center">
                  <div className="empty-state-icon h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                    <Focus className="h-8 w-8 text-muted-foreground" aria-label="No projects icon" />
                  </div>
                  <h3 className="empty-state-title text-base font-semibold text-foreground">No projects yet</h3>
                  <p className="empty-state-description text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    Create a project to group workloads and apply governance.
                  </p>
                  <CreateProjectDialog>
                    <Button size="default" className="mt-6 rounded-xl font-semibold press-effect" aria-label="Create a new project">
                      <Plus className="h-4 w-4 mr-2" />
                      New project
                    </Button>
                  </CreateProjectDialog>
                </CardContent>
              </Card>
            )}
          </motion.section>
        </div>
      </div>

      <AlertDialog open={!!clusterToRemove} onOpenChange={(open) => !open && setClusterToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unregister <strong>{clusterToRemove?.name ?? ''}</strong> from Kubilitics. The cluster will be
              removed from the app and from any projects. This does not modify your kubeconfig file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteClusterMutation.isPending} className="press-effect">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => clusterToRemove && deleteClusterMutation.mutate(clusterToRemove)}
              disabled={deleteClusterMutation.isPending}
              className="press-effect"
            >
              {deleteClusterMutation.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!projectToRemove} onOpenChange={(open) => !open && setProjectToRemove(null)}>
        <AlertDialogContent className="rounded-[2.5rem] p-10 border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl font-bold text-slate-900">Purge logical environment?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 font-medium">
              This action is <span className="text-red-600 font-bold uppercase tracking-widest text-[10px]">irreversible</span>.
              All cluster associations and resource links for <span className="font-bold text-slate-900">{projectToRemove?.name}</span> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-8 gap-3">
            <AlertDialogCancel className="rounded-2xl h-12 px-8 font-bold border-slate-100 press-effect" disabled={deleteProjectMutation.isPending}>Abort</AlertDialogCancel>
            <Button
              className="rounded-2xl h-12 px-8 font-bold bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200 press-effect"
              onClick={() => projectToRemove && deleteProjectMutation.mutate(projectToRemove)}
              disabled={deleteProjectMutation.isPending}
            >
              {deleteProjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin skeleton-shimmer" aria-label="Confirming purge" /> : "Confirm Purge"}
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
