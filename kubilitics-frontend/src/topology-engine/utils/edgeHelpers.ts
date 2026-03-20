/**
 * Edge Helpers – Utility functions for topology edges
 */
import type { TopologyEdge } from '../types/topology.types';

/**
 * Build Cytoscape element data from a TopologyEdge
 * Edge label is displayed along the edge for relationship clarity
 */
export function toCytoscapeEdgeData(edge: TopologyEdge) {
  return {
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      relationshipType: edge.relationshipType,
      traffic: edge.traffic,
    },
  };
}

/**
 * Relationship type display labels and colors
 */
export const RELATIONSHIP_CONFIG: Record<string, { label: string; color: string; style: string; description: string }> = {
  owns:         { label: 'Owns', color: '#64748b', style: 'solid', description: 'Parent owns this child resource' },
  selects:      { label: 'Selects', color: '#a1a1aa', style: 'dashed', description: 'Label selector match' },
  exposes:      { label: 'Exposes', color: '#10b981', style: 'solid', description: 'Exposes via network endpoint' },
  routes:       { label: 'Routes', color: '#10b981', style: 'solid', description: 'Routes traffic to target' },
  scheduled_on: { label: 'Scheduled On', color: '#f97316', style: 'solid', description: 'Scheduled on this node' },
  runs:         { label: 'Runs', color: '#f97316', style: 'solid', description: 'Runs on this resource' },
  mounts:       { label: 'Mounts', color: '#14b8a6', style: 'dotted', description: 'Mounts volume from source' },
  stores:       { label: 'Stores', color: '#14b8a6', style: 'dotted', description: 'Stores data in target' },
  backed_by:    { label: 'Backed By', color: '#14b8a6', style: 'dotted', description: 'Provisioned by storage class' },
  references:   { label: 'References', color: '#f59e0b', style: 'dashed', description: 'References configuration' },
  configures:   { label: 'Configures', color: '#f59e0b', style: 'dashed', description: 'Configures target resource' },
  contains:     { label: 'Contains', color: '#a78bfa', style: 'dashed', description: 'Namespace contains resource' },
  permits:      { label: 'Permits', color: '#f43f5e', style: 'dashed', description: 'Grants access permissions' },
  limits:       { label: 'Limits', color: '#78716c', style: 'dashed', description: 'Applies resource limits' },
  manages:      { label: 'Manages', color: '#0ea5e9', style: 'solid', description: 'Manages scaling/lifecycle' },
};
