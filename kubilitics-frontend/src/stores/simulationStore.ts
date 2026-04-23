/**
 * Zustand store for What-If Simulation Engine state.
 *
 * Holds the scenario list, simulation results, and UI flags.
 * Persists autoRun preference across sessions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Scenario, SimulationResult } from '@/services/api/simulation';
import { onClusterSwitch } from './clusterSwitch';

export interface SimulationState {
  scenarios: Scenario[];
  result: SimulationResult | null;
  isRunning: boolean;
  error: string | null;
  autoRun: boolean;

  // Actions
  addScenario: (scenario: Scenario) => void;
  removeScenario: (index: number) => void;
  reorderScenarios: (from: number, to: number) => void;
  clearScenarios: () => void;
  setResult: (result: SimulationResult | null) => void;
  setRunning: (running: boolean) => void;
  setError: (error: string | null) => void;
  toggleAutoRun: () => void;
}

export const useSimulationStore = create<SimulationState>()(
  persist(
    (set, get) => ({
      scenarios: [],
      result: null,
      isRunning: false,
      error: null,
      autoRun: false,

      addScenario: (scenario) =>
        set((s) => ({ scenarios: [...s.scenarios, scenario] })),

      removeScenario: (index) =>
        set((s) => ({
          scenarios: s.scenarios.filter((_, i) => i !== index),
        })),

      reorderScenarios: (from, to) => {
        const scenarios = [...get().scenarios];
        const [moved] = scenarios.splice(from, 1);
        scenarios.splice(to, 0, moved);
        set({ scenarios });
      },

      clearScenarios: () =>
        set({ scenarios: [], result: null, error: null }),

      setResult: (result) =>
        set({ result }),

      setRunning: (isRunning) =>
        set({ isRunning }),

      setError: (error) =>
        set({ error }),

      toggleAutoRun: () =>
        set((s) => ({ autoRun: !s.autoRun })),
    }),
    {
      name: 'kubilitics-simulation',
      partialize: (state) => ({
        autoRun: state.autoRun,
      }),
    }
  )
);

// Phase 2 / Gap 4 — scenarios target a specific cluster's workloads;
// on cluster switch drop the active list + last result so a simulation
// queued for cluster-A doesn't silently replay against cluster-B.
onClusterSwitch(() => {
  useSimulationStore.setState({
    scenarios: [],
    result: null,
    isRunning: false,
    error: null,
  });
});
