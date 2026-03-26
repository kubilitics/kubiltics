import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";
import { formatBytes, formatCPU } from "./nodeUtils";
import { K8sIcon } from "../icons/K8sIcon";
import {
  categoryBorderClass,
  categoryHeaderClass,
  getStatusBadge,
  A11Y,
} from "../constants/designTokens";

export type ExpandedNodeData = BaseNodeData & {
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
 * ExpandedNode: Full detail view at zoom > 1.5x.
 * Rich card with metrics grid, labels, and detailed status.
 */
function ExpandedNodeInner({ data }: NodeProps<ExpandedNodeData>) {
  const headerBg = categoryHeaderClass(data.category);
  const borderColor = categoryBorderClass(data.category);
  const badge = getStatusBadge(data.status);
  const metrics = data.metrics;

  return (
    <div
      className={`w-[380px] rounded-lg border ${borderColor} bg-white dark:bg-slate-800 shadow-sm ${A11Y.transition} hover:shadow-md ${A11Y.focusRing} overflow-hidden`}
      role="treeitem"
      aria-roledescription="topology node"
      aria-label={`${data.kind}: ${data.name}, status ${data.statusReason ?? data.status}${data.namespace ? `, namespace ${data.namespace}` : ""}${metrics?.podCount != null ? `, ${metrics.readyCount ?? 0} of ${metrics.podCount} pods ready` : ""}`}
      tabIndex={0}
    >
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-gray-400 dark:!bg-gray-500 !border-white !border-2" />

      {/* Header */}
      <div className={`flex items-center gap-2.5 ${headerBg} px-3 py-1.5`}>
        <K8sIcon kind={data.kind} size={22} backdrop />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-white tracking-wide uppercase">{data.kind}</span>
        </div>
        <div className={`h-3 w-3 rounded-full ${badge.dotClass} ring-2 ring-white/30`} aria-hidden="true" />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-3">
        <div>
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 break-all leading-snug">{data.name}</div>
          {data.namespace && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{data.namespace}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${badge.dotClass}`} aria-hidden="true" />
          <span className="text-xs font-medium text-gray-900 dark:text-gray-200">{data.statusReason ?? badge.text}</span>
        </div>

        {metrics && (
          <div className="grid grid-cols-2 gap-2 border-t border-gray-100 dark:border-gray-700 pt-3" role="group" aria-label="Resource metrics">
            {(metrics.cpuUsage != null || metrics.cpuRequest != null) && (
              <MetricCard label="CPU" value={formatCPU(metrics.cpuUsage ?? metrics.cpuRequest ?? 0)} />
            )}
            {((metrics.memoryUsage != null && metrics.memoryUsage > 0) || (metrics.memoryRequest != null && metrics.memoryRequest > 0)) && (
              <MetricCard label="Memory" value={formatBytes(metrics.memoryUsage ?? metrics.memoryRequest ?? 0)} />
            )}
            {metrics.podCount != null && (
              <MetricCard label="Pods" value={`${metrics.readyCount ?? 0}/${metrics.podCount}`} />
            )}
            {metrics.restartCount != null && metrics.restartCount > 0 && (
              <MetricCard label="Restarts" value={String(metrics.restartCount)} warning />
            )}
          </div>
        )}

        {data.labels && Object.keys(data.labels).length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2" role="group" aria-label={`Labels: ${Object.keys(data.labels).length} total`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Labels</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.labels).slice(0, 3).map(([k, v]) => (
                <span key={k} className="inline-flex px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px] text-gray-700 dark:text-gray-300 font-mono break-all">
                  {k.split("/").pop()}={v}
                </span>
              ))}
              {Object.keys(data.labels).length > 3 && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400 px-1">+{Object.keys(data.labels).length - 3}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-400 dark:!bg-gray-500 !border-white !border-2" />
    </div>
  );
}

function MetricCard({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-md px-2.5 py-1.5 ${warning ? "bg-amber-50 dark:bg-amber-950/30" : "bg-gray-50 dark:bg-slate-700"}`} aria-label={`${label}: ${value}`}>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">{label}</div>
      <div className={`text-xs font-semibold font-mono mt-0.5 ${warning ? "text-amber-600" : "text-gray-900 dark:text-gray-100"}`}>{value}</div>
    </div>
  );
}

export const ExpandedNode = memo(ExpandedNodeInner);
