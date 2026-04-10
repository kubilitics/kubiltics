import { memo, useCallback } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { formatCPU, formatBytes } from "./nodeUtils";
import { K8sIcon } from "../icons/K8sIcon";
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
    cpuUsage?: number;
    cpuRequest?: number;
    cpuLimit?: number;
    memoryUsage?: number;
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
function BaseNodeInner({ id, data }: NodeProps<BaseNodeData>) {
  const headerBg = categoryHeaderClass(data.category);
  const borderColor = categoryBorderClass(data.category);
  const badge = getStatusBadge(data.status);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('topology-node-activate', { detail: { nodeId: id } }));
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('topology-node-activate', { detail: { nodeId: null } }));
    }
  }, [id]);

  return (
    <div
      className={`w-[260px] rounded-lg border ${borderColor} bg-white dark:bg-slate-800 shadow-sm ${A11Y.transition} hover:shadow-md ${A11Y.focusRing} overflow-hidden`}
      role="treeitem"
      aria-roledescription="topology node"
      aria-label={`${data.kind}: ${data.name}, status ${data.statusReason ?? data.status}${data.namespace ? `, namespace ${data.namespace}` : ""}${data.metrics?.podCount != null ? `, ${data.metrics.readyCount ?? 0} of ${data.metrics.podCount} pods ready` : ""}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-gray-400 dark:!bg-gray-500 !border-white !border-2" />

      {/* Header with category color */}
      <div className={`flex items-center gap-2 ${headerBg} px-3 py-1.5`}>
        <K8sIcon kind={data.kind} size={18} backdrop />
        <span className="flex-1 text-xs font-semibold text-white tracking-wide uppercase">{data.kind}</span>
        <div className={`h-2 w-2 rounded-full ${badge.dotClass} ring-1 ring-white/40`} aria-hidden="true" />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-snug" title={data.name}>{data.name}</div>
        {data.namespace && (
          <div className="text-xs text-gray-600 dark:text-gray-400 break-all">{data.namespace}</div>
        )}

        {/* Status badge */}
        <div className="flex items-center gap-2 mt-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.bg} ${badge.textColor}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} aria-hidden="true" />
            {data.statusReason ?? badge.text}
          </span>
        </div>

        {/* Compact metrics row */}
        {(data.metrics?.podCount != null || data.metrics?.cpuUsage != null || data.metrics?.cpuRequest != null) && (
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-700 mt-1.5 flex-wrap" aria-label="Resource metrics">
            {data.metrics?.podCount != null && (
              <div className="text-xs text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-gray-800 dark:text-gray-200">{data.metrics.readyCount ?? 0}/{data.metrics.podCount}</span> pods
              </div>
            )}
            {(data.metrics?.cpuUsage != null || data.metrics?.cpuRequest != null) && (
              <div className="text-xs text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-gray-800 dark:text-gray-200">{formatCPU(data.metrics.cpuUsage ?? data.metrics.cpuRequest ?? 0)}</span> CPU
              </div>
            )}
            {(data.metrics?.memoryUsage != null || data.metrics?.memoryRequest != null) && (data.metrics.memoryUsage ?? data.metrics.memoryRequest ?? 0) > 0 && (
              <div className="text-xs text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-gray-800 dark:text-gray-200">{formatBytes(data.metrics.memoryUsage ?? data.metrics.memoryRequest ?? 0)}</span> Mem
              </div>
            )}
            {data.metrics?.restartCount != null && data.metrics.restartCount > 0 && (
              <div className="text-xs text-amber-600 font-medium" role="status">
                {data.metrics.restartCount} restarts
              </div>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-gray-400 dark:!bg-gray-500 !border-white !border-2" />
    </div>
  );
}

export const BaseNode = memo(BaseNodeInner);
