import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { motion } from 'framer-motion';
import {
  Network,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Play,
  Pause,
  RotateCcw,
  FileJson,
  FileSpreadsheet,
  Image,
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
  FolderOpen,
  FolderClosed,
  Zap,
  Map,
  X,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { D3MiniMap } from './D3MiniMap';

export type ResourceType =
  | 'cluster'
  | 'pod'
  | 'deployment'
  | 'replicaset'
  | 'service'
  | 'node'
  | 'namespace'
  | 'configmap'
  | 'secret'
  | 'ingress'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob'
  | 'pv'
  | 'pvc'
  | 'hpa'
  | 'vpa'
  | 'pdb'
  | 'networkpolicy'
  | 'serviceaccount'
  | 'role'
  | 'clusterrole'
  | 'rolebinding'
  | 'clusterrolebinding'
  | 'endpoint'
  | 'endpointslice'
  | 'ingressclass'
  | 'storageclass'
  | 'user'
  | 'group';

export interface TopologyNode {
  id: string;
  type: ResourceType;
  name: string;
  namespace?: string;
  status?: 'healthy' | 'warning' | 'error' | 'pending';
  isCurrent?: boolean;
  traffic?: number; // 0-100 traffic intensity
}

export interface TopologyEdge {
  from: string;
  to: string;
  label?: string;
  traffic?: number; // 0-100 traffic intensity for animation
}

export interface D3TopologyCanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onNodeClick?: (node: TopologyNode) => void;
  className?: string;
  /** When true, show traffic animation on edges (default true when used from Interactive topology). */
  showTraffic?: boolean;
}

type GroupingMode = 'none' | 'namespace' | 'type';

const MAX_FORCE_NODES = 250;

// Resource type styling
// Resource type styling - Synchronized with Cytoscape HSL palette
const resourceStyles: Record<ResourceType, { color: string; radius: number }> = {
  pod: { color: 'hsl(199, 89%, 48%)', radius: 24 },
  deployment: { color: 'hsl(25, 95%, 53%)', radius: 32 },
  replicaset: { color: 'hsl(262, 83%, 58%)', radius: 28 },
  service: { color: 'hsl(142, 72%, 29%)', radius: 30 },
  node: { color: 'hsl(0, 72%, 51%)', radius: 36 },
  namespace: { color: 'hsl(280, 80%, 60%)', radius: 34 },
  configmap: { color: 'hsl(47, 96%, 53%)', radius: 22 },
  secret: { color: 'hsl(346, 84%, 61%)', radius: 22 },
  ingress: { color: 'hsl(174, 90%, 41%)', radius: 28 },
  statefulset: { color: 'hsl(210, 80%, 45%)', radius: 30 },
  daemonset: { color: 'hsl(280, 75%, 45%)', radius: 30 },
  job: { color: 'hsl(45, 93%, 47%)', radius: 26 },
  cronjob: { color: 'hsl(38, 92%, 50%)', radius: 26 },
  pv: { color: 'hsl(200, 40%, 45%)', radius: 26 },
  pvc: { color: 'hsl(200, 60%, 45%)', radius: 24 },
  hpa: { color: 'hsl(160, 60%, 45%)', radius: 24 },
  vpa: { color: 'hsl(150, 60%, 45%)', radius: 24 },
  pdb: { color: 'hsl(350, 60%, 50%)', radius: 24 },
  networkpolicy: { color: 'hsl(15, 80%, 40%)', radius: 26 },
  serviceaccount: { color: 'hsl(320, 70%, 50%)', radius: 24 },
  role: { color: 'hsl(310, 60%, 45%)', radius: 24 },
  clusterrole: { color: 'hsl(300, 80%, 40%)', radius: 28 },
  rolebinding: { color: 'hsl(300, 50%, 60%)', radius: 22 },
  clusterrolebinding: { color: 'hsl(300, 60%, 55%)', radius: 26 },
  endpoint: { color: 'hsl(215, 25%, 40%)', radius: 22 },
  endpointslice: { color: 'hsl(215, 20%, 50%)', radius: 22 },
  ingressclass: { color: 'hsl(170, 60%, 45%)', radius: 26 },
  storageclass: { color: 'hsl(200, 30%, 30%)', radius: 28 },
  user: { color: 'hsl(240, 60%, 55%)', radius: 24 },
  group: { color: 'hsl(250, 60%, 55%)', radius: 26 },
  cluster: { color: 'hsl(217, 91%, 25%)', radius: 50 },
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
  cluster: Map,
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
  hpa: 'HPA',
  vpa: 'VPA',
  pdb: 'PDB',
  networkpolicy: 'NetworkPolicy',
  serviceaccount: 'ServiceAccount',
  role: 'Role',
  clusterrole: 'ClusterRole',
  rolebinding: 'RoleBinding',
  clusterrolebinding: 'ClusterRoleBinding',
  endpoint: 'Endpoint',
  endpointslice: 'EndpointSlice',
  ingressclass: 'IngressClass',
  storageclass: 'StorageClass',
  user: 'User',
  group: 'Group',
  cluster: 'Cluster',
};

