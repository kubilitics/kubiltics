import type cytoscape from 'cytoscape';

export type HighlightLevel = 'none' | 'hover' | 'selection' | 'search' | 'path' | 'blast-radius';

export interface HighlightState {
  hoveredNode: string | null;
  selectedNodes: Set<string>;
  searchResults: Set<string>;
  pathNodes: Set<string>;
  pathEdges: Set<string>;
  blastRadiusNodes: Set<string>;
  blastRadiusEdges: Set<string>;
}

/**
 * HighlightManager - Multi-level highlighting system for Cytoscape
 *
 * Manages 5 levels of highlighting with proper visual hierarchy:
 * 1. Hover (lightest) - Subtle glow
 * 2. Selection (light) - Border highlight
 * 3. Search (medium) - Yellow tint
 * 4. Path (strong) - Blue highlight with thicker edges
 * 5. Blast Radius (strongest) - Red/orange gradient with pulsing animation
 */
export class HighlightManager {
  private cy: cytoscape.Core;
  private state: HighlightState;

  constructor(cy: cytoscape.Core) {
    this.cy = cy;
    this.state = {
      hoveredNode: null,
      selectedNodes: new Set(),
      searchResults: new Set(),
      pathNodes: new Set(),
      pathEdges: new Set(),
      blastRadiusNodes: new Set(),
      blastRadiusEdges: new Set(),
    };

    this.setupEventListeners();
  }

  /**
   * Setup hover event listeners
   */
  private setupEventListeners() {
    this.cy.on('mouseover', 'node', (event) => {
      const nodeId = event.target.id();
      this.setHover(nodeId);
    });

    this.cy.on('mouseout', 'node', () => {
      this.clearHover();
    });
  }

  /**
   * Set hover highlight
   */
  setHover(nodeId: string | null) {
    this.state.hoveredNode = nodeId;
    this.applyHighlights();
  }

  /**
   * Clear hover highlight
   */
  clearHover() {
    this.state.hoveredNode = null;
    this.applyHighlights();
  }

  /**
   * Set selection highlight
   */
  setSelection(nodeIds: Set<string>) {
    this.state.selectedNodes = new Set(nodeIds);
    this.applyHighlights();
  }

  /**
   * Add to selection
   */
  addToSelection(nodeId: string) {
    this.state.selectedNodes.add(nodeId);
    this.applyHighlights();
  }

  /**
   * Remove from selection
   */
  removeFromSelection(nodeId: string) {
    this.state.selectedNodes.delete(nodeId);
    this.applyHighlights();
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.state.selectedNodes.clear();
    this.applyHighlights();
  }

  /**
   * Set search results highlight
   */
  setSearchResults(nodeIds: Set<string>) {
    this.state.searchResults = new Set(nodeIds);
    this.applyHighlights();
  }

  /**
   * Clear search results
   */
  clearSearchResults() {
    this.state.searchResults.clear();
    this.applyHighlights();
  }

  /**
   * Set path highlight
   */
  setPath(nodeIds: Set<string>, edgeIds: Set<string>) {
    this.state.pathNodes = new Set(nodeIds);
    this.state.pathEdges = new Set(edgeIds);
    this.applyHighlights();
  }

  /**
   * Clear path highlight
   */
  clearPath() {
    this.state.pathNodes.clear();
    this.state.pathEdges.clear();
    this.applyHighlights();
  }

  /**
   * Set blast radius highlight
   */
  setBlastRadius(nodeIds: Set<string>, edgeIds: Set<string>) {
    this.state.blastRadiusNodes = new Set(nodeIds);
    this.state.blastRadiusEdges = new Set(edgeIds);
    this.applyHighlights();
  }

  /**
   * Clear blast radius highlight
   */
  clearBlastRadius() {
    this.state.blastRadiusNodes.clear();
    this.state.blastRadiusEdges.clear();
    this.applyHighlights();
  }

  /**
   * Clear all highlights
   */
  clearAll() {
    this.state = {
      hoveredNode: null,
      selectedNodes: new Set(),
      searchResults: new Set(),
      pathNodes: new Set(),
      pathEdges: new Set(),
      blastRadiusNodes: new Set(),
      blastRadiusEdges: new Set(),
    };
    this.applyHighlights();
  }

