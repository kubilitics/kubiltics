import { create } from 'zustand';
import { onClusterSwitch } from './clusterSwitch';

export interface CausalNode {
  resourceKey: string;
  kind: string;
  namespace: string;
  name: string;
  eventReason: string;
  eventMessage: string;
  timestamp: string;
  healthStatus: string;
}

export interface CausalLinkV2 {
  cause: CausalNode;
  effect: CausalNode;
  rule: string;
  confidence: number;
  timeDeltaMs: number;
}

export interface CausalChain {
  id: string;
  clusterId: string;
  insightId?: string;
  rootCause: CausalNode;
  links: CausalLinkV2[];
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface CausalChainState {
  activeChainId: string | null;
  chainData: CausalChain | null;
  highlightedStep: number | null;
  isTimelineExpanded: boolean;
  overlayEnabled: boolean;

  setActiveChain: (chain: CausalChain) => void;
  clearActiveChain: () => void;
  setHighlightedStep: (step: number | null) => void;
  toggleTimeline: () => void;
  toggleOverlay: () => void;
}

// No localStorage persistence — chains are ephemeral
export const useCausalChainStore = create<CausalChainState>()((set) => ({
  activeChainId: null,
  chainData: null,
  highlightedStep: null,
  isTimelineExpanded: false,
  overlayEnabled: false,

  setActiveChain: (chain) =>
    set({ activeChainId: chain.id, chainData: chain, overlayEnabled: true }),

  clearActiveChain: () =>
    set({
      activeChainId: null,
      chainData: null,
      highlightedStep: null,
      isTimelineExpanded: false,
      overlayEnabled: false,
    }),

  setHighlightedStep: (step) => set({ highlightedStep: step }),

  toggleTimeline: () => set((s) => ({ isTimelineExpanded: !s.isTimelineExpanded })),

  toggleOverlay: () =>
    set((s) => ({
      overlayEnabled: !s.overlayEnabled,
      ...(s.overlayEnabled ? { highlightedStep: null, isTimelineExpanded: false } : {}),
    })),
}));

// Phase 2 / Gap 4 — causal chains are cluster-scoped; on cluster switch
// drop the active chain so the topology overlay doesn't paint
// yesterday's cluster.
onClusterSwitch(() => {
  useCausalChainStore.setState({
    activeChainId: null,
    chainData: null,
    highlightedStep: null,
    isTimelineExpanded: false,
    overlayEnabled: false,
  });
});
