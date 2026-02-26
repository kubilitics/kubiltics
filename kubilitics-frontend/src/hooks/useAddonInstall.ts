import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useApi } from "./useApi";
import { useAddOnStore } from "../stores/addonStore";
import { ADDON_KEYS } from "./useAddOnCatalog";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { getAddonInstallStreamUrl } from "@/services/backendApiClient";
import type {
  InstallPlan,
  InstallRequest,
  InstallProgressEvent,
  AddOnUpgradePolicy,
} from "../types/api/addons";
import { toast } from "sonner";

// T6.FE-02: WebSocket reconnection constants
const WS_MAX_RETRIES = 3;
const WS_RECONNECT_DELAY_MS = 2000;

export function useAddonInstallFlow(clusterId: string) {
  const api = useApi();
  const store = useAddOnStore();
  const [error, setError] = useState<string | null>(null);
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);

  const resolvePlan = useCallback(
    async (addonId: string, namespace: string) => {
      setError(null);
      store.setActivePreflightReport(null);
      store.setActiveDryRunResult(null);
      store.setActiveCostEstimate(null);
      try {
        const plan = await api.planAddonInstall(clusterId, addonId, namespace);
        store.setActiveInstallPlan(plan);
        const costEstimate = await api.estimateAddonCost(clusterId, plan);
        store.setActiveCostEstimate(costEstimate ?? null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to resolve installation plan";
        setError(msg);
        store.setActiveInstallPlan(null);
        store.setActiveCostEstimate(null);
        throw err;
      }
    },
    [api, clusterId, store]
  );

  const runPreflight = useCallback(
    async (plan: InstallPlan) => {
      setError(null);
      try {
        const report = await api.runAddonPreflight(clusterId, plan);
        store.setActivePreflightReport(report);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Preflight failed";
        setError(msg);
        store.setActivePreflightReport(null);
        throw err;
      }
    },
    [api, clusterId, store]
  );

  const runDryRun = useCallback(
    async (req: InstallRequest) => {
      setError(null);
      try {
        const result = await api.dryRunAddonInstall(clusterId, req);
        store.setActiveDryRunResult(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Dry run failed";
        setError(msg);
        store.setActiveDryRunResult(null);
        throw err;
      }
    },
    [api, clusterId, store]
  );

  /**
   * T6.FE-02: Execute install over WebSocket with automatic reconnection.
   *
   * On unexpected disconnect the hook retries up to WS_MAX_RETRIES times with
   * WS_RECONNECT_DELAY_MS between attempts.  The last received event_id is
   * forwarded as ?last_event_id= so the server can resume from that point.
   * Each reconnect attempt appends a "warning" log line to installProgress so
   * the ExecuteStep timeline stays informative.
   */
  const executeInstall = useCallback(
    async (req: InstallRequest, onProgress?: (e: InstallProgressEvent) => void) => {
      store.clearInstallProgress();
      store.setIsInstalling(true);
      store.setInstallError(null);
      store.setWsReconnectAttempt(0);
      store.setWsReconnectStatus(null);

      return new Promise<void>((resolve, reject) => {
        // Track last seen event_id for resume on reconnect
        let lastEventId = 0;
        // Number of reconnect attempts made so far (0 = first connection)
        let attempt = 0;
        // Set to true once the server signals complete or failed
        let settled = false;

        const connect = () => {
          const baseWsUrl = getAddonInstallStreamUrl(backendBaseUrl, clusterId);
          // Append last_event_id on reconnects so the server can resume streaming
          const wsUrl = lastEventId > 0
            ? `${baseWsUrl}?last_event_id=${lastEventId}`
            : baseWsUrl;

          const ws = new WebSocket(wsUrl);
          ws.binaryType = "arraybuffer";

          ws.onopen = () => {
            ws.send(JSON.stringify(req));
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data as string) as
                | InstallProgressEvent
                | { status?: string; error?: string };

              if ("step" in data && "message" in data) {
                const progressEvent = data as InstallProgressEvent;
                // Track last event_id for WS resume on reconnect
                const eid = (progressEvent as any).event_id;
                if (typeof eid === 'number' && eid > lastEventId) {
                  lastEventId = eid;
                }
                store.appendInstallProgress(progressEvent);
                onProgress?.(progressEvent);
              } else if ("status" in data) {
                if (data.status === "complete") {
                  settled = true;
                  store.setIsInstalling(false);
                  store.setWsReconnectStatus(null);
                  ws.close();
                  resolve();
                } else if (data.status === "failed") {
                  settled = true;
                  const errMsg = (data as { error?: string }).error ?? "Installation failed";
                  store.setInstallError(errMsg);
                  store.setIsInstalling(false);
                  ws.close();
                  reject(new Error(errMsg));
                }
              }
            } catch {
              // ignore JSON parse errors (e.g. keep-alive pings)
            }
          };

          ws.onerror = () => {
            // onerror always fires before onclose; reconnect logic lives in onclose
          };

          ws.onclose = () => {
            // Clean shutdown after server-side complete/failed — nothing to do
            if (settled) return;

            attempt += 1;

            if (attempt > WS_MAX_RETRIES) {
              const errMsg =
                "Lost connection to server. The install may still be running. Check the Installed tab.";
              store.setWsReconnectStatus('exhausted');
              store.setInstallError(errMsg);
              store.setIsInstalling(false);
              reject(new Error(errMsg));
              return;
            }

            // Log the reconnect attempt into the install timeline
            store.setWsReconnectAttempt(attempt);
            store.setWsReconnectStatus('reconnecting');
            store.appendInstallProgress({
              step: "Connection",
              message: `Connection lost, reconnecting... (attempt ${attempt}/${WS_MAX_RETRIES})`,
              status: "warning",
              timestamp: new Date().toISOString(),
            });

            setTimeout(connect, WS_RECONNECT_DELAY_MS);
          };
        };

        connect();
      });
    },
    [backendBaseUrl, clusterId, store]
  );

  const reset = useCallback(() => {
    store.resetWizard();
    setError(null);
  }, [store]);

  return {
    plan: store.activeInstallPlan,
    preflight: store.activePreflightReport,
    costEstimate: store.activeCostEstimate,
    dryRun: store.activeDryRunResult,
    installProgress: store.installProgress,
    isLoading: store.isInstalling,
    wsReconnectAttempt: store.wsReconnectAttempt,
    wsReconnectStatus: store.wsReconnectStatus,
    error: error ?? store.installError,
    resolvePlan,
    runPreflight,
    runDryRun,
    executeInstall,
    reset,
  };
}

