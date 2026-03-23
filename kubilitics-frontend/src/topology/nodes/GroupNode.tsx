import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { K8sIcon } from "../icons/K8sIcon";

export type GroupNodeData = {
  label: string;
  type: string;
  memberCount: number;
  collapsed?: boolean;
  style?: {
    backgroundColor: string;
    borderColor: string;
  };
};

/**
 * GroupNode: Namespace or logical group container with styled header.
 * Renders as a labeled rounded rectangle that contains child nodes.
 */
function GroupNodeInner({ data }: NodeProps<GroupNodeData>) {
  const bg = data.style?.backgroundColor ?? "#f1f5f9";
  const border = data.style?.borderColor ?? "#94a3b8";

  return (
    <div
      className="rounded-xl border-2 border-dashed dark:border-opacity-50"
      style={{
        backgroundColor: bg,
        borderColor: border,
        minWidth: 300,
        minHeight: 200,
        padding: "8px",
      }}
      role="group"
      aria-label={`${data.type} ${data.label} — ${data.memberCount} resources`}
    >
      {/* Header bar */}
      <div
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-1"
        style={{ backgroundColor: `${border}20` }}
      >
        {data.type === "namespace" && (
          <K8sIcon kind="Namespace" size={14} />
        )}
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {data.type}
        </span>
        <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
          {data.label}
        </span>
        <span className="ml-auto text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-white/60 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
          {data.memberCount}
        </span>
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeInner);
