/**
 * CrossClusterTopology — Fleet view showing clusters as top-level super-nodes.
 *
 * Features:
 * - "Fleet" view mode with clusters as expandable super-nodes
 * - Click cluster to expand into namespace-level view
 * - Aggregate health status per cluster node
 * - Cross-cluster edges for shared resources (e.g., federated services)
 */
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Handle,
  Position,
  type NodeProps,
  useReactFlow,
} from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClusterHealth {
  healthy: number;
  warning: number;
  error: number;
  unknown: number;
  total: number;
}

export interface ClusterInfo {
  id: string;
  name: string;
  provider?: string;
  region?: string;
  version?: string;
  health: ClusterHealth;
  namespaces: NamespaceInfo[];
  nodeCount: number;
  podCount: number;
}

export interface NamespaceInfo {
  name: string;
  podCount: number;
  health: 'healthy' | 'warning' | 'error' | 'unknown';
  workloadCount: number;
}

export interface CrossClusterEdge {
  id: string;
  sourceClusterId: string;
  targetClusterId: string;
  label: string;
  resourceType: string;
  detail?: string;
}

interface ClusterNodeData {
  cluster: ClusterInfo;
  isExpanded: boolean;
}

interface NamespaceNodeData {
  clusterId: string;
  namespace: NamespaceInfo;
}

// ─── Health Utilities ───────────────────────────────────────────────────────

function computeOverallHealth(health: ClusterHealth): 'healthy' | 'warning' | 'error' | 'unknown' {
  if (health.error > 0) return 'error';
  if (health.warning > 0) return 'warning';
  if (health.healthy > 0) return 'healthy';
  return 'unknown';
}

