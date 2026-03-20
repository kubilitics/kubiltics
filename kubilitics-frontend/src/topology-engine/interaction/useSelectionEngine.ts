/**
 * Selection Engine – Node click/tap selection management
 */
import { useCallback } from 'react';
import type { Core, EventObject, NodeSingular } from 'cytoscape';
import type { TopologyNode } from '../types/topology.types';

export interface SelectionEngineOptions {
  onNodeSelect?: (node: TopologyNode | null) => void;
  onNodeDoubleClick?: (node: TopologyNode) => void;
}

export function useSelectionEngine(options: SelectionEngineOptions = {}) {
  const attachListeners = useCallback((cy: Core) => {
    // Single click – select node
    cy.on('tap', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular;
      const nodeData = node.data('_nodeData') as TopologyNode | undefined;
      if (nodeData) {
        options.onNodeSelect?.(nodeData);
      }
    });

    // Click on background – deselect
    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) {
        options.onNodeSelect?.(null);
      }
    });

    // Double click – navigate to detail
    cy.on('dblclick', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular;
      const nodeData = node.data('_nodeData') as TopologyNode | undefined;
      if (nodeData) {
        options.onNodeDoubleClick?.(nodeData);
      }
    });
  }, [options]);

  const selectNode = useCallback((cy: Core, nodeId: string | null) => {
    cy.elements().unselect();
    if (nodeId) {
      const node = cy.getElementById(nodeId);
      if (node.length > 0) node.select();
    }
  }, []);

  return { attachListeners, selectNode };
}
