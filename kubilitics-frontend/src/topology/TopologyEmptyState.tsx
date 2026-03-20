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
 * TopologyEmptyState: Rich contextual empty states with actionable suggestions.
 * Each state provides clear next steps and helpful hints.
 */
export function TopologyEmptyState({
  type,
  clusterId,
  namespace,
  searchQuery,
  onClearSearch,
  onClearNamespaceFilter,
}: TopologyEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-gray-50/50" role="status">
      <div className="max-w-md">
        {type === "no-cluster" && <NoClusterState />}
        {type === "empty-cluster" && <EmptyClusterState clusterId={clusterId} />}
        {type === "empty-namespace" && (
          <EmptyNamespaceState namespace={namespace} onClearNamespaceFilter={onClearNamespaceFilter} />
        )}
        {type === "no-search-results" && (
          <NoSearchResultsState searchQuery={searchQuery} onClearSearch={onClearSearch} />
        )}
      </div>
    </div>
  );
}

function NoClusterState() {
  return (
    <>
      <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
        <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      </div>
      <h2 className="mb-2 text-base font-semibold text-gray-800">Select a cluster</h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-5">
        Choose a cluster from the sidebar to visualize its topology.
      </p>
      <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-left">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 mb-2">Quick start</div>
        <div className="space-y-2">
          <HintRow icon="1" text="Select a cluster from the left sidebar" />
          <HintRow icon="2" text="Choose a view mode (Cluster, Namespace, Workload)" />
          <HintRow icon="3" text="Click any node to inspect its details" />
        </div>
      </div>
    </>
  );
}

function EmptyClusterState({ clusterId }: { clusterId?: string | null }) {
  return (
    <>
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5">
        <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
        </svg>
      </div>
      <h2 className="mb-2 text-base font-semibold text-gray-800">No resources found</h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-5">
        {clusterId ? `Cluster "${clusterId}" appears empty.` : "This cluster appears empty."}{" "}
        This could happen if the cluster has no workloads or if permissions are restricted.
      </p>
      <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-left">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 mb-2">Suggestions</div>
        <div className="space-y-2">
          <HintRow icon="&#10003;" text="Check that the cluster agent is running and connected" />
          <HintRow icon="&#10003;" text="Verify your RBAC permissions allow listing resources" />
          <HintRow icon="&#10003;" text="Try a different cluster from the sidebar" />
        </div>
      </div>
    </>
  );
}

function EmptyNamespaceState({
  namespace,
  onClearNamespaceFilter,
}: {
  namespace?: string;
  onClearNamespaceFilter?: () => void;
}) {
  return (
    <>
      <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-5">
        <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>
      </div>
      <h2 className="mb-2 text-base font-semibold text-gray-800">
        No workloads in {namespace ? `"${namespace}"` : "this namespace"}
      </h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-5">
        This namespace doesn&apos;t contain any visible workloads. It may only contain system resources or config objects not shown in this view.
      </p>
      <div className="flex flex-col items-center gap-3">
        {onClearNamespaceFilter && (
          <button
            type="button"
            className={`rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:from-emerald-600 hover:to-emerald-700 shadow-sm ${A11Y.focusRing} ${A11Y.transition}`}
            onClick={onClearNamespaceFilter}
          >
            Show all namespaces
          </button>
        )}
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-left w-full">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Try these</div>
          <div className="space-y-2">
            <HintRow icon="1" text="Switch to Cluster view to see all resources" />
            <HintRow icon="2" text="Filter by a different namespace in the sidebar" />
            <HintRow icon="3" text="Use Workload view to focus on deployments and pods" />
          </div>
        </div>
      </div>
    </>
  );
}

function NoSearchResultsState({
  searchQuery,
  onClearSearch,
}: {
  searchQuery?: string;
  onClearSearch?: () => void;
}) {
  return (
    <>
      <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-5">
        <svg className="w-7 h-7 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      </div>
      <h2 className="mb-2 text-base font-semibold text-gray-800">No matches found</h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-5">
        No resources match{searchQuery ? ` "${searchQuery}"` : " your search"}.
      </p>
      <div className="flex flex-col items-center gap-3">
        {onClearSearch && (
          <button
            type="button"
            className={`rounded-lg bg-gradient-to-r from-violet-500 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:from-violet-600 hover:to-violet-700 shadow-sm ${A11Y.focusRing} ${A11Y.transition}`}
            onClick={onClearSearch}
          >
            Clear search
          </button>
        )}
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-left w-full">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Search syntax</div>
          <div className="space-y-1.5">
            <SyntaxRow syntax="kind:Pod" desc="Filter by resource kind" />
            <SyntaxRow syntax="ns:default" desc="Filter by namespace" />
            <SyntaxRow syntax="status:error" desc="Find unhealthy resources" />
            <SyntaxRow syntax="label:app=web" desc="Match label selectors" />
          </div>
        </div>
      </div>
    </>
  );
}

function HintRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex-shrink-0 w-5 h-5 rounded-md bg-white/80 flex items-center justify-center text-[10px] font-bold text-gray-500 border border-gray-200/60">
        {icon}
      </span>
      <span className="text-xs text-gray-600 leading-relaxed">{text}</span>
    </div>
  );
}

function SyntaxRow({ syntax, desc }: { syntax: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-violet-600 font-medium">{syntax}</code>
      <span className="text-[11px] text-gray-400">{desc}</span>
    </div>
  );
}
