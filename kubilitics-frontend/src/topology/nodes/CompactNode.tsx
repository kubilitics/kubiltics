import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { BaseNodeData } from "./BaseNode";
import { getCategoryColor, statusDotClass, A11Y } from "../constants/designTokens";
import { K8sIcon } from "../icons/K8sIcon";

/**
 * CompactNode: Displayed at zoom level 0.08x-0.30x.
 * Card with colored left accent, kind icon, name, kind badge, and status dot.
 */
function CompactNodeInner({ data }: NodeProps<BaseNodeData>) {
  const color = statusDotClass(data.status);
  const accent = getCategoryColor(data.category).accent;

  return (
    <div
      className={`flex w-[200px] items-center gap-2.5 rounded-lg bg-white dark:bg-slate-800 px-3 py-1.5 shadow-sm ${A11Y.transition} hover:shadow-md ${A11Y.focusRing}`}
      style={{ borderLeft: `3px solid ${accent}` }}
      role="treeitem"
      aria-roledescription="topology node"
      aria-label={`${data.kind}: ${data.name}, status ${data.status}`}
      tabIndex={0}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-400 dark:!bg-gray-500 !border-white dark:!border-slate-800 !border-2" />
      <K8sIcon kind={data.kind} size={26} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 leading-tight truncate" title={data.name}>{data.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-gray-600 dark:text-gray-400 font-medium">{data.kind}</span>
          {data.metrics?.podCount != null && (
            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-700 px-1 rounded">
              {data.metrics.readyCount ?? 0}/{data.metrics.podCount}
            </span>
          )}
        </div>
      </div>
      <div className={`h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-white dark:ring-slate-800 ${color}`} title={data.statusReason ?? data.status} aria-hidden="true" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-400 dark:!bg-gray-500 !border-white dark:!border-slate-800 !border-2" />
    </div>
  );
}

export const CompactNode = memo(CompactNodeInner);
