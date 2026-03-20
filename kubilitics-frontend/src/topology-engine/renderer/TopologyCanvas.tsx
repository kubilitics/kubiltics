/**
 * TopologyCanvas – Crown Jewel Renderer
 * Cytoscape.js + ELK layered layout
 * Enterprise-grade, light background, premium design
 * Features: edge labels, traffic flow, heatmap, minimap, draggable nodes
 */
import {
  useRef, useEffect, useCallback, useState,
  forwardRef, useImperativeHandle,
} from 'react';
import cytoscape, { Core, EventObject, NodeSingular } from 'cytoscape';
import elk from 'cytoscape-elk';
import { getStylesheet, CANVAS_BG, getHeatmapColor } from './styles';
import { applyELKLayout } from './useELKLayout';
import { useHighlightEngine } from '../interaction/useHighlightEngine';
import { useSelectionEngine } from '../interaction/useSelectionEngine';
import { toCytoscapeNodeData } from '../utils/nodeHelpers';
import { toCytoscapeEdgeData } from '../utils/edgeHelpers';
import { applyAbstraction, type FilterOptions } from '../core/abstractionEngine';
import { downloadPDF } from '../export/exportPdf';
import { cn } from '@/lib/utils';
import type {
  TopologyGraph, TopologyNode, TopologyCanvasRef,
  KubernetesKind, HealthStatus, RelationshipType, AbstractionLevel,
  HeatMapMode,
} from '../types/topology.types';
import type { BlastRadiusResult } from '../types/interaction.types';
import type { OverlayData } from '../types/overlay.types';

/** Above this node count use grid layout instead of ELK to avoid main-thread freeze */
const ELK_NODE_CAP = 250;

// Register ELK once
let elkRegistered = false;
try {
  if (!elkRegistered) { cytoscape.use(elk); elkRegistered = true; }
} catch { /* already registered */ }

export interface TopologyCanvasProps {
  graph: TopologyGraph;
  selectedResources: Set<KubernetesKind>;
  selectedRelationships: Set<RelationshipType>;
  selectedHealth: Set<HealthStatus | 'pending'>;
  searchQuery: string;
  abstractionLevel: AbstractionLevel;
  namespace?: string;
  centeredNodeId?: string;
  className?: string;
  isPaused?: boolean;
  heatMapMode?: HeatMapMode;
  trafficFlowEnabled?: boolean;
  onNodeSelect?: (node: TopologyNode | null) => void;
  onNodeDoubleClick?: (node: TopologyNode) => void;
  onContextMenu?: (event: { nodeId: string; position: { x: number; y: number } }) => void;
  onNodeHover?: (nodeId: string | null, clientPosition: { x: number; y: number } | null) => void;
  blastRadius?: BlastRadiusResult | null;
  overlayData?: OverlayData | null;
  /** When true, node positions snap to grid on drag end (grid size 20px) */
  snapToGrid?: boolean;
}

