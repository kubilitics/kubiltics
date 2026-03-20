import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ProjectCluster {
    cluster_id: string;
    namespaces: string[];
}

export interface Project {
    id: string;
    name: string;
    description?: string;
    clusters: ProjectCluster[];
}

interface ProjectState {
    activeProjectId: string | null;
    activeProject: Project | null;
    setActiveProject: (project: Project | null) => void;
    clearActiveProject: () => void;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set) => ({
            activeProjectId: null,
            activeProject: null,
            setActiveProject: (project) => set({
                activeProject: project,
                activeProjectId: project?.id ?? null
            }),
            clearActiveProject: () => set({
                activeProject: null,
                activeProjectId: null
            }),
        }),
        {
            name: 'kubilitics-project-store',
        }
    )
);
