import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { categoryIcon, formatCPU, formatBytes } from "./nodeUtils";
import {
  categoryBorderClass,
  categoryHeaderClass,
  getStatusBadge,
  A11Y,
} from "../constants/designTokens";

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

/**
 * BaseNode: Default node displayed at zoom 0.30x-1.5x.
 * Card with category header, name, namespace, status badge, and optional metrics.
 */
function BaseNodeInner({ data }: NodeProps<BaseNodeData>) {
  const icon = categoryIcon(data.category);
  const headerBg = categoryHeaderClass(data.category);
  const borderColor = categoryBorderClass(data.category);
  const badge = getStatusBadge(data.status);

  return (
    <div
      className={`min-w-[230px] max-w-[320px] rounded-lg border ${borderColor} bg-white shadow-sm ${A11Y.transition} hover:shadow-md ${A11Y.focusRing} overflow-hidden`}
      role="treeitem"
      aria-roledescription="topology node"
      aria-label={`${data.kind}: ${data.name}, status ${data.statusReason ?? data.status}${data.namespace ? `, namespace ${data.namespace}` : ""}${data.metrics?.podCount != null ? `, ${data.metrics.readyCount ?? 0} of ${data.metrics.podCount} pods ready` : ""}`}
      tabIndex={0}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-gray-300 !border-white !border-2" />

      {/* Header with category color */}
      <div className={`flex items-center gap-2 ${headerBg} px-3 py-1.5`}>
        <span className="text-sm" aria-hidden="true">{icon}</span>
        <span className="flex-1 text-[11px] font-semibold text-white tracking-wide uppercase">{data.kind}</span>
        <div className={`h-2 w-2 rounded-full ${badge.dotClass} ring-1 ring-white/40`} aria-hidden="true" />
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="text-sm font-semibold text-gray-900 break-all leading-snug">{data.name}</div>
        {data.namespace && (
          <div className="text-[11px] text-gray-500 break-all">{data.namespace}</div>
        )}

        {/* Status badge */}
        <div className="flex items-center gap-2 mt-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.bg} ${badge.textColor}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} aria-hidden="true" />
            {data.statusReason ?? badge.text}
          </span>
        </div>

        {/* Compact metrics row */}
        {data.metrics?.podCount != null && (
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100 mt-1.5" aria-label="Pod metrics">
            <div className="text-[11px] text-gray-500">
              <span className="font-semibold text-gray-700">{data.metrics.readyCount ?? 0}/{data.metrics.podCount}</span> pods
            </div>
            {data.metrics.restartCount != null && data.metrics.restartCount > 0 && (
              <div className="text-[11px] text-amber-600 font-medium" role="status">
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
