import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";
import { categoryIcon, statusColor, categoryHeaderBg, categoryBorderColor, formatBytes, formatCPU } from "./nodeUtils";

export type ExpandedNodeData = BaseNodeData & {
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
 * ExpandedNode: Full detail view at zoom > 1.5x.
 * Rich card with metrics grid, labels, and detailed status.
 */
function ExpandedNodeInner({ data }: NodeProps<ExpandedNodeData>) {
  const icon = categoryIcon(data.category);
  const sColor = statusColor(data.status);
  const headerBg = categoryHeaderBg(data.category);
  const borderColor = categoryBorderColor(data.category);
  const metrics = data.metrics;

  return (
    <div
      className={`min-w-[300px] max-w-[420px] rounded-xl border-2 ${borderColor} bg-white shadow-lg overflow-hidden`}
      role="treeitem"
      aria-label={`${data.kind} ${data.name} — ${data.statusReason ?? data.status}${metrics?.podCount != null ? `, ${metrics.readyCount ?? 0}/${metrics.podCount} pods ready` : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-gray-300 !border-white !border-2" />

      {/* Header */}
      <div className={`flex items-center gap-2.5 ${headerBg} px-4 py-2`}>
        <span className="text-base" aria-hidden="true">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-white tracking-wide uppercase">{data.kind}</span>
        </div>
        <div className={`h-3 w-3 rounded-full ${sColor} ring-2 ring-white/30`} role="img" aria-label={`Status: ${data.status}`} />
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        <div>
          <div className="text-sm font-bold text-gray-900 break-all leading-snug">{data.name}</div>
          {data.namespace && (
            <div className="text-xs text-gray-400 mt-0.5">{data.namespace}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${sColor}`} />
          <span className="text-xs font-medium text-gray-700">{data.statusReason ?? data.status}</span>
        </div>

        {metrics && (
          <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3" aria-label="Resource metrics">
            {metrics.cpuRequest != null && (
              <MetricCard label="CPU" value={formatCPU(metrics.cpuRequest)} />
            )}
            {metrics.memoryRequest != null && metrics.memoryRequest > 0 && (
              <MetricCard label="Memory" value={formatBytes(metrics.memoryRequest)} />
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
          <div className="border-t border-gray-100 pt-2">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Labels</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.labels).slice(0, 3).map(([k, v]) => (
                <span key={k} className="inline-flex px-1.5 py-0.5 rounded bg-gray-100 text-[9px] text-gray-600 font-mono break-all">
                  {k.split("/").pop()}={v}
                </span>
              ))}
              {Object.keys(data.labels).length > 3 && (
                <span className="text-[9px] text-gray-400 px-1">+{Object.keys(data.labels).length - 3}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-300 !border-white !border-2" />
    </div>
  );
}

function MetricCard({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-md px-2.5 py-1.5 ${warning ? "bg-amber-50" : "bg-gray-50"}`}>
      <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wider">{label}</div>
      <div className={`text-xs font-semibold font-mono mt-0.5 ${warning ? "text-amber-600" : "text-gray-800"}`}>{value}</div>
    </div>
  );
}

export const ExpandedNode = memo(ExpandedNodeInner);