export function useAddonMutations(clusterId: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  const upgrade = useCallback(
    async (
      installId: string,
      version?: string,
      values?: Record<string, unknown>,
      reuseValues?: boolean
    ) => {
      await api.upgradeAddon(clusterId, installId, version, values, reuseValues);
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.installed(clusterId) });
      toast.success("Upgrade initiated");
    },
    [api, clusterId, queryClient]
  );

  const rollback = useCallback(
    async (installId: string, revision: number) => {
      await api.rollbackAddon(clusterId, installId, revision);
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.installed(clusterId) });
      toast.success("Rollback initiated");
    },
    [api, clusterId, queryClient]
  );

  const uninstall = useCallback(
    async (installId: string, deleteCrds?: boolean) => {
      await api.uninstallAddon(clusterId, installId, deleteCrds);
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.installed(clusterId) });
      toast.success("Uninstall initiated");
    },
    [api, clusterId, queryClient]
  );

  const setPolicy = useCallback(
    async (installId: string, policy: AddOnUpgradePolicy) => {
      await api.setAddonUpgradePolicy(clusterId, installId, policy);
      queryClient.invalidateQueries({ queryKey: ADDON_KEYS.installed(clusterId) });
      toast.success("Upgrade policy updated");
    },
    [api, clusterId, queryClient]
  );

  return {
    upgrade,
    rollback,
    uninstall,
    setPolicy,
  };
}
