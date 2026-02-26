/**
 * World-Class Topology Page
 * Uses the portable /topology-engine
 * Structural + Traffic Flow modes, Heatmap, Minimap
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Network, ZoomIn, ZoomOut, Maximize, RotateCcw, Download,
  FileCode, FileImage, FileText, FileJson, Table, Search,
  Layers, ChevronDown, Activity, Thermometer, RefreshCcw,
  Map as MapIcon, Copy, Bomb, Route, Trash2, Edit, X, ScrollText, ExternalLink, ChevronUp, Grid3X3,
  Brain, GitBranch, AlertCircle, CheckCircle2, Sparkles, Loader2, ShieldAlert, ArrowRight,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useClusterStore } from '@/stores/clusterStore';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useClusterTopology } from '@/hooks/useClusterTopology';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getTopologyExportDrawio } from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  useBlastRadiusAnalysis,
  useCriticalPath,
  useNodeExplain,
  type TopologyNodeSummary as AINodeSummary,
  type TopologyEdgeSummary as AIEdgeSummary,
} from '@/hooks/useTopologyAI';

// ─── Import from portable topology-engine ─────────────────────
import {
  TopologyCanvas,
  ABSTRACTION_LEVELS,
  NODE_COLORS,
  KIND_LABELS,
  getKindColor,
  RELATIONSHIP_CONFIG,
  downloadJSON,
  downloadCSVSummary,
  downloadPDF,
  getRecommendedAbstraction,
  D3TopologyCanvas,
  convertToD3Topology,
  computeBlastRadius,
  useHealthOverlay,
  useCostOverlay,
  usePerformanceOverlay,
  useSecurityOverlay,
  useDependencyOverlay,
  useTrafficOverlay,
  OVERLAY_LABELS,
  type TopologyCanvasRef,
  type TopologyGraph,
  type TopologyNode,
  type KubernetesKind,
  type HealthStatus,
  type RelationshipType,
  type AbstractionLevel,
  type HeatMapMode,
  type BlastRadiusResult,
  type OverlayType,
  generateTestGraph,
} from '@/topology-engine';

// ─── Resource type filter config ──────────────────────────────
const RESOURCE_TYPES: Array<{ kind: KubernetesKind; label: string; color: string }> = [
  { kind: 'Namespace', label: 'Namespace', color: NODE_COLORS.Namespace.bg },
  { kind: 'Ingress', label: 'Ingress', color: NODE_COLORS.Ingress.bg },
  { kind: 'Service', label: 'Service', color: NODE_COLORS.Service.bg },
  { kind: 'Deployment', label: 'Deployment', color: NODE_COLORS.Deployment.bg },
  { kind: 'StatefulSet', label: 'StatefulSet', color: NODE_COLORS.StatefulSet.bg },
  { kind: 'DaemonSet', label: 'DaemonSet', color: NODE_COLORS.DaemonSet.bg },
  { kind: 'ReplicaSet', label: 'ReplicaSet', color: NODE_COLORS.ReplicaSet.bg },
  { kind: 'Pod', label: 'Pod', color: NODE_COLORS.Pod.bg },
  { kind: 'PodGroup', label: 'PodGroup', color: NODE_COLORS.PodGroup.bg },
  { kind: 'ConfigMap', label: 'ConfigMap', color: NODE_COLORS.ConfigMap.bg },
  { kind: 'Secret', label: 'Secret', color: NODE_COLORS.Secret.bg },
  { kind: 'PersistentVolumeClaim', label: 'PersistentVolumeClaim', color: NODE_COLORS.PersistentVolumeClaim.bg },
  { kind: 'PersistentVolume', label: 'PersistentVolume', color: NODE_COLORS.PersistentVolume.bg },
  { kind: 'StorageClass', label: 'StorageClass', color: NODE_COLORS.StorageClass.bg },
  { kind: 'Node', label: 'Node', color: NODE_COLORS.Node.bg },
  { kind: 'Job', label: 'Job', color: NODE_COLORS.Job.bg },
  { kind: 'CronJob', label: 'CronJob', color: NODE_COLORS.CronJob.bg },
];

const ALL_RELATIONSHIPS: RelationshipType[] = [
  'owns', 'selects', 'scheduled_on', 'routes', 'references',
  'configures', 'mounts', 'stores', 'contains', 'exposes', 'backed_by',
  'permits', 'limits', 'manages',
];

// Helper
function n(partial: Omit<TopologyNode, 'label'>): TopologyNode {
  return { ...partial, label: partial.name };
}

// ─── Mock Graph ───────────────────────────────────────────────
const mockGraph: TopologyGraph = {
  schemaVersion: '1.0',
  nodes: [
    n({ id: 'Namespace/blue-green-demo', kind: 'Namespace', namespace: '', name: 'blue-green-demo', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'ns-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Node/desktop-worker', kind: 'Node', namespace: '', name: 'desktop-worker', apiVersion: 'v1', status: 'Ready', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'node-1' }, computed: { health: 'healthy', cpuUsage: 45 } }),
    n({ id: 'Deployment/blue-green-demo/nginx', kind: 'Deployment', namespace: 'blue-green-demo', name: 'nginx-deployment', apiVersion: 'apps/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'dep-1' }, computed: { health: 'healthy', replicas: { desired: 3, ready: 3, available: 3 } } }),
    n({ id: 'Deployment/blue-green-demo/api', kind: 'Deployment', namespace: 'blue-green-demo', name: 'api-gateway', apiVersion: 'apps/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'dep-2' }, computed: { health: 'warning', replicas: { desired: 2, ready: 1, available: 1 }, cpuUsage: 78 } }),
    n({ id: 'ReplicaSet/blue-green-demo/nginx-rs', kind: 'ReplicaSet', namespace: 'blue-green-demo', name: 'nginx-rs-abc12', apiVersion: 'apps/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'rs-1' }, computed: { health: 'healthy', replicas: { desired: 3, ready: 3, available: 3 } } }),
    n({ id: 'Pod/blue-green-demo/nginx-1', kind: 'Pod', namespace: 'blue-green-demo', name: 'nginx-abc12', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-1' }, computed: { health: 'healthy', restartCount: 0, cpuUsage: 12 } }),
    n({ id: 'Pod/blue-green-demo/nginx-2', kind: 'Pod', namespace: 'blue-green-demo', name: 'nginx-def34', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-2' }, computed: { health: 'healthy', restartCount: 0, cpuUsage: 18 } }),
    n({ id: 'Pod/blue-green-demo/nginx-3', kind: 'Pod', namespace: 'blue-green-demo', name: 'nginx-ghi56', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-3' }, computed: { health: 'warning', restartCount: 5, cpuUsage: 62 } }),
    n({ id: 'Pod/blue-green-demo/api-1', kind: 'Pod', namespace: 'blue-green-demo', name: 'api-jkl78', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-4' }, computed: { health: 'healthy', restartCount: 1, cpuUsage: 34 } }),
    n({ id: 'Service/blue-green-demo/nginx-svc', kind: 'Service', namespace: 'blue-green-demo', name: 'nginx-svc', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'svc-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Service/blue-green-demo/api-svc', kind: 'Service', namespace: 'blue-green-demo', name: 'api-svc', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'svc-2' }, computed: { health: 'healthy' } }),
    n({ id: 'ConfigMap/blue-green-demo/nginx-config', kind: 'ConfigMap', namespace: 'blue-green-demo', name: 'nginx-config', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'cm-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Secret/blue-green-demo/api-secrets', kind: 'Secret', namespace: 'blue-green-demo', name: 'api-secrets', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'sec-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Ingress/blue-green-demo/main-ingress', kind: 'Ingress', namespace: 'blue-green-demo', name: 'todo-ingress', apiVersion: 'networking.k8s.io/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'ing-1' }, computed: { health: 'healthy' } }),
    n({ id: 'PersistentVolume/pv-test-001', kind: 'PersistentVolume', namespace: '', name: 'pv-test-001', apiVersion: 'v1', status: 'Bound', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pv-1' }, computed: { health: 'healthy' } }),
    n({ id: 'PersistentVolumeClaim/blue-green-demo/data-pvc', kind: 'PersistentVolumeClaim', namespace: 'blue-green-demo', name: 'data-pvc', apiVersion: 'v1', status: 'Bound', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pvc-1' }, computed: { health: 'healthy' } }),
    n({ id: 'StorageClass/hostpath', kind: 'StorageClass', namespace: '', name: 'hostpath', apiVersion: 'storage.k8s.io/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'sc-1' }, computed: { health: 'healthy' } }),
  ],
  edges: [
    { id: 'e-dep-rs', source: 'Deployment/blue-green-demo/nginx', target: 'ReplicaSet/blue-green-demo/nginx-rs', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e-rs-pod1', source: 'ReplicaSet/blue-green-demo/nginx-rs', target: 'Pod/blue-green-demo/nginx-1', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e-rs-pod2', source: 'ReplicaSet/blue-green-demo/nginx-rs', target: 'Pod/blue-green-demo/nginx-2', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e-rs-pod3', source: 'ReplicaSet/blue-green-demo/nginx-rs', target: 'Pod/blue-green-demo/nginx-3', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e-dep-pod4', source: 'Deployment/blue-green-demo/api', target: 'Pod/blue-green-demo/api-1', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e-svc-pod1', source: 'Service/blue-green-demo/nginx-svc', target: 'Pod/blue-green-demo/nginx-1', relationshipType: 'selects', label: 'selected by', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e-svc-pod2', source: 'Service/blue-green-demo/nginx-svc', target: 'Pod/blue-green-demo/nginx-2', relationshipType: 'selects', label: 'selected by', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e-svc-pod3', source: 'Service/blue-green-demo/nginx-svc', target: 'Pod/blue-green-demo/nginx-3', relationshipType: 'selects', label: 'selected by', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e-svc-pod4', source: 'Service/blue-green-demo/api-svc', target: 'Pod/blue-green-demo/api-1', relationshipType: 'selects', label: 'selected by', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e-ing-svc1', source: 'Ingress/blue-green-demo/main-ingress', target: 'Service/blue-green-demo/nginx-svc', relationshipType: 'routes', label: 'routes to', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.rules' } },
    { id: 'e-ing-svc2', source: 'Ingress/blue-green-demo/main-ingress', target: 'Service/blue-green-demo/api-svc', relationshipType: 'routes', label: 'routes to', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.rules' } },
    { id: 'e-dep-cm', source: 'Deployment/blue-green-demo/nginx', target: 'ConfigMap/blue-green-demo/nginx-config', relationshipType: 'references', label: 'uses config', metadata: { derivation: 'envReference', confidence: 1, sourceField: 'spec.template.spec.volumes' } },
    { id: 'e-dep-sec', source: 'Deployment/blue-green-demo/api', target: 'Secret/blue-green-demo/api-secrets', relationshipType: 'references', label: 'uses secret', metadata: { derivation: 'envReference', confidence: 1, sourceField: 'spec.template.spec.containers[].envFrom' } },
    { id: 'e-pod-node1', source: 'Pod/blue-green-demo/nginx-1', target: 'Node/desktop-worker', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e-pod-node2', source: 'Pod/blue-green-demo/nginx-2', target: 'Node/desktop-worker', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e-pod-node3', source: 'Pod/blue-green-demo/nginx-3', target: 'Node/desktop-worker', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e-pod-node4', source: 'Pod/blue-green-demo/api-1', target: 'Node/desktop-worker', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e-pvc-pv', source: 'PersistentVolumeClaim/blue-green-demo/data-pvc', target: 'PersistentVolume/pv-test-001', relationshipType: 'stores', label: 'binds to', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.volumeName' } },
    { id: 'e-sc-pv1', source: 'StorageClass/hostpath', target: 'PersistentVolume/pv-test-001', relationshipType: 'backed_by', label: 'provisions', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.storageClassName' } },
    { id: 'e-pod-pvc', source: 'Pod/blue-green-demo/nginx-1', target: 'PersistentVolumeClaim/blue-green-demo/data-pvc', relationshipType: 'mounts', label: 'mounts', metadata: { derivation: 'volumeMount', confidence: 1, sourceField: 'spec.volumes' } },
  ],
  metadata: {
    clusterId: 'docker-desktop',
    generatedAt: new Date().toISOString(),
    layoutSeed: 'deterministic-seed-123',
    isComplete: true,
    warnings: [],
  },
};

export default function Topology() {
  const { activeCluster } = useClusterStore();
  const clusterId = useActiveClusterId();
  const navigate = useNavigate();
  const canvasRef = useRef<TopologyCanvasRef>(null);

  const [selectedNamespace, setSelectedNamespace] = useState('all');
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string>('all');

  const handleNamespaceChange = useCallback((ns: string) => {
    setSelectedNamespace(ns);
    setSelectedNodeFilter('all');
  }, []);

  const handleNodeChange = useCallback((nodeId: string) => {
    setSelectedNodeFilter(nodeId);
    setSelectedNamespace('all');
  }, []);

  const { graph: clusterGraph, isLoading: topologyLoading, error: topologyError, refetch: refetchTopology } = useClusterTopology({
    clusterId,
    namespace: selectedNamespace,
    enabled: !!clusterId,
  });

  // Calculate statistics (Number of pods, health status)
  const stats = useMemo(() => {
    const nodes = clusterGraph?.nodes || mockGraph.nodes;
    const pods = nodes.filter(n => n.kind === 'Pod');
    return {
      total: pods.length,
      healthy: pods.filter(p => !p.computed?.health || p.computed.health === 'healthy').length,
      warning: pods.filter(p => p.computed?.health === 'warning').length,
      critical: pods.filter(p => p.computed?.health === 'critical').length,
    };
  }, [clusterGraph]);

  // Task 9.1–9.3: Optional performance test graph (100 / 1K / 5K / 10K nodes)
  const [perfTestNodes, setPerfTestNodes] = useState<number | null>(null);
  const perfTestGraph = useMemo(
    () => (perfTestNodes != null ? generateTestGraph(perfTestNodes) : null),
    [perfTestNodes]
  );

  const displayGraph = perfTestGraph ?? clusterGraph ?? mockGraph;
  const isLiveData = !!clusterGraph;
  const [searchQuery, setSearchQuery] = useState('');
  const [abstractionLevel, setAbstractionLevel] = useState<AbstractionLevel>('L2');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [topologyMode, setTopologyMode] = useState<'structural' | 'traffic'>('structural');
  const [heatMapMode, setHeatMapMode] = useState<HeatMapMode>('none');

  const [selectedResources, setSelectedResources] = useState<Set<KubernetesKind>>(
    new Set(RESOURCE_TYPES.map(r => r.kind))
  );
  const [selectedRelationships, setSelectedRelationships] = useState<Set<RelationshipType>>(
    new Set(ALL_RELATIONSHIPS)
  );
  const [selectedHealth, setSelectedHealth] = useState<Set<HealthStatus | 'pending'>>(
    new Set(['healthy', 'warning', 'critical', 'unknown'])
  );
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [activeTab, setActiveTab] = useState<'cytoscape' | 'd3-force'>('cytoscape');
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [blastRadius, setBlastRadius] = useState<BlastRadiusResult | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType | null>(null);
  const [hoveredNode, setHoveredNode] = useState<{ node: TopologyNode; position: { x: number; y: number } } | null>(null);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [snapToGrid, setSnapToGrid] = useState(false);
  // E-PLAT-001: AI analysis state
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiPanelTab, setAIPanelTab] = useState<'blast' | 'critical-path'>('blast');

  // E-PLAT-001: AI hooks
  const { result: aiAnalysis, loading: aiAnalyzing, analyze: analyzeBlastRadius, clear: clearAIAnalysis } = useBlastRadiusAnalysis();
  const { result: criticalPath, loading: critPathLoading, fetchCriticalPath, clear: clearCriticalPath } = useCriticalPath();
  const { results: nodeExplains, loadingId: nodeExplainLoadingId, explain: explainNode } = useNodeExplain();

  // Helpers to convert topology graph nodes/edges to AI API format
  const toAINodes = useCallback((nodes: TopologyNode[]): AINodeSummary[] =>
    nodes.map(n => ({
      id: n.id,
      kind: n.kind,
      name: n.name,
      namespace: n.namespace,
      health: n.computed?.health,
      replicas: n.computed?.replicas?.ready,
    })), []);


  const toAIEdges = useCallback((edges: Array<{ source: string; target: string; relationshipType: string }>): AIEdgeSummary[] =>
    edges.map(e => ({
      source: e.source,
      target: e.target,
      relationship_type: e.relationshipType,
    })), []);

  const availableNamespaces = useMemo(() => {
    const ns = new Set<string>();
    displayGraph.nodes.forEach(n => { if (n.namespace) ns.add(n.namespace); });
    return Array.from(ns);
  }, [displayGraph.nodes]);

  const availableNodes = useMemo(() => {
    return displayGraph.nodes.filter(n => n.kind === 'Node').map(n => ({ id: n.id, name: n.name }));
  }, [displayGraph.nodes]);

  // When a node is selected, show only that node + pods on it + resources connected to those pods
  const nodeFilteredGraph = useMemo(() => {
    if (!selectedNodeFilter || selectedNodeFilter === 'all') return displayGraph;

    // Strict Filtering: Only show the targeted node and its immediate workloads/pods
    const inScope = new Set<string>([selectedNodeFilter]);
    const edges = displayGraph.edges;
    const allNodes = displayGraph.nodes;

    // 1. Find workloads/pods scheduled on this node
    const scheduledOnThisNode = new Set<string>();
    for (const e of edges) {
      if (e.target === selectedNodeFilter && (e.relationshipType === 'scheduled_on' || e.relationshipType === 'runs' || e.relationshipType === 'schedules')) {
        scheduledOnThisNode.add(e.source);
        inScope.add(e.source);
      }
    }

    // 2. Find direct parents/owners of those scheduled items (Deployments, ReplicaSets, Services)
    // but NEVER add another Node.
    for (const e of edges) {
      if (scheduledOnThisNode.has(e.source) || scheduledOnThisNode.has(e.target)) {
        const otherId = scheduledOnThisNode.has(e.source) ? e.target : e.source;
        const otherNode = allNodes.find(n => n.id === otherId);

        // Only add if it's NOT a node and NOT the Cluster root
        if (otherNode && otherNode.kind !== 'Node' && otherNode.id !== 'cluster-root') {
          inScope.add(otherId);
        }
      }
    }

    const filteredNodes = allNodes.filter(n => inScope.has(n.id));
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { ...displayGraph, nodes: filteredNodes, edges: filteredEdges };
  }, [displayGraph, selectedNodeFilter]);

  // Task 8.3: filteredGraph — apply node filter first, then hide by resource type
  const filteredGraph = useMemo(() => {
    const filteredNodes = nodeFilteredGraph.nodes.filter((n) => selectedResources.has(n.kind));
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = nodeFilteredGraph.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );
    return {
      ...nodeFilteredGraph,
      nodes: filteredNodes,
      edges: filteredEdges,
    };
  }, [nodeFilteredGraph, selectedResources]);

  const d3Topology = useMemo(
    () => convertToD3Topology(filteredGraph),
    [filteredGraph]
  );

  const healthOverlayData = useHealthOverlay(filteredGraph);
  const costOverlayData = useCostOverlay(filteredGraph);
  const performanceOverlayData = usePerformanceOverlay(filteredGraph);
  const securityOverlayData = useSecurityOverlay(filteredGraph);
  const dependencyOverlayData = useDependencyOverlay(filteredGraph);
  const trafficOverlayData = useTrafficOverlay(filteredGraph);
  const searchMatchIds = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return filteredGraph.nodes
      .filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        (n.namespace || '').toLowerCase().includes(q)
      )
      .map(n => n.id);
  }, [filteredGraph.nodes, searchQuery]);
  const centeredNodeIdForCanvas = searchMatchIds.length > 0
    ? searchMatchIds[Math.min(searchMatchIndex, searchMatchIds.length - 1)]
    : selectedNode?.id;

  const overlayDataForCanvas = activeOverlay === 'health' ? healthOverlayData
    : activeOverlay === 'cost' ? costOverlayData
      : activeOverlay === 'performance' ? performanceOverlayData
        : activeOverlay === 'security' ? securityOverlayData
          : activeOverlay === 'dependency' ? dependencyOverlayData
            : activeOverlay === 'traffic' ? trafficOverlayData
              : null;

  const handleResourceToggle = useCallback((kind: KubernetesKind) => {
    setSelectedResources(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  /** Builds detail path for topology node (matches App.tsx routes: /pods/ns/name or /nodes/name). */
  const getDetailPathForNode = useCallback((node: { id: string; kind?: string; namespace?: string; name?: string }) => {
    const routeMap: Record<string, string> = {
      Pod: 'pods', Deployment: 'deployments', ReplicaSet: 'replicasets',
      StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Service: 'services',
      ConfigMap: 'configmaps', Secret: 'secrets', Ingress: 'ingresses',
      Node: 'nodes', Namespace: 'namespaces', PersistentVolume: 'persistentvolumes',
      PersistentVolumeClaim: 'persistentvolumeclaims', StorageClass: 'storageclasses',
      Job: 'jobs', CronJob: 'cronjobs', Endpoints: 'endpoints', EndpointSlice: 'endpointslices',
      NetworkPolicy: 'networkpolicies', IngressClass: 'ingressclasses', VolumeAttachment: 'volumeattachments',
    };
    const parts = node.id.split('/');
    const kind = node.kind ?? parts[0];
    const route = routeMap[kind] ?? kind.toLowerCase() + 's';
    if (parts.length === 2) {
      return `/${route}/${parts[1]}`;
    }
    if (parts.length >= 3) {
      return `/${route}/${parts[1]}/${parts[2]}`;
    }
    if (node.namespace && node.name) return `/${route}/${node.namespace}/${node.name}`;
    if (node.name) return `/${route}/${node.name}`;
    return null;
  }, []);

  const handleNodeDoubleClick = useCallback((node: TopologyNode) => {
    const path = getDetailPathForNode(node);
    if (path) navigate(path);
  }, [navigate, getDetailPathForNode]);

  const handleContextMenu = useCallback((event: { nodeId: string; position: { x: number; y: number } }) => {
    setContextMenu({ nodeId: event.nodeId, x: event.position.x, y: event.position.y });
  }, []);

  useEffect(() => { setSearchMatchIndex(0); }, [searchQuery]);

  const handleNodeHover = useCallback((nodeId: string | null, clientPosition: { x: number; y: number } | null) => {
    if (!nodeId || !clientPosition) {
      setHoveredNode(null);
      return;
    }
    const node = filteredGraph.nodes.find(n => n.id === nodeId);
    if (node) setHoveredNode({ node, position: clientPosition });
    else setHoveredNode(null);
  }, [filteredGraph.nodes]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenuAction = useCallback((actionId: string, nodeId: string) => {
    const node = filteredGraph.nodes.find(n => n.id === nodeId);
    if (actionId === 'copy-name' && node) {
      navigator.clipboard.writeText(node.name);
      toast.success('Copied to clipboard');
    } else if (actionId === 'blast-radius') {
      const result = computeBlastRadius(filteredGraph, nodeId);
      setBlastRadius(result);
      toast.success(`Blast radius: ${result.affectedNodes.size} resources affected`);
      // E-PLAT-001: Also fetch AI analysis
      clearAIAnalysis();
      setShowAIPanel(true);
      setAIPanelTab('blast');
      analyzeBlastRadius({
        target_node_id: nodeId,
        operation: 'delete',
        nodes: toAINodes(filteredGraph.nodes),
        edges: toAIEdges(filteredGraph.edges),
        blast_radius_node_ids: Array.from(result.affectedNodes),
        total_impact: result.totalImpact,
      });
    } else if (actionId === 'view-logs' && node) {
      const routeMap: Record<string, string> = {
        Pod: 'pods', Deployment: 'deployments', ReplicaSet: 'replicasets',
        StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Job: 'jobs', CronJob: 'cronjobs',
      };
      const route = routeMap[node.kind];
      if (route) {
        const path = node.namespace ? `/${route}/${node.namespace}/${node.name}` : `/${route}/${node.name}`;
        navigate(`${path}?tab=logs`);
      } else {
        toast.info('Logs are available for Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet.');
      }
    } else if (actionId === 'view-yaml' || actionId === 'view-metrics' || actionId === 'dependencies') {
      if (node) setSelectedNode(node);
    } else if (actionId === 'user-journey') {
      toast.info('User journey tracing coming soon');
    } else if (actionId === 'edit' && node) {
      handleNodeDoubleClick(node);
    } else if (actionId === 'delete') {
      toast.error('Delete is not implemented in topology view. Use the resource detail page.');
    }
    setContextMenu(null);
  }, [filteredGraph, handleNodeDoubleClick, navigate]);

  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const handleExport = useCallback((format: string) => {
    if (format !== 'json' && format !== 'csv' && format !== 'pdf' && format !== 'drawio' && !canvasRef.current) return;
    if (format === 'drawio') {
      (async () => {
        if (!clusterId || !isBackendConfigured()) {
          toast.error('Connect backend and select a cluster to open topology in draw.io.');
          return;
        }
        try {
          const { url } = await getTopologyExportDrawio(effectiveBaseUrl, clusterId, { format: 'mermaid' });
          window.open(url, '_blank', 'noopener,noreferrer');
          toast.success('Opened in draw.io');
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Failed to export to draw.io');
        }
      })();
      return;
    }
    switch (format) {
      case 'svg': {
        const data = canvasRef.current.exportAsSVG();
        if (data) {
          const blob = new Blob([data], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `topology-${new Date().toISOString().slice(0, 10)}.svg`;
          link.href = url; link.click(); URL.revokeObjectURL(url);
        }
        break;
      }
      case 'png': {
        const data = canvasRef.current.exportAsPNG();
        if (data) {
          const link = document.createElement('a');
          link.download = `topology-${new Date().toISOString().slice(0, 10)}.png`;
          link.href = data; link.click();
        }
        break;
      }
      case 'pdf': {
        if (activeTab !== 'cytoscape') {
          toast.info('PDF export is available for Cytoscape layout. Switch to that tab first.');
          return;
        }
        canvasRef.current?.exportAsPDF?.();
        break;
      }
      case 'json': downloadJSON(filteredGraph, `topology-${new Date().toISOString().slice(0, 10)}.json`); break;
      case 'csv': downloadCSVSummary(filteredGraph); break;
    }
    if (format !== 'drawio') toast.success(`Exported as ${format.toUpperCase()}`);
  }, [activeTab, filteredGraph, clusterId, effectiveBaseUrl, isBackendConfigured]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    if (isLiveData) {
      await refetchTopology();
    } else {
      await new Promise(r => setTimeout(r, 1000));
    }
    setIsRefreshing(false);
    toast.success(isLiveData ? 'Topology refreshed' : 'Topology refreshed');
  }, [isLiveData, refetchTopology]);

  // Keyboard: space to toggle pause; Escape close menu/blast
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setBlastRadius(null);
      }
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setIsPaused(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const contextMenuActions = [
    { id: 'copy-name', label: 'Copy Resource Name', icon: Copy },
    { id: 'view-logs', label: 'View Logs', icon: ScrollText },
    { id: 'view-yaml', label: 'View Full YAML', icon: FileText },
    { id: 'view-metrics', label: 'Show Metrics', icon: Activity },
    { id: 'dependencies', label: 'Inspect Dependencies', icon: Network },
    { id: 'blast-radius', label: 'Compute Blast Radius', icon: Bomb },
    { id: 'user-journey', label: 'Trace User Journey', icon: Route },
    { id: 'edit', label: 'Edit Resource', icon: Edit },
    { id: 'delete', label: 'Delete', icon: Trash2, danger: true },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-[calc(100vh-4rem)] gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Network className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cluster Topology</h1>
            <p className="text-sm text-muted-foreground">
              {activeCluster?.name || 'docker-desktop'} • {filteredGraph.nodes.length} resources • ELK Layered
              {topologyLoading && ' • Loading…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Structural / Traffic toggle */}
          <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={topologyMode === 'structural' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setTopologyMode('structural')}
                  className="h-8 px-3 text-xs font-medium gap-1.5"
                >
                  <Layers className="h-3.5 w-3.5" />
                  Structural
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cluster Intelligence Map – resource connections</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={topologyMode === 'traffic' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setTopologyMode('traffic')}
                  className="h-8 px-3 text-xs font-medium gap-1.5"
                >
                  <Activity className="h-3.5 w-3.5" />
                  Traffic Flow
                </Button>
              </TooltipTrigger>
              <TooltipContent>Interactive Traffic Topology – request flow simulation</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Abstraction Level Selector */}
          <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg">
            {(['L0', 'L1', 'L2', 'L3'] as AbstractionLevel[]).map((level) => (
              <Tooltip key={level}>
                <TooltipTrigger asChild>
                  <Button
                    variant={abstractionLevel === level ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setAbstractionLevel(level)}
                    className="h-8 px-3 text-xs font-medium"
                  >
                    {level}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{ABSTRACTION_LEVELS[level].label}</p>
                  <p className="text-xs text-muted-foreground">{ABSTRACTION_LEVELS[level].description}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
        {/* Namespace selector */}
        <Select value={selectedNamespace} onValueChange={handleNamespaceChange}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="All Namespaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Namespaces</SelectItem>
            {availableNamespaces.map(ns => (
              <SelectItem key={ns} value={ns}>{ns}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Node selector — show resources on selected node only */}
        <Select value={selectedNodeFilter} onValueChange={handleNodeChange}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="All Nodes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Nodes</SelectItem>
            {availableNodes.map(n => (
              <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Search + jump between matches */}
        <div className="relative flex-1 max-w-sm flex items-center gap-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8 h-9"
          />
          {searchMatchIds.length > 0 && (
            <div className="absolute right-1 flex items-center gap-0.5 bg-muted/80 rounded px-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  const next = searchMatchIndex <= 0 ? searchMatchIds.length - 1 : searchMatchIndex - 1;
                  setSearchMatchIndex(next);
                  const node = filteredGraph.nodes.find(n => n.id === searchMatchIds[next]);
                  if (node) setSelectedNode(node);
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] font-medium text-muted-foreground min-w-[2.5rem] text-center">
                {searchMatchIndex + 1}/{searchMatchIds.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  const next = searchMatchIndex >= searchMatchIds.length - 1 ? 0 : searchMatchIndex + 1;
                  setSearchMatchIndex(next);
                  const node = filteredGraph.nodes.find(n => n.id === searchMatchIds[next]);
                  if (node) setSelectedNode(node);
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Heatmap */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={heatMapMode !== 'none' ? 'default' : 'outline'} size="sm" className="gap-1.5 h-9">
              <Thermometer className="h-4 w-4" />
              {heatMapMode === 'none' ? 'Heatmap' : heatMapMode === 'cpu' ? 'CPU Heat' : 'Restart Heat'}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setHeatMapMode('none')}>
              Off
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHeatMapMode('cpu')}>
              <Thermometer className="h-4 w-4 mr-2" /> CPU Usage
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHeatMapMode('restarts')}>
              <RefreshCcw className="h-4 w-4 mr-2" /> Restart Count
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Insight overlays */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={activeOverlay ? 'default' : 'outline'} size="sm" className="gap-1.5 h-9">
              <Layers className="h-4 w-4" />
              {activeOverlay ? OVERLAY_LABELS[activeOverlay] : 'Overlays'}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setActiveOverlay(null)}>
              Off
            </DropdownMenuItem>
            {(['health', 'cost', 'security', 'performance', 'dependency', 'traffic'] as OverlayType[]).map((type) => (
              <DropdownMenuItem key={type} onClick={() => setActiveOverlay(type)}>
                {OVERLAY_LABELS[type]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* E-PLAT-001: AI Analysis toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showAIPanel ? 'default' : 'outline'}
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                setShowAIPanel(v => !v);
                if (!showAIPanel && criticalPath === null && !critPathLoading) {
                  fetchCriticalPath(toAINodes(filteredGraph.nodes), toAIEdges(filteredGraph.edges));
                }
              }}
            >
              {(aiAnalyzing || critPathLoading) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Brain className="h-4 w-4" />
              )}
              AI Analysis
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle AI-powered blast radius analysis and critical path visualization</TooltipContent>
        </Tooltip>

        {/* Snap to grid (Cytoscape only) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={snapToGrid ? 'default' : 'outline'}
              size="icon"
              className="h-9 w-9"
              onClick={() => setSnapToGrid((v) => !v)}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Snap nodes to grid when dragging (Cytoscape)</p>
          </TooltipContent>
        </Tooltip>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <Download className="h-4 w-4" /> Export <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport('svg')}>
              <FileCode className="h-4 w-4 mr-2" /> SVG (Vector)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('png')}>
              <FileImage className="h-4 w-4 mr-2" /> PNG (High DPI)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('pdf')}>
              <FileText className="h-4 w-4 mr-2" /> PDF (Print)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('drawio')}>
              <ExternalLink className="h-4 w-4 mr-2" /> Open in draw.io
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleExport('json')}>
              <FileJson className="h-4 w-4 mr-2" /> JSON (Full Graph)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('csv')}>
              <Table className="h-4 w-4 mr-2" /> CSV (Summary)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Refresh */}
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleRefresh} disabled={isRefreshing}>
          <RotateCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Resource Type Filters */}
      <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
        {RESOURCE_TYPES.map(rt => {
          const active = selectedResources.has(rt.kind);
          return (
            <button
              key={rt.kind}
              onClick={() => handleResourceToggle(rt.kind)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${active
                ? 'border-transparent text-white shadow-sm'
                : 'border-border text-muted-foreground bg-background hover:bg-muted'
                }`}
              style={active ? { backgroundColor: rt.color } : undefined}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rt.color }} />
              {rt.label}
            </button>
          );
        })}
      </div>

      {/* Data source banner + Perf test (Task 9.1–9.3) */}
      {(!isLiveData || perfTestNodes != null) && !topologyLoading && (
        <Alert className="flex-shrink-0 border-amber-500/30 bg-amber-500/5">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              {perfTestNodes != null
                ? `Performance test graph: ${perfTestNodes.toLocaleString()} nodes (check console for load/overlay/export timing)`
                : 'Using demo data. Connect backend for live cluster topology.'}
            </span>
            <Select
              value={perfTestNodes != null ? String(perfTestNodes) : 'live'}
              onValueChange={(v) => setPerfTestNodes(v === 'live' ? null : parseInt(v, 10))}
            >
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue placeholder="Graph" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live / Demo</SelectItem>
                <SelectItem value="100">Perf: 100 nodes</SelectItem>
                <SelectItem value="1000">Perf: 1,000 nodes</SelectItem>
                <SelectItem value="5000">Perf: 5,000 nodes</SelectItem>
                <SelectItem value="10000">Perf: 10,000 nodes</SelectItem>
              </SelectContent>
            </Select>
          </AlertDescription>
        </Alert>
      )}
      {topologyError && (
        <Alert variant="destructive" className="flex-shrink-0">
          <AlertDescription>
            Could not load topology: {topologyError.message}. Showing demo data.
          </AlertDescription>
        </Alert>
      )}

      {/* Traffic mode info banner */}
      {topologyMode === 'traffic' && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
          <Activity className="h-4 w-4 text-emerald-600" />
          <span className="text-sm text-emerald-700 font-medium">
            Traffic Flow Mode — Animated edges show request flow: Ingress → Service → Pod
          </span>
        </div>
      )}

      {/* Canvas with Tabs */}
      <div className="flex-1 relative min-h-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'cytoscape' | 'd3-force')} className="h-full flex flex-col">
          <TabsList className="mb-2 flex-shrink-0" data-testid="topology-tabs">
            <TabsTrigger value="cytoscape" data-testid="topology-tab-cytoscape">Cytoscape Layout</TabsTrigger>
            <TabsTrigger value="d3-force" data-testid="topology-tab-d3">D3.js</TabsTrigger>
          </TabsList>

          <TabsContent value="cytoscape" className="flex-1 relative min-h-0 mt-0">
            {activeTab === 'cytoscape' && (
              <TopologyCanvas
                ref={canvasRef}
                graph={filteredGraph}
                selectedResources={selectedResources}
                selectedRelationships={selectedRelationships}
                selectedHealth={selectedHealth}
                searchQuery={searchQuery}
                abstractionLevel={abstractionLevel}
                namespace={selectedNamespace}
                centeredNodeId={centeredNodeIdForCanvas}
                snapToGrid={snapToGrid}
                isPaused={isPaused}
                heatMapMode={heatMapMode}
                trafficFlowEnabled={topologyMode === 'traffic'}
                onNodeSelect={setSelectedNode}
                onNodeDoubleClick={handleNodeDoubleClick}
                onContextMenu={handleContextMenu}
                onNodeHover={handleNodeHover}
                blastRadius={blastRadius}
                overlayData={overlayDataForCanvas}
                className="h-full"
              />
            )}
            {/* Same Legend, Node count, and Zoom controls below */}
            {/* ... */}
          </TabsContent>

          <TabsContent value="d3-force" className="flex-1 relative min-h-0 mt-0">
            {activeTab === 'd3-force' && (
              <D3TopologyCanvas
                nodes={d3Topology.nodes}
                edges={d3Topology.edges}
                onNodeClick={(node) => {
                  const path = getDetailPathForNode({ id: node.id, name: node.name, namespace: node.namespace });
                  if (path) navigate(path);
                }}
                className="h-full"
              />
            )}
          </TabsContent>
        </Tabs>

        {/* Node hover tooltip */}
        {activeTab === 'cytoscape' && hoveredNode && createPortal(
          <div
            className="fixed z-[9998] max-w-[280px] rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-xl p-3 text-sm pointer-events-none"
            style={{
              left: Math.min(hoveredNode.position.x + 12, window.innerWidth - 300),
              top: hoveredNode.position.y + 12,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: getKindColor(hoveredNode.node.kind) }}
              >
                {hoveredNode.node.kind}
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{hoveredNode.node.name}</p>
                <p className="text-xs text-muted-foreground">{hoveredNode.node.kind}{hoveredNode.node.namespace ? ` • ${hoveredNode.node.namespace}` : ''}</p>
              </div>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={hoveredNode.node.computed.health === 'healthy' ? 'default' : hoveredNode.node.computed.health === 'warning' ? 'secondary' : 'destructive'} className="text-[10px] h-5">
                  {hoveredNode.node.computed.health}
                </Badge>
              </div>
              {hoveredNode.node.computed.restartCount != null && (
                <div className="flex justify-between"><span className="text-muted-foreground">Restarts</span><span>{hoveredNode.node.computed.restartCount}</span></div>
              )}
              {hoveredNode.node.computed.cpuUsage != null && (
                <div className="flex justify-between"><span className="text-muted-foreground">CPU</span><span>{hoveredNode.node.computed.cpuUsage}%</span></div>
              )}
              {hoveredNode.node.computed.replicas && (
                <div className="flex justify-between"><span className="text-muted-foreground">Replicas</span><span>{hoveredNode.node.computed.replicas.ready}/{hoveredNode.node.computed.replicas.desired}</span></div>
              )}
            </div>
            <div className="mt-2 pt-2 border-t border-border flex gap-1 flex-wrap pointer-events-auto">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => {
                  const routeMap: Record<string, string> = { Pod: 'pods', Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Job: 'jobs', CronJob: 'cronjobs', ReplicaSet: 'replicasets' };
                  const route = routeMap[hoveredNode.node.kind];
                  if (route) navigate(`${hoveredNode.node.namespace ? `/${route}/${hoveredNode.node.namespace}/${hoveredNode.node.name}` : `/${route}/${hoveredNode.node.name}`}?tab=logs`);
                  setHoveredNode(null);
                }}
              >
                View Logs
              </Button>
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setSelectedNode(hoveredNode.node); setHoveredNode(null); }}>Inspect</Button>
            </div>
          </div>,
          document.body
        )}

        {/* Floating context menu */}
        {contextMenu && createPortal(
          <div
            className="fixed z-[9999] min-w-[200px] py-1 rounded-lg border border-border bg-background shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenuActions.map(({ id, label, icon: Icon, danger }) => (
              <button
                key={id}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${danger ? 'text-destructive' : ''}`}
                onClick={() => handleContextMenuAction(id, contextMenu.nodeId)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>,
          document.body
        )}

        {/* Blast radius panel */}
        {activeTab === 'cytoscape' && blastRadius && (
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="absolute top-4 left-4 w-72 z-10">
            <Card className="p-4 bg-background/95 backdrop-blur-sm shadow-lg border-orange-500/30">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Bomb className="h-4 w-4 text-orange-500" />
                  Blast Radius
                </h3>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setBlastRadius(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {blastRadius.affectedNodes.size} resources affected
                {filteredGraph.nodes.length > 0 && (
                  <> ({Math.round((blastRadius.affectedNodes.size / filteredGraph.nodes.length) * 100)}% of visible graph)</>
                )}
              </p>
              {blastRadius.suggestions && blastRadius.suggestions.length > 0 && (
                <ul className="mt-2 text-xs text-muted-foreground list-disc list-inside">
                  {blastRadius.suggestions.slice(0, 3).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </Card>
          </motion.div>
        )}

        {/* E-PLAT-001: AI Analysis Panel — Critical Path + Blast Radius AI */}
        {showAIPanel && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute top-4 right-4 w-80 z-20 flex flex-col gap-2"
          >
            <Card className="bg-background/95 backdrop-blur-sm shadow-xl border-purple-500/30">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-purple-500" />
                  <span className="font-semibold text-sm">AI Topology Analysis</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setAIPanelTab('blast')}
                    className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${aiPanelTab === 'blast' ? 'bg-purple-500/20 text-purple-600' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Impact
                  </button>
                  <button
                    onClick={() => {
                      setAIPanelTab('critical-path');
                      if (!criticalPath && !critPathLoading) {
                        fetchCriticalPath(toAINodes(filteredGraph.nodes), toAIEdges(filteredGraph.edges));
                      }
                    }}
                    className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${aiPanelTab === 'critical-path' ? 'bg-purple-500/20 text-purple-600' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Critical Path
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-1"
                    onClick={() => { setShowAIPanel(false); clearAIAnalysis(); clearCriticalPath(); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Impact tab */}
              {aiPanelTab === 'blast' && (
                <div className="p-3 space-y-3">
                  {!aiAnalysis && !aiAnalyzing && (
                    <div className="text-center py-4 space-y-2">
                      <Bomb className="h-8 w-8 text-muted-foreground mx-auto" />
                      <p className="text-xs text-muted-foreground">Right-click any resource and select<br /><strong>Compute Blast Radius</strong> for AI analysis</p>
                    </div>
                  )}
                  {aiAnalyzing && (
                    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                      Analyzing impact with AI…
                    </div>
                  )}
                  {aiAnalysis && (
                    <div className="space-y-3">
                      {/* Risk badge */}
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${aiAnalysis.risk_level === 'critical' ? 'bg-red-500/20 text-red-600' :
                          aiAnalysis.risk_level === 'high' ? 'bg-orange-500/20 text-orange-600' :
                            aiAnalysis.risk_level === 'medium' ? 'bg-yellow-500/20 text-yellow-700' :
                              'bg-green-500/20 text-green-600'
                          }`}>
                          {aiAnalysis.risk_level} risk
                        </span>
                        {aiAnalysis.can_proceed_safely ? (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Safe to proceed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <ShieldAlert className="h-3.5 w-3.5" /> Proceed with caution
                          </span>
                        )}
                      </div>

                      {/* AI summary */}
                      <div className="bg-muted/50 rounded-lg p-2.5">
                        <div className="flex items-start gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
                          <p className="text-xs leading-relaxed text-foreground">{aiAnalysis.natural_language_summary}</p>
                        </div>
                        {aiAnalysis.source === 'llm' && (
                          <span className="text-[10px] text-muted-foreground mt-1 block">AI-powered analysis</span>
                        )}
                      </div>

                      {/* Affected services */}
                      {aiAnalysis.affected_services.length > 0 && (
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Impacted Services</p>
                          <div className="flex flex-wrap gap-1">
                            {aiAnalysis.affected_services.map(svc => (
                              <span key={svc} className="px-1.5 py-0.5 bg-orange-500/10 text-orange-600 rounded text-xs border border-orange-500/20">{svc}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recommended actions */}
                      {aiAnalysis.recommended_actions.length > 0 && (
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Recommended Actions</p>
                          <ul className="space-y-1.5">
                            {aiAnalysis.recommended_actions.map((action, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-xs">
                                <ArrowRight className="h-3 w-3 text-purple-400 mt-0.5 shrink-0" />
                                <span>{action}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Safety message */}
                      <p className="text-[11px] text-muted-foreground border-t border-border pt-2">{aiAnalysis.safety_check_message}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Critical Path tab */}
              {aiPanelTab === 'critical-path' && (
                <div className="p-3 space-y-3">
                  {critPathLoading && (
                    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                      Computing critical path…
                    </div>
                  )}
                  {!criticalPath && !critPathLoading && (
                    <div className="text-center py-4 space-y-2">
                      <GitBranch className="h-8 w-8 text-muted-foreground mx-auto" />
                      <p className="text-xs text-muted-foreground">Computing critical user traffic path…</p>
                    </div>
                  )}
                  {criticalPath && (
                    <div className="space-y-3">
                      {/* Path visualization */}
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                          <GitBranch className="h-3 w-3 inline mr-1" /> User Traffic Path
                        </p>
                        <p className="text-xs bg-muted/50 rounded p-2 font-mono leading-relaxed break-words">
                          {criticalPath.path_description || 'No user-facing path detected'}
                        </p>
                      </div>

                      {/* SPOFs */}
                      {criticalPath.spofs.length > 0 && (
                        <div>
                          <p className="text-[11px] font-medium text-red-600 uppercase tracking-wide mb-1.5">
                            <AlertCircle className="h-3 w-3 inline mr-1" /> Single Points of Failure
                          </p>
                          <div className="flex flex-col gap-1">
                            {criticalPath.spofs.map(spof => (
                              <span key={spof} className="flex items-center gap-1.5 px-2 py-1 bg-red-500/10 text-red-600 rounded text-xs border border-red-500/20">
                                <ShieldAlert className="h-3 w-3 shrink-0" />
                                {spof}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {criticalPath.spofs.length === 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-green-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> No SPOFs detected on critical path
                        </div>
                      )}

                      {/* AI explanation */}
                      {criticalPath.llm_explanation && (
                        <div className="bg-muted/50 rounded-lg p-2.5">
                          <div className="flex items-start gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
                            <p className="text-xs leading-relaxed">{criticalPath.llm_explanation}</p>
                          </div>
                          {criticalPath.source === 'llm' && (
                            <span className="text-[10px] text-muted-foreground mt-1 block">AI-powered analysis</span>
                          )}
                        </div>
                      )}

                      {/* Refresh */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs h-8 gap-1.5"
                        onClick={() => {
                          clearCriticalPath();
                          fetchCriticalPath(toAINodes(filteredGraph.nodes), toAIEdges(filteredGraph.edges));
                        }}
                        disabled={critPathLoading}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Refresh Analysis
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </motion.div>
        )}

        {/* Selected Node Panel - show for Cytoscape and Enterprise tabs */}
        {activeTab === 'cytoscape' && selectedNode && (
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="absolute top-4 left-4 w-72">
            <Card className="p-4 bg-background/95 backdrop-blur-sm shadow-lg border-primary/30">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0 shadow-md leading-tight text-center"
                  style={{ backgroundColor: getKindColor(selectedNode.kind) }}
                >
                  {selectedNode.kind}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold truncate text-sm">{selectedNode.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedNode.kind}{selectedNode.namespace && ` • ${selectedNode.namespace}`}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={
                    selectedNode.computed?.health === 'healthy' ? 'default' :
                      selectedNode.computed?.health === 'warning' ? 'secondary' : 'destructive'
                  } className="text-[10px] h-5">
                    {selectedNode.computed?.health ?? '—'}
                  </Badge>
                </div>
                {selectedNode.computed?.restartCount !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Restarts:</span>
                    <span className="font-medium">{selectedNode.computed.restartCount}</span>
                  </div>
                )}
                {selectedNode.computed?.cpuUsage !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">CPU:</span>
                    <span className="font-medium">{selectedNode.computed.cpuUsage}%</span>
                  </div>
                )}
                {selectedNode.computed?.replicas && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Replicas:</span>
                    <span className="font-medium">{selectedNode.computed.replicas.ready}/{selectedNode.computed.replicas.desired}</span>
                  </div>
                )}
              </div>

              {/* E-PLAT-001: AI node explanation */}
              {(() => {
                const aiNode = nodeExplains.get(selectedNode.id);
                const isLoadingThis = nodeExplainLoadingId === selectedNode.id;
                return (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    {isLoadingThis && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Generating AI explanation…
                      </div>
                    )}
                    {aiNode && (
                      <div className="space-y-1.5">
                        {/* Role */}
                        <div className="flex items-start gap-1.5 bg-purple-500/5 border border-purple-500/20 rounded-md p-2">
                          <Sparkles className="h-3 w-3 text-purple-500 shrink-0 mt-0.5" />
                          <p className="text-[11px] leading-relaxed text-foreground">{aiNode.role}</p>
                        </div>
                        {/* Anomalies */}
                        {aiNode.anomalies.length > 0 && (
                          <div className="space-y-1">
                            {aiNode.anomalies.map((a, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700">
                                <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                                <span>{a}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {!aiNode && !isLoadingThis && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs h-7 gap-1.5 text-purple-600 hover:text-purple-700 hover:bg-purple-500/10"
                        onClick={() => {
                          explainNode(
                            {
                              id: selectedNode.id,
                              kind: selectedNode.kind,
                              name: selectedNode.name,
                              namespace: selectedNode.namespace,
                              health: selectedNode.computed?.health,
                              replicas: selectedNode.computed?.replicas?.ready,
                            },
                            toAINodes(filteredGraph.nodes),
                            toAIEdges(filteredGraph.edges),
                          );
                        }}
                      >
                        <Brain className="h-3 w-3" />
                        AI Explain this resource
                      </Button>
                    )}
                    <div className="flex items-center justify-end">
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => handleNodeDoubleClick(selectedNode)}>
                        View Details →
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </motion.div>
        )}
        {/* Final Premium Legend & Statistics Panel */}
        <Card className="absolute bottom-4 left-4 p-4 shadow-2xl border-none bg-white/90 backdrop-blur-md dark:bg-slate-900/90 z-20 w-80 overflow-hidden transition-all duration-300 hover:w-96">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Grid3X3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-bold text-sm tracking-tight text-slate-800 dark:text-slate-100">Live Ecosystem</h3>
            </div>
            <Badge variant="outline" className="text-[10px] font-bold px-1.5 py-0 border-blue-200 text-blue-600">
              {(clusterGraph?.nodes || mockGraph.nodes).length} Nodes
            </Badge>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {RESOURCE_TYPES.slice(0, 8).map((rt) => (
                <div key={rt.kind} className="flex items-center gap-2 group cursor-default">
                  <div
                    className="w-2 h-2 rounded-full shadow-sm group-hover:scale-125 transition-transform"
                    style={{ backgroundColor: rt.color }}
                  />
                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate">{rt.label}</span>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex gap-2">
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] font-bold text-emerald-600">{stats.healthy}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[10px] font-bold text-amber-600">{stats.warning}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  <span className="text-[10px] font-bold text-rose-600">{stats.critical}</span>
                </div>
              </div>
              <span className="text-[9px] text-slate-400 font-medium italic">Auto-refresh active</span>
            </div>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}
