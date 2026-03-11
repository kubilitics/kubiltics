import { useMemo, useCallback } from "react";
import type { TopologyResponse, TopologyNode, TopologyEdge } from "./types/topology";
import { categoryIcon, formatBytes, formatCPU } from "./nodes/nodeUtils";
import { getStatusBadge, getCategoryColor, A11Y } from "./constants/designTokens";

export interface TopologyDetailPanelProps {
  selectedNodeId: string | null;
  topology: TopologyResponse | null;
  onNavigateToResource?: (nodeId: string) => void;
}

export function TopologyDetailPanel({
  selectedNodeId,
  topology,
  onNavigateToResource,
}: TopologyDetailPanelProps) {
  const node = useMemo(
    () => selectedNodeId ? topology?.nodes?.find((n) => n.id === selectedNodeId) ?? null : null,
    [selectedNodeId, topology]
  );

  const connections = useMemo(() => {
    if (!selectedNodeId || !topology?.edges) return [];
    return topology.edges.filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId
    );
  }, [selectedNodeId, topology]);

  const connectedNodes = useMemo(() => {
    if (!topology?.nodes || !connections.length) return new Map<string, TopologyNode>();
    const map = new Map<string, TopologyNode>();
    for (const n of topology.nodes) {
      map.set(n.id, n);
    }
    return map;
  }, [topology, connections]);

  const handleNavigate = useCallback((id: string) => {
    onNavigateToResource?.(id);
  }, [onNavigateToResource]);

  if (!node) {
    return (
      <aside
        className="hidden w-80 shrink-0 border-l border-gray-200 bg-gray-50/50 p-6 text-xs text-muted-foreground md:block"
        aria-label="Resource detail panel"
      >
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-gray-500 mb-1">Select a resource</div>
          <p className="text-gray-400 text-xs leading-relaxed max-w-[200px]">Click any node on the canvas to view its details, connections, and metrics.</p>
        </div>
      </aside>
    );
  }

  const icon = categoryIcon(node.category);
  const badge = getStatusBadge(node.status);
  const accent = getCategoryColor(node.category).accent;

  return (
    <aside
      className="hidden w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white md:block"
      aria-label={`Details for ${node.kind} ${node.name}`}
      role="complementary"
    >
      {/* Header */}
      <div className="sticky top-0 border-b bg-background p-3 z-10">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{node.name}</div>
            <div className="text-[11px] text-muted-foreground">{node.kind}</div>
          </div>
          <div
            className={`h-3 w-3 rounded-full ${badge.dotClass}`}
            title={node.statusReason ?? node.status}
            aria-label={`Status: ${node.statusReason ?? node.status}`}
            role="img"
          />
        </div>
        {/* Category accent bar */}
        <div className="h-0.5 mt-2 rounded-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      </div>

      <div className="space-y-3 p-3 text-xs">
        {/* Basic Info */}
        <Section title="Overview">
          <InfoRow label="Kind" value={node.kind} />
          <InfoRow label="Name" value={node.name} />
          {node.namespace && <InfoRow label="Namespace" value={node.namespace} />}
          <InfoRow label="API Version" value={node.apiVersion} />
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground">Status</span>
            <span className={`inline-flex items-center gap-1 ${badge.textColor} font-medium`}>
              <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} aria-hidden="true" />
              {node.statusReason ?? badge.text}
            </span>
          </div>
          {node.createdAt && <InfoRow label="Created" value={formatDate(node.createdAt)} />}
        </Section>

        {/* Resource-specific details */}
        <ResourceSpecificSection node={node} />

        {/* Metrics */}
        {node.metrics && (
          <Section title="Metrics">
            {node.metrics.cpuRequest != null && (
              <InfoRow label="CPU Request" value={formatCPU(node.metrics.cpuRequest)} />
            )}
            {node.metrics.cpuLimit != null && node.metrics.cpuLimit > 0 && (
              <InfoRow label="CPU Limit" value={formatCPU(node.metrics.cpuLimit)} />
            )}
            {node.metrics.memoryRequest != null && node.metrics.memoryRequest > 0 && (
              <InfoRow label="Memory Request" value={formatBytes(node.metrics.memoryRequest)} />
            )}
            {node.metrics.memoryLimit != null && node.metrics.memoryLimit > 0 && (
              <InfoRow label="Memory Limit" value={formatBytes(node.metrics.memoryLimit)} />
            )}
            {node.metrics.podCount != null && (
              <InfoRow label="Pods" value={`${node.metrics.readyCount ?? 0}/${node.metrics.podCount} ready`} />
            )}
            {node.metrics.restartCount != null && node.metrics.restartCount > 0 && (
              <InfoRow label="Restarts" value={String(node.metrics.restartCount)} highlight />
            )}
          </Section>
        )}

        {/* Connections */}
        <Section title={`Connections (${connections.length})`}>
          {connections.length === 0 ? (
            <p className="text-muted-foreground italic">No connections</p>
          ) : (
            <div className="space-y-1.5" role="list" aria-label="Connected resources">
              {connections.map((edge) => {
                const peerId = edge.source === selectedNodeId ? edge.target : edge.source;
                const peer = connectedNodes.get(peerId);
                const direction = edge.source === selectedNodeId ? "outgoing" : "incoming";
                return (
                  <ConnectionRow
                    key={edge.id}
                    edge={edge}
                    peer={peer}
                    direction={direction}
                    onNavigate={handleNavigate}
                  />
                );
              })}
            </div>
          )}
        </Section>

        {/* Labels */}
        {node.labels && Object.keys(node.labels).length > 0 && (
          <Section title="Labels">
            <div className="space-y-0.5" role="list" aria-label="Resource labels">
              {Object.entries(node.labels).slice(0, 10).map(([k, v]) => (
                <div key={k} className="flex gap-1" role="listitem">
                  <span className="font-mono text-[10px] text-muted-foreground">{k}:</span>
                  <span className="font-mono text-[10px] break-all">{v}</span>
                </div>
              ))}
              {Object.keys(node.labels).length > 10 && (
                <span className="text-[10px] text-muted-foreground">
                  +{Object.keys(node.labels).length - 10} more
                </span>
              )}
            </div>
          </Section>
        )}

        {/* Go to Resource Button */}
        <button
          type="button"
          className={`w-full rounded-lg bg-primary px-3 py-2.5 text-center text-xs font-semibold text-primary-foreground hover:bg-primary/90 ${A11Y.focusRing} ${A11Y.transition}`}
          onClick={() => handleNavigate(node.id)}
        >
          View Resource Details
        </button>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right max-w-[55%] truncate ${highlight ? "font-semibold text-amber-600" : ""}`} title={value}>{value}</span>
    </div>
  );
}

function ConnectionRow({
  edge,
  peer,
  direction,
  onNavigate,
}: {
  edge: TopologyEdge;
  peer?: TopologyNode | null;
  direction: "incoming" | "outgoing";
  onNavigate: (id: string) => void;
}) {
  const peerId = direction === "outgoing" ? edge.target : edge.source;
  const peerName = peer?.name ?? peerId.split("/").pop() ?? peerId;
  const peerKind = peer?.kind ?? peerId.split("/")[0] ?? "";
  const arrow = direction === "outgoing" ? "\u2192" : "\u2190";
  const icon = peer ? categoryIcon(peer.category) : "";

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-muted/50 ${A11Y.focusRing} ${A11Y.transition}`}
      onClick={() => onNavigate(peerId)}
      role="listitem"
      aria-label={`${direction === "outgoing" ? "connects to" : "connected from"} ${peerKind} ${peerName} via ${edge.label}`}
    >
      <span className="text-[10px]" aria-hidden="true">{icon}</span>
      <span className="text-[10px] text-muted-foreground" aria-hidden="true">{arrow}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{peerName}</div>
        <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span>{peerKind}</span>
          {edge.label && (
            <>
              <span aria-hidden="true">|</span>
              <span>{edge.label}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function ResourceSpecificSection({ node }: { node: TopologyNode }) {
  switch (node.kind) {
    case "Pod":
      return (
        <Section title="Pod Details">
          <InfoRow label="Phase" value={node.status} />
          {node.statusReason && <InfoRow label="Reason" value={node.statusReason} />}
        </Section>
      );
    case "Deployment":
    case "StatefulSet":
    case "DaemonSet":
      return (
        <Section title="Workload Details">
          <InfoRow label="Type" value={node.kind} />
          <InfoRow label="Category" value={node.category} />
        </Section>
      );
    case "Service":
      return (
        <Section title="Service Details">
          <InfoRow label="Type" value={node.kind} />
        </Section>
      );
    case "Ingress":
      return (
        <Section title="Ingress Details">
          <InfoRow label="Type" value="Ingress" />
        </Section>
      );
    case "ConfigMap":
    case "Secret":
      return (
        <Section title="Config Details">
          <InfoRow label="Type" value={node.kind} />
        </Section>
      );
    case "PersistentVolumeClaim":
    case "PersistentVolume":
      return (
        <Section title="Storage Details">
          <InfoRow label="Type" value={node.kind} />
          <InfoRow label="Phase" value={node.status} />
        </Section>
      );
    case "Node":
      return (
        <Section title="Node Details">
          <InfoRow label="Status" value={node.statusReason ?? node.status} />
        </Section>
      );
    default:
      return null;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
