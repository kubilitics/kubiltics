import { BackendProject } from '@/services/backendApiClient';
import { Focus, ArrowRight, Settings, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ProjectCardProps {
    project: BackendProject;
    /** Primary action: open project dashboard */
    onClick?: () => void;
    /** Secondary action: open project settings (e.g. icon click) */
    onSettingsClick?: (e: React.MouseEvent) => void;
    /** Tertiary action: delete project */
    onDeleteClick?: (e: React.MouseEvent) => void;
}

export function ProjectCard({ project, onClick, onSettingsClick, onDeleteClick }: ProjectCardProps) {
    return (
        <div
            className="glass-card glass-card-hover group cursor-pointer relative overflow-hidden h-[340px] flex flex-col justify-between"
            onClick={onClick}
        >
            {/* Subtle Top Shine */}
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/50 to-transparent z-20" />

            <div className="p-8 relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-start mb-10">
                    <div className="relative">
                        {/* Soft Glow behind icon */}
                        <div className="absolute inset-x-0 -inset-y-4 bg-blue-500/10 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />

                        <div className="relative h-16 w-16 bg-white rounded-[1.5rem] flex items-center justify-center shadow-sm border border-slate-100 group-hover:border-blue-200 group-hover:-translate-y-1.5 transition-all duration-700 ease-spring">
                            <Focus className="h-8 w-8 text-slate-400 group-hover:text-blue-600 transition-colors duration-500" />
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {onSettingsClick && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-full text-slate-400 hover:text-slate-900 hover:bg-white/90 shadow-sm transition-all"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSettingsClick(e);
                                }}
                            >
                                <Settings className="h-4.5 w-4.5" />
                            </Button>
                        )}
                        {onDeleteClick && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50/80 shadow-sm transition-all"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteClick(e);
                                }}
                            >
                                <Trash2 className="h-4.5 w-4.5" />
                            </Button>
                        )}
                    </div>
                </div>

                <div className="space-y-3">
                    <h3 className="apple-title text-2xl group-hover:text-blue-700 transition-colors duration-500">{project.name}</h3>
                    <p className="apple-description text-sm line-clamp-2 min-h-[2.5rem] opacity-80">
                        {project.description || "Synthesizing multi-cluster logic into a unified governance scope."}
                    </p>
                </div>

                <div className="mt-auto pt-8 border-t border-white/40 flex items-center justify-between">
                    <div className="flex gap-8">
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Clusters</span>
                            <span className="text-xl font-bold text-slate-900 tabular-nums">{project.cluster_count || 0}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Resources</span>
                            <span className="text-xl font-bold text-slate-900 tabular-nums">{project.namespace_count || 0}</span>
                        </div>
                    </div>

                    <div className="h-12 w-12 rounded-full bg-white/50 flex items-center justify-center group-hover:bg-blue-600 group-hover:shadow-xl group-hover:shadow-blue-500/25 transition-all duration-700 ease-spring group-hover:translate-x-1">
                        <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-white transition-colors duration-500" />
                    </div>
                </div>
            </div>

            {/* Premium Background Accent */}
            <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-blue-500/5 blur-[80px] rounded-full pointer-events-none group-hover:bg-blue-500/10 transition-colors duration-700" />
        </div>
    );
}
