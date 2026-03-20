import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ADDON_KEYS } from "@/hooks/useAddOnCatalog";
import { useAddOnStore } from "@/stores/addonStore";
import { toast } from "sonner";

/**
 * InstallGuard — Resilient install state tracking across page reloads.
 *
 * Problem: If the user refreshes the browser mid-install, the Zustand store
 * resets and we lose all context about the in-flight install. The addon might
 * complete on the cluster, but the UI has no idea an install was pending.
 *
 * Solution: This component persists a minimal install intent to localStorage
 * when an install begins, and on mount checks if there's a pending intent.
 * If found, it triggers an immediate cache refresh and shows a toast
 * notification about the recovered install.
 *
 * Usage: Mount this component once in the AddOns page or App layout.
 *   <InstallGuard clusterId={clusterId} />
 */

const STORAGE_KEY = "kubilitics:pending-install";

interface PendingInstall {
  clusterId: string;
  releaseName: string;
  addonId: string;
  startedAt: string;
}

function getPendingInstall(): PendingInstall | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingInstall;
  } catch {
    return null;
  }
}

function setPendingInstall(data: PendingInstall) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable — degrade gracefully
  }
}

function clearPendingInstall() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable — degrade gracefully
  }
}

export function InstallGuard({ clusterId }: { clusterId: string }) {
  const queryClient = useQueryClient();
  const { isInstalling, activeInstallPlan } = useAddOnStore();
  const recoveryDoneRef = useRef(false);

  // Persist install intent when an install begins
  useEffect(() => {
    if (isInstalling && activeInstallPlan && clusterId) {
      const primaryStep = activeInstallPlan.steps?.[0];
      setPendingInstall({
        clusterId,
        releaseName: primaryStep?.release_name ?? "",
        addonId: primaryStep?.addon_id ?? activeInstallPlan.requested_addon_id ?? "",
        startedAt: new Date().toISOString(),
      });
    }
  }, [isInstalling, activeInstallPlan, clusterId]);

  // Clear pending install when install completes (isInstalling goes false)
  useEffect(() => {
    if (!isInstalling) {
      clearPendingInstall();
    }
  }, [isInstalling]);

  // On mount: check for a pending install from a previous session (page reload)
  useEffect(() => {
    if (recoveryDoneRef.current || !clusterId) return;
    recoveryDoneRef.current = true;

    const pending = getPendingInstall();
    if (!pending) return;
    if (pending.clusterId !== clusterId) {
      clearPendingInstall();
      return;
    }

    // Check if the install started less than 10 minutes ago (reasonable max install time)
    const elapsed = Date.now() - new Date(pending.startedAt).getTime();
    const TEN_MINUTES = 10 * 60 * 1000;
    if (elapsed > TEN_MINUTES) {
      clearPendingInstall();
      return;
    }

    // We found a recent pending install — force-refresh the installed addons
    queryClient.invalidateQueries({ queryKey: ADDON_KEYS.installed(clusterId) });

    toast.info(`Recovering install status for ${pending.releaseName || pending.addonId}`, {
      description: "The page was reloaded during installation. Checking current status...",
      duration: 5000,
    });

    clearPendingInstall();
  }, [clusterId, queryClient]);

  return null; // Render nothing — this is a behavior-only component
}
