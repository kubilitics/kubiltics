/**
 * D3 Hierarchical Topology Canvas - Tree/Hierarchical Layout
 * Clean top-down hierarchical visualization using D3 tree layout
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { 
  Network, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Box,
  Server,
  Layers,
  Globe,
  Container,
  Database,
  Key,
  FileCode,
  Clock,
  HardDrive,
  Shield,
  Activity,
  Cpu,
  Settings,
  Workflow,
  Map as MapIcon,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { TopologyNode, TopologyEdge, ResourceType } from './D3TopologyCanvas';

export interface HierarchicalNode {
  id: string;
  data: TopologyNode;
  children?: HierarchicalNode[];
  parent?: HierarchicalNode;
  depth?: number;
  x?: number;
  y?: number;
}

// Re-export for convenience
export type { TopologyNode, TopologyEdge, ResourceType } from './D3TopologyCanvas';

/** Max nodes for tree layout; above this we show a message to avoid renderer crash / freeze */
const MAX_TREE_NODES = 200;
/** Nodes to create per animation frame (keeps main thread responsive) */
const NODES_PER_FRAME = 35;

export interface D3HierarchicalTopologyCanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onNodeClick?: (node: TopologyNode) => void;
  className?: string;
}

// Resource type styling - matching reference image colors
const resourceStyles: Record<ResourceType, { color: string; radius: number }> = {
  pod: { color: '#3498DB', radius: 24 }, // Blue
  deployment: { color: '#FF6B35', radius: 32 }, // Orange
  replicaset: { color: '#9B59B6', radius: 28 }, // Purple
  service: { color: '#2ECC71', radius: 30 }, // Green
  node: { color: '#D32F2F', radius: 36 }, // Red
  namespace: { color: '#7B1FA2', radius: 34 }, // Purple
  configmap: { color: '#FFC107', radius: 22 }, // Amber
  secret: { color: '#E53935', radius: 22 }, // Red
  ingress: { color: '#26A69A', radius: 28 }, // Teal
  statefulset: { color: '#1E88E5', radius: 30 }, // Blue
  daemonset: { color: '#5E35B1', radius: 30 }, // Purple
  job: { color: '#F57C00', radius: 26 }, // Orange
  cronjob: { color: '#FF9800', radius: 26 }, // Orange
  pv: { color: '#0097A7', radius: 26 }, // Teal
  pvc: { color: '#00ACC1', radius: 24 }, // Cyan
  hpa: { color: '#0288D1', radius: 24 }, // Blue
  vpa: { color: '#00BCD4', radius: 24 }, // Cyan
  pdb: { color: '#E91E63', radius: 24 }, // Pink
  networkpolicy: { color: '#FF6F00', radius: 26 }, // Orange
  serviceaccount: { color: '#AD1457', radius: 24 }, // Pink
  role: { color: '#EC407A', radius: 24 }, // Pink
  clusterrole: { color: '#C2185B', radius: 28 }, // Pink
  rolebinding: { color: '#F06292', radius: 22 }, // Pink
  clusterrolebinding: { color: '#E91E63', radius: 26 }, // Pink
  endpoint: { color: '#546E7A', radius: 22 }, // Gray
  endpointslice: { color: '#607D8B', radius: 22 }, // Gray
  ingressclass: { color: '#00BCD4', radius: 26 }, // Cyan
  storageclass: { color: '#00BCD4', radius: 28 }, // Cyan
  user: { color: '#9C27B0', radius: 24 }, // Purple
  group: { color: '#7B1FA2', radius: 26 }, // Purple
  cluster: { color: '#2196F3', radius: 50 }, // Blue
};

const resourceIcons: Record<ResourceType, LucideIcon> = {
  pod: Box,
  deployment: Container,
  replicaset: Layers,
  service: Globe,
  node: Server,
  namespace: Network,
  configmap: FileCode,
  secret: Key,
  ingress: Globe,
  statefulset: Database,
  daemonset: Cpu,
  job: Workflow,
  cronjob: Clock,
  pv: HardDrive,
  pvc: HardDrive,
  hpa: Activity,
  vpa: Activity,
  pdb: Shield,
  networkpolicy: Shield,
  serviceaccount: Settings,
  role: Shield,
  clusterrole: Shield,
  rolebinding: Shield,
  clusterrolebinding: Shield,
  endpoint: Globe,
  endpointslice: Network,
  ingressclass: Globe,
  storageclass: Layers,
  user: Settings,
  group: Settings,
  cluster: MapIcon,
};

