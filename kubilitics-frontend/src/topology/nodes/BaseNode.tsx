import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { categoryIcon, statusColor, categoryHeaderBg, categoryBorderColor, formatCPU, formatBytes } from "./nodeUtils";

export type BaseNodeData = {
  kind: string;
  name: string;
  namespace?: string;
  category: string;
  status: "healthy" | "warning" | "error" | "unknown";
  statusReason?: string;
  metrics?: {
    cpuRequest?: number;
    cpuLimit?: number;
    memoryRequest?: number;
    memoryLimit?: number;
    restartCount?: number;
    podCount?: number;
    readyCount?: number;
  };
  labels?: Record<string, string>;
  createdAt?: string;
};

/** Status badge text + color */
function statusBadge(status: string): { text: string; bg: string; text_color: string } {
  switch (status) {
    case "healthy": return { text: "Healthy", bg: "bg-emerald-50", text_color: "text-emerald-700" };
    case "warning": return { text: "Warning", bg: "bg-amber-50", text_color: "text-amber-700" };
    case "error": return { text: "Error", bg: "bg-red-50", text_color: "text-red-700" };
    default: return { text: "Unknown", bg: "bg-gray-50", text_color: "text-gray-500" };
  }
}

/**
 * BaseNode: Default node displayed at zoom 0.6x-1.5x.
 * Modern card with category header, name, namespace, status badge, and optional metrics.
 */
function BaseNodeInner({ data }: NodeProps<BaseNodeData>) {
  const icon = categoryIcon(data.category);
  const sColor = statusColor(data.status);
  const headerBg = categoryHeaderBg(data.category);
  const borderColor = categoryBorderColor(data.category);
  const badge = statusBadge(data.status);

  return (
    <div
      className={`min-w-[230px] max-w-[320px] rounded-lg border ${borderColor} bg-white shadow-sm transition-shadow hover:shadow-md overflow-hidden`}
      role="treeitem"
      aria-label={`${data.kind} ${data.name} — ${data.statusReason ?? data.status}`}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-gray-300 !border-white !border-2" />

      {/* Header with category color */}
      <div className={`flex items-center gap-2 ${headerBg} px-3 py-1.5`}>
        <span className="text-sm" aria-hidden="true">{icon}</span>
        <span className="flex-1 text-[11px] font-semibold text-white tracking-wide uppercase">{data.kind}</span>
        <div className={`h-2 w-2 rounded-full ${sColor} ring-1 ring-white/40`} aria-label={`Status: ${data.status}`} role="img" />
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="text-sm font-semibold text-gray-900 break-all leading-snug">{data.name}</div>
        {data.namespace && (
          <div className="text-[11px] text-gray-400 break-all">{data.namespace}</div>
        )}

        {/* Status badge */}
        <div className="flex items-center gap-2 mt-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.bg} ${badge.text_color}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${sColor}`} />
            {data.statusReason ?? badge.text}
          </span>
        </div>

        {/* Compact metrics row */}
        {data.metrics?.podCount != null && (
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100 mt-1.5">
            <div className="text-[10px] text-gray-500">
              <span className="font-semibold text-gray-700">{data.metrics.readyCount ?? 0}/{data.metrics.podCount}</span> pods
            </div>
            {data.metrics.restartCount != null && data.metrics.restartCount > 0 && (
              <div className="text-[10px] text-amber-600 font-medium">
                {data.metrics.restartCount} restarts
              </div>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-gray-300 !border-white !border-2" />
    </div>
  );
}

export const BaseNode = memo(BaseNodeInner);
