import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";
import { statusColor } from "./nodeUtils";

/**
 * MinimalNode: Displayed at extreme zoom-out (<0.3x).
 * Just a colored dot with a tiny label.
 * Width: 24px circle.
 */
function MinimalNodeInner({ data }: NodeProps<BaseNodeData>) {
  const color = statusColor(data.status);

  return (
    <div className="flex flex-col items-center" role="treeitem" aria-label={`${data.kind}: ${data.name} — ${data.status}`}>
      <Handle type="target" position={Position.Left} className="!w-1 !h-1 !bg-transparent !border-0" />
      <div className={`h-6 w-6 rounded-full ${color} border border-white shadow-sm`} title={`${data.kind}: ${data.name}`} role="img" aria-label={`Status: ${data.status}`} />
      <div className="mt-0.5 max-w-[60px] truncate text-center text-[8px] text-muted-foreground">{data.name}</div>
      <Handle type="source" position={Position.Right} className="!w-1 !h-1 !bg-transparent !border-0" />
    </div>
  );
}

export const MinimalNode = memo(MinimalNodeInner);
