import type { ViewMode } from "../types/topology";
import {
  Globe, Layers, Box, Target, Shield,
} from "lucide-react";

export interface ViewModeSelectProps {
  value?: ViewMode;
  onChange?: (mode: ViewMode) => void;
}

const modes: {
  value: ViewMode;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
  description: string;
  gradient: string;
  activeBg: string;
  activeText: string;
  activeBorder: string;
  dotColor: string;
}[] = [
  {
    value: "cluster",
    label: "Cluster",
    icon: <Globe className="h-3.5 w-3.5" />,
    shortcut: "1",
    description: "Cluster-scoped resources",
    gradient: "from-blue-500 to-blue-600",
    activeBg: "bg-gradient-to-r from-blue-50 to-blue-100/60",
    activeText: "text-blue-700",
    activeBorder: "border-blue-200 ring-1 ring-blue-100",
    dotColor: "bg-blue-500",
  },
  {
    value: "namespace",
    label: "Namespace",
    icon: <Layers className="h-3.5 w-3.5" />,
    shortcut: "2",
    description: "All resources",
    gradient: "from-emerald-500 to-emerald-600",
    activeBg: "bg-gradient-to-r from-emerald-50 to-emerald-100/60",
    activeText: "text-emerald-700",
    activeBorder: "border-emerald-200 ring-1 ring-emerald-100",
    dotColor: "bg-emerald-500",
  },
  {
    value: "workload",
    label: "Workload",
    icon: <Box className="h-3.5 w-3.5" />,
    shortcut: "3",
    description: "Deployments, Pods, Services",
    gradient: "from-violet-500 to-violet-600",
    activeBg: "bg-gradient-to-r from-violet-50 to-violet-100/60",
    activeText: "text-violet-700",
    activeBorder: "border-violet-200 ring-1 ring-violet-100",
    dotColor: "bg-violet-500",
  },
  {
    value: "resource",
    label: "Resource",
    icon: <Target className="h-3.5 w-3.5" />,
    shortcut: "4",
    description: "Focus on specific resource",
    gradient: "from-amber-500 to-amber-600",
    activeBg: "bg-gradient-to-r from-amber-50 to-amber-100/60",
    activeText: "text-amber-700",
    activeBorder: "border-amber-200 ring-1 ring-amber-100",
    dotColor: "bg-amber-500",
  },
  {
    value: "rbac",
    label: "RBAC",
    icon: <Shield className="h-3.5 w-3.5" />,
    shortcut: "5",
    description: "Roles & permissions",
    gradient: "from-pink-500 to-pink-600",
    activeBg: "bg-gradient-to-r from-pink-50 to-pink-100/60",
    activeText: "text-pink-700",
    activeBorder: "border-pink-200 ring-1 ring-pink-100",
    dotColor: "bg-pink-500",
  },
];

export function ViewModeSelect({ value = "namespace", onChange }: ViewModeSelectProps) {
  return (
    <div className="inline-flex items-center rounded-xl bg-gray-100/80 p-1 gap-0.5 backdrop-blur-sm border border-gray-200/60">
      {modes.map((m) => {
        const isActive = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            className={`group relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
              isActive
                ? `${m.activeBg} ${m.activeText} ${m.activeBorder} shadow-sm border`
                : "text-gray-500 hover:text-gray-700 hover:bg-white/70 border border-transparent"
            }`}
            onClick={() => onChange?.(m.value)}
            title={`${m.description} (${m.shortcut})`}
          >
            {/* Active indicator dot */}
            {isActive && (
              <span className={`absolute -top-0.5 left-1/2 -translate-x-1/2 h-1 w-4 rounded-full bg-gradient-to-r ${m.gradient} opacity-80`} />
            )}
            {m.icon}
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
