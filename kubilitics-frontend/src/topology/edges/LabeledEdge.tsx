import { memo, useState, useCallback } from "react";
import type { EdgeProps } from "@xyflow/react";
import { BezierEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import { getEdgeColor, STATUS_COLORS } from "../constants/designTokens";

export type LabeledEdgeData = {
  label: string;
  detail?: string;
  relationshipCategory?: string;
  healthy?: boolean;
  hideLabel?: boolean;
};

function LabeledEdgeInner(props: EdgeProps<LabeledEdgeData>) {
  const { data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const label = data?.label ?? "";
  const [hovered, setHovered] = useState(false);

  const color = getEdgeColor(data?.relationshipCategory);
  const isHealthy = data?.healthy !== false;
  const hideLabel = data?.hideLabel === true;

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
          stroke: isHealthy ? color : STATUS_COLORS.error,
          strokeWidth: hovered ? 2.5 : 1.5,
          strokeDasharray: props.style?.strokeDasharray,
          opacity: hovered ? 1 : 0.6,
          transition: "stroke-width 0.15s, opacity 0.15s",
        }}
      />
      {!hideLabel && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-default rounded-md border bg-white/95 px-1.5 py-0.5 text-[10px] leading-tight text-gray-600 shadow-sm backdrop-blur-sm transition-all"
            style={{
              left: labelX,
              top: labelY,
              borderColor: hovered ? color : "#e5e7eb",
              opacity: hovered ? 1 : 0.8,
            }}
            title={data?.detail}
            role="note"
            aria-label={`Relationship: ${label}${data?.detail ? `, ${data.detail}` : ""}`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            {label}
            {hovered && data?.detail && (
              <div className="mt-0.5 text-[9px] text-gray-500">{data.detail}</div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const LabeledEdge = memo(LabeledEdgeInner);
