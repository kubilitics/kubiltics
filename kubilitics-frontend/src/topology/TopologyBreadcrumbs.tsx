import type { ViewMode } from "./types/topology";

export interface TopologyBreadcrumbsProps {
  viewMode: ViewMode;
  namespace?: string | null;
  resource?: string | null;
}

export function TopologyBreadcrumbs({
  viewMode,
  namespace,
  resource,
}: TopologyBreadcrumbsProps) {
  const parts: string[] = ["cluster"];
  if (viewMode !== "cluster") parts.push(namespace ?? "namespace");
  if (viewMode === "workload" || viewMode === "resource") parts.push("workload");
  if (viewMode === "resource" && resource) parts.push(resource);
  return (
    <div className="flex items-center gap-1 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1">/</span>}
          <span className={i === parts.length - 1 ? "font-medium text-foreground" : "opacity-70"}>{p}</span>
        </span>
      ))}
    </div>
  );
}

