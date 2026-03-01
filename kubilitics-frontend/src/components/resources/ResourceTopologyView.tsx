/**
 * ResourceTopologyView - Reusable component for displaying resource-scoped topology
 * Integrates topology-engine with backend API
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Network, Loader2, AlertCircle, RefreshCw, ZoomIn, ZoomOut, Maximize,
  FileJson, FileText, FileImage, Layers, ExternalLink, ChevronDown, Map as MapIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  TopologyCanvas,
  NODE_COLORS,
  downloadJSON,
  downloadCSV,
  useHealthOverlay,
  type TopologyCanvasRef,
  type TopologyGraph,
  type OverlayType,
  OVERLAY_LABELS,
  TopologyViewer,
} from '@/topology-engine';
import type {
  TopologyNode,
  KubernetesKind,
  RelationshipType,
  HealthStatus,
  AbstractionLevel,
} from '@/topology-engine';
import { useResourceTopology } from '@/hooks/useResourceTopology';
import { useCapabilities } from '@/hooks/useCapabilities';
import { kindToRoutePath, buildTopologyNodeId, isResourceTopologySupported, RESOURCE_TOPOLOGY_SUPPORTED_KINDS } from '@/utils/resourceKindMapper';
import { TopologyNodePanel } from '@/topology-engine/components/TopologyNodePanel';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { getTopologyExportDrawio } from '@/services/backendApiClient';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ResourceTopologyViewProps {
  kind: string;
  namespace?: string | null;
  name?: string | null;
  sourceResourceType?: string;
  sourceResourceName?: string;
}

function getResourceRoute(node: TopologyNode): string | null {
  const route = kindToRoutePath(node.kind);
  if (!route) return null;
  return node.namespace
    ? `/${route}/${node.namespace}/${node.name}`
    : `/${route}/${node.name}`;
}

/**
 * Resource-scoped topology view component.
 * All hooks are called unconditionally at the top; conditional returns come after.
 */
