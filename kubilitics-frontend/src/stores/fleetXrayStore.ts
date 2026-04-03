/**
 * Zustand store for Fleet X-Ray state.
 *
 * Holds ephemeral UI state: selected clusters for comparison, active template,
 * and DR assessment pair. Data (clusters[], templates[], etc.) lives in
 * React Query cache -- this store only manages selection/UI state.
 */
import { create } from 'zustand';

interface FleetXrayState {
  /** Two-element tuple for cluster comparison selection. */
  selectedClusters: [string | null, string | null];
  /** Currently active golden template ID (for scores view). */
  activeTemplateId: string | null;
  /** DR assessment: primary cluster ID. */
  drPrimaryId: string | null;
  /** DR assessment: backup cluster ID. */
  drBackupId: string | null;

  setSelectedClusterA: (id: string | null) => void;
  setSelectedClusterB: (id: string | null) => void;
  setActiveTemplateId: (id: string | null) => void;
  setDRPrimaryId: (id: string | null) => void;
  setDRBackupId: (id: string | null) => void;
  resetSelections: () => void;
}

export const useFleetXrayStore = create<FleetXrayState>()((set) => ({
  selectedClusters: [null, null],
  activeTemplateId: null,
  drPrimaryId: null,
  drBackupId: null,

  setSelectedClusterA: (id) =>
    set((state) => ({ selectedClusters: [id, state.selectedClusters[1]] })),
  setSelectedClusterB: (id) =>
    set((state) => ({ selectedClusters: [state.selectedClusters[0], id] })),
  setActiveTemplateId: (id) => set({ activeTemplateId: id }),
  setDRPrimaryId: (id) => set({ drPrimaryId: id }),
  setDRBackupId: (id) => set({ drBackupId: id }),
  resetSelections: () =>
    set({
      selectedClusters: [null, null],
      activeTemplateId: null,
      drPrimaryId: null,
      drBackupId: null,
    }),
}));
