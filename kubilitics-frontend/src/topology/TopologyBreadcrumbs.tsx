import { ChevronRight, Globe, Layers, Box, Target, Shield } from "lucide-react";
import type { ViewMode } from "./types/topology";
import { A11Y } from "./constants/designTokens";

export interface TopologyBreadcrumbsProps {
  viewMode: ViewMode;
  namespace?: string | null;
  resource?: string | null;
  onNavigate?: (viewMode: ViewMode) => void;
  onClearNamespace?: () => void;
}

export function TopologyBreadcrumbs({
  viewMode,
  namespace,
  resource,
  onNavigate,
  onClearNamespace,
}: TopologyBreadcrumbsProps) {
  const parts: {
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
  }[] = [
    {
      label: "cluster",
      icon: <Globe className="h-3 w-3" />,
      onClick: () => onNavigate?.("cluster"),
    },
  ];

  if (viewMode !== "cluster") {
    parts.push({
      label: namespace ?? "all namespaces",
      icon: <Layers className="h-3 w-3" />,
      onClick: () => {
        onNavigate?.("namespace");
        if (namespace) onClearNamespace?.();
      },
    });
  }
  if (viewMode === "workload" || viewMode === "resource") {
    parts.push({
      label: "workloads",
      icon: <Box className="h-3 w-3" />,
      onClick: () => onNavigate?.("workload"),
    });
  }
  if (viewMode === "resource" && resource) {
    parts.push({
      label: resource,
      icon: <Target className="h-3 w-3" />,
    });
  }
  if (viewMode === "rbac") {
    parts.push({
      label: "RBAC",
      icon: <Shield className="h-3 w-3" />,
    });
  }

  // Mark last item as active (not clickable)
  if (parts.length > 0) {
    parts[parts.length - 1].active = true;
    parts[parts.length - 1].onClick = undefined;
  }

  return (
    <nav
      className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-slate-800 px-4 py-2 text-xs"
      aria-label="Topology breadcrumb navigation"
    >
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-gray-500 dark:text-gray-400 mx-0.5" aria-hidden="true" />}
          {p.onClick && !p.active ? (
            <button
              type="button"
              className={`flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-white dark:hover:bg-gray-700 px-2 py-0.5 rounded-md transition-all ${A11Y.focusRing}`}
              onClick={p.onClick}
            >
              {p.icon}
              {p.label}
            </button>
          ) : (
            <span className={`flex items-center gap-1 ${
              p.active
                ? "font-semibold text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 shadow-sm"
                : "text-gray-600 dark:text-gray-400"
            }`}>
              {p.icon}
              {p.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
