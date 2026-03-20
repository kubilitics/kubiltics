/**
 * Highlight Engine – World-class hover highlighting
 * <16ms response time. No re-layout. Style mutation only.
 *
 * On hover:
 * - Hovered node: scale 1.1x, glow, high contrast
 * - Parents + children: full opacity, thicker edges, slight glow
 * - Unrelated nodes: opacity 0.12, desaturated
 * - Unrelated edges: opacity 0.06
 */
import { useCallback, useRef } from 'react';
import type { Core, EventObject, NodeSingular } from 'cytoscape';

export interface HighlightEngineOptions {
  onNodeHover?: (nodeId: string | null, clientPosition?: { x: number; y: number } | null) => void;
  isPaused?: boolean;
}

export function useHighlightEngine(options: HighlightEngineOptions = {}) {
  const lastHoveredId = useRef<string | null>(null);

  const applyHighlight = useCallback((cy: Core, nodeId: string | null) => {
    if (options.isPaused) return;

    // Performance: batch all class changes
    cy.batch(() => {
      // Clear previous state
      cy.elements().removeClass('faded highlighted hovered');

      if (!nodeId) {
        lastHoveredId.current = null;
        return;
      }

      lastHoveredId.current = nodeId;
      const hoveredNode = cy.getElementById(nodeId);
      if (hoveredNode.length === 0) return;

      // Get immediate neighborhood (connected component 1-hop)
      const neighborhood = hoveredNode.closedNeighborhood();

      // Apply states
      hoveredNode.addClass('hovered');
      neighborhood.addClass('highlighted');
      cy.elements().not(neighborhood).addClass('faded');
    });
  }, [options.isPaused]);

  const clearHighlight = useCallback((cy: Core) => {
    cy.batch(() => {
      cy.elements().removeClass('faded highlighted hovered');
    });
    lastHoveredId.current = null;
  }, []);

  const attachListeners = useCallback((cy: Core, container: HTMLElement) => {
    cy.on('mouseover', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular;
      const nodeId = node.id();
      applyHighlight(cy, nodeId);
      container.style.cursor = 'pointer';
      const pos = node.renderedPosition();
      const rect = container.getBoundingClientRect();
      const clientPosition = { x: rect.left + pos.x, y: rect.top + pos.y };
      options.onNodeHover?.(nodeId, clientPosition);
    });

    cy.on('mouseout', 'node', () => {
      clearHighlight(cy);
      container.style.cursor = 'default';
      options.onNodeHover?.(null, null);
    });
  }, [applyHighlight, clearHighlight, options]);

  return { applyHighlight, clearHighlight, attachListeners };
}