// Short abbreviations shown inside D3 force nodes
const KIND_ABBREVS: Record<ResourceType, string> = {
  pod: 'Pod', deployment: 'Dep', replicaset: 'RS', service: 'Svc',
  node: 'N', namespace: 'NS', configmap: 'CM', secret: 'Sec',
  ingress: 'Ing', statefulset: 'STS', daemonset: 'DS', job: 'Job',
  cronjob: 'CJ', pv: 'PV', pvc: 'PVC', hpa: 'HPA', vpa: 'VPA',
  pdb: 'PDB', networkpolicy: 'NP', serviceaccount: 'SA', role: 'Rol',
  clusterrole: 'CR', rolebinding: 'RB', clusterrolebinding: 'CRB',
  endpoint: 'EP', endpointslice: 'EPS', ingressclass: 'IC',
  storageclass: 'SC', user: 'Usr', group: 'Grp', cluster: 'K8s',
};

// Edge colors by relationship label for visual differentiation
const EDGE_LABEL_COLORS: Record<string, string> = {
  owns: '#546E7A', selects: '#78909C', exposes: '#2ECC71', routes: '#2ECC71',
  mounts: '#00ACC1', stores: '#00ACC1', references: '#FFC107', configures: '#FFC107',
  contains: '#9B59B6', permits: '#EC407A', manages: '#3498DB',
  scheduled_on: '#FF6B35', runs: '#FF6B35', backed_by: '#00ACC1', limits: '#795548',
};

// Namespace cluster hull colors
const NS_HULL_FILLS = [
  'rgba(52,152,219,0.06)', 'rgba(46,204,113,0.06)', 'rgba(155,89,182,0.06)',
  'rgba(241,196,15,0.06)', 'rgba(231,76,60,0.06)', 'rgba(26,188,156,0.06)',
  'rgba(243,156,18,0.06)', 'rgba(142,68,173,0.06)',
];
const NS_HULL_STROKES = [
  'rgba(52,152,219,0.3)', 'rgba(46,204,113,0.3)', 'rgba(155,89,182,0.3)',
  'rgba(241,196,15,0.3)', 'rgba(231,76,60,0.3)', 'rgba(26,188,156,0.3)',
  'rgba(243,156,18,0.3)', 'rgba(142,68,173,0.3)',
];

// D3 simulation node type
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: ResourceType;
  name: string;
  namespace?: string;
  status?: 'healthy' | 'warning' | 'error' | 'pending';
  isCurrent?: boolean;
  radius: number;
  color: string;
  traffic?: number;
  isGroup?: boolean;
  groupId?: string;
  childCount?: number;
  isCollapsed?: boolean;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  label?: string;
  traffic?: number;
}

interface GroupNode {
  id: string;
  name: string;
  count: number;
  nodes: string[];
  color: string;
}

