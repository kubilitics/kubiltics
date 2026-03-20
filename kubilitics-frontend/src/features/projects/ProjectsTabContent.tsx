/**
 * Projects Tab Content — List of projects with search and create.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  FolderKanban,
  Loader2,
  ChevronRight,
  Server,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjects } from '@/hooks/useProjects';
import { CreateProjectModal } from './CreateProjectModal';
import { cn } from '@/lib/utils';

export function ProjectsTabContent() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];

  const filtered = projects.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Create Project
        </Button>
      </div>

      {projectsQuery.isLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading projects…</p>
        </div>
      )}

      {projectsQuery.error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-6 flex flex-col gap-4">
          <p className="text-destructive font-medium">Failed to load projects</p>
          <p className="text-sm text-muted-foreground">
            {projectsQuery.error instanceof Error ? projectsQuery.error.message : 'Unknown error'}
          </p>
          <Button variant="outline" onClick={() => projectsQuery.refetch()} className="w-fit">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {!projectsQuery.isLoading && !projectsQuery.error && filtered.length === 0 && (
        <div className="relative overflow-hidden rounded-3xl border border-dashed border-border bg-gradient-to-b from-muted/50 to-muted/20 p-16 text-center">
          <div className="absolute inset-0 bg-grid-slate-200 [mask-image:linear-gradient(0deg,#fff,rgba(255,255,255,0.6))] dark:bg-grid-slate-800 -z-10" />
          <div className="relative">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-8 ring-primary/5">
              <FolderKanban className="h-10 w-10" />
            </div>
            <h3 className="text-2xl font-bold tracking-tight mb-2">No projects discovered</h3>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto text-balance">
              {searchQuery
                ? `We couldn't find any projects matching "${searchQuery}".`
                : 'Projects are the heart of your organization. Group clusters and namespaces by environment, team, or application to stay organized.'}
            </p>
            {!searchQuery && (
              <Button onClick={() => setCreateOpen(true)} size="lg" className="rounded-full px-8 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all">
                <Plus className="h-5 w-5 mr-2" />
                Initialize First Project
              </Button>
            )}
          </div>
        </div>
      )}

      {!projectsQuery.isLoading && !projectsQuery.error && filtered.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => navigate(`/projects/${project.id}`)}
              className={cn(
                'group relative flex flex-col gap-5 p-7 rounded-2xl border border-border bg-card text-left transition-all duration-300',
                'hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 hover:-translate-y-1',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
              )}
            >
              <div className="flex items-start justify-between">
                <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                  <FolderKanban className="h-6 w-6" />
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 bg-primary/10 text-primary transition-all duration-300 -translate-x-2 group-hover:translate-x-0">
                  <ChevronRight className="h-5 w-5" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-xl tracking-tight group-hover:text-primary transition-colors">{project.name}</h3>
                {project.description ? (
                  <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{project.description}</p>
                ) : (
                  <p className="text-sm text-muted-foreground/50 italic font-light italic leading-relaxed">No description provided</p>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground mt-auto pt-4 border-t border-border/50">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/50">
                  <Server className="h-3.5 w-3.5" />
                  {typeof project.cluster_count === 'number' ? `${project.cluster_count} Cluster${project.cluster_count !== 1 ? 's' : ''}` : 'Clusters'}
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/50">
                  <Layers className="h-3.5 w-3.5" />
                  {typeof project.namespace_count === 'number' ? `${project.namespace_count} Namespace${project.namespace_count !== 1 ? 's' : ''}` : 'Namespaces'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => projectsQuery.refetch()}
      />
    </div>
  );
}
