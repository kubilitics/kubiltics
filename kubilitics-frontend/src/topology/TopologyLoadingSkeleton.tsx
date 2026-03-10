import type { ViewMode } from "./types/topology";

export interface TopologyLoadingSkeletonProps {
  viewMode?: ViewMode;
  progress?: number;
}

/**
 * TopologyLoadingSkeleton: Displays a contextual skeleton matching the expected
 * view mode layout while topology data loads. Uses pulse animation
 * (respects prefers-reduced-motion).
 */
export function TopologyLoadingSkeleton({
  viewMode = "namespace",
  progress,
}: TopologyLoadingSkeletonProps) {
  const isHorizontal = viewMode === "namespace" || viewMode === "rbac";
  const nodeCount = viewMode === "cluster" ? 4 : viewMode === "resource" ? 7 : 9;

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      {/* Skeleton graph */}
      <div
        className={`flex gap-6 ${isHorizontal ? "flex-row flex-wrap" : "flex-col"} items-center justify-center`}
        style={{ maxWidth: 700, maxHeight: 400 }}
      >
        {Array.from({ length: nodeCount }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            {/* Node skeleton */}
            <div
              className="animate-pulse rounded-lg bg-muted"
              style={{
                width: viewMode === "cluster" ? 180 : 200,
                height: viewMode === "cluster" ? 90 : 70,
                animationDelay: `${i * 100}ms`,
              }}
            />
            {/* Edge skeleton */}
            {i < nodeCount - 1 && (
              <div
                className={`animate-pulse bg-muted/50 ${
                  isHorizontal ? "h-[2px] w-8" : "h-8 w-[2px]"
                }`}
                style={{ animationDelay: `${i * 100 + 50}ms` }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="mt-6 text-center">
        <div className="text-sm text-muted-foreground">
          {progress != null ? `Computing layout... ${Math.round(progress)}%` : "Building topology..."}
        </div>
        {progress != null && (
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
