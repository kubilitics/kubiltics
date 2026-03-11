import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";
import { categoryIcon } from "./nodeUtils";
import { getCategoryColor, statusDotClass } from "../constants/designTokens";

/**
 * CompactNode: Displayed at zoom level 0.08x-0.30x.
 * Card with colored left accent, kind icon, name, kind badge, and status dot.
 */
function CompactNodeInner({ data }: NodeProps<BaseNodeData>) {
  const icon = categoryIcon(data.category);
  const color = statusDotClass(data.status);
  const accent = getCategoryColor(data.category).accent;

  return (
    <div
      className="flex min-w-[180px] max-w-[280px] items-center gap-2.5 rounded-lg bg-white px-2.5 py-2 shadow-sm transition-shadow hover:shadow-md"
      style={{ borderLeft: `3px solid ${accent}` }}
      role="treeitem"
      aria-label={`${data.kind} ${data.name} — ${data.status}`}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-300 !border-white !border-2" />
      <span className="text-lg shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-gray-900 leading-tight break-all">{data.name}</div>
        <div className="text-[9px] text-gray-400 font-medium mt-0.5">{data.kind}</div>
      </div>
      <div className={`h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-white ${color}`} title={data.statusReason ?? data.status} role="img" aria-label={`Status: ${data.status}`} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-300 !border-white !border-2" />
    </div>
  );
}

export const CompactNode = memo(CompactNodeInner);
