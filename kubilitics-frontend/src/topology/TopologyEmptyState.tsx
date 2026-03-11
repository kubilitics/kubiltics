import { A11Y } from "./constants/designTokens";

export interface TopologyEmptyStateProps {
  type: "no-cluster" | "empty-cluster" | "empty-namespace" | "no-search-results";
  clusterId?: string | null;
  namespace?: string;
  searchQuery?: string;
  onClearSearch?: () => void;
  onClearNamespaceFilter?: () => void;
}

/**
 * TopologyEmptyState: Contextual empty states for different scenarios.
 * Uses SVG icons instead of emoji for consistent cross-platform rendering.
 */
export function TopologyEmptyState({
  type,
  clusterId,
  namespace,
  searchQuery,
  onClearSearch,
  onClearNamespaceFilter,
}: TopologyEmptyStateProps) {
  const configs: Record<string, { title: string; description: string; action?: { label: string; onClick?: () => void } }> = {
    "no-cluster": {
      title: "Select a cluster",
      description: "Choose a cluster from the sidebar to view its topology.",
    },
    "empty-cluster": {
      title: "No resources found",
      description: `No resources found in cluster "${clusterId ?? "unknown"}". This cluster may be empty or you may not have permissions to view resources.`,
    },
    "empty-namespace": {
      title: `No workloads in ${namespace ?? "this namespace"}`,
      description: "This namespace doesn't contain any workloads. Try switching to a different namespace or viewing the cluster overview.",
      action: onClearNamespaceFilter ? { label: "Show all namespaces", onClick: onClearNamespaceFilter } : undefined,
    },
    "no-search-results": {
      title: "No resources match your search",
      description: `No results for "${searchQuery ?? ""}". Try a different search term or use syntax like kind:Pod, ns:default, or status:error.`,
      action: onClearSearch ? { label: "Clear search", onClick: onClearSearch } : undefined,
    },
  };

  const config = configs[type] ?? configs["empty-cluster"];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-gray-50/50" role="status">
      <div className="max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-5">
          <EmptyStateIcon type={type} />
        </div>
        <h2 className="mb-2 text-base font-semibold text-gray-800">{config.title}</h2>
        <p className="text-sm text-gray-500 leading-relaxed">{config.description}</p>
        {config.action && (
          <button
            type="button"
            className={`mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm ${A11Y.focusRing} ${A11Y.transition}`}
            onClick={config.action.onClick}
          >
            {config.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyStateIcon({ type }: { type: string }) {
  const className = "w-7 h-7 text-gray-300";
  switch (type) {
    case "no-cluster":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      );
    case "empty-cluster":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
        </svg>
      );
    case "empty-namespace":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>
      );
    default:
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      );
  }
}
