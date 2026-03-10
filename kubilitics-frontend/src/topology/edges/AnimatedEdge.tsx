import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export interface AnimatedEdgeData {
  label?: string;
  detail?: string;
  category?: string;
}

/**
 * AnimatedEdge: Edge with traffic animation (dashed stroke animation).
 * Used for live traffic visualization overlay.
 */
function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const d = data as AnimatedEdgeData | undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "#2563EB" : "#7C3AED",
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: "8 4",
          animation: "dash-flow 1s linear infinite",
        }}
      />
      {d?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="rounded border bg-background px-1.5 py-0.5 text-[10px] shadow-sm"
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
      <style>{`
        @keyframes dash-flow {
          to { stroke-dashoffset: -12; }
        }
      `}</style>
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);
