import { useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ViewMode } from "../types/topology";

export interface NavigationState {
  viewMode: ViewMode;
  namespace: string;
  resource: string;
  clusterId: string;
}

const VIEW_MODE_MAP: Record<string, ViewMode> = {
  cluster: "cluster",
  namespace: "namespace",
  workload: "workload",
  resource: "resource",
  rbac: "rbac",
};

/**
 * useTopologyNavigation: Syncs topology view state with URL search params.
 * Supports deep-link URLs and browser back/forward navigation.
 */
export function useTopologyNavigation(
  onStateChange?: (state: NavigationState) => void
) {
  const [searchParams, setSearchParams] = useSearchParams();

  const currentState: NavigationState = {
    viewMode: (VIEW_MODE_MAP[searchParams.get("mode") ?? ""] ?? "namespace") as ViewMode,
    namespace: searchParams.get("ns") ?? "",
    resource: searchParams.get("resource") ?? "",
    clusterId: searchParams.get("cluster") ?? "",
  };

  // Sync URL changes back to component state
  useEffect(() => {
    onStateChange?.(currentState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const navigate = useCallback(
    (updates: Partial<NavigationState>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (updates.viewMode) next.set("mode", updates.viewMode);
        if (updates.namespace !== undefined) {
          if (updates.namespace) next.set("ns", updates.namespace);
          else next.delete("ns");
        }
        if (updates.resource !== undefined) {
          if (updates.resource) next.set("resource", updates.resource);
          else next.delete("resource");
        }
        if (updates.clusterId !== undefined) {
          if (updates.clusterId) next.set("cluster", updates.clusterId);
          else next.delete("cluster");
        }
        return next;
      }, { replace: false });
    },
    [setSearchParams]
  );

  const navigateToView = useCallback(
    (mode: ViewMode, params?: { namespace?: string; resource?: string }) => {
      navigate({
        viewMode: mode,
        namespace: params?.namespace ?? currentState.namespace,
        resource: params?.resource ?? "",
      });
    },
    [navigate, currentState.namespace]
  );

  const navigateToResource = useCallback(
    (kind: string, ns: string, name: string) => {
      const resourceId = ns ? `${kind}/${ns}/${name}` : `${kind}/${name}`;
      navigate({
        viewMode: "resource",
        namespace: ns,
        resource: resourceId,
      });
    },
    [navigate]
  );

  return {
    ...currentState,
    navigate,
    navigateToView,
    navigateToResource,
  };
}