const resourceLabels: Record<ResourceType, string> = {
  pod: 'Pod',
  deployment: 'Deployment',
  replicaset: 'ReplicaSet',
  service: 'Service',
  node: 'Node',
  namespace: 'Namespace',
  configmap: 'ConfigMap',
  secret: 'Secret',
  ingress: 'Ingress',
  statefulset: 'StatefulSet',
  daemonset: 'DaemonSet',
  job: 'Job',
  cronjob: 'CronJob',
  pv: 'PersistentVolume',
  pvc: 'PersistentVolumeClaim',
  hpa: 'HorizontalPodAutoscaler',
  vpa: 'VerticalPodAutoscaler',
  pdb: 'PodDisruptionBudget',
  networkpolicy: 'NetworkPolicy',
  serviceaccount: 'ServiceAccount',
  role: 'Role',
  clusterrole: 'ClusterRole',
  rolebinding: 'RoleBinding',
  clusterrolebinding: 'ClusterRoleBinding',
  endpoint: 'Endpoints',
  endpointslice: 'EndpointSlice',
  ingressclass: 'IngressClass',
  storageclass: 'StorageClass',
  user: 'User',
  group: 'Group',
  cluster: 'Cluster',
};

export function D3HierarchicalTopologyCanvas({
  nodes,
  edges,
  onNodeClick,
  className,
}: D3HierarchicalTopologyCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [zoomLevel, setZoomLevel] = useState(100);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [overNodeLimit, setOverNodeLimit] = useState(false);

  // Build hierarchical tree structure from nodes and edges (skip when over limit to avoid memory spike)
  const treeRoot = useMemo(() => {
    if (nodes.length === 0 || nodes.length > MAX_TREE_NODES) return null;

    // Build node map
    const nodeMap = new Map<string, HierarchicalNode>();
    nodes.forEach(node => {
      nodeMap.set(node.id, {
        id: node.id,
        data: node,
        children: [],
      });
    });

    // Build parent-child relationships from edges
    // Priority: 'owns' > 'manages' > 'runs' > other relationships
    const relationshipPriority: Record<string, number> = {
      'owns': 1,
      'manages': 2,
      'runs': 3,
      'creates': 4,
    };

    // Group edges by target, keeping only highest priority relationship
    const childToParent = new Map<string, { parentId: string; edge: TopologyEdge }>();
    
    edges.forEach(edge => {
      const existing = childToParent.get(edge.to);
      const labelLower = edge.label?.toLowerCase() || '';
      const priority = relationshipPriority[labelLower] || 100;
      
      if (!existing || priority < (relationshipPriority[existing.edge.label?.toLowerCase() || ''] || 100)) {
        childToParent.set(edge.to, { parentId: edge.from, edge });
      }
    });

    // Build tree structure
    const rootNodes: HierarchicalNode[] = [];
    
    nodeMap.forEach((node, nodeId) => {
      const parentInfo = childToParent.get(nodeId);
      
      if (parentInfo) {
        const parent = nodeMap.get(parentInfo.parentId);
        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(node);
          node.parent = parent;
        } else {
          // Parent not found, treat as root
          rootNodes.push(node);
        }
      } else {
        // No parent, this is a root node
        rootNodes.push(node);
      }
    });

    // If multiple roots and we have a current node, use it as root
    // Otherwise, use first root or create virtual root if multiple roots exist
    let root: HierarchicalNode;
    
    if (rootNodes.length === 1) {
      root = rootNodes[0];
    } else {
      const currentNode = nodes.find(n => n.isCurrent);
      if (currentNode && nodeMap.has(currentNode.id)) {
        root = nodeMap.get(currentNode.id)!;
        
        // Rebuild tree with current node as root
        const visited = new Set<string>();
        const rebuildTree = (node: HierarchicalNode) => {
          if (visited.has(node.id)) return;
          visited.add(node.id);
          
          node.children = [];
          // Find all edges where this node is the source
          edges
            .filter(e => e.from === node.id)
            .forEach(edge => {
              const child = nodeMap.get(edge.to);
              if (child && !visited.has(child.id)) {
                node.children!.push(child);
                child.parent = node;
                rebuildTree(child);
              }
            });
        };
        
        rebuildTree(root);
        
        // Add remaining disconnected nodes as children
        nodeMap.forEach((node) => {
          if (!visited.has(node.id) && node.id !== root.id) {
            if (!root.children) {
              root.children = [];
            }
            root.children.push(node);
            node.parent = root;
          }
        });
      } else {
        // Create virtual root
        root = {
          id: '__virtual_root__',
          data: {
            id: '__virtual_root__',
            type: 'namespace',
            name: 'Root',
          },
          children: rootNodes,
        };
        rootNodes.forEach(node => {
          node.parent = root;
        });
      }
    }

    return root;
  }, [nodes, edges]);

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(rect.width - 32, 400),
          height: Math.max(rect.height - 100, 400),
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Build edge map for quick lookup
  const edgeMap = useMemo(() => {
    const map = new Map<string, TopologyEdge>();
    edges.forEach(edge => {
      map.set(`${edge.from}-${edge.to}`, edge);
    });
    return map;
  }, [edges]);

  // Render D3 tree — deferred so tab switch stays responsive (avoids main-thread freeze)
  useEffect(() => {
    if (!svgRef.current || !treeRoot) return;

    const nodeCount = nodes.length;
    if (nodeCount > MAX_TREE_NODES) {
      setOverNodeLimit(true);
      return;
    }
    setOverNodeLimit(false);

    let cancelled = false;
    const svgEl = svgRef.current;
    const { width, height } = dimensions;

    const runLayout = () => {
      if (cancelled || !svgEl) return;
      const svg = d3.select(svgEl);

      // Clear previous content
      svg.selectAll('*').remove();

      // Create defs for gradients and markers
      const defs = svg.append('defs');
      defs.append('marker')
        .attr('id', 'arrowhead-hierarchical')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 15)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#666');

      const g = svg.append('g').attr('class', 'topology-container');

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
          setZoomLevel(Math.round(event.transform.k * 100));
        });

      zoomRef.current = zoom;
      svg.call(zoom);

      const hierarchy = d3.hierarchy(treeRoot, (d: HierarchicalNode) => d.children);
      const treeLayout = d3.tree<HierarchicalNode>()
        .size([height - 120, width - 200])
        .separation((a, b) => (a.parent === b.parent ? 1.2 : 1.5));
      const treeData = treeLayout(hierarchy);

      const visibleDescendants = treeData.descendants().filter((d: any) => d.data?.id !== '__virtual_root__');

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      visibleDescendants.forEach((d: any) => {
        if (d.x < minX) minX = d.x;
        if (d.x > maxX) maxX = d.x;
        if (d.y < minY) minY = d.y;
        if (d.y > maxY) maxY = d.y;
      });

      const treeWidth = maxX - minX || width - 200;
      const treeHeight = maxY - minY || height - 120;
      const treeCenterX = (minX + maxX) / 2 || (width - 200) / 2;
      const treeCenterY = (minY + maxY) / 2 || (height - 120) / 2;
      const padding = 60;
      const scale = Math.min(
        (width - padding * 2) / treeWidth,
        (height - padding * 2) / treeHeight,
        1
      );
      const translateX = width / 2 - treeCenterX * scale;
      const translateY = padding - minY * scale;
      const initialTransform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
      svg.call(zoom.transform as any, initialTransform);

      const linksGroup = g.append('g').attr('class', 'links');
      const nodesGroup = g.append('g').attr('class', 'nodes');

      const visibleLinks = treeData.links().filter((d: any) => (d as any).source.data?.id !== '__virtual_root__');
      linksGroup.selectAll<SVGPathElement, any>('path')
        .data(visibleLinks)
        .enter()
        .append('path')
        .attr('d', (d: any) => {
          const source = d.source as any;
          const target = d.target as any;
          return `M${source.y},${source.x}L${target.y},${target.x}`;
        })
        .attr('fill', 'none')
        .attr('stroke', '#999')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6)
        .attr('marker-end', 'url(#arrowhead-hierarchical)');

      linksGroup.selectAll<SVGTextElement, any>('text')
        .data(visibleLinks)
        .enter()
        .append('text')
        .attr('x', (d: any) => {
          const source = d.source as any;
          const target = d.target as any;
          return (source.y + target.y) / 2;
        })
        .attr('y', (d: any) => {
          const source = d.source as any;
          const target = d.target as any;
          return (source.x + target.x) / 2;
        })
        .attr('dy', -5)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .attr('fill', '#666')
        .attr('font-weight', 500)
        .text((d: any) => {
          const source = d.source as HierarchicalNode;
          const target = d.target as HierarchicalNode;
          const edge = edgeMap.get(`${source.id}-${target.id}`);
          let label = edge?.label || 'Manages';
          if (label.toLowerCase() === 'owns') label = 'Creates';
          return label;
        });

      const addNodeBatch = (endIndex: number) => {
        if (cancelled) return;
        const slice = visibleDescendants.slice(0, endIndex);
        const node = nodesGroup.selectAll<SVGGElement, any>('g.node')
          .data(slice, (d: any) => d.data.id)
          .enter()
          .append('g')
          .attr('class', 'node')
          .attr('transform', (d: any) => `translate(${d.y},${d.x})`)
          .style('cursor', 'pointer')
          .on('mouseenter', (event, d: any) => {
            setHoveredNode(d.data.id);
            d3.select(event.currentTarget).select('circle.node-circle').attr('stroke-width', 3);
          })
          .on('mouseleave', (event) => {
            setHoveredNode(null);
            d3.select(event.currentTarget).select('circle.node-circle').attr('stroke-width', 2);
          })
          .on('click', (event, d: any) => {
            event.stopPropagation();
            onNodeClick?.(d.data);
          });

        node.append('circle')
          .attr('r', (d: any) => {
            const style = resourceStyles[d.data.type] || resourceStyles.pod;
            return style.radius + 6;
          })
          .attr('fill', (d: any) => {
            if (d.data.isCurrent || hoveredNode === d.data.id) {
              const style = resourceStyles[d.data.type] || resourceStyles.pod;
              return style.color;
            }
            return 'transparent';
          })
          .attr('opacity', 0.2)
          .attr('class', 'node-glow');

        node.append('circle')
          .attr('r', (d: any) => {
            const style = resourceStyles[d.data.type] || resourceStyles.pod;
            return style.radius;
          })
          .attr('fill', (d: any) => {
            const style = resourceStyles[d.data.type] || resourceStyles.pod;
            return style.color;
          })
          .attr('stroke', (d: any) => (d.data.isCurrent ? '#000' : '#fff'))
          .attr('stroke-width', (d: any) => d.data.isCurrent ? 3 : 2)
          .attr('class', 'node-circle');

        node.filter((d: any) => d.data.status === 'healthy')
          .append('circle')
          .attr('r', 6)
          .attr('cx', (d: any) => {
            const style = resourceStyles[d.data.type] || resourceStyles.pod;
            return style.radius * 0.6;
          })
          .attr('cy', (d: any) => {
            const style = resourceStyles[d.data.type] || resourceStyles.pod;
            return -style.radius * 0.6;
          })
          .attr('fill', '#2ECC71')
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5);

        node.append('text')
          .attr('y', (d: any) => {
            const style = resourceStyles[d.data.type] || resourceStyles.pod;
            return style.radius + 18;
          })
          .attr('text-anchor', 'middle')
          .attr('font-size', 12)
          .attr('font-weight', 600)
          .attr('fill', '#1a1a1a')
          .text((d: any) => (d.data && (resourceLabels[d.data.type] || d.data.type)) || 'Resource');

        node.append('text')
          .attr('y', (d: any) => {
            const style = resourceStyles[d.data.type] || resourceStyles.pod;
            return style.radius + 32;
          })
          .attr('text-anchor', 'middle')
          .attr('font-size', 10)
          .attr('fill', '#666')
          .text((d: any) => {
            const name = d.data?.name ?? '';
            return name.length > 20 ? name.slice(0, 17) + '...' : name;
          });

        const next = Math.min(endIndex + NODES_PER_FRAME, visibleDescendants.length);
        if (next > endIndex) requestAnimationFrame(() => addNodeBatch(next));
      };

      addNodeBatch(Math.min(NODES_PER_FRAME, visibleDescendants.length));
    };

    const rafId = requestAnimationFrame(() => runLayout());
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [nodes.length, svgRef, treeRoot, dimensions, edgeMap, onNodeClick]);

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(200)
      .call(zoomRef.current.scaleBy as any, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(200)
      .call(zoomRef.current.scaleBy as any, 1 / 1.3);
  }, []);

  const handleResetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(300)
      .call(zoomRef.current.transform as any, d3.zoomIdentity);
    setZoomLevel(100);
  }, []);

  return (
    <div ref={containerRef} className={cn('relative w-full h-full bg-white', className)}>
      {overNodeLimit ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 bg-slate-50/95 rounded-lg border border-gray-200 z-10">
          <Layers className="h-12 w-12 text-amber-500" />
          <p className="text-sm font-medium text-gray-800 text-center max-w-sm">
            D3 Standard tree supports up to {MAX_TREE_NODES} nodes (this graph has {nodes.length}). Use <strong>Cytoscape Layout</strong> or <strong>3D</strong> for large graphs.
          </p>
          <p className="text-xs text-gray-500">You can switch tabs freely; the app will not freeze.</p>
        </div>
      ) : null}
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="w-full h-full"
        style={{ visibility: overNodeLimit ? 'hidden' : 'visible' }}
      />
      
      {/* Resource count badge */}
      <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-1.5 shadow-md z-10">
        <span className="text-xs font-semibold text-gray-700">
          {nodes.length} Resources
        </span>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col items-center gap-1 p-1 bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg z-10">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleZoomIn}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Zoom In</TooltipContent>
          </Tooltip>
          
          <div className="text-xs text-gray-600 font-medium min-w-[3rem] text-center">
            {zoomLevel}%
          </div>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleZoomOut}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Zoom Out</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleResetZoom}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Reset Zoom</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
