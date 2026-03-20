/**
 * Node type registry for AGT ReactFlow nodes.
 * Re-exports the NODE_TYPES and AGTNodeData from the main AGTView.
 * 
 * NOTE: Node components remain in AGTView.tsx for now to avoid
 * a massive multi-file refactor in one step. This file provides
 * the type export and will serve as the extraction point for
 * individual node component files in a future refactor pass.
 */
import type { TopologyNode } from '../../types/topology.types';

export type AGTNodeData = {
  topologyNode: TopologyNode;
  selected?: boolean;
};
