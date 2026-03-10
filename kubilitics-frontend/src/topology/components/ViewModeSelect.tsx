import type { ViewMode } from "../types/topology";
import {
  Globe, Layers, Box, Target, Shield,
} from "lucide-react";

export interface ViewModeSelectProps {
  value?: ViewMode;
  onChange?: (mode: ViewMode) => void;
}

const modes: { value: ViewMode; label: string; icon: React.ReactNode; shortcut: string; description: string }[] = [
  { value: "cluster", label: "Cluster", icon: <Globe className="h-3.5 w-3.5" />, shortcut: "1", description: "Cluster-scoped resources" },
  { value: "namespace", label: "Namespace", icon: <Layers className="h-3.5 w-3.5" />, shortcut: "2", description: "All resources" },
  { value: "workload", label: "Workload", icon: <Box className="h-3.5 w-3.5" />, shortcut: "3", description: "Deployments, Pods, Services" },
  { value: "resource", label: "Resource", icon: <Target className="h-3.5 w-3.5" />, shortcut: "4", description: "Focus on specific resource" },
  { value: "rbac", label: "RBAC", icon: <Shield className="h-3.5 w-3.5" />, shortcut: "5", description: "Roles & permissions" },
];

const activeColors: Record<ViewMode, string> = {
  cluster: "bg-blue-50 text-blue-700 border-blue-200 shadow-blue-100",
  namespace: "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-emerald-100",
  workload: "bg-violet-50 text-violet-700 border-violet-200 shadow-violet-100",
  resource: "bg-amber-50 text-amber-700 border-amber-200 shadow-amber-100",
  rbac: "bg-pink-50 text-pink-700 border-pink-200 shadow-pink-100",
};

export function ViewModeSelect({ value = "namespace", onChange }: ViewModeSelectProps) {
  return (
    <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50/80 p-0.5 gap-0.5">
      {modes.map((m) => {
        const isActive = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${
              isActive
                ? `${activeColors[m.value]} shadow-sm border`
                : "text-gray-500 hover:text-gray-700 hover:bg-white/60 border border-transparent"
            }`}
            onClick={() => onChange?.(m.value)}
            title={`${m.description} (${m.shortcut})`}
          >
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
