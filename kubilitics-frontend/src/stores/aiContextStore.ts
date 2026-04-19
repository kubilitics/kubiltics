import { create } from 'zustand';

export type AIContext = {
  type:
    | 'pod' | 'deployment' | 'node' | 'namespace' | 'service'
    | 'ingress' | 'event' | 'cluster' | 'dashboard' | 'topology' | 'blast-radius';
  cluster: string;
  namespace?: string;
  name?: string;
  page?: string;
  extra?: Record<string, string | number>;
};

interface AIContextState {
  implicit: AIContext | null;
  explicit: AIContext | null;
  setImplicit: (ctx: AIContext | null) => void;
  setExplicit: (ctx: AIContext | null) => void;
  current: () => AIContext | null;
}

export const useAIContextStore = create<AIContextState>((set, get) => ({
  implicit: null,
  explicit: null,
  setImplicit: (ctx) => set({ implicit: ctx }),
  setExplicit: (ctx) => set({ explicit: ctx }),
  current: () => get().explicit ?? get().implicit,
}));
