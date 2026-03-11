import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";
import { getCategoryColor, STATUS_COLORS, mapStatusKey } from "../constants/designTokens";

/**
 * MinimalNode: Displayed at extreme zoom-out (<0.08x).
 * Category-colored dot with status ring + tiny label.
 */
function MinimalNodeInner({ data }: NodeProps<BaseNodeData>) {
  const fill = getCategoryColor(data.category).accent;
  const ring = STATUS_COLORS[mapStatusKey(data.status)];

  return (
    <div className="flex flex-col items-center" role="treeitem" aria-label={`${data.kind}: ${data.name} — ${data.status}`}>
      <Handle type="target" position={Position.Left} className="!w-1 !h-1 !bg-transparent !border-0" />
      <div
        className="h-8 w-8 rounded-full shadow-sm transition-transform hover:scale-125"
        style={{
          backgroundColor: fill,
          boxShadow: `0 0 0 2.5px white, 0 0 0 4px ${ring}`,
        }}
        title={`${data.kind}: ${data.name}`}
        role="img"
        aria-label={`${data.kind} ${data.name}, status: ${data.status}`}
      />
      <div
        className="mt-1.5 max-w-[80px] truncate text-center text-[8px] font-medium"
        style={{ color: fill }}
      >
        {data.name}
      </div>
      <Handle type="source" position={Position.Right} className="!w-1 !h-1 !bg-transparent !border-0" />
    </div>
  );
}

export const MinimalNode = memo(MinimalNodeInner);