const HEALTH_COLORS = {
  healthy: { ring: 'ring-emerald-400', bg: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  warning: { ring: 'ring-amber-400', bg: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  error:   { ring: 'ring-red-400', bg: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  unknown: { ring: 'ring-gray-400', bg: 'bg-gray-400', text: 'text-gray-500 dark:text-gray-400' },
};

// ─── Cluster Super-Node ─────────────────────────────────────────────────────

function ClusterNodeComponent({ data, id }: NodeProps) {
  const d = data as unknown as ClusterNodeData;
  const { cluster, isExpanded } = d;
  const overallHealth = computeOverallHealth(cluster.health);
  const healthColor = HEALTH_COLORS[overallHealth];
  const healthPercent = cluster.health.total > 0
    ? Math.round((cluster.health.healthy / cluster.health.total) * 100)
    : 0;

  return (
    <div
      className={`min-w-[280px] rounded-xl border-2 ${healthColor.ring.replace('ring-', 'border-')} bg-white shadow-md transition-all duration-200 hover:shadow-lg dark:bg-gray-800`}
      role="treeitem"
      aria-label={`Cluster: ${cluster.name}, health ${overallHealth}, ${cluster.podCount} pods`}
      aria-expanded={isExpanded}
    >
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-gray-300 !border-white !border-2" />

      {/* Header */}
      <div className="flex items-center gap-3 rounded-t-xl bg-slate-600 px-4 py-2.5 dark:bg-slate-700">
        <div className={`h-3 w-3 rounded-full ${healthColor.bg} ring-2 ring-white/40`} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">{cluster.name}</div>
          {cluster.provider && (
            <div className="text-[10px] text-gray-300">{cluster.provider} {cluster.region ? `/ ${cluster.region}` : ''}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-white">{healthPercent}%</div>
          <div className="text-[10px] text-gray-300">healthy</div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {/* Health bar */}
        <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div className="flex h-full">
            {cluster.health.healthy > 0 && (
              <div
                className="bg-emerald-500"
                style={{ width: `${(cluster.health.healthy / cluster.health.total) * 100}%` }}
              />
            )}
            {cluster.health.warning > 0 && (
              <div
                className="bg-amber-500"
                style={{ width: `${(cluster.health.warning / cluster.health.total) * 100}%` }}
              />
            )}
            {cluster.health.error > 0 && (
              <div
                className="bg-red-500"
                style={{ width: `${(cluster.health.error / cluster.health.total) * 100}%` }}
              />
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-[11px]">
          <div className="text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{cluster.nodeCount}</span> nodes
          </div>
          <div className="text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{cluster.podCount}</span> pods
          </div>
          <div className="text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{cluster.namespaces.length}</span> ns
          </div>
          {cluster.version && (
            <div className="text-gray-400 dark:text-gray-500">
              {cluster.version}
            </div>
          )}
        </div>

        {/* Expanded: namespace list */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-700">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Namespaces
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {cluster.namespaces.map((ns) => (
                    <div
                      key={ns.name}
                      className="flex items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_COLORS[ns.health].bg}`} />
                      <span className="flex-1 font-medium text-gray-700 dark:text-gray-200">{ns.name}</span>
                      <span className="text-gray-400">{ns.podCount} pods</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-300 !border-white !border-2" />
    </div>
  );
}

const ClusterNode = memo(ClusterNodeComponent);

// ─── Namespace Node ─────────────────────────────────────────────────────────

function NamespaceNodeComponent({ data }: NodeProps) {
  const d = data as unknown as NamespaceNodeData;
  const { namespace } = d;
  const healthColor = HEALTH_COLORS[namespace.health];

  return (
    <div
      className={`min-w-[160px] rounded-lg border ${healthColor.ring.replace('ring-', 'border-')} bg-white px-3 py-2 shadow-sm dark:bg-gray-800`}
      role="treeitem"
      aria-label={`Namespace: ${namespace.name}, ${namespace.podCount} pods`}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-300" />
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${healthColor.bg}`} />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{namespace.name}</span>
      </div>
      <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
        {namespace.workloadCount} workloads, {namespace.podCount} pods
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-300" />
    </div>
  );
}

const NamespaceNode = memo(NamespaceNodeComponent);

const fleetNodeTypes = {
  clusterNode: ClusterNode,
  namespaceNode: NamespaceNode,
};

// ─── Main Component ─────────────────────────────────────────────────────────

export interface CrossClusterTopologyProps {
  clusters: ClusterInfo[];
  crossClusterEdges?: CrossClusterEdge[];
  /** Called when user clicks a cluster to navigate into it */
  onClusterSelect?: (clusterId: string) => void;
  /** Called when user clicks a namespace within an expanded cluster */
  onNamespaceSelect?: (clusterId: string, namespace: string) => void;
}

export const CrossClusterTopology = memo(function CrossClusterTopology({
  clusters,
  crossClusterEdges = [],
  onClusterSelect,
  onNamespaceSelect,
}: CrossClusterTopologyProps) {
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((clusterId: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  }, []);

  // Build React Flow nodes and edges
  const { flowNodes, flowEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Layout: clusters in a grid
    const clusterSpacing = 400;
    const cols = Math.ceil(Math.sqrt(clusters.length));

    clusters.forEach((cluster, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const isExpanded = expandedClusters.has(cluster.id);

      nodes.push({
        id: cluster.id,
        type: 'clusterNode',
        position: { x: col * clusterSpacing, y: row * 350 },
        data: {
          cluster,
          isExpanded,
        } satisfies ClusterNodeData,
      });

      // If expanded, show namespace child nodes
      if (isExpanded) {
        cluster.namespaces.forEach((ns, j) => {
          const nsId = `${cluster.id}/ns/${ns.name}`;
          nodes.push({
            id: nsId,
            type: 'namespaceNode',
            position: {
              x: col * clusterSpacing + 320,
              y: row * 350 + j * 60,
            },
            data: {
              clusterId: cluster.id,
              namespace: ns,
            } satisfies NamespaceNodeData,
          });

          edges.push({
            id: `edge-${cluster.id}-${nsId}`,
            source: cluster.id,
            target: nsId,
            type: 'default',
            style: { stroke: '#94a3b8', strokeWidth: 1 },
          });
        });
      }
    });

    // Cross-cluster edges
    for (const edge of crossClusterEdges) {
      edges.push({
        id: edge.id,
        source: edge.sourceClusterId,
        target: edge.targetClusterId,
        type: 'default',
        label: edge.label,
        style: {
          stroke: '#8b5cf6',
          strokeWidth: 2,
          strokeDasharray: '8 4',
        },
      });
    }

    return { flowNodes: nodes, flowEdges: edges };
  }, [clusters, expandedClusters, crossClusterEdges]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'clusterNode') {
        toggleExpanded(node.id);
      } else if (node.type === 'namespaceNode') {
        const d = node.data as unknown as NamespaceNodeData;
        onNamespaceSelect?.(d.clusterId, d.namespace.name);
      }
    },
    [toggleExpanded, onNamespaceSelect],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'clusterNode') {
        onClusterSelect?.(node.id);
      }
    },
    [onClusterSelect],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Fleet header */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900">
        <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Fleet View
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto text-[11px] text-gray-400">
          Click to expand, double-click to navigate into cluster
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        {clusters.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
            <div className="text-center">
              <svg className="mx-auto mb-3 h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-sm font-medium">No clusters configured</p>
              <p className="mt-1 text-xs">Add cluster connections to see the fleet view</p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={fleetNodeTypes}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="#e5e7eb" />
            <Controls position="bottom-right" />
            <MiniMap
              position="bottom-left"
              nodeColor={(node) => {
                if (node.type === 'clusterNode') {
                  const d = node.data as unknown as ClusterNodeData;
                  const h = computeOverallHealth(d.cluster.health);
                  return h === 'healthy' ? '#16A34A' : h === 'warning' ? '#EAB308' : h === 'error' ? '#DC2626' : '#9CA3AF';
                }
                return '#94a3b8';
              }}
              maskColor="rgba(0,0,0,0.08)"
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
});

export default CrossClusterTopology;
