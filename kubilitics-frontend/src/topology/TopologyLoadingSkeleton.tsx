import type { ViewMode } from "./types/topology";
import { CANVAS } from "./constants/designTokens";

export interface TopologyLoadingSkeletonProps {
  viewMode?: ViewMode;
  progress?: number;
}

/**
 * TopologyLoadingSkeleton: Displays a contextual skeleton matching the expected
 * view mode layout while topology data loads. Uses pulse animation
 * (respects prefers-reduced-motion via Tailwind's motion-safe).
 */
export function TopologyLoadingSkeleton({
  viewMode = "namespace",
  progress,
}: TopologyLoadingSkeletonProps) {
  const isHorizontal = viewMode === "namespace" || viewMode === "rbac";
  const nodeCount = viewMode === "cluster" ? 4 : viewMode === "resource" ? 7 : 9;

  // Category-aligned skeleton colors from designTokens
  const skeletonColors = [
    "bg-blue-100/80", "bg-purple-100/80", "bg-teal-100/80",
    "bg-orange-100/80", "bg-pink-100/80", "bg-green-100/80",
  ];

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center p-8"
      style={{ backgroundColor: CANVAS.background }}
      role="status"
      aria-label={progress != null ? `Computing layout: ${Math.round(progress)}% complete` : "Building topology graph"}
      aria-live="polite"
    >
      {/* Animated constellation skeleton */}
      <div className="relative" style={{ width: 600, height: 360 }} aria-hidden="true">
        {Array.from({ length: nodeCount }).map((_, i) => {
          const angle = (i / nodeCount) * 2 * Math.PI;
          const rx = 220;
          const ry = 130;
          const cx = 300 + rx * Math.cos(angle + 0.3);
          const cy = 180 + ry * Math.sin(angle + 0.3);
          return (
            <div
              key={i}
              className={`absolute motion-safe:animate-pulse rounded-xl ${skeletonColors[i % skeletonColors.length]} shadow-sm`}
              style={{
                left: cx - 55,
                top: cy - 25,
                width: 110,
                height: 50,
                animationDelay: `${i * 120}ms`,
              }}
            />
          );
        })}
        {/* Connection lines */}
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
          {Array.from({ length: Math.min(nodeCount, 8) }).map((_, i) => {
            const a1 = (i / nodeCount) * 2 * Math.PI + 0.3;
            const a2 = ((i + 1) / nodeCount) * 2 * Math.PI + 0.3;
            return (
              <line
                key={i}
                x1={300 + 220 * Math.cos(a1)}
                y1={180 + 130 * Math.sin(a1)}
                x2={300 + 220 * Math.cos(a2)}
                y2={180 + 130 * Math.sin(a2)}
                stroke="#e5e7eb"
                strokeWidth="1.5"
                strokeDasharray="6 4"
                className="motion-safe:animate-pulse"
                style={{ animationDelay: `${i * 100 + 60}ms` }}
              />
            );
          })}
        </svg>
      </div>

      {/* Progress text */}
      <div className="mt-8 text-center">
        <div className="text-sm font-medium text-gray-600">
          {progress != null ? `Computing layout... ${Math.round(progress)}%` : "Building topology graph..."}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Arranging {isHorizontal ? "namespace" : "cluster"} resources with ELK engine
        </div>
        {progress != null && (
          <div className="mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-gray-200 mx-auto" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
