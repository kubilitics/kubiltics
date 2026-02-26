/**
 * Project Detail Page — Multi-cluster list and namespace management.
 * Clean cluster cards with Connect/Remove. Namespaces grouped by cluster with team labels.
 * Add Cluster, Add Namespace, Edit, Delete.
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Server,
  Layers,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  FolderKanban,
  Plus,
  MoreVertical,
  Pencil,
  LayoutDashboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProject, useProjectMutations } from '@/hooks/useProjects';
import { useProjectStore, type Project } from '@/stores/projectStore';
import type { BackendProjectWithDetails } from '@/services/backendApiClient';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { toast } from 'sonner';
import { AddClusterDialog } from '@/features/projects/AddClusterDialog';
import { AddNamespaceDialog } from '@/features/projects/AddNamespaceDialog';
import { EditProjectDialog } from '@/features/projects/EditProjectDialog';
import { DeleteProjectDialog } from '@/features/projects/DeleteProjectDialog';

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-amber-500" />;
  }
}

/** Adapt backend project (clusters + flat namespaces) to store shape (clusters with namespaces[] per cluster). */
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

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [addClusterOpen, setAddClusterOpen] = useState(false);
  const [addNamespaceOpen, setAddNamespaceOpen] = useState(false);
  const [addNamespaceClusterId, setAddNamespaceClusterId] = useState<string | undefined>(undefined);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const { setActiveCluster, setClusters, setDemo } = useClusterStore();
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const clustersQuery = useClustersFromBackend();
  const allClusters = clustersQuery.data ?? [];

  const projectQuery = useProject(projectId!);
  const project = projectQuery.data;
  const mutations = useProjectMutations();
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);

  useEffect(() => {
    if (project) {
      setActiveProject(toStoreProject(project));
    }
    // Removed cleanup: Clear project only when navigating back to home or explicitly changing.
    // This ensures filtering works when clicking 'Pods' or other sidebar items from this page.
  }, [project, setActiveProject, clearActiveProject]);

  const handleConnect = (clusterId: string) => {
    const backendCluster = allClusters.find((c) => c.id === clusterId);
    if (!backendCluster) {
      toast.error('Cluster not found');
      return;
    }
    const connected = allClusters.map(backendClusterToCluster);
    const active = backendClusterToCluster(backendCluster);
    setCurrentClusterId(clusterId);
    setClusters(connected);
    setActiveCluster(active);
    setDemo(false);
    toast.success(`Connected to ${backendCluster.name}`);
    navigate(`/projects/${projectId}/dashboard`, { replace: true });
  };

  const handleRemoveCluster = async (clusterId: string) => {
    if (!projectId) return;
    try {
      await mutations.removeCluster.mutateAsync({ projectId, clusterId });
      toast.success('Cluster removed from project');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove cluster');
    }
  };

  const handleRemoveNamespace = async (clusterId: string, namespaceName: string) => {
    if (!projectId) return;
    try {
      await mutations.removeNamespace.mutateAsync({ projectId, clusterId, namespaceName });
      toast.success('Namespace removed from project');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove namespace');
    }
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-muted-foreground">Project not found</p>
        <Button variant="link" onClick={() => navigate('/home')}>
          Back to Home
        </Button>
      </div>
    );
  }

  if (projectQuery.isLoading || !project) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading project…</p>
      </div>
    );
  }

  if (projectQuery.error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-6">
        <p className="text-destructive font-medium">Failed to load project</p>
        <p className="text-sm text-muted-foreground mt-2">
          {projectQuery.error instanceof Error ? projectQuery.error.message : 'Unknown error'}
        </p>
        <Button variant="outline" onClick={() => navigate('/home')} className="mt-4">
          Back to Home
        </Button>
      </div>
    );
  }

  const namespacesByCluster = new Map<string, typeof project.namespaces>();
  (project.namespaces ?? []).forEach((n) => {
    const list = namespacesByCluster.get(n.cluster_id) ?? [];
    list.push(n);
    namespacesByCluster.set(n.cluster_id, list);
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/home')} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <FolderKanban className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              {project.description && (
                <p className="text-muted-foreground mt-0.5">{project.description}</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            className="gap-2"
            onClick={() => navigate(`/projects/${projectId}/dashboard`)}
            disabled={!project.clusters?.length}
          >
            <LayoutDashboard className="h-4 w-4" />
            Open dashboard
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Project actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditProjectOpen(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit project
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteProjectOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AddClusterDialog
        projectId={projectId}
        open={addClusterOpen}
        onOpenChange={setAddClusterOpen}
        existingClusterIds={(project.clusters ?? []).map((c) => c.cluster_id)}
      />
      <AddNamespaceDialog
        projectId={projectId}
        open={addNamespaceOpen}
        onOpenChange={(open) => {
          setAddNamespaceOpen(open);
          if (!open) setAddNamespaceClusterId(undefined);
        }}
        clusters={(project.clusters ?? []).map((c) => ({ cluster_id: c.cluster_id, cluster_name: c.cluster_name }))}
        initialClusterId={addNamespaceClusterId}
      />
      <EditProjectDialog
        projectId={projectId}
        projectName={project.name}
        projectDescription={project.description ?? ''}
        open={editProjectOpen}
        onOpenChange={setEditProjectOpen}
      />
      <DeleteProjectDialog
        projectId={projectId}
        projectName={project.name}
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
      />

      {/* Clusters — clean list */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5" />
            Clusters
          </h2>
          <Button variant="outline" size="sm" onClick={() => setAddClusterOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Cluster
          </Button>
        </div>
        {project.clusters && project.clusters.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {project.clusters.map((pc) => (
              <div
                key={pc.cluster_id}
                className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusIcon status={pc.cluster_status} />
                    <span className="font-medium truncate">{pc.cluster_name}</span>
                  </div>
                  {pc.cluster_provider && (
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {pc.cluster_provider}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2 mt-auto">
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-1"
                    onClick={() => handleConnect(pc.cluster_id)}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Connect
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemoveCluster(pc.cluster_id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
            <p className="text-muted-foreground mb-4">No clusters in this project yet.</p>
            <Button variant="outline" onClick={() => setAddClusterOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Cluster
            </Button>
          </div>
        )}
      </section>

      {/* Namespaces by cluster (multi-tenancy) */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Namespaces
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAddNamespaceClusterId(undefined);
              setAddNamespaceOpen(true);
            }}
            disabled={!project.clusters?.length}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Namespace
          </Button>
        </div>
        {project.clusters && project.clusters.length > 0 ? (
          <div className="space-y-4">
            {project.clusters?.map((c) => {
              const nsList = namespacesByCluster.get(c.cluster_id) ?? [];
              return (
                <div key={c.cluster_id} className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-sm">{c.cluster_name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        setAddNamespaceClusterId(c.cluster_id);
                        setAddNamespaceOpen(true);
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                    </Button>
                  </div>
                  {nsList.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {nsList.map((n) => (
                        <div
                          key={`${n.cluster_id}:${n.namespace_name}`}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 text-sm"
                        >
                          <span>{n.namespace_name}</span>
                          {n.team && (
                            <Badge variant="secondary" className="text-[10px]">
                              {n.team}
                            </Badge>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveNamespace(n.cluster_id, n.namespace_name)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No namespaces yet</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
            <p className="text-muted-foreground text-sm mb-4">
              Add clusters first, then add namespaces to organize workloads by team.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