  /**
   * Apply all highlights based on current state
   *
   * Highlights are applied in priority order:
   * blast-radius > path > search > selection > hover > none
   *
   * HOVER BEHAVIOR (Billion Dollar USP Feature):
   * - Hovered node: 'hovered' class (scale + glow)
   * - Immediate parents + children: 'highlighted' class (full opacity)
   * - All other nodes/edges: 'faded' class (opacity 0.15)
   */
  private applyHighlights() {
    // Reset all nodes and edges to default
    this.cy.nodes().removeClass('highlighted hovered hover selected search path blast-radius faded');
    this.cy.edges().removeClass('highlighted path blast-radius faded');

    // Apply highlights in order of priority (lowest to highest)

    // 1. Hover (lowest priority but most visible for immediate parent/child highlighting)
    if (this.state.hoveredNode) {
      const hoveredNode = this.cy.getElementById(this.state.hoveredNode);

      if (hoveredNode.length > 0) {
        // Mark hovered node itself
        hoveredNode.addClass('hovered');

        // Get immediate neighborhood (connected parents, children, and edges)
        const neighborhood = hoveredNode.closedNeighborhood();

        // Highlight the entire neighborhood
        neighborhood.addClass('highlighted');

        // Fade everything that's not in the neighborhood
        this.cy.elements().not(neighborhood).addClass('faded');
      }
    }

    // 2. Selection
    this.state.selectedNodes.forEach(nodeId => {
      this.cy.getElementById(nodeId).addClass('selected');
    });

    // 3. Search results
    this.state.searchResults.forEach(nodeId => {
      this.cy.getElementById(nodeId).addClass('search');
    });

    // 4. Path
    this.state.pathNodes.forEach(nodeId => {
      this.cy.getElementById(nodeId).addClass('path');
    });
    this.state.pathEdges.forEach(edgeId => {
      // Edge ID format: "source-target"
      const edge = this.cy.edges().filter((ele) => {
        const source = ele.source().id();
        const target = ele.target().id();
        return `${source}-${target}` === edgeId;
      });
      edge.addClass('path');
    });

    // 5. Blast radius (highest priority)
    this.state.blastRadiusNodes.forEach(nodeId => {
      this.cy.getElementById(nodeId).addClass('blast-radius');
    });
    this.state.blastRadiusEdges.forEach(edgeId => {
      const edge = this.cy.edges().filter((ele) => {
        const source = ele.source().id();
        const target = ele.target().id();
        return `${source}-${target}` === edgeId;
      });
      edge.addClass('blast-radius');
    });

    // Dim non-highlighted elements when we have selection/search/path/blast-radius active
    // (But NOT for hover - hover uses 'faded' class directly)
    const hasHighlights =
      this.state.selectedNodes.size > 0 ||
      this.state.searchResults.size > 0 ||
      this.state.pathNodes.size > 0 ||
      this.state.blastRadiusNodes.size > 0;

    if (hasHighlights) {
      // Dim all elements
      this.cy.elements().addClass('dimmed');

      // Un-dim highlighted elements
      this.cy.elements('.hovered, .highlighted, .selected, .search, .path, .blast-radius').removeClass('dimmed');

      // Un-dim connected edges for highlighted nodes
      const highlightedNodes = this.cy.nodes('.hovered, .highlighted, .selected, .search, .path, .blast-radius');
      highlightedNodes.connectedEdges().removeClass('dimmed');
    } else if (!this.state.hoveredNode) {
      // Remove dimming when no highlights (and no hover)
      this.cy.elements().removeClass('dimmed');
    }
  }

  /**
   * Get highlight level for a node
   */
  getHighlightLevel(nodeId: string): HighlightLevel {
    if (this.state.blastRadiusNodes.has(nodeId)) return 'blast-radius';
    if (this.state.pathNodes.has(nodeId)) return 'path';
    if (this.state.searchResults.has(nodeId)) return 'search';
    if (this.state.selectedNodes.has(nodeId)) return 'selection';
    if (this.state.hoveredNode === nodeId) return 'hover';
    return 'none';
  }

