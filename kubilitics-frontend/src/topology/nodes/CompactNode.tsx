import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";
import { categoryIcon, statusColor } from "./nodeUtils";

/**
 * CompactNode: Displayed at zoom level 0.3x-0.6x.
 * Shows kind icon, name (truncated), and a status indicator dot.
 * Width: 160px, Height: ~50px.
 */
function CompactNodeInner({ data }: NodeProps<BaseNodeData>) {
  const icon = categoryIcon(data.category);
  const color = statusColor(data.status);

  return (
    <div
      className="flex w-[160px] items-center gap-2 rounded-md border bg-background px-2 py-1.5 shadow-sm"
      role="treeitem"
      aria-label={`${data.kind} ${data.name} — ${data.status}`}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-muted-foreground/40" />
      <span className="text-base" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium leading-tight">{data.name}</div>
        <div className="text-[9px] text-muted-foreground">{data.kind}</div>
      </div>
      <div className={`h-2.5 w-2.5 rounded-full ${color}`} title={data.statusReason ?? data.status} role="img" aria-label={`Status: ${data.status}`} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-muted-foreground/40" />
    </div>
  );
}

export const CompactNode = memo(CompactNodeInner);
