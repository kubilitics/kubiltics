import { create } from "zustand";
import type {
  AddOnEntry,
  AddOnDetail,
  AddOnInstallWithHealth,
  AddOnStatus,
  DryRunResult,
  FinancialStack,
  InstallPlan,
  InstallProgressEvent,
  PlanCostEstimate,
  PreflightReport,
} from "../types/api/addons";

interface AddOnState {
  // Catalog
  catalogEntries: AddOnEntry[];
  selectedCatalogEntry: AddOnDetail | null;

  // Installed (per cluster)
  installedAddons: Record<string, AddOnInstallWithHealth[]>;

  // Wizard / active flow
  activeInstallPlan: InstallPlan | null;
  activePreflightReport: PreflightReport | null;
  activeDryRunResult: DryRunResult | null;
  activeCostEstimate: PlanCostEstimate | null;
  installProgress: InstallProgressEvent[];
  isInstalling: boolean;
  installError: string | null;
  // WebSocket reconnection state (T6.FE-02)
  wsReconnectAttempt: number;
  wsReconnectStatus: 'reconnecting' | 'exhausted' | null;
  // Values editor state (T6.FE-03)
  valuesYaml: string;
  yamlValidationError: string | null;

  // Financial stack (cluster-level)
  financialStack: FinancialStack | null;

  // Actions
  setCatalog: (entries: AddOnEntry[]) => void;
  setSelectedCatalogEntry: (entry: AddOnDetail | null) => void;
  setInstalledAddons: (clusterId: string, installs: AddOnInstallWithHealth[]) => void;
  updateInstallStatus: (installId: string, status: AddOnStatus) => void;
  setActiveInstallPlan: (plan: InstallPlan | null) => void;
  setActivePreflightReport: (report: PreflightReport | null) => void;
  setActiveDryRunResult: (result: DryRunResult | null) => void;
  setActiveCostEstimate: (estimate: PlanCostEstimate | null) => void;
  appendInstallProgress: (event: InstallProgressEvent) => void;
  clearInstallProgress: () => void;
  setIsInstalling: (v: boolean) => void;
  setInstallError: (err: string | null) => void;
  setWsReconnectAttempt: (n: number) => void;
  setWsReconnectStatus: (s: 'reconnecting' | 'exhausted' | null) => void;
  setValuesYaml: (yaml: string) => void;
  setYamlValidationError: (err: string | null) => void;
  setFinancialStack: (stack: FinancialStack | null) => void;
  resetWizard: () => void;
}

export const useAddOnStore = create<AddOnState>((set, _get) => ({
  catalogEntries: [],
  selectedCatalogEntry: null,
  installedAddons: {},
  activeInstallPlan: null,
  activePreflightReport: null,
  activeDryRunResult: null,
  activeCostEstimate: null,
  installProgress: [],
  isInstalling: false,
  installError: null,
  wsReconnectAttempt: 0,
  wsReconnectStatus: null,
  valuesYaml: "",
  yamlValidationError: null,
  financialStack: null,

  setCatalog: (entries) => set({ catalogEntries: entries }),
  setSelectedCatalogEntry: (entry) => set({ selectedCatalogEntry: entry }),
  setInstalledAddons: (clusterId, installs) =>
    set((state) => ({
      installedAddons: { ...state.installedAddons, [clusterId]: installs },
    })),
  updateInstallStatus: (installId, status) =>
    set((state) => {
      const next: Record<string, AddOnInstallWithHealth[]> = {};
      for (const [cid, list] of Object.entries(state.installedAddons)) {
        next[cid] = list.map((i) =>
          i.id === installId ? { ...i, status } : i
        );
      }
      return { installedAddons: next };
    }),
  setActiveInstallPlan: (plan) => set({ activeInstallPlan: plan }),
  setActivePreflightReport: (report) => set({ activePreflightReport: report }),
  setActiveDryRunResult: (result) => set({ activeDryRunResult: result }),
  setActiveCostEstimate: (estimate) => set({ activeCostEstimate: estimate }),
  appendInstallProgress: (event) =>
    set((state) => ({
      installProgress: [...state.installProgress, event],
    })),
  clearInstallProgress: () => set({ installProgress: [] }),
  setIsInstalling: (v) => set({ isInstalling: v }),
  setInstallError: (err) => set({ installError: err }),
  setWsReconnectAttempt: (n) => set({ wsReconnectAttempt: n }),
  setWsReconnectStatus: (s) => set({ wsReconnectStatus: s }),
  setValuesYaml: (yaml) => set({ valuesYaml: yaml }),
  setYamlValidationError: (err) => set({ yamlValidationError: err }),
  setFinancialStack: (stack) => set({ financialStack: stack }),
  resetWizard: () =>
    set({
      activeInstallPlan: null,
      activePreflightReport: null,
      activeDryRunResult: null,
      activeCostEstimate: null,
      installProgress: [],
      isInstalling: false,
      installError: null,
      wsReconnectAttempt: 0,
      wsReconnectStatus: null,
      valuesYaml: "",
      yamlValidationError: null,
    }),
}));
