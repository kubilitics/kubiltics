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

/**
 * BaseNode: Default node displayed at zoom 0.6x-1.5x.
 * Shows kind header with category color, name, namespace, and status dot.
 */
function BaseNodeInner({ data }: NodeProps<BaseNodeData>) {
  const icon = categoryIcon(data.category);
  const sColor = statusColor(data.status);
  const headerBg = categoryHeaderBg(data.category);
  const borderColor = categoryBorderColor(data.category);

  return (
    <div
      className={`w-[220px] min-h-[80px] rounded-md border ${borderColor} bg-background text-xs shadow-sm`}
      role="treeitem"
      aria-label={`${data.kind} ${data.name} — ${data.statusReason ?? data.status}`}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-muted-foreground/40" />
      <div className={`flex items-center gap-2 rounded-t-md ${headerBg} px-2 py-1 text-[11px] font-medium text-white`}>
        <span aria-hidden="true">{icon}</span>
        <span className="flex-1">{data.kind}</span>
        <div className={`h-2 w-2 rounded-full border border-white/50 ${sColor}`} aria-label={`Status: ${data.status}`} role="img" />
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-[13px] font-semibold">{data.name}</div>
        {data.namespace && (
          <div className="truncate text-[11px] text-muted-foreground">
            {data.namespace}
          </div>
        )}
        <div className="mt-1 text-[11px] text-muted-foreground">
          {data.statusReason ?? data.status}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-muted-foreground/40" />
    </div>
  );
}

export const BaseNode = memo(BaseNodeInner);