export function D3TopologyCanvas({
  nodes,
  edges,
  onNodeClick,
  className,
  showTraffic: showTrafficProp,
}: D3TopologyCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [isSimulationRunning, setIsSimulationRunning] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 });
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showTraffic, setShowTraffic] = useState(showTrafficProp ?? true);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [hasAutoFitted, setHasAutoFitted] = useState(false);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const trafficAnimationFrameRef = useRef<number | null>(null);

  // Calculate groups based on grouping mode
  const groups = useMemo((): globalThis.Map<string, GroupNode> => {
    const groupMap: globalThis.Map<string, GroupNode> = new globalThis.Map();

    if (groupingMode === 'none') return groupMap;

    nodes.forEach(node => {
      let groupKey: string;
      let groupName: string;
      let groupColor: string;

      if (groupingMode === 'namespace') {
        groupKey = node.namespace || 'default';
        groupName = node.namespace || 'default';
        groupColor = 'hsl(280, 87%, 67%)';
      } else {
        groupKey = node.type;
        groupName = resourceLabels[node.type];
        groupColor = resourceStyles[node.type]?.color || 'hsl(var(--primary))';
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          id: `group-${groupKey}`,
          name: groupName,
          count: 0,
          nodes: [],
          color: groupColor
        });
      }

      const group = groupMap.get(groupKey)!;
      group.count++;
      group.nodes.push(node.id);
    });

    return groupMap;
  }, [nodes, groupingMode]);

  // Prepare D3 data with grouping support
  const { d3Nodes, d3Links } = useMemo(() => {
    let processedNodes: D3Node[] = [];
    let processedLinks: D3Link[] = [];

    if (groupingMode === 'none') {
      // No grouping - show all nodes
      processedNodes = nodes.map(node => ({
        ...node,
        radius: resourceStyles[node.type]?.radius || 24,
        color: resourceStyles[node.type]?.color || 'hsl(var(--primary))',
      }));

      processedLinks = edges.map(edge => ({
        source: edge.from,
        target: edge.to,
        label: edge.label,
        traffic: edge.traffic,
      }));
    } else {
      // With grouping
      const visibleNodeIds = new Set<string>();

      // Add group nodes or expanded individual nodes
      groups.forEach((group, groupKey) => {
        if (collapsedGroups.has(groupKey)) {
          // Show collapsed group node
          processedNodes.push({
            id: group.id,
            type: 'namespace' as ResourceType,
            name: group.name,
            radius: 40 + Math.min(group.count * 2, 20),
            color: group.color,
            isGroup: true,
            groupId: groupKey,
            childCount: group.count,
            isCollapsed: true,
          });
          visibleNodeIds.add(group.id);
        } else {
          // Show individual nodes
          group.nodes.forEach(nodeId => {
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
              processedNodes.push({
                ...node,
                radius: resourceStyles[node.type]?.radius || 24,
                color: resourceStyles[node.type]?.color || 'hsl(var(--primary))',
                groupId: groupKey,
              });
              visibleNodeIds.add(nodeId);
            }
          });
        }
      });

      // Process links - connect to group nodes if collapsed
      edges.forEach(edge => {
        let source = edge.from;
        let target = edge.to;

        // Check if source/target are in collapsed groups
        groups.forEach((group, groupKey) => {
          if (collapsedGroups.has(groupKey)) {
            if (group.nodes.includes(edge.from)) {
              source = group.id;
            }
            if (group.nodes.includes(edge.to)) {
              target = group.id;
            }
          }
        });

        // Only add if both endpoints are visible and not self-referential
        if (visibleNodeIds.has(source) && visibleNodeIds.has(target) && source !== target) {
          // Check if this link already exists (for collapsed groups)
          const existingLink = processedLinks.find(
            l => (l.source === source || (l.source as D3Node).id === source) &&
              (l.target === target || (l.target as D3Node).id === target)
          );
          if (!existingLink) {
            processedLinks.push({
              source,
              target,
              label: edge.label,
              traffic: edge.traffic,
            });
          }
        }
      });
    }

    return { d3Nodes: processedNodes, d3Links: processedLinks };
  }, [nodes, edges, groupingMode, groups, collapsedGroups]);

  // Toggle group collapse
  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  // Collapse/expand all groups
  const collapseAll = useCallback(() => {
    const allKeys = Array.from(groups.keys());
    setCollapsedGroups(new Set(allKeys));
  }, [groups]);

  const expandAll = useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

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

  const overNodeCap = d3Nodes.length > MAX_FORCE_NODES;

  // Initialize D3 force simulation (deferred to rAF to avoid blocking; capped for large graphs)
  useEffect(() => {
    if (!svgRef.current || d3Nodes.length === 0 || overNodeCap) return;

    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled || !svgRef.current) return;
      const svg = d3.select(svgRef.current);
      const { width, height } = dimensions;

      // Clear previous content
      svg.selectAll('*').remove();

      // Create defs for gradients and markers
      const defs = svg.append('defs');

      // Arrow marker
      defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'hsl(var(--muted-foreground))');

      // Traffic flow gradient
      const trafficGradient = defs.append('linearGradient')
        .attr('id', 'traffic-gradient')
        .attr('gradientUnits', 'userSpaceOnUse');

      trafficGradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', 'hsl(142, 76%, 36%)')
        .attr('stop-opacity', 0.8);

      trafficGradient.append('stop')
        .attr('offset', '50%')
        .attr('stop-color', 'hsl(199, 89%, 48%)')
        .attr('stop-opacity', 1);

      trafficGradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', 'hsl(142, 76%, 36%)')
        .attr('stop-opacity', 0.8);

      // Radial gradients for 3D sphere effect on each resource type
      Object.entries(resourceStyles).forEach(([type, style]) => {
        const grad = defs.append('radialGradient')
          .attr('id', `node-grad-${type}`)
          .attr('cx', '35%').attr('cy', '30%').attr('r', '65%');
        grad.append('stop').attr('offset', '0%')
          .attr('stop-color', '#ffffff').attr('stop-opacity', 0.4);
        grad.append('stop').attr('offset', '100%')
          .attr('stop-color', style.color).attr('stop-opacity', 1);
      });

      // Glow filter for depth effect
      const glowFilter = defs.append('filter')
        .attr('id', 'node-glow-filter')
        .attr('x', '-50%').attr('y', '-50%')
        .attr('width', '200%').attr('height', '200%');
      glowFilter.append('feGaussianBlur')
        .attr('in', 'SourceGraphic').attr('stdDeviation', '6').attr('result', 'blur');
      const glowMerge = glowFilter.append('feMerge');
      glowMerge.append('feMergeNode').attr('in', 'blur');
      glowMerge.append('feMergeNode').attr('in', 'SourceGraphic');

      // Create container group for zoom/pan
      const g = svg.append('g').attr('class', 'topology-container');

      // Add zoom behavior
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });

      zoomRef.current = zoom;
      svg.call(zoom);

      // Create namespace hull backgrounds group (rendered behind everything)
      const hullsGroup = g.append('g').attr('class', 'namespace-hulls');

      // Create links group
      const linksGroup = g.append('g').attr('class', 'links');

      // Create traffic particles group
      const trafficGroup = g.append('g').attr('class', 'traffic-particles');

      // Create nodes group
      const nodesGroup = g.append('g').attr('class', 'nodes');

      // Create link elements using paths for curved edges (Edge Bundling lite)
      const link = linksGroup.selectAll<SVGPathElement, D3Link>('path')
        .data(d3Links)
        .enter()
        .append('path')
        .attr('stroke', d => {
          const key = (d.label || '').replace(/\s+/g, '_').toLowerCase();
          return EDGE_LABEL_COLORS[key] || 'hsl(var(--muted-foreground))';
        })
        .attr('stroke-opacity', d => d.label ? 0.6 : 0.3)
        .attr('stroke-width', d => d.traffic ? Math.max(2, d.traffic / 20) : d.label ? 2.5 : 1.5)
        .attr('fill', 'none')
        .attr('marker-end', 'url(#arrowhead)');

      // Create animated traffic particles for edges with traffic
      if (showTraffic) {
        d3Links.filter(l => l.traffic && l.traffic > 0).forEach((linkData, i) => {
          const particleCount = Math.ceil((linkData.traffic || 0) / 20);

          for (let p = 0; p < particleCount; p++) {
            trafficGroup.append('circle')
              .attr('class', `traffic-particle traffic-${i}-${p}`)
              .attr('r', 3)
              .attr('fill', 'hsl(142, 76%, 50%)')
              .attr('opacity', 0.8);
          }
        });
      }

      // Create link labels
      const linkLabels = linksGroup.selectAll<SVGTextElement, D3Link>('text')
        .data(d3Links.filter(l => l.label))
        .enter()
        .append('text')
        .attr('font-size', 10)
        .attr('fill', 'hsl(var(--muted-foreground))')
        .attr('text-anchor', 'middle')
        .text(d => d.label || '');

      // Create node groups
      const node = nodesGroup.selectAll<SVGGElement, D3Node>('g')
        .data(d3Nodes)
        .enter()
        .append('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')
        .call(d3.drag<SVGGElement, D3Node>()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended)
        );

      // Add ambient glow behind each node for depth
      node.append('circle')
        .attr('r', d => d.radius + 10)
        .attr('fill', d => d.color)
        .attr('opacity', 0.15)
        .attr('class', 'node-ambient-glow')
        .style('filter', 'url(#node-glow-filter)');

      // Add selection ring for current nodes
      node.append('circle')
        .attr('r', d => d.radius + 4)
        .attr('fill', 'none')
        .attr('stroke', d => d.isCurrent ? d.color : 'transparent')
        .attr('stroke-width', 2.5)
        .attr('opacity', 0.7)
        .attr('class', 'node-selection-ring');

      // Add special glow effect for cluster node
      node.filter(d => d.type === 'cluster')
        .append('circle')
        .attr('r', d => d.radius + 12)
        .attr('fill', d => d.color)
        .attr('opacity', 0.2)
        .attr('class', 'cluster-glow')
        .style('filter', 'blur(8px)');

      node.filter(d => d.type === 'cluster')
        .append('circle')
        .attr('r', d => d.radius + 6)
        .attr('fill', d => d.color)
        .attr('opacity', 0.3)
        .attr('class', 'cluster-glow-inner');

      // Add group indicator ring
      node.filter(d => d.isGroup)
        .append('circle')
        .attr('r', d => d.radius + 4)
        .attr('fill', 'none')
        .attr('stroke', d => d.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4 2')
        .attr('opacity', 0.6);

      // Add main circle with gradient fill for 3D sphere effect
      node.append('circle')
        .attr('r', d => d.radius)
        .attr('fill', d => `url(#node-grad-${d.type})`)
        .attr('stroke', d => {
          if (d.type === 'cluster') return 'hsl(var(--background))';
          return d.isCurrent ? 'hsl(var(--background))' : 'transparent';
        })
        .attr('stroke-width', d => d.type === 'cluster' ? 4 : 3)
        .attr('class', 'node-circle')
        .style('filter', d => d.type === 'cluster' ? 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))' : null)
        .on('mouseenter', function (event, d) {
          d3.select(this).transition().duration(200).attr('r', d.radius + 4);
          setHoveredNode(d.id);
        })
        .on('mouseleave', function (event, d) {
          d3.select(this).transition().duration(200).attr('r', d.radius);
          setHoveredNode(null);
        })
        .on('click', (event, d) => {
          if (d.isGroup && d.groupId) {
            toggleGroup(d.groupId);
          } else {
            setSelectedNode(d.id);
            onNodeClick?.(d as TopologyNode);
          }
        });

      // Add status indicator
      node.filter(d => !!d.status && !d.isGroup)
        .append('circle')
        .attr('r', 6)
        .attr('cx', d => d.radius * 0.6)
        .attr('cy', d => -d.radius * 0.6)
        .attr('fill', d => {
          switch (d.status) {
            case 'healthy': return 'hsl(142, 76%, 36%)';
            case 'warning': return 'hsl(45, 93%, 47%)';
            case 'error': return 'hsl(0, 72%, 51%)';
            default: return 'hsl(var(--muted-foreground))';
          }
        })
        .attr('stroke', 'hsl(var(--background))')
        .attr('stroke-width', 2);

      // Add traffic indicator for nodes
      node.filter(d => !d.isGroup && d.traffic && d.traffic > 0)
        .append('circle')
        .attr('r', 4)
        .attr('cx', d => -d.radius * 0.6)
        .attr('cy', d => -d.radius * 0.6)
        .attr('fill', 'hsl(142, 76%, 50%)')
        .attr('class', 'traffic-indicator')
        .style('animation', 'pulse 1s ease-in-out infinite');

      // Add kind abbreviation inside node
      node.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', 'white')
        .attr('font-size', d => {
          if (d.isGroup) return 14;
          const abbr = KIND_ABBREVS[d.type] || '';
          return abbr.length > 3 ? Math.max(d.radius * 0.4, 9) : Math.max(d.radius * 0.55, 10);
        })
        .attr('font-weight', '700')
        .attr('font-family', '"Inter", "SF Pro Text", system-ui, sans-serif')
        .attr('letter-spacing', '0.3px')
        .text(d => {
          if (d.isGroup) return d.childCount || '?';
          return KIND_ABBREVS[d.type] || resourceLabels[d.type]?.charAt(0) || '?';
        });

      // Add resource type label
      node.append('text')
        .attr('y', d => d.radius + 16)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .attr('fill', 'hsl(var(--foreground))')
        .text(d => d.isGroup ? d.name : resourceLabels[d.type]);

      // Add resource name label
      node.filter(d => !d.isGroup)
        .append('text')
        .attr('y', d => d.radius + 30)
        .attr('text-anchor', 'middle')
        .attr('font-size', 9)
        .attr('fill', 'hsl(var(--muted-foreground))')
        .text(d => d.name.length > 20 ? d.name.slice(0, 17) + '...' : d.name);

      // Add collapse/expand indicator for groups
      node.filter(d => d.isGroup)
        .append('text')
        .attr('y', d => d.radius + 30)
        .attr('text-anchor', 'middle')
        .attr('font-size', 9)
        .attr('fill', 'hsl(var(--muted-foreground))')
        .text('Click to expand');

      // Create force simulation with clustering
      const simulation = d3.forceSimulation(d3Nodes)
        .force('link', d3.forceLink<D3Node, D3Link>(d3Links)
          .id(d => d.id)
          .distance(100)
          .strength(0.3)
        )
        .force('charge', d3.forceManyBody<D3Node>()
          .strength(d => d.type === 'cluster' ? -1000 : -300)
          .distanceMax(400)
        )
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide<D3Node>()
          .radius(d => d.radius + 20)
          .strength(0.9)
        )
        // Clustering force: pull nodes toward their namespace center
        .force('cluster', (alpha: number) => {
          const centers = new globalThis.Map<string, { x: number; y: number }>();
          d3Nodes.filter(n => n.type === 'namespace' || n.isGroup).forEach(n => {
            centers.set(n.namespace || n.groupId || '', { x: n.x || width / 2, y: n.y || height / 2 });
          });

          d3Nodes.forEach(n => {
            const center = centers.get(n.namespace || '');
            if (center) {
              n.vx! += (center.x - n.x!) * alpha * 0.1;
              n.vy! += (center.y - n.y!) * alpha * 0.1;
            }
          });
        })
        .force('x', d3.forceX(width / 2).strength(0.04))
        .force('y', d3.forceY(height / 2).strength(0.04));

      simulationRef.current = simulation;

      // Animate traffic particles
      const animateTraffic = () => {
        if (!showTraffic || cancelled) return;

        const time = Date.now();
        d3Links.filter(l => l.traffic && l.traffic > 0).forEach((linkData, i) => {
          const particleCount = Math.ceil((linkData.traffic || 0) / 20);
          const source = linkData.source as D3Node;
          const target = linkData.target as D3Node;

          if (!source.x || !source.y || !target.x || !target.y) return;

          for (let p = 0; p < particleCount; p++) {
            const speed = 0.001 + (linkData.traffic || 0) / 10000;
            const offset = p / particleCount;
            const t = ((time * speed) + offset) % 1;

            const x = source.x + (target.x - source.x) * t;
            const y = source.y + (target.y - source.y) * t;

            trafficGroup.select(`.traffic-${i}-${p}`)
              .attr('cx', x)
              .attr('cy', y);
          }
        });

        trafficAnimationFrameRef.current = requestAnimationFrame(animateTraffic);
      };

      if (showTraffic) {
        animateTraffic();
      }

      // Auto-fit function to scale content to fit screen
      const autoFitToScreen = () => {
        if (!svgRef.current || !zoomRef.current) return;

        const svgElement = svgRef.current;
        const container = g.node();
        if (!container) return;

        const bounds = container.getBBox();
        if (bounds.width === 0 || bounds.height === 0) return;

        const padding = 60;
        const fullWidth = width;
        const fullHeight = height;

        const widthScale = (fullWidth - padding * 2) / bounds.width;
        const heightScale = (fullHeight - padding * 2) / bounds.height;
        const scale = Math.min(widthScale, heightScale, 1); // Don't zoom in past 100%

        const translateX = (fullWidth - bounds.width * scale) / 2 - bounds.x * scale;
        const translateY = (fullHeight - bounds.height * scale) / 2 - bounds.y * scale;

        const transform = d3.zoomIdentity
          .translate(translateX, translateY)
          .scale(scale);

        d3.select(svgElement)
          .transition()
          .duration(750)
          .call(zoomRef.current.transform as any, transform);
      };

      // Update positions on each tick
      let tickCount = 0;
      simulation.on('tick', () => {
        tickCount++;

        link
          .attr('d', d => {
            const source = d.source as D3Node;
            const target = d.target as D3Node;
            const dx = target.x! - source.x!;
            const dy = target.y! - source.y!;
            const dr = Math.sqrt(dx * dx + dy * dy);
            // Curve factor for "bundled" look
            return `M${source.x},${source.y}A${dr},${dr} 0 0,1 ${target.x},${target.y}`;
          });

        linkLabels
          .attr('x', d => {
            const source = d.source as D3Node;
            const target = d.target as D3Node;
            return (source.x! + target.x!) / 2 + (target.y! - source.y!) / 4;
          })
          .attr('y', d => {
            const source = d.source as D3Node;
            const target = d.target as D3Node;
            return (source.y! + target.y!) / 2 - (target.x! - source.x!) / 4;
          });

        // Render namespace cluster hulls (every 5 ticks for performance)
        if (tickCount % 5 === 0) {
          const nsGroups = new Map<string, [number, number][]>();
          d3Nodes.forEach(n => {
            if (!n.namespace || n.isGroup) return;
            if (!nsGroups.has(n.namespace)) nsGroups.set(n.namespace, []);
            nsGroups.get(n.namespace)!.push([n.x!, n.y!]);
          });
          hullsGroup.selectAll('path').remove();
          hullsGroup.selectAll('text').remove();
          let nsIdx = 0;
          nsGroups.forEach((points, ns) => {
            const ci = nsIdx % NS_HULL_FILLS.length;
            if (points.length >= 3) {
              const hull = d3.polygonHull(points);
              if (hull) {
                const cx = d3.mean(hull, h => h[0])!;
                const cy = d3.mean(hull, h => h[1])!;
                const padded = hull.map(p => {
                  const dx = p[0] - cx;
                  const dy = p[1] - cy;
                  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                  return [p[0] + dx / dist * 55, p[1] + dy / dist * 55] as [number, number];
                });
                hullsGroup.append('path')
                  .attr('d', `M${padded.map(p => p.join(',')).join('L')}Z`)
                  .attr('fill', NS_HULL_FILLS[ci])
                  .attr('stroke', NS_HULL_STROKES[ci])
                  .attr('stroke-width', 1.5)
                  .attr('stroke-dasharray', '8 4');
                const topY = Math.min(...padded.map(p => p[1]));
                hullsGroup.append('text')
                  .attr('x', cx).attr('y', topY - 12)
                  .attr('text-anchor', 'middle')
                  .attr('font-size', 11)
                  .attr('font-weight', 600)
                  .attr('fill', NS_HULL_STROKES[ci].replace('0.3', '0.8'))
                  .attr('font-family', '"Inter", system-ui, sans-serif')
                  .text(ns);
              }
            }
            nsIdx++;
          });
        }

        node.attr('transform', d => `translate(${d.x},${d.y})`);

        // Auto-fit after simulation has stabilized initially (around 100 ticks)
        if (tickCount === 100 && !hasAutoFitted && !cancelled) {
          autoFitToScreen();
          setHasAutoFitted(true);
        }
      });

      // Drag functions
      function dragstarted(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }

      function dragged(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
        d.fx = event.x;
        d.fy = event.y;
      }

      function dragended(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }

    }); // end requestAnimationFrame

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      simulationRef.current?.stop();
      if (trafficAnimationFrameRef.current != null) {
        cancelAnimationFrame(trafficAnimationFrameRef.current);
        trafficAnimationFrameRef.current = null;
      }
    };
  }, [d3Nodes, d3Links, dimensions, onNodeClick, toggleGroup, showTraffic, overNodeCap]);

  // Control simulation
  const toggleSimulation = useCallback(() => {
    if (simulationRef.current) {
      if (isSimulationRunning) {
        simulationRef.current.stop();
      } else {
        simulationRef.current.alpha(0.3).restart();
      }
      setIsSimulationRunning(!isSimulationRunning);
    }
  }, [isSimulationRunning]);

  const resetSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.alpha(1).restart();
      setIsSimulationRunning(true);
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().duration(300).call(
        d3.zoom<SVGSVGElement, unknown>().scaleBy as any,
        1.3
      );
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().duration(300).call(
        d3.zoom<SVGSVGElement, unknown>().scaleBy as any,
        0.7
      );
    }
  }, []);

  const handleFitToScreen = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;

    const svg = d3.select(svgRef.current);
    const container = svg.select('.topology-container').node() as SVGGElement;
    if (!container) return;

    const bounds = container.getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    const padding = 60;
    const { width, height } = dimensions;

    const widthScale = (width - padding * 2) / bounds.width;
    const heightScale = (height - padding * 2) / bounds.height;
    const scale = Math.min(widthScale, heightScale, 1);

    const translateX = (width - bounds.width * scale) / 2 - bounds.x * scale;
    const translateY = (height - bounds.height * scale) / 2 - bounds.y * scale;

    const transform = d3.zoomIdentity
      .translate(translateX, translateY)
      .scale(scale);

    svg.transition().duration(500).call(zoomRef.current.transform as any, transform);
    resetSimulation();
  }, [dimensions, resetSimulation]);

  // Keyboard shortcuts - must be after handleFitToScreen is defined
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'f':
          handleFitToScreen();
          break;
        case ' ':
          e.preventDefault();
          toggleSimulation();
          break;
        case 'r':
          resetSimulation();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleFitToScreen, toggleSimulation, resetSimulation]);

  return (
    <div
      ref={containerRef}
      className={cn('rounded-xl border border-border bg-card overflow-hidden', className)}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Network className="h-4 w-4 text-primary" />
          </div>
          <h3 className="font-medium text-sm">Force-Directed Topology</h3>
          <Badge variant="secondary" className="text-xs">
            D3.js
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          {/* Grouping controls */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Group by:</Label>
            <Select value={groupingMode} onValueChange={(v) => setGroupingMode(v as GroupingMode)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="namespace">Namespace</SelectItem>
                <SelectItem value="type">Resource Type</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {groupingMode !== 'none' && (
            <div className="flex items-center gap-1">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={collapseAll}>
                      <FolderClosed className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Collapse all groups</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={expandAll}>
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Expand all groups</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          <div className="w-px h-4 bg-border" />

          {/* Traffic toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="traffic-toggle"
              checked={showTraffic}
              onCheckedChange={setShowTraffic}
              className="scale-75"
            />
            <Label htmlFor="traffic-toggle" className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" />
              Traffic
            </Label>
          </div>

          <div className="w-px h-4 bg-border" />

          {/* Simulation controls */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={toggleSimulation}
                >
                  {isSimulationRunning ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isSimulationRunning ? 'Pause simulation' : 'Resume simulation'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={resetSimulation}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset simulation</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="w-px h-4 bg-border" />

          {/* Export buttons */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <FileJson className="h-3.5 w-3.5" />
                  JSON
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export as JSON</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export as CSV</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Image className="h-3.5 w-3.5" />
                  PNG
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export as PNG</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="w-px h-4 bg-border" />

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={handleZoomOut}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={handleZoomIn}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleFitToScreen}
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fit to screen</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative bg-gradient-to-b from-background to-muted/20 overflow-hidden">
        <Badge
          variant="secondary"
          className="absolute top-4 right-4 z-10 font-medium text-xs"
        >
          {d3Nodes.length} Resources
        </Badge>

        <Badge
          variant={isSimulationRunning ? "default" : "secondary"}
          className="absolute top-4 left-4 z-10 font-medium text-xs gap-1 flex items-center"
        >
          {isSimulationRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Physics Active
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              Paused
            </>
          )}
        </Badge>

        {showTraffic && (
          <Badge
            variant="outline"
            className="absolute top-4 left-32 z-10 font-medium text-xs gap-1 flex items-center border-green-500/50 text-green-600"
          >
            <Zap className="h-3 w-3" />
            Traffic Flow
          </Badge>
        )}

        {/* Mini-map toggle button */}
        {!showMiniMap && (
          <Button
            variant="outline"
            size="sm"
            className="absolute bottom-4 right-4 z-10 gap-1.5"
            onClick={() => setShowMiniMap(true)}
          >
            <Map className="h-4 w-4" />
            Mini-map
          </Button>
        )}

        {overNodeCap && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-lg p-6 text-center">
            <p className="text-sm font-medium text-muted-foreground max-w-md">
              This graph has {d3Nodes.length} nodes. Force-directed layout is limited to {MAX_FORCE_NODES} nodes for performance.
              Use Cytoscape Layout or 3D tab for larger graphs.
            </p>
          </div>
        )}
        <motion.svg
          ref={svgRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full"
          style={{ minHeight: '500px' }}
        />

        {/* Mini-map */}
        {showMiniMap && d3Nodes.length > 5 && (
          <D3MiniMap
            svgRef={svgRef}
            containerDimensions={dimensions}
            onClose={() => setShowMiniMap(false)}
          />
        )}

        {/* Resource Type Legend */}
        <div className="absolute top-12 right-4 z-10 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 max-h-[300px] overflow-y-auto shadow-lg">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Resource Types</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Array.from(new Set(nodes.map(n => n.type))).sort().map(type => {
              const style = resourceStyles[type];
              return style ? (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: style.color }} />
                  <span className="text-[10px] text-foreground/80">{resourceLabels[type]}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>

        {/* Instructions overlay with keyboard shortcuts */}
        <div className="absolute bottom-4 left-4 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-border">
          <span className="font-medium">Controls:</span> Drag nodes • Scroll to zoom • Click to select
          <span className="mx-2">|</span>
          <span className="font-medium">Keys:</span>
          <span className="ml-1.5 px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">F</span> Fit
          <span className="ml-1.5 px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Space</span> Pause
          <span className="ml-1.5 px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">R</span> Reset
        </div>
      </div>
    </div>
  );
}
