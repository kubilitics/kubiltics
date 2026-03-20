/**
 * useZoomLevel — Level-of-Detail controller for AGT nodes
 *
 * Reads the current ReactFlow viewport zoom and returns a LOD tier:
 *   'full'    — zoom > 0.5  → Show full card with all details
 *   'compact' — zoom > 0.25 → Show condensed card (icon + name)
 *   'dot'     — zoom <= 0.25 → Show colored dot only
 *
 * Used by node components to render progressively less detail at lower zoom.
 * This enables smooth rendering of 200+ node graphs.
 */
import { useStore } from '@xyflow/react';

export type LODLevel = 'full' | 'compact' | 'dot';

export function useZoomLevel(): LODLevel {
  const zoom = useStore((state) => state.transform[2]);
  if (zoom > 0.5) return 'full';
  if (zoom > 0.25) return 'compact';
  return 'dot';
}
