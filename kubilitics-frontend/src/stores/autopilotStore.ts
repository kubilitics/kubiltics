import { create } from 'zustand';
import type { AutoPilotFinding, AutoPilotAction, AutoPilotRuleConfig } from '@/services/api/autopilot';
import { onClusterSwitch } from './clusterSwitch';

interface AutoPilotState {
  /** Current findings from the latest scan. */
  findings: AutoPilotFinding[];
  /** Action records (audit trail / pending approvals). */
  actions: AutoPilotAction[];
  /** Per-rule configuration for the active cluster. */
  config: AutoPilotRuleConfig[];
  /** Whether a scan is currently running. */
  isScanning: boolean;

  setFindings: (findings: AutoPilotFinding[]) => void;
  setActions: (actions: AutoPilotAction[]) => void;
  /** Mark a specific action as applied (optimistic update). */
  approveAction: (actionId: string) => void;
  /** Mark a specific action as dismissed (optimistic update). */
  dismissAction: (actionId: string) => void;
  setConfig: (config: AutoPilotRuleConfig[]) => void;
  updateConfig: (ruleId: string, patch: Partial<AutoPilotRuleConfig>) => void;
  setIsScanning: (scanning: boolean) => void;
}

export const useAutoPilotStore = create<AutoPilotState>((set) => ({
  findings: [],
  actions: [],
  config: [],
  isScanning: false,

  setFindings: (findings) => set({ findings }),

  setActions: (actions) => set({ actions }),

  approveAction: (actionId) =>
    set((state) => ({
      actions: state.actions.map((a) =>
        a.id === actionId ? { ...a, status: 'applied' as const } : a,
      ),
    })),

  dismissAction: (actionId) =>
    set((state) => ({
      actions: state.actions.map((a) =>
        a.id === actionId ? { ...a, status: 'dismissed' as const } : a,
      ),
    })),

  setConfig: (config) => set({ config }),

  updateConfig: (ruleId, patch) =>
    set((state) => ({
      config: state.config.map((c) =>
        c.rule_id === ruleId ? { ...c, ...patch } : c,
      ),
    })),

  setIsScanning: (isScanning) => set({ isScanning }),
}));

// Phase 2 / Gap 4 — findings/actions/config are all cluster-scoped; on
// cluster switch wipe everything so the AutoPilot page never shows
// the prior cluster's recommendations after the active id rotates.
onClusterSwitch(() => {
  useAutoPilotStore.setState({
    findings: [],
    actions: [],
    config: [],
    isScanning: false,
  });
});
