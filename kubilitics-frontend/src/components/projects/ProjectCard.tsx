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
                'group relative flex flex-col gap-5 p-6 rounded-2xl cursor-pointer',
                'bg-card border border-border/60',
                'shadow-sm hover:shadow-xl hover:shadow-black/5',
                'hover:border-primary/30 hover:-translate-y-0.5',
                'transition-all duration-300',
                'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2'
            )}
            onClick={onClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
        >
            {/* Top row: icon + action buttons */}
            <div className="flex items-start justify-between">
                {/* Project icon */}
                <div className={cn(
                    'relative h-14 w-14 rounded-2xl flex items-center justify-center',
                    'bg-primary/10 text-primary',
                    'group-hover:bg-primary group-hover:text-primary-foreground',
                    'transition-all duration-300 ease-out'
                )}>
                    <FolderKanban className="h-6 w-6" />
                </div>

                {/* Action buttons + animated arrow */}
                <div className="flex items-center gap-1">
                    {onSettingsClick && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary opacity-0 group-hover:opacity-100 transition-all duration-200"
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
                    <div className={cn(
                        'h-8 w-8 rounded-full flex items-center justify-center',
                        'bg-secondary text-muted-foreground',
                        'group-hover:bg-primary group-hover:text-primary-foreground',
                        'group-hover:translate-x-0.5',
                        'transition-all duration-300'
                    )}>
                        <ArrowRight className="h-4 w-4" />
                    </div>
                </div>
            </div>

            {/* Title + description */}
            <div className="space-y-1.5">
                <h3 className="font-bold text-[17px] tracking-tight leading-snug text-foreground group-hover:text-primary transition-colors duration-200">
                    {project.name}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 min-h-[2.5rem]">
                    {project.description || 'No description provided.'}
                </p>
            </div>

            {/* Stats footer */}
            <div className="flex items-center gap-3 pt-4 border-t border-border/50 mt-auto">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/60 text-xs font-medium text-muted-foreground">
                    <Server className="h-3.5 w-3.5 text-primary/60" />
                    {typeof project.cluster_count === 'number'
                        ? `${project.cluster_count} Cluster${project.cluster_count !== 1 ? 's' : ''}`
                        : 'Clusters'}
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/60 text-xs font-medium text-muted-foreground">
                    <Layers className="h-3.5 w-3.5 text-primary/60" />
                    {typeof project.namespace_count === 'number'
                        ? `${project.namespace_count} Namespace${project.namespace_count !== 1 ? 's' : ''}`
                        : 'Namespaces'}
                </span>
            </div>
        </div>
    );
}
