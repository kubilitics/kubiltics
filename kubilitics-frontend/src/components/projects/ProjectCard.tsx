import { BackendProject } from '@/services/backendApiClient';
import { FolderKanban, ArrowRight, Settings, Trash2, Server, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProjectCardProps {
    project: BackendProject;
    /** Primary action: open project dashboard */
    onClick?: () => void;
    /** Secondary action: open project settings */
    onSettingsClick?: (e: React.MouseEvent) => void;
    /** Tertiary action: delete project */
    onDeleteClick?: (e: React.MouseEvent) => void;
}

export function ProjectCard({ project, onClick, onSettingsClick, onDeleteClick }: ProjectCardProps) {
    return (
        <div
            role="button"
            tabIndex={0}
            className={cn(
                'group relative flex flex-col gap-4 p-5 cursor-pointer',
                'bg-white dark:bg-[hsl(228,14%,11%)]',
                'border border-slate-200 dark:border-slate-700',
                'rounded-2xl overflow-hidden',
                'shadow',
                'transition-all duration-300',
                'hover:border-indigo-200 dark:hover:border-indigo-900',
                'hover:shadow-[var(--shadow-3)] hover:-translate-y-[2px]',
                'active:translate-y-0 active:shadow',
                'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2'
            )}
            style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
            onClick={onClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
        >
            {/* Top row: icon + action buttons */}
            <div className="flex items-start justify-between">
                {/* Project icon — tinted, not solid */}
                <div className="h-11 w-11 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center shrink-0">
                    <FolderKanban className="h-5 w-5 text-indigo-500 dark:text-indigo-400" strokeWidth={1.75} />
                </div>

                {/* Action buttons + arrow */}
                <div className="flex items-center gap-1">
                    {onSettingsClick && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-all duration-200"
                            onClick={(e) => { e.stopPropagation(); onSettingsClick(e); }}
                            aria-label="Project settings"
                        >
                            <Settings className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    {onDeleteClick && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all duration-200"
                            onClick={(e) => { e.stopPropagation(); onDeleteClick(e); }}
                            aria-label="Delete project"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center group-hover:bg-indigo-500 transition-colors duration-300">
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors duration-300" />
                    </div>
                </div>
            </div>

            {/* Title + description */}
            <div className="space-y-1">
                <h3 className="font-semibold text-[15px] tracking-tight leading-snug text-foreground group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-200">
                    {project.name}
                </h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2 min-h-[2.5rem]">
                    {project.description || 'No description provided.'}
                </p>
            </div>

            {/* Stats footer */}
            <div className="flex items-center gap-2.5 pt-3.5 border-t border-border/50 mt-auto">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/60 dark:bg-muted/30 text-[11px] font-medium text-muted-foreground">
                    <Server className="h-3 w-3 text-blue-500/60 dark:text-blue-400/60" />
                    {typeof project.cluster_count === 'number'
                        ? `${project.cluster_count} Cluster${project.cluster_count !== 1 ? 's' : ''}`
                        : 'Clusters'}
                </span>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/60 dark:bg-muted/30 text-[11px] font-medium text-muted-foreground">
                    <Layers className="h-3 w-3 text-teal-500/60 dark:text-teal-400/60" />
                    {typeof project.namespace_count === 'number'
                        ? `${project.namespace_count} Namespace${project.namespace_count !== 1 ? 's' : ''}`
                        : 'Namespaces'}
                </span>
            </div>
        </div>
    );
}
