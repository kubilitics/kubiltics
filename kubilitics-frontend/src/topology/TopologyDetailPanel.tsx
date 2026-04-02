import { useMemo, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Check, ChevronRight, X, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { TopologyResponse, TopologyNode, TopologyEdge, NodeMetrics } from "./types/topology";
import { formatBytes, formatCPU } from "./nodes/nodeUtils";
import { K8sIcon } from "./icons/K8sIcon";
import { getStatusBadge, getCategoryColor, getEdgeColor, A11Y } from "./constants/designTokens";
import { useNodeTrafficImpact, type TrafficEdge as TrafficEdgeType } from "./hooks/useNodeTrafficImpact";

export interface TopologyDetailPanelProps {
  selectedNodeId: string | null;
  topology: TopologyResponse | null;
  clusterId?: string;
  onNavigateToResource?: (nodeId: string) => void;
  onClose?: () => void;
}

/**
 * Map a K8s kind to its URL path segment.
 * Route pattern: /{kind-plural-lowercase}/{namespace}/{name}
 */
function kindToRouteSegment(kind: string): string {
  const k = kind.toLowerCase();
  const irregulars: Record<string, string> = {
    ingress: "ingresses",
    endpointslice: "endpointslices",
    networkpolicy: "networkpolicies",
    podsecuritypolicy: "podsecuritypolicies",
    storageclass: "storageclasses",
    ingressclass: "ingressclasses",
    priorityclass: "priorityclasses",
    runtimeclass: "runtimeclasses",
    resourcequota: "resourcequotas",
    limitrange: "limitranges",
    componentstatus: "componentstatuses",
  };
  if (irregulars[k]) return irregulars[k];
  // Standard pluralization
  if (k.endsWith("s")) return k;
  return k + "s";
}

export function TopologyDetailPanel({
  selectedNodeId,
  topology,
  clusterId,
  onNavigateToResource,
  onClose,
}: TopologyDetailPanelProps) {
  const navigate = useNavigate();

  const {
    trafficEdges,
  } = useNodeTrafficImpact(clusterId ?? null, selectedNodeId);

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

  const handleViewResourceDetails = useCallback((n: TopologyNode) => {
    const segment = kindToRouteSegment(n.kind);
    if (n.namespace) {
      navigate(`/${segment}/${n.namespace}/${n.name}`);
    } else {
      navigate(`/${segment}/${n.name}`);
    }
  }, [navigate]);

  if (!node) {
    return null;
  }

  const badge = getStatusBadge(node.status);
  const accent = getCategoryColor(node.category).accent;

  return (
    <aside
      className="hidden w-80 shrink-0 overflow-y-auto border-l border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 md:block"
      aria-label={`Details for ${node.kind} ${node.name}`}
      role="complementary"
    >
      {/* Header */}
      <div className="sticky top-0 border-b bg-background p-3 z-10">
        <div className="flex items-center gap-2">
          <K8sIcon kind={node.kind} size={22} />
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
          {/* Close button */}
          {onClose && (
            <button
              type="button"
              className={`ml-1 rounded-md p-1 text-gray-600 dark:text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 ${A11Y.focusRing} ${A11Y.transition}`}
              onClick={onClose}
              aria-label="Close detail panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
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
        {node.metrics && hasMetricsData(node.metrics) && (
          <Section title="Metrics">
            {node.metrics.cpuUsage != null && (
              <InfoRow label="CPU Usage" value={formatCPU(node.metrics.cpuUsage)} />
            )}
            {node.metrics.cpuRequest != null && (
              <InfoRow label="CPU Request" value={formatCPU(node.metrics.cpuRequest)} />
            )}
            {node.metrics.cpuLimit != null && node.metrics.cpuLimit > 0 && (
              <InfoRow label="CPU Limit" value={formatCPU(node.metrics.cpuLimit)} />
            )}
            {node.metrics.memoryUsage != null && node.metrics.memoryUsage > 0 && (
              <InfoRow label="Memory Usage" value={formatBytes(node.metrics.memoryUsage)} />
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

        {/* Connections — grouped into UPSTREAM / DOWNSTREAM */}
        {(() => {
          const upstream = connections.filter(e => e.target === selectedNodeId);
          const downstream = connections.filter(e => e.source === selectedNodeId);
          return (
            <Section title={`Connections (${connections.length})`}>
              {connections.length === 0 ? (
                <p className="text-muted-foreground italic">No connections</p>
              ) : (
                <div className="space-y-2">
                  {upstream.length > 0 && (
                    <CollapsibleGroup label={`UPSTREAM (${upstream.length})`} defaultOpen>
                      {upstream.map((edge) => {
                        const peerId = edge.source;
                        const peer = connectedNodes.get(peerId);
                        return (
                          <ConnectionRow
                            key={edge.id}
                            edge={edge}
                            peer={peer}
                            direction="incoming"
                            onNavigate={handleNavigate}
                          />
                        );
                      })}
                    </CollapsibleGroup>
                  )}
                  {downstream.length > 0 && (
                    <CollapsibleGroup label={`DOWNSTREAM (${downstream.length})`} defaultOpen>
                      {downstream.map((edge) => {
                        const peerId = edge.target;
                        const peer = connectedNodes.get(peerId);
                        return (
                          <ConnectionRow
                            key={edge.id}
                            edge={edge}
                            peer={peer}
                            direction="outgoing"
                            onNavigate={handleNavigate}
                          />
                        );
                      })}
                    </CollapsibleGroup>
                  )}
                </div>
              )}
            </Section>
          );
        })()}

        {/* Traffic */}
        {clusterId && trafficEdges.length > 0 && (
          <TrafficSection trafficEdges={trafficEdges} />
        )}

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

        {/* Go to Resource Button — navigates to the resource detail page */}
        <button
          type="button"
          className={`w-full rounded-lg bg-primary px-3 py-2.5 text-center text-xs font-semibold text-primary-foreground hover:bg-primary/90 ${A11Y.focusRing} ${A11Y.transition}`}
          onClick={() => handleViewResourceDetails(node)}
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function CollapsibleGroup({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      {open && <div className="space-y-1 pl-4 pt-1">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value, highlight, copyable = true }: { label: string; value: string; highlight?: boolean; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [value]);

  return (
    <div className="group flex justify-between py-0.5 items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 max-w-[60%]">
        <span className={`text-right truncate ${highlight ? "font-semibold text-amber-600" : ""}`} title={value}>{value}</span>
        {copyable && (
          <button
            type="button"
            className="opacity-50 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700"
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3 text-gray-600 dark:text-gray-400" />
            )}
          </button>
        )}
      </span>
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
  const edgeColor = getEdgeColor((edge as unknown as Record<string, unknown>).relationshipCategory as string);

  return (
    <button
      type="button"
      className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 border border-transparent hover:border-gray-100 dark:hover:border-slate-600 ${A11Y.focusRing} ${A11Y.transition}`}
      onClick={() => onNavigate(peerId)}
      role="listitem"
      aria-label={`${direction === "outgoing" ? "connects to" : "connected from"} ${peerKind} ${peerName} via ${edge.label}`}
    >
      {/* Direction indicator */}
      <div
        className="flex-shrink-0 w-1 h-8 rounded-full"
        style={{ backgroundColor: edgeColor }}
        aria-hidden="true"
      />
      {peer && <K8sIcon kind={peer.kind} size={16} className="flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-gray-900 dark:text-slate-200">{peerName}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[9px] text-gray-600 dark:text-gray-400">{peerKind}</span>
          {edge.label && (
            <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">
              {edge.label}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-3 w-3 text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" aria-hidden="true" />
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
          {node.podIP && <InfoRow label="Pod IP" value={node.podIP} />}
          {node.nodeName && <InfoRow label="Node" value={node.nodeName} />}
          {node.containers != null && node.containers > 0 && <InfoRow label="Containers" value={String(node.containers)} />}
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
          {node.serviceType && <InfoRow label="Type" value={node.serviceType} />}
          {node.clusterIP && <InfoRow label="Cluster IP" value={node.clusterIP} />}
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
          {node.internalIP && <InfoRow label="Internal IP" value={node.internalIP} />}
          {node.externalIP && <InfoRow label="External IP" value={node.externalIP} />}
        </Section>
      );
    default:
      return null;
  }
}

// ─── Traffic Section ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let color = "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-400";
  if (pct >= 80) color = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  else if (pct >= 50) color = "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return (
    <span className={`inline-flex items-center rounded px-1 py-0 text-[8px] font-medium ${color}`}>
      {pct}%
    </span>
  );
}

function TrafficSection({ trafficEdges }: { trafficEdges: TrafficEdgeType[] }) {
  const incoming = trafficEdges.filter((e) => e.direction === "incoming");
  const outgoing = trafficEdges.filter((e) => e.direction === "outgoing");

  return (
    <Section title={`Traffic (${trafficEdges.length})`}>
      {incoming.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center gap-1 mb-1 text-[10px] text-muted-foreground font-medium">
            <ArrowDownLeft className="h-3 w-3" />
            Incoming ({incoming.length})
          </div>
          <div className="space-y-1" role="list" aria-label="Incoming traffic">
            {incoming.map((edge) => (
              <TrafficEdgeRow key={edge.id} edge={edge} />
            ))}
          </div>
        </div>
      )}
      {outgoing.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-1 text-[10px] text-muted-foreground font-medium">
            <ArrowUpRight className="h-3 w-3" />
            Outgoing ({outgoing.length})
          </div>
          <div className="space-y-1" role="list" aria-label="Outgoing traffic">
            {outgoing.map((edge) => (
              <TrafficEdgeRow key={edge.id} edge={edge} />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function TrafficEdgeRow({ edge }: { edge: TrafficEdgeType }) {
  const peerName = edge.direction === "incoming" ? edge.sourceName : edge.targetName;
  const peerKind = edge.direction === "incoming" ? edge.sourceKind : edge.targetKind;

  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 border border-transparent hover:bg-gray-50 dark:hover:bg-slate-700/50"
      role="listitem"
    >
      <K8sIcon kind={peerKind} size={14} className="flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-medium">{peerName}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[9px] text-muted-foreground">{peerKind}</span>
          {edge.port > 0 && (
            <span className="text-[9px] text-muted-foreground">:{edge.port}</span>
          )}
        </div>
      </div>
      <ConfidenceBadge confidence={edge.confidence} />
    </div>
  );
}

/** Returns true if metrics object has any displayable data */
function hasMetricsData(m: NodeMetrics): boolean {
  return (
    m.cpuUsage != null ||
    m.cpuRequest != null ||
    m.cpuLimit != null ||
    (m.memoryUsage != null && m.memoryUsage > 0) ||
    (m.memoryRequest != null && m.memoryRequest > 0) ||
    (m.memoryLimit != null && m.memoryLimit > 0) ||
    m.podCount != null ||
    (m.restartCount != null && m.restartCount > 0)
  );
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
