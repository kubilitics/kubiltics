/**
 * NamespaceHull — Convex hull polygons around namespace clusters
 *
 * Uses d3.polygonHull() to compute hulls, renders as SVG paths
 * that sync with the ReactFlow viewport transform.
 */

import { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import * as d3 from 'd3';

interface NodePosition {
  id: string;
  namespace: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NamespaceHullProps {
  nodePositions: NodePosition[];
  enabled: boolean;
}

// Namespace-based color palette (consistent with CATEGORY_COLORS)
const HULL_COLORS = [
  '#5A8ED9', '#38A89C', '#C08E4E', '#9472C8', '#4A96C0',
  '#C07840', '#6B72C4', '#7B5EC0', '#B85252', '#40A882',
];

function getHullColor(index: number): string {
  return HULL_COLORS[index % HULL_COLORS.length];
}

// Expand hull points by padding
function expandHullPoints(
  points: [number, number][],
  padding: number,
): [number, number][] {
  if (points.length < 3) return points;

  // Compute centroid
  let cx = 0, cy = 0;
  for (const [px, py] of points) {
    cx += px;
    cy += py;
  }
  cx /= points.length;
  cy /= points.length;

  // Push each point outward from centroid
  return points.map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return [px + padding, py] as [number, number];
    const scale = (dist + padding) / dist;
    return [cx + dx * scale, cy + dy * scale] as [number, number];
  });
}

// Generate smooth rounded path from hull points
function hullPath(points: [number, number][]): string {
  if (points.length < 3) return '';

  // Use cardinal closed curve for smooth hull boundary
  const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
  return line(points) || '';
}

export default function NamespaceHull({ nodePositions, enabled }: NamespaceHullProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();

  const hulls = useMemo(() => {
    if (!enabled || nodePositions.length === 0) return [];

    // Group nodes by namespace
    const byNamespace = new Map<string, [number, number][]>();
    for (const node of nodePositions) {
      const ns = node.namespace;
      if (!ns) continue;

      if (!byNamespace.has(ns)) byNamespace.set(ns, []);
      const pts = byNamespace.get(ns)!;

      // Use node corners for better hull coverage
      const hw = node.width / 2;
      const hh = node.height / 2;
      pts.push(
        [node.x, node.y],
        [node.x + node.width, node.y],
        [node.x, node.y + node.height],
        [node.x + node.width, node.y + node.height],
      );
    }

    // Compute hulls
    const result: { namespace: string; path: string; color: string; centroid: [number, number] }[] = [];
    let colorIdx = 0;

    const sortedNamespaces = Array.from(byNamespace.keys()).sort();
    for (const ns of sortedNamespaces) {
      const points = byNamespace.get(ns)!;
      if (points.length < 3) {
        colorIdx++;
        continue;
      }

      const hull = d3.polygonHull(points);
      if (!hull) {
        colorIdx++;
        continue;
      }

      const expanded = expandHullPoints(hull, 30);
      const path = hullPath(expanded);
      const color = getHullColor(colorIdx);

      // Compute centroid for label
      let cx = 0, cy = 0;
      for (const [px, py] of hull) {
        cx += px;
        cy += py;
      }
      cx /= hull.length;
      cy /= hull.length;

      result.push({
        namespace: ns,
        path,
        color,
        centroid: [cx, cy],
      });
      colorIdx++;
    }

    return result;
  }, [nodePositions, enabled]);

  if (!enabled || hulls.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <g transform={`translate(${vpX}, ${vpY}) scale(${zoom})`}>
        {hulls.map(({ namespace, path, color, centroid }) => (
          <g key={namespace}>
            {/* Hull fill */}
            <path
              d={path}
              fill={color}
              fillOpacity={0.06}
              stroke={color}
              strokeOpacity={0.15}
              strokeWidth={1.5 / zoom}
            />
            {/* Namespace label */}
            <text
              x={centroid[0]}
              y={centroid[1]}
              textAnchor="middle"
              dominantBaseline="central"
              fill={color}
              fillOpacity={0.35}
              fontSize={Math.max(12, 14 / zoom)}
              fontWeight={600}
              fontFamily='"SF Pro Text", "Inter", system-ui, sans-serif'
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {namespace}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
