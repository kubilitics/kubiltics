import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

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
 * GroupNode: Represents a namespace or logical group container.
 * Renders as a labeled rectangle that contains child nodes.
 * React Flow uses this as a parent node for compound grouping.
 */
function GroupNodeInner({ data }: NodeProps<GroupNodeData>) {
  const bg = data.style?.backgroundColor ?? "#f1f5f9";
  const border = data.style?.borderColor ?? "#94a3b8";

  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const effectiveBg = isDark ? `${bg}40` : bg; // 25% opacity in dark mode

  return (
    <div
      className="rounded-lg border-2 border-dashed"
      style={{
        backgroundColor: effectiveBg,
        borderColor: isDark ? `${border}80` : border,
        minWidth: 300,
        minHeight: 200,
        padding: "8px",
      }}
      role="group"
      aria-label={`${data.type} ${data.label} — ${data.memberCount} resources`}
    >
      <div className="flex items-center gap-1.5 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">{data.type}</span>
        <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{data.label}</span>
        <span className="ml-auto text-[10px] font-medium text-gray-600 dark:text-gray-400">{data.memberCount} resources</span>
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeInner);