export const TopologyCanvas = forwardRef<TopologyCanvasRef, TopologyCanvasProps>(({
  graph,
  selectedResources,
  selectedRelationships,
  selectedHealth,
  searchQuery,
  abstractionLevel,
  namespace,
  centeredNodeId,
  className,
  isPaused = false,
  heatMapMode = 'none',
  trafficFlowEnabled = false,
  onNodeSelect,
  onNodeDoubleClick,
  onContextMenu,
  onNodeHover,
  blastRadius,
  overlayData,
  snapToGrid = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  // Virtual scrollbar state: tracks graph extent vs viewport for vertical panning
  const [scrollInfo, setScrollInfo] = useState<{ thumbRatio: number; thumbTop: number } | null>(null);
  const scrollTrackRef = useRef<HTMLDivElement>(null);
  const isDraggingScroll = useRef(false);
  const trafficAnimRef = useRef<number | null>(null);
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;
  const onNodeHoverRef = useRef(onNodeHover);
  onNodeHoverRef.current = onNodeHover;
  const minimapTransformRef = useRef<{ scale: number; ox: number; oy: number } | null>(null);

  const highlightEngine = useHighlightEngine({
    isPaused,
    onNodeHover: (nodeId, clientPosition) => onNodeHoverRef.current?.(nodeId, clientPosition ?? null),
  });
  const selectionEngine = useSelectionEngine({ onNodeSelect, onNodeDoubleClick });

  // Build filtered Cytoscape elements
  const getFilteredElements = useCallback(() => {
    const filterOptions: FilterOptions = {
      abstractionLevel,
      selectedKinds: selectedResources,
      selectedRelationships,
      selectedHealth,
      searchQuery,
      namespace,
    };
    const filtered = applyAbstraction(graph, filterOptions);
    const elements: cytoscape.ElementDefinition[] = [];

    for (const node of filtered.nodes) {
      elements.push(toCytoscapeNodeData(node));
    }
    for (const edge of filtered.edges) {
      elements.push(toCytoscapeEdgeData(edge));
    }
    return elements;
  }, [graph, selectedResources, selectedRelationships, selectedHealth, searchQuery, abstractionLevel, namespace]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: getStylesheet(),
      wheelSensitivity: 0.3,
      minZoom: 0.05,
      maxZoom: 5.0,
      boxSelectionEnabled: true,
      selectionType: 'additive',
      autoungrabify: false,
      layout: { name: 'preset' },
    });
    cyRef.current = cy;

    // Attach interaction engines
    highlightEngine.attachListeners(cy, containerRef.current);
    selectionEngine.attachListeners(cy);

    // Right-click context menu: emit node id and client position for menu placement
    const handleCxttap = (ev: EventObject) => {
      const target = ev.target;
      if (target === cy || !target.isNode()) return;
      const nodeId = target.id();
      const pos = (target as NodeSingular).renderedPosition();
      const container = containerRef.current;
      const x = container ? container.getBoundingClientRect().left + pos.x : pos.x;
      const y = container ? container.getBoundingClientRect().top + pos.y : pos.y;
      onContextMenuRef.current?.({ nodeId, position: { x, y } });
    };
    cy.on('cxttap', handleCxttap);

    setIsReady(true);
    return () => {
      cy.off('cxttap', handleCxttap);
      if (trafficAnimRef.current) cancelAnimationFrame(trafficAnimRef.current);
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Update elements on data/filter change — deferred so tab stays responsive (avoids freeze)
  useEffect(() => {
    if (!cyRef.current || !isReady) return;
    const cy = cyRef.current;
    const elements = getFilteredElements();
    const centered = centeredNodeId;
    let cancelled = false;

    const runUpdate = () => {
      if (cancelled) return;
      const nodeCount = elements.filter((el: cytoscape.ElementDefinition) => el.data && !('target' in (el.data || {}))).length;
      cy.batch(() => {
        cy.elements().remove();
        if (elements.length > 0) {
          cy.add(elements);
        }
      });
      if (elements.length === 0) return;

      const finish = () => {
        if (cancelled) return;
        if (centered) {
          const node = cy.getElementById(centered);
          if (node.length > 0) {
            cy.center(node);
            node.addClass('current');
          }
        } else {
          // Fit to width for readable nodes; allow vertical overflow + scrollbar
          cy.fit(undefined, 50);
          const fitAllZoom = cy.zoom();
          const bb = cy.elements().boundingBox();
          const cw = containerRef.current?.clientWidth ?? 800;
          const pad = 50;
          const zoomW = (cw - pad * 2) / bb.w;
          // Use fit-to-width when it yields noticeably larger (more readable) nodes
          if (zoomW > fitAllZoom * 1.1) {
            cy.zoom(zoomW);
            cy.pan({
              x: -bb.x1 * zoomW + pad,
              y: -bb.y1 * zoomW + pad,
            });
          }
        }
        updateMinimap();
        updateScrollbar();
      };

      if (nodeCount > ELK_NODE_CAP) {
        const gridLayout = cy.layout({ name: 'grid', padding: 50, fit: true } as any);
        gridLayout.on('layoutstop', () => { if (!cancelled) finish(); });
        gridLayout.run();
      } else {
        applyELKLayout(cy).then(finish);
      }
    };

    const rafId = requestAnimationFrame(() => runUpdate());
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [graph, selectedResources, selectedRelationships, selectedHealth, searchQuery, abstractionLevel, namespace, isReady, getFilteredElements, centeredNodeId]);

  // Center on node when centeredNodeId changes (no relayout)
  useEffect(() => {
    if (!cyRef.current || !isReady || !centeredNodeId) return;
    const node = cyRef.current.getElementById(centeredNodeId);
    if (node.length > 0) {
      cyRef.current.center(node);
      node.addClass('current');
    }
  }, [centeredNodeId, isReady]);

  // Snap to grid on drag end when snapToGrid is enabled
  const GRID_SIZE = 20;
  useEffect(() => {
    if (!cyRef.current || !isReady || !snapToGrid) return;
    const cy = cyRef.current;
    const handleFree = (ev: EventObject) => {
      const node = ev.target;
      if (!node.isNode()) return;
      const pos = node.position();
      node.position({
        x: Math.round(pos.x / GRID_SIZE) * GRID_SIZE,
        y: Math.round(pos.y / GRID_SIZE) * GRID_SIZE,
      });
    };
    cy.on('free', handleFree);
    return () => { cy.off('free', handleFree); };
  }, [isReady, snapToGrid]);

  // Heatmap mode (when no overlay) or overlay mode
  useEffect(() => {
    if (!cyRef.current || !isReady) return;
    const cy = cyRef.current;

    cy.batch(() => {
      cy.nodes().removeClass('heatmap-green heatmap-yellow heatmap-orange heatmap-red overlay-green overlay-yellow overlay-red');

      if (overlayData?.nodeValues) {
        const nodeValues = overlayData.nodeValues;
        cy.nodes().forEach((node: any) => {
          const val = nodeValues.get(node.id());
          if (val === undefined) return;
          if (val >= 70) node.addClass('overlay-green');
          else if (val >= 40) node.addClass('overlay-yellow');
          else node.addClass('overlay-red');
        });
        return;
      }

      if (heatMapMode === 'none') return;

      const nodes = cy.nodes();
      let maxVal = 0;
      nodes.forEach(n => {
        const nodeData = n.data('_nodeData') as TopologyNode | undefined;
        if (!nodeData) return;
        const val = heatMapMode === 'cpu'
          ? (nodeData.computed?.cpuUsage ?? 0)
          : (nodeData.computed?.restartCount ?? 0);
        if (val > maxVal) maxVal = val;
      });

      nodes.forEach(n => {
        const nodeData = n.data('_nodeData') as TopologyNode | undefined;
        if (!nodeData) return;
        const val = heatMapMode === 'cpu'
          ? (nodeData.computed?.cpuUsage ?? 0)
          : (nodeData.computed?.restartCount ?? 0);
        const color = getHeatmapColor(val, maxVal);
        if (color === '#22c55e') n.addClass('heatmap-green');
        else if (color === '#eab308') n.addClass('heatmap-yellow');
        else if (color === '#f97316') n.addClass('heatmap-orange');
        else n.addClass('heatmap-red');
      });
    });
  }, [heatMapMode, overlayData, isReady]);

  // Blast radius overlay
  useEffect(() => {
    if (!cyRef.current || !isReady) return;
    const cy = cyRef.current;

    cy.batch(() => {
      cy.nodes().removeClass('blast-target blast-direct blast-transitive blast-dim');
      cy.edges().removeClass('blast-affected blast-alternative blast-dim');

      if (!blastRadius) return;

      const { affectedNodes, affectedEdges, severity, alternativePathEdges } = blastRadius;
      const allNodeIds = new Set(cy.nodes().map((n: any) => n.id()));

      cy.nodes().forEach((node: any) => {
        const id = node.id();
        if (!affectedNodes.has(id)) {
          node.addClass('blast-dim');
          return;
        }
        const s = severity.get(id) ?? 0;
        if (s >= 99) node.addClass('blast-target');
        else if (s >= 60) node.addClass('blast-direct');
        else node.addClass('blast-transitive');
      });

      cy.edges().forEach((edge: any) => {
        const edgeKey = edge.id();
        if (affectedEdges.has(edgeKey)) {
          edge.addClass('blast-affected');
        } else if (alternativePathEdges?.has(edgeKey)) {
          edge.addClass('blast-alternative');
        } else {
          edge.addClass('blast-dim');
        }
      });
    });
  }, [blastRadius, isReady]);

  // Traffic flow animation
  useEffect(() => {
    if (!cyRef.current || !isReady) return;
    const cy = cyRef.current;

    if (trafficAnimRef.current) {
      cancelAnimationFrame(trafficAnimRef.current);
      trafficAnimRef.current = null;
    }

    if (!trafficFlowEnabled) {
      cy.edges().removeClass('traffic-flow');
      return;
    }

    // Animate traffic on routing/expose edges
    const trafficEdges = cy.edges('[relationshipType="routes"], [relationshipType="exposes"], [relationshipType="selects"]');
    let step = 0;

    function animate() {
      step++;
      const batchSize = Math.ceil(trafficEdges.length / 3);
      cy.batch(() => {
        trafficEdges.removeClass('traffic-flow');
        const offset = step % 3;
        for (let i = offset * batchSize; i < Math.min((offset + 1) * batchSize, trafficEdges.length); i++) {
          trafficEdges[i]?.addClass('traffic-flow');
        }
      });
      trafficAnimRef.current = requestAnimationFrame(() => {
        setTimeout(animate, 600);
      });
    }
    animate();

    return () => {
      if (trafficAnimRef.current) cancelAnimationFrame(trafficAnimRef.current);
    };
  }, [trafficFlowEnabled, isReady]);

  // Minimap rendering
  const updateMinimap = useCallback(() => {
    if (!cyRef.current || !minimapRef.current) return;
    const cy = cyRef.current;
    const canvas = minimapRef.current.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, w, h);

    const bb = cy.elements().boundingBox();
    if (bb.w === 0 || bb.h === 0) return;
    const scale = Math.min(w / bb.w, h / bb.h) * 0.85;
    const ox = (w - bb.w * scale) / 2 - bb.x1 * scale;
    const oy = (h - bb.h * scale) / 2 - bb.y1 * scale;
    minimapTransformRef.current = { scale, ox, oy };

    // Draw edges
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.5;
    cy.edges().forEach(e => {
      const sp = e.sourceEndpoint();
      const tp = e.targetEndpoint();
      ctx.beginPath();
      ctx.moveTo(sp.x * scale + ox, sp.y * scale + oy);
      ctx.lineTo(tp.x * scale + ox, tp.y * scale + oy);
      ctx.stroke();
    });

    // Draw nodes
    cy.nodes().forEach(n => {
      const pos = n.position();
      const color = n.data('bgColor') || '#6b7280';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x * scale + ox, pos.y * scale + oy, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Viewport rectangle
    const ext = cy.extent();
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      ext.x1 * scale + ox,
      ext.y1 * scale + oy,
      ext.w * scale,
      ext.h * scale
    );
  }, []);

  // Update minimap on viewport changes
  useEffect(() => {
    if (!cyRef.current || !isReady) return;
    const cy = cyRef.current;
    const handler = () => requestAnimationFrame(updateMinimap);
    cy.on('viewport', handler);
    cy.on('layoutstop', handler);
    return () => {
      cy.off('viewport', handler);
      cy.off('layoutstop', handler);
    };
  }, [isReady, updateMinimap]);

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      cyRef.current?.zoom(cyRef.current.zoom() * 1.3);
      cyRef.current?.center();
    },
    zoomOut: () => {
      cyRef.current?.zoom(cyRef.current.zoom() / 1.3);
      cyRef.current?.center();
    },
    fitToScreen: () => { cyRef.current?.fit(undefined, 50); },
    resetView: () => {
      cyRef.current?.zoom(1);
      cyRef.current?.center();
    },
    exportAsSVG: () => {
      if (!cyRef.current) return;
      try { return (cyRef.current as any).svg({ full: true, scale: 2 }); } catch { return undefined; }
    },
    exportAsPNG: () => {
      if (!cyRef.current) return;
      // Cap scale so canvas stays within browser limits (~32767px max dimension)
      const bb = cyRef.current.elements().boundingBox();
      const maxDim = Math.max(bb.w, bb.h);
      const maxCanvasPx = 30000;
      const safeScale = maxDim > 0 ? Math.min(2, maxCanvasPx / maxDim) : 2;
      return cyRef.current.png({ full: true, scale: Math.max(1, safeScale), bg: '#ffffff' });
    },
    exportAsPDF: (filename?: string) => {
      if (cyRef.current) {
        downloadPDF(cyRef.current, filename ?? `topology-${new Date().toISOString().slice(0, 10)}.pdf`);
      }
    },
    relayout: () => {
      if (cyRef.current) applyELKLayout(cyRef.current);
    },
    getNodeCount: () => cyRef.current?.nodes().length || 0,
    getEdgeCount: () => cyRef.current?.edges().length || 0,
  }));

  // Keyboard shortcuts: F fit, R reset, Escape clear, Arrow pan, +/- zoom, Enter open selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!cyRef.current) return;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;
      switch (e.key) {
        case 'f': case 'F':
          if (!e.metaKey && !e.ctrlKey) cyRef.current.fit(undefined, 50);
          break;
        case 'r': case 'R':
          if (!e.metaKey && !e.ctrlKey) { cyRef.current.zoom(1); cyRef.current.center(); }
          break;
        case 'Escape':
          onNodeSelect?.(null);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          cyRef.current.pan(cyRef.current.pan().x + 80);
          break;
        case 'ArrowRight':
          e.preventDefault();
          cyRef.current.pan(cyRef.current.pan().x - 80);
          break;
        case 'ArrowUp':
          e.preventDefault();
          cyRef.current.pan(cyRef.current.pan().y + 80);
          break;
        case 'ArrowDown':
          e.preventDefault();
          cyRef.current.pan(cyRef.current.pan().y - 80);
          break;
        case '+': case '=':
          e.preventDefault();
          cyRef.current.zoom(cyRef.current.zoom() * 1.2);
          break;
        case '-':
          e.preventDefault();
          cyRef.current.zoom(cyRef.current.zoom() / 1.2);
          break;
        case 'Enter': {
          e.preventDefault();
          const sel = cyRef.current.elements(':selected');
          if (sel.length > 0) {
            const node = sel[0];
            const data = node.data('_nodeData');
            if (data) onNodeSelect?.(data);
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNodeSelect]);

  // Update the virtual scrollbar position based on Cytoscape viewport vs graph extent
  const updateScrollbar = useCallback(() => {
    if (!cyRef.current) { setScrollInfo(null); return; }
    const cy = cyRef.current;
    const bb = cy.elements().boundingBox();
    if (!bb || bb.h === 0) { setScrollInfo(null); return; }
    const ext = cy.extent();
    const zoom = cy.zoom();
    const graphH = bb.h * zoom;
    const viewH = ext.h * zoom;
    if (graphH <= viewH * 1.05) { setScrollInfo(null); return; } // graph fits, no scrollbar needed
    const thumbRatio = Math.min(viewH / graphH, 1);
    const scrollRange = graphH - viewH;
    const currentOffset = (ext.y1 - bb.y1) * zoom;
    const thumbTop = scrollRange > 0 ? currentOffset / scrollRange : 0;
    setScrollInfo({ thumbRatio, thumbTop: Math.max(0, Math.min(1, thumbTop)) });
  }, []);

  // Sync scrollbar on viewport changes
  useEffect(() => {
    if (!cyRef.current || !isReady) return;
    const cy = cyRef.current;
    const handler = () => requestAnimationFrame(updateScrollbar);
    cy.on('viewport', handler);
    cy.on('layoutstop', handler);
    return () => { cy.off('viewport', handler); cy.off('layoutstop', handler); };
  }, [isReady, updateScrollbar]);

  // Wheel on canvas → vertical pan (not zoom) so user can scroll through topology
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cyRef.current) return;
    const cy = cyRef.current;
    const handleWheel = (e: WheelEvent) => {
      // Only intercept vertical scroll; let horizontal and pinch-zoom (ctrl/meta) through
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX) || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation(); // prevent Cytoscape from zooming
      const pan = cy.pan();
      cy.pan({ x: pan.x, y: pan.y - e.deltaY });
    };
    // Use capture phase so we intercept before Cytoscape's internal wheel-zoom handler
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => container.removeEventListener('wheel', handleWheel, { capture: true });
  }, [isReady]);

  // Scrollbar drag handler
  const handleScrollbarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingScroll.current = true;
    const track = scrollTrackRef.current;
    if (!track || !cyRef.current) return;
    const cy = cyRef.current;
    const bb = cy.elements().boundingBox();
    const trackRect = track.getBoundingClientRect();
    const trackH = trackRect.height;

    const onMove = (me: MouseEvent) => {
      if (!isDraggingScroll.current) return;
      const relY = Math.max(0, Math.min(1, (me.clientY - trackRect.top) / trackH));
      const zoom = cy.zoom();
      const ext = cy.extent();
      const targetY = bb.y1 + relY * (bb.h - ext.h / zoom);
      cy.pan({ x: cy.pan().x, y: -(targetY * zoom) + (containerRef.current?.clientHeight || 0) / 2 });
    };
    const onUp = () => {
      isDraggingScroll.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Jump to clicked position immediately
    onMove(e.nativeEvent);
  }, []);

  return (
    <div className={cn('relative w-full h-full rounded-xl overflow-hidden border border-border', className)}
         style={{ background: CANVAS_BG }}>
      <div
        ref={containerRef}
        className="w-full h-full"
        role="application"
        aria-label="Kubernetes topology graph"
        tabIndex={0}
      />

      {/* Virtual vertical scrollbar — right edge */}
      {scrollInfo && (
        <div
          ref={scrollTrackRef}
          className="absolute top-2 right-1 bottom-2 w-2.5 rounded-full bg-black/10 cursor-pointer z-10"
          onMouseDown={handleScrollbarMouseDown}
        >
          <div
            className="absolute w-full rounded-full bg-muted-foreground/50 hover:bg-muted-foreground/70 transition-colors min-h-[24px]"
            style={{
              top: `${scrollInfo.thumbTop * (1 - scrollInfo.thumbRatio) * 100}%`,
              height: `${Math.max(scrollInfo.thumbRatio * 100, 5)}%`,
            }}
          />
        </div>
      )}

      {/* Minimap (click to jump) */}
      <div
        ref={minimapRef}
        className="absolute bottom-3 right-3 w-[160px] h-[100px] rounded-lg border border-border bg-background/90 backdrop-blur-sm shadow-lg overflow-hidden cursor-pointer"
        role="button"
        tabIndex={0}
        aria-label="Minimap – click to pan view"
        onClick={(e) => {
          if (!cyRef.current || !minimapRef.current || !minimapTransformRef.current) return;
          const canvas = minimapRef.current.querySelector('canvas');
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const scale = minimapTransformRef.current.scale;
          const ox = minimapTransformRef.current.ox;
          const oy = minimapTransformRef.current.oy;
          const clickX = e.clientX - rect.left;
          const clickY = e.clientY - rect.top;
          const graphX = (clickX - ox) / scale;
          const graphY = (clickY - oy) / scale;
          const cy = cyRef.current;
          const zoom = cy.zoom();
          const container = containerRef.current;
          const cw = container?.clientWidth ?? 400;
          const ch = container?.clientHeight ?? 300;
          cy.pan({ x: -graphX * zoom + cw / 2, y: -graphY * zoom + ch / 2 });
        }}
      >
        <canvas width={160} height={100} className="w-full h-full" />
        <div className="absolute top-1 left-1.5 text-[8px] font-semibold text-muted-foreground/60 uppercase tracking-wider pointer-events-none">
          Minimap
        </div>
      </div>

      {/* Pause indicator */}
      {isPaused && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-500/10 text-amber-700 border border-amber-500/20 px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          Updates Paused (Space to Resume)
        </div>
      )}
    </div>
  );
});

TopologyCanvas.displayName = 'TopologyCanvas';
export default TopologyCanvas;
