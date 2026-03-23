import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

export type LayerLabelData = {
  label: string;
  layer: number;
};

/**
 * LayerLabel: Non-interactive tier label rendered at the left edge of each
 * architecture layer. Acts as a vertical watermark showing the tier name
 * (e.g. "Infrastructure", "Workloads", "Services").
 */
function LayerLabelInner({ data }: NodeProps<LayerLabelData>) {
  return (
    <div
      className="pointer-events-none select-none"
      style={{ width: 40, height: 200 }}
      aria-hidden="true"
    >
      <div
        className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-300 dark:text-slate-700"
        style={{
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          transform: "rotate(180deg)",
          whiteSpace: "nowrap",
        }}
      >
        {data.label}
      </div>
    </div>
  );
}

export const LayerLabel = memo(LayerLabelInner);