export function ResourceTopologyView({
  kind,
  namespace,
  name,
}: ResourceTopologyViewProps) {
  const navigate = useNavigate();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useActiveClusterId();
  const canvasRef = useRef<TopologyCanvasRef>(null);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType | null>(null);
  // Node info panel — shown on single click; double-click navigates directly
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);

  const backendConfigured = isBackendConfigured();
  const hasClusterId = !!clusterId;
  const hasKind = !!kind;
  const hasName = !!name;
  const topologySupported = isResourceTopologySupported(kind ?? '');
  const { resourceTopologyKinds } = useCapabilities();
  const supportedKindsLabel = (resourceTopologyKinds?.length ? resourceTopologyKinds : RESOURCE_TOPOLOGY_SUPPORTED_KINDS).join(', ');

  const { graph, isLoading, error, refetch } = useResourceTopology({
    kind,
    namespace,
    name,
    enabled: backendConfigured && hasClusterId && hasKind && hasName && topologySupported,
  });

  const currentNodeId = useMemo(() => {
    if (!kind || !name) return undefined;
    return buildTopologyNodeId(kind, namespace ?? '', name);
  }, [kind, namespace, name]);

  const healthOverlayData = useHealthOverlay(graph ?? { schemaVersion: 'v1', nodes: [], edges: [], metadata: { clusterId: '', generatedAt: '', layoutSeed: '', isComplete: false, warnings: [] } });
  const overlayDataForCanvas = activeOverlay === 'health' ? healthOverlayData : null;

  // All filter sets declared as hooks (unconditionally)
  const [selectedResources] = useState<Set<KubernetesKind>>(
    new Set<KubernetesKind>([
      'Namespace', 'Ingress', 'Service', 'Deployment', 'StatefulSet', 'DaemonSet',
      'ReplicaSet', 'Pod', 'ConfigMap', 'Secret', 'PersistentVolumeClaim',
      'PersistentVolume', 'StorageClass', 'Node', 'Job', 'CronJob',
      'Endpoints', 'EndpointSlice',
    ])
  );

  const [selectedRelationships] = useState<Set<RelationshipType>>(
    new Set<RelationshipType>([
      'exposes', 'selects', 'owns', 'runs', 'mounts', 'scheduled_on',
      'references', 'backed_by', 'routes', 'configures', 'contains',
      'stores', 'permits', 'limits', 'manages',
    ])
  );

  const [selectedHealth] = useState<Set<HealthStatus | 'pending'>>(
    new Set(['healthy', 'warning', 'critical', 'unknown'])
  );

  const [abstractionLevel] = useState<AbstractionLevel>('L3'); // Full infrastructure
  const [searchQuery] = useState('');
  const [isPaused] = useState(false);

  const handleNodeDoubleClick = useCallback(
    (node: TopologyNode) => {
      const route = getResourceRoute(node);
      if (route) navigate(route);
    },
    [navigate]
  );

  // Single click → show info panel (double-click still navigates directly)
  const handleNodeSelect = useCallback((node: TopologyNode | null) => {
    setSelectedNode(node);
  }, []);

  const handleNavigateToNode = useCallback((node: TopologyNode) => {
    const route = getResourceRoute(node);
    if (route) navigate(route);
  }, [navigate]);

  // Export handlers
  const handleExportJSON = useCallback(() => {
    if (!graph) return;
    downloadJSON(graph, `topology-${kind}-${name || 'resource'}.json`);
    toast.success('Exported as JSON');
  }, [graph, kind, name]);

  const handleExportCSV = useCallback(() => {
    if (!graph) return;
    downloadCSV(graph, `topology-${kind}-${name || 'resource'}.csv`);
    toast.success('Exported as CSV');
  }, [graph, kind, name]);

  const handleExportPNG = useCallback(() => {
    if (!canvasRef.current) return;
    const pngData = canvasRef.current.exportAsPNG();
    if (pngData) {
      const link = document.createElement('a');
      link.download = `topology-${kind}-${name || 'resource'}.png`;
      link.href = pngData;
      // Append to DOM so the click works in WebKit / Tauri WebView
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Exported as PNG');
    }
  }, [kind, name]);

  const handleExportPDF = useCallback(() => {
    if (!canvasRef.current?.exportAsPDF) {
      toast.info('PDF export is available in Cytoscape layout. Switch to that tab first.');
      return;
    }
    canvasRef.current.exportAsPDF(`topology-${kind}-${name || 'resource'}.pdf`);
    toast.success('Exported as PDF');
  }, [kind, name]);

  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const handleExportDrawio = useCallback(async () => {
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
  }, [clusterId, effectiveBaseUrl, isBackendConfigured]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    canvasRef.current?.zoomIn();
    setZoomLevel(prev => Math.min(Math.round(prev * 1.3), 500));
  }, []);

  const handleZoomOut = useCallback(() => {
    canvasRef.current?.zoomOut();
    setZoomLevel(prev => Math.max(Math.round(prev / 1.3), 10));
  }, []);

  const handleFullscreen = useCallback(() => {
    const container = document.querySelector('[data-topology-container]') as HTMLElement;
    if (container) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      }
    }
  }, []);

  const handleRefreshLayout = useCallback(() => {
    canvasRef.current?.relayout();
    toast.success('Layout refreshed');
  }, []);

  // D3 single click → find full TopologyNode and show info panel
  const handleD3NodeClick = useCallback((node: { id: string; type: string; name: string; namespace?: string }) => {
    if (!graph) return;
    const found = graph.nodes.find((n) => n.id === node.id);
    if (found) {
      setSelectedNode(found);
    } else {
      // Fallback: build a minimal node for lookup if id doesn't match directly
      const parts = node.id.split('/');
      if (parts.length >= 2) {
        const k = parts[0] as KubernetesKind;
        const route = kindToRoutePath(k);
        if (route) {
          navigate(parts[2]
            ? `/${route}/${parts[1]}/${parts[2]}`
            : `/${route}/${parts[1]}`);
        }
      }
    }
  }, [graph, navigate]);


  // --- All hooks called above this line. Conditional returns below. ---

  if (!backendConfigured) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-2">Connect to Kubilitics backend to view topology</p>
        <p className="text-sm text-muted-foreground">Go to Settings to configure the backend connection</p>
      </div>
    );
  }

  if (!hasClusterId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Select a cluster to view topology</p>
      </div>
    );
  }

  if (!topologySupported) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground font-medium mb-2">Topology is not available for this resource type</p>
        <p className="text-sm text-muted-foreground mb-2">
          Resource-scoped topology is supported for: {supportedKindsLabel}.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate('/topology')}>
          <MapIcon className="h-3.5 w-3.5 mr-1.5" />
          View full cluster topology
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">Loading topology...</p>
      </div>
    );
  }

  if (error) {
    const msg = error.message || String(error);
    const isNotFound = msg.toLowerCase().includes('not found') || msg.includes('404');
    const isTimeout = msg.toLowerCase().includes('timeout');
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">
          {isNotFound ? 'Resource not found' : isTimeout ? 'Topology build timed out' : 'Failed to load topology'}
        </p>
        <p className="text-sm text-muted-foreground mb-4">{msg}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Retry
        </Button>
      </div>
    );
  }

  if (!graph || (graph.nodes.length === 0 && graph.edges.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-2 font-medium">No connections found</p>
        <p className="text-sm text-muted-foreground max-w-md">
          This resource isn&apos;t mounted by any Pod or workload in this namespace.
          Check the <strong>Used By</strong> tab for details.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full bg-white rounded-lg border border-gray-200 shadow-sm" style={{ height: 'calc(100vh - 18rem)', minHeight: '500px' }} data-topology-container>
      {/* Node Info Panel — shown on single click */}
      {selectedNode && (
        <TopologyNodePanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onNavigate={handleNavigateToNode}
        />
      )}

      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white rounded-t-lg">
        {/* Left Section - Title, link to full topology, Layout */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center">
              <Network className="h-4 w-4 text-blue-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">Resource Topology</h3>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={() => navigate('/topology')}
            >
              <MapIcon className="h-3.5 w-3.5 mr-1" />
              Full Cluster Topology
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshLayout}
            className="h-8 px-3 text-xs text-gray-600 hover:text-gray-900"
            disabled={false}
          >
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            Refresh Layout
          </Button>
        </div>

        {/* Right Section - Overlays, Export, Controls */}
        <div className="flex items-center gap-3">
          {/* Overlays (Cytoscape only) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={activeOverlay ? 'default' : 'outline'}
                size="sm"
                className="h-8 px-3 text-xs gap-1.5"
                disabled={false}
              >
                <Layers className="h-3.5 w-3.5" />
                {activeOverlay ? OVERLAY_LABELS[activeOverlay] : 'Overlays'}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setActiveOverlay(null)}>Off</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveOverlay('health')}>
                {OVERLAY_LABELS.health}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="h-6" />

          {/* Export Options */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5" disabled={!graph}>
                <FileImage className="h-3.5 w-3.5" /> Export <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportPNG}>
                <FileImage className="h-3.5 w-3.5 mr-2" /> PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF} disabled={false}>
                <FileText className="h-3.5 w-3.5 mr-2" /> PDF (Cytoscape)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportDrawio}>
                <ExternalLink className="h-3.5 w-3.5 mr-2" /> Open in draw.io
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJSON}>
                <FileJson className="h-3.5 w-3.5 mr-2" /> JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportCSV}>
                <FileText className="h-3.5 w-3.5 mr-2" /> CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="h-6" />

          {/* Zoom (Cytoscape only) */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              className="h-8 w-8 text-gray-600 hover:text-gray-900"
              disabled={!graph}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium text-gray-700 min-w-[3rem] text-center">
              {zoomLevel}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              className="h-8 w-8 text-gray-600 hover:text-gray-900"
              disabled={!graph}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFullscreen}
            className="h-8 w-8 text-gray-600 hover:text-gray-900"
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="relative h-[calc(100%-3.5rem)]">
        {graph && (
          <TopologyCanvas
            ref={canvasRef}
            graph={graph}
            selectedResources={selectedResources}
            selectedRelationships={selectedRelationships}
            selectedHealth={selectedHealth}
            searchQuery={searchQuery}
            abstractionLevel={abstractionLevel}
            namespace={namespace ?? undefined}
            centeredNodeId={currentNodeId}
            isPaused={isPaused}
            heatMapMode="none"
            trafficFlowEnabled={false}
            overlayData={overlayDataForCanvas}
            onNodeSelect={handleNodeSelect}
            onNodeDoubleClick={handleNodeDoubleClick}
            className="h-full w-full rounded-b-lg"
          />
        )}

        {/* Resource Count Badge */}
        {graph && (
          <div className="absolute bottom-4 right-4 z-50 bg-gray-100 border border-gray-200 rounded-md px-2.5 py-1">
            <span className="text-xs font-medium text-gray-700">
              {graph.nodes.length} Resources
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
