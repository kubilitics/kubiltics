/**
 * Project-scoped dashboard: shows namespace-scoped resources for the project's namespaces.
 * Sets activeProject so sidebar and all list/count hooks are project-scoped.
 */
import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AlertCircle, Loader2, ArrowLeft, FolderKanban, Settings, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProject } from '@/hooks/useProjects';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import type { BackendProjectWithDetails } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { DashboardLayout } from '@/features/dashboard/components/DashboardLayout';
import { cn } from '@/lib/utils';

function toStoreProject(api: BackendProjectWithDetails): Project {
  const clusters = (api.clusters ?? []).map((c) => ({
    cluster_id: c.cluster_id,
    namespaces: (api.namespaces ?? [])
      .filter((n) => n.cluster_id === c.cluster_id)
      .map((n) => n.namespace_name),
  }));
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    clusters,
  };
}

export default function ProjectDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const { setActiveCluster, setClusters, setDemo } = useClusterStore();
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);

  const projectQuery = useProject(projectId ?? null);
  const project = projectQuery.data;
  const { data: clustersFromBackend } = useClustersFromBackend();
  const allClusters = clustersFromBackend ?? [];

  useEffect(() => {
    if (project) {
      setActiveProject(toStoreProject(project));
    }
    return () => {};
  }, [project, setActiveProject]);

  const isProjectCluster = project && currentClusterId && project.clusters?.some((c) => c.cluster_id === currentClusterId);
  const projectNamespacesForCluster = project && currentClusterId
    ? project.namespaces?.filter((n) => n.cluster_id === currentClusterId).map((n) => n.namespace_name) ?? []
    : [];

  const handleExitProject = () => {
    clearActiveProject();
    navigate('/home');
  };

  const handleConnectCluster = (clusterId: string) => {
    const backendCluster = allClusters.find((c) => c.id === clusterId);
    if (!backendCluster) return;
    const connected = allClusters.map(backendClusterToCluster);
    const active = backendClusterToCluster(backendCluster);
    setCurrentClusterId(clusterId);
    setClusters(connected);
    setActiveCluster(active);
    setDemo(false);
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-muted-foreground">Project not found</p>
        <Button variant="link" onClick={() => navigate('/home')}>Back to Home</Button>
      </div>
    );
  }

  if (projectQuery.isLoading || !project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading project…</p>
      </div>
    );
  }

  if (projectQuery.error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 rounded-xl border border-destructive/50 bg-destructive/5 p-6">
        <p className="text-destructive font-medium">Failed to load project</p>
        <Button variant="outline" onClick={() => navigate('/home')}>Back to Home</Button>
      </div>
    );
  }

  const hasClusters = project.clusters && project.clusters.length > 0;

  if (!hasClusters) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6">
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center max-w-md">
          <FolderKanban className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">No clusters in this project</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Add clusters and namespaces to this project to see a scoped dashboard.
          </p>
          <Button asChild variant="default">
            <Link to={`/projects/${projectId}`}>Manage project</Link>
          </Button>
        </div>
        <Button variant="ghost" onClick={handleExitProject} className="gap-2">
          <LogOut className="h-4 w-4" /> Exit project
        </Button>
      </div>
    );
  }

  if (!currentClusterId || !isProjectCluster) {
    return (
      <div className="flex flex-col min-h-[60vh] p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${projectId}`)} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <FolderKanban className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-xl font-bold">{project.name}</h1>
                <p className="text-sm text-muted-foreground">Select a cluster to view project dashboard</p>
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={handleExitProject} className="gap-2">
            <LogOut className="h-4 w-4" /> Exit project
          </Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 flex-1">
          <p className="text-sm text-muted-foreground mb-4">Connect to one of this project&apos;s clusters:</p>
          <div className="flex flex-wrap gap-2">
            {project.clusters?.map((pc) => {
              const backendCluster = allClusters.find((c) => c.id === pc.cluster_id);
              return (
                <Button
                  key={pc.cluster_id}
                  variant="outline"
                  onClick={() => {
                    handleConnectCluster(pc.cluster_id);
                    navigate(`/projects/${projectId}/dashboard`, { replace: true });
                  }}
                >
                  {backendCluster?.name ?? pc.cluster_id}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Or <Link to={`/projects/${projectId}`} className="text-primary underline">manage project</Link> to add clusters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex flex-col">
      {/* Project context header with breadcrumb */}
      <div className="shrink-0 border-b border-border bg-card/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="Breadcrumb">
            <Link to="/home" className="hover:text-foreground transition-colors">Home</Link>
            <span aria-hidden>/</span>
            <Link to={`/projects/${projectId}`} className="hover:text-foreground transition-colors truncate max-w-[140px]">
              {project.name}
            </Link>
            <span aria-hidden>/</span>
            <span className="text-foreground font-medium">Dashboard</span>
          </nav>
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10">
              <FolderKanban className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold truncate">{project.name}</h1>
              <p className="text-xs text-muted-foreground truncate">
                {projectNamespacesForCluster.length > 0
                  ? `Namespaces: ${projectNamespacesForCluster.join(', ')}`
                  : 'Project dashboard'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/projects/${projectId}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings className="h-4 w-4" /> Manage project
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleExitProject} className="gap-1.5 text-muted-foreground">
              <LogOut className="h-4 w-4" /> Exit project
            </Button>
          </div>
        </div>
      </div>
      <div className={cn("flex-1 min-h-0")}>
        <DashboardLayout />
      </div>
    </div>
  );
}
