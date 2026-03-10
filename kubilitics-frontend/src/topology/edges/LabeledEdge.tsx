import { memo, useState, useCallback } from "react";
import type { EdgeProps } from "@xyflow/react";
import { BezierEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";

export type LabeledEdgeData = {
  label: string;
  detail?: string;
  relationshipCategory?: string;
  healthy?: boolean;
};

/** Category-based edge colors for visual distinction. */
const categoryColors: Record<string, string> = {
  ownership: "#3b82f6",    // blue
  networking: "#8b5cf6",   // purple
  configuration: "#f59e0b",// amber
  storage: "#06b6d4",     // cyan
  rbac: "#ec4899",        // pink
  scheduling: "#6b7280",  // gray
  scaling: "#22c55e",     // green
  policy: "#f97316",      // orange
  containment: "#94a3b8", // slate
};

function LabeledEdgeInner(props: EdgeProps<LabeledEdgeData>) {
  const { data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const label = data?.label ?? "";
  const [hovered, setHovered] = useState(false);

  const color = categoryColors[data?.relationshipCategory ?? ""] ?? "#94a3b8";
  const isHealthy = data?.healthy !== false;

  const [, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  });

  const onMouseEnter = useCallback(() => setHovered(true), []);
  const onMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <>
      <BezierEdge
        {...props}
        style={{
          stroke: isHealthy ? color : "#ef4444",
          strokeWidth: hovered ? 2.5 : 1.5,
          strokeDasharray: props.style?.strokeDasharray,
          opacity: hovered ? 1 : 0.6,
          transition: "stroke-width 0.15s, opacity 0.15s",
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-default rounded border bg-background/95 px-1.5 py-0.5 text-[12px] leading-tight text-muted-foreground shadow-sm backdrop-blur-sm transition-opacity"
          style={{
            left: labelX,
            top: labelY,
            borderColor: color,
            opacity: hovered ? 1 : 0.85,
          }}
          title={data?.detail}
          role="img"
          aria-label={`Relationship: ${label}${data?.detail ? ` — ${data.detail}` : ""}`}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          {label}
          {hovered && data?.detail && (
            <div className="mt-0.5 text-[10px] text-muted-foreground/70">{data.detail}</div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const LabeledEdge = memo(LabeledEdgeInner);
