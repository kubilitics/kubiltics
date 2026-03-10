export interface TopologyEmptyStateProps {
  type: "no-cluster" | "empty-cluster" | "empty-namespace" | "no-search-results";
  clusterId?: string | null;
  namespace?: string;
  searchQuery?: string;
}

/**
 * TopologyEmptyState: Contextual empty states for different scenarios.
 */
export function TopologyEmptyState({
  type,
  clusterId,
  namespace,
  searchQuery,
}: TopologyEmptyStateProps) {
  const configs: Record<string, { icon: string; title: string; description: string }> = {
    "no-cluster": {
      icon: "🔍",
      title: "Select a cluster",
      description: "Choose a cluster from the sidebar to view its topology.",
    },
    "empty-cluster": {
      icon: "📦",
      title: "No resources found",
      description: `No resources found in cluster "${clusterId ?? "unknown"}". This cluster may be empty or you may not have permissions to view resources.`,
    },
    "empty-namespace": {
      icon: "📁",
      title: `No workloads in ${namespace ?? "this namespace"}`,
      description: "This namespace doesn't contain any workloads. Try switching to a different namespace or viewing the cluster overview.",
    },
    "no-search-results": {
      icon: "🔎",
      title: "No resources match your search",
      description: `No results for "${searchQuery ?? ""}". Try a different search term or use syntax like kind:Pod, ns:default, or status:error.`,
    },
  };

  const config = configs[type] ?? configs["empty-cluster"];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <div className="mb-4 text-5xl">{config.icon}</div>
        <h2 className="mb-2 text-lg font-semibold text-foreground">{config.title}</h2>
        <p className="text-sm text-muted-foreground">{config.description}</p>
      </div>
    </div>
  );
}
