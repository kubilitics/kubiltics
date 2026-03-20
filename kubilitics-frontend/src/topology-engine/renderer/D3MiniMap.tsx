import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Map, X } from 'lucide-react';

interface D3MiniMapProps {
  svgRef: React.RefObject<SVGSVGElement>;
  containerDimensions: { width: number; height: number };
  className?: string;
  onClose?: () => void;
}

export function D3MiniMap({ 
  svgRef, 
  containerDimensions,
  className,
  onClose 
}: D3MiniMapProps) {
  const miniMapRef = useRef<HTMLCanvasElement>(null);
  const [viewportRect, setViewportRect] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [isDragging, setIsDragging] = useState(false);

  const miniMapWidth = 200;
  const miniMapHeight = 150;

  // Update mini-map and viewport indicator
  useEffect(() => {
    if (!svgRef.current || !miniMapRef.current) return;

    const svg = svgRef.current;
    const canvas = miniMapRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updateMiniMap = () => {
      // Clear canvas
      ctx.clearRect(0, 0, miniMapWidth, miniMapHeight);

      // Get the topology container
      const container = svg.querySelector('.topology-container') as SVGGElement;
      if (!container) return;

      const bounds = container.getBBox();
      if (bounds.width === 0 || bounds.height === 0) return;

      // Calculate scale to fit content in mini-map
      const padding = 10;
      const scaleX = (miniMapWidth - padding * 2) / bounds.width;
      const scaleY = (miniMapHeight - padding * 2) / bounds.height;
      const scale = Math.min(scaleX, scaleY, 0.1); // Limit max scale

      // Draw background
      ctx.fillStyle = 'hsl(var(--muted) / 0.3)';
      ctx.fillRect(0, 0, miniMapWidth, miniMapHeight);

      // Draw nodes
      const nodes = container.querySelectorAll('.node');
      nodes.forEach((node) => {
        const transform = node.getAttribute('transform');
        if (!transform) return;

        const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
        if (!match) return;

        const x = (parseFloat(match[1]) - bounds.x) * scale + padding;
        const y = (parseFloat(match[2]) - bounds.y) * scale + padding;

        // Get node color from the circle
        const circle = node.querySelector('.node-circle') as SVGCircleElement;
        const color = circle?.getAttribute('fill') || 'hsl(var(--primary))';

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      // Draw edges
      const edges = container.querySelectorAll('.links line');
      ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)';
      ctx.lineWidth = 0.5;
      edges.forEach((edge) => {
        const x1 = ((parseFloat(edge.getAttribute('x1') || '0') - bounds.x) * scale) + padding;
        const y1 = ((parseFloat(edge.getAttribute('y1') || '0') - bounds.y) * scale) + padding;
        const x2 = ((parseFloat(edge.getAttribute('x2') || '0') - bounds.x) * scale) + padding;
        const y2 = ((parseFloat(edge.getAttribute('y2') || '0') - bounds.y) * scale) + padding;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      // Calculate viewport rectangle
      const currentTransform = d3.zoomTransform(svg);
      const viewportWidth = containerDimensions.width / currentTransform.k;
      const viewportHeight = containerDimensions.height / currentTransform.k;
      const viewportX = -currentTransform.x / currentTransform.k;
      const viewportY = -currentTransform.y / currentTransform.k;

      // Transform viewport to mini-map coordinates
      const vpX = ((viewportX - bounds.x) * scale) + padding;
      const vpY = ((viewportY - bounds.y) * scale) + padding;
      const vpWidth = viewportWidth * scale;
      const vpHeight = viewportHeight * scale;

      setViewportRect({
        x: Math.max(0, vpX),
        y: Math.max(0, vpY),
        width: Math.min(miniMapWidth, vpWidth),
        height: Math.min(miniMapHeight, vpHeight),
      });

      // Draw viewport rectangle
      ctx.strokeStyle = 'hsl(var(--primary))';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.max(0, vpX),
        Math.max(0, vpY),
        Math.min(miniMapWidth - vpX, vpWidth),
        Math.min(miniMapHeight - vpY, vpHeight)
      );
    };

    // Initial update
    updateMiniMap();

    // Set up observer for changes
    const observer = new MutationObserver(updateMiniMap);
    observer.observe(svg, { 
      subtree: true, 
      attributes: true, 
      attributeFilter: ['transform', 'x1', 'y1', 'x2', 'y2'] 
    });

    // Also listen for zoom events
    const handleZoom = () => updateMiniMap();
    svg.addEventListener('wheel', handleZoom);
    
    // Update periodically for simulation movements
    const interval = setInterval(updateMiniMap, 100);

    return () => {
      observer.disconnect();
      svg.removeEventListener('wheel', handleZoom);
      clearInterval(interval);
    };
  }, [svgRef, containerDimensions]);

  // Handle click to navigate
  const handleMiniMapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!svgRef.current || !miniMapRef.current) return;

    const svg = svgRef.current;
    const canvas = miniMapRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Get the topology container bounds
    const container = svg.querySelector('.topology-container') as SVGGElement;
    if (!container) return;

    const bounds = container.getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    // Calculate scale
    const padding = 10;
    const scaleX = (miniMapWidth - padding * 2) / bounds.width;
    const scaleY = (miniMapHeight - padding * 2) / bounds.height;
    const scale = Math.min(scaleX, scaleY, 0.1);

    // Convert click to SVG coordinates
    const svgX = (clickX - padding) / scale + bounds.x;
    const svgY = (clickY - padding) / scale + bounds.y;

    // Pan to center on clicked point
    const currentTransform = d3.zoomTransform(svg);
    const newX = -(svgX * currentTransform.k - containerDimensions.width / 2);
    const newY = -(svgY * currentTransform.k - containerDimensions.height / 2);

    const newTransform = d3.zoomIdentity
      .translate(newX, newY)
      .scale(currentTransform.k);

    d3.select(svg)
      .transition()
      .duration(300)
      .call(d3.zoom<SVGSVGElement, unknown>().transform as any, newTransform);
  }, [svgRef, containerDimensions]);

  return (
    <div 
      className={cn(
        'absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm rounded-lg border border-border shadow-lg overflow-hidden z-20',
        className
      )}
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-muted/50">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Map className="h-3 w-3" />
          Mini-map
        </div>
        {onClose && (
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-5 w-5" 
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <canvas
        ref={miniMapRef}
        width={miniMapWidth}
        height={miniMapHeight}
        className="cursor-pointer"
        onClick={handleMiniMapClick}
      />
    </div>
  );
}
