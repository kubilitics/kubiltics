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
 * Shows metrics, labels, status with rich layout.
 * Width: 280px.
 */
function ExpandedNodeInner({ data }: NodeProps<ExpandedNodeData>) {
  const icon = categoryIcon(data.category);
  const sColor = statusColor(data.status);
  const headerBg = categoryHeaderBg(data.category);
  const borderColor = categoryBorderColor(data.category);
  const metrics = data.metrics;

  return (
    <div
      className={`w-[280px] rounded-lg border-2 ${borderColor} bg-background shadow-md`}
      role="treeitem"
      aria-label={`${data.kind} ${data.name} — ${data.statusReason ?? data.status}${metrics?.podCount != null ? `, ${metrics.readyCount ?? 0}/${metrics.podCount} pods ready` : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-muted-foreground/40" />
      {/* Header */}
      <div className={`flex items-center gap-2 rounded-t-md ${headerBg} px-3 py-1.5 text-white`}>
        <span className="text-sm" aria-hidden="true">{icon}</span>
        <span className="flex-1 truncate text-xs font-semibold">{data.kind}</span>
        <div className={`h-2.5 w-2.5 rounded-full border border-white/50 ${sColor}`} role="img" aria-label={`Status: ${data.status}`} />
      </div>
      {/* Body */}
      <div className="space-y-2 px-3 py-2">
        <div>
          <div className="truncate text-sm font-semibold">{data.name}</div>
          {data.namespace && (
            <div className="text-[11px] text-muted-foreground">{data.namespace}</div>
          )}
        </div>
        <div className="text-[11px]">
          <span className="text-muted-foreground">Status: </span>
          <span className="font-medium">{data.statusReason ?? data.status}</span>
        </div>
        {/* Metrics */}
        {metrics && (
          <div className="space-y-1 border-t pt-1.5" aria-label="Resource metrics">
            {metrics.cpuRequest != null && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">CPU Request</span>
                <span className="font-mono">{formatCPU(metrics.cpuRequest)}</span>
              </div>
            )}
            {metrics.memoryRequest != null && metrics.memoryRequest > 0 && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Memory Request</span>
                <span className="font-mono">{formatBytes(metrics.memoryRequest)}</span>
              </div>
            )}
            {metrics.podCount != null && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Pods</span>
                <span className="font-mono">{metrics.readyCount ?? 0}/{metrics.podCount}</span>
              </div>
            )}
            {metrics.restartCount != null && metrics.restartCount > 0 && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Restarts</span>
                <span className="font-mono text-amber-600">{metrics.restartCount}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-muted-foreground/40" />
    </div>
  );
}

export const ExpandedNode = memo(ExpandedNodeInner);