  /**
   * Get current state
   */
  getState(): HighlightState {
    return { ...this.state };
  }
}

/**
 * Generate Cytoscape stylesheet with highlight classes
 */
export function getHighlightStylesheet(): cytoscape.Stylesheet[] {
  return [
    // DEFAULT DIMMED STATE (for selection/search/path/blast-radius)
    {
      selector: '.dimmed',
      style: {
        opacity: 0.3,
      },
    },

    // FADED STATE (for hover - everything except neighborhood)
    {
      selector: '.faded',
      style: {
        opacity: 0.15,
      },
    },

    // HOVERED NODE (the actual node being hovered) - 5px blue border per PRD 7.2
    {
      selector: 'node.hovered',
      style: {
        'border-width': 5,
        'border-color': '#3B82F6',
        'border-opacity': 1.0,
        'overlay-opacity': 0.3,
        'overlay-color': '#3B82F6',
        'overlay-padding': 6,
        // Scale effect (Cytoscape doesn't support transform, use width/height multiplier)
        width: 'data(originalWidth)' as any || 66, // 1.1x scale (60 -> 66)
        height: 'data(originalHeight)' as any || 66,
      },
    },

    // HIGHLIGHTED NODES (immediate parents + children of hovered node)
    {
      selector: 'node.highlighted',
      style: {
        opacity: 1.0,
        'border-width': 3,
        'border-color': '#60A5FA',
        'border-opacity': 0.7,
      },
    },

    // HIGHLIGHTED EDGES (edges connecting to hovered node)
    {
      selector: 'edge.highlighted',
      style: {
        opacity: 1.0,
        width: 3,
        'line-color': '#60A5FA',
        'target-arrow-color': '#60A5FA',
      },
    },

    // Legacy hover class (kept for backward compatibility)
    {
      selector: 'node.hover',
      style: {
        'border-width': 3,
        'border-color': '#64B5F6',
        'border-opacity': 0.8,
      },
    },

    // Selection highlight (5px border + shadow - PRD Section 7.3 Task 4.4)
    {
      selector: 'node.selected',
      style: {
        'border-width': 5,
        'border-color': '#2563eb',
        'border-opacity': 1.0,
        'overlay-opacity': 0.2,
        'overlay-color': '#2563eb',
        'overlay-padding': 4,
        'shadow-blur': 20,
        'shadow-color': 'rgba(37, 99, 235, 0.4)',
        'shadow-opacity': 1,
      },
    },

    // Search results highlight (yellow tint)
    {
      selector: 'node.search',
      style: {
        'border-width': 4,
        'border-color': '#FFC107',
        'border-opacity': 1.0,
        'overlay-opacity': 0.3,
        'overlay-color': '#FFC107',
        'overlay-padding': 6,
      },
    },

    // Path highlight (blue with thick edges)
    {
      selector: 'node.path',
      style: {
        'border-width': 5,
        'border-color': '#1976D2',
        'border-opacity': 1.0,
        'overlay-opacity': 0.4,
        'overlay-color': '#1976D2',
        'overlay-padding': 8,
      },
    },

    {
      selector: 'edge.path',
      style: {
        width: 4,
        'line-color': '#1976D2',
        'target-arrow-color': '#1976D2',
        opacity: 1.0,
      },
    },

    // Blast radius highlight (red/orange gradient with animation)
    {
      selector: 'node.blast-radius',
      style: {
        'border-width': 6,
        'border-color': '#E53935',
        'border-opacity': 1.0,
        'overlay-opacity': 0.5,
        'overlay-color': '#E53935',
        'overlay-padding': 10,
        // Note: Pulsing animation would be added via CSS animation or JS
      },
    },

    {
      selector: 'edge.blast-radius',
      style: {
        width: 5,
        'line-color': '#FF5722',
        'target-arrow-color': '#FF5722',
        opacity: 1.0,
      },
    },
  ];
}
