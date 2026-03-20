/**
 * incrementalLayout — Updates only changed nodes' positions while preserving
 * existing node positions for unchanged nodes.
 *
 * Uses spring physics for smooth animated position transitions.
 *
 * Usage:
 *   const result = computeIncrementalLayout(previousNodes, nextNodes, edges, options);
 *   // result.nodes has updated positions with spring-interpolated coordinates
 *   // result.animatingNodeIds tells you which nodes are transitioning
 */

import type { Node, Edge } from '@xyflow/react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface SpringConfig {
  /** Spring stiffness (default: 170) */
  stiffness: number;
  /** Damping ratio (default: 26) */
  damping: number;
  /** Mass of the node (default: 1) */
  mass: number;
  /** Velocity threshold to consider animation complete (default: 0.01) */
  restThreshold: number;
}

export interface IncrementalLayoutOptions {
  /** Spring physics config */
  spring?: Partial<SpringConfig>;
  /** Padding between nodes for new node placement (default: 50) */
  nodePadding?: number;
  /** Node dimensions for collision avoidance */
  nodeWidth?: number;
  nodeHeight?: number;
  /** Maximum iterations for force-directed placement of new nodes (default: 50) */
  maxIterations?: number;
  /** Whether to run force simulation on new nodes (default: true) */
  simulateNewNodes?: boolean;
}

export interface SpringState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  settled: boolean;
}

export interface IncrementalLayoutResult {
  /** Nodes with updated positions */
  nodes: Node[];
  /** IDs of nodes that are currently animating */
  animatingNodeIds: Set<string>;
  /** Spring states for ongoing animations (pass back on next call) */
  springStates: Map<string, SpringState>;
  /** IDs of newly added nodes */
  addedNodeIds: Set<string>;
  /** IDs of removed nodes */
  removedNodeIds: Set<string>;
}

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_SPRING: SpringConfig = {
  stiffness: 170,
  damping: 26,
  mass: 1,
  restThreshold: 0.01,
};

const DEFAULT_OPTIONS: Required<IncrementalLayoutOptions> = {
  spring: DEFAULT_SPRING,
  nodePadding: 50,
  nodeWidth: 260,
  nodeHeight: 110,
  maxIterations: 50,
  simulateNewNodes: true,
};

// ─── Spring Physics ─────────────────────────────────────────────────────────

/**
 * Advance a spring by one time step using the damped harmonic oscillator model.
 */
function advanceSpring(
  state: SpringState,
  config: SpringConfig,
  dt: number,
): SpringState {
  const dx = state.x - state.targetX;
  const dy = state.y - state.targetY;

  // Spring force: F = -k * displacement
  const fx = -config.stiffness * dx;
  const fy = -config.stiffness * dy;

  // Damping force: F = -c * velocity
  const dampX = -config.damping * state.vx;
  const dampY = -config.damping * state.vy;

  // Acceleration: a = F / mass
  const ax = (fx + dampX) / config.mass;
  const ay = (fy + dampY) / config.mass;

  // Verlet integration
  const newVx = state.vx + ax * dt;
  const newVy = state.vy + ay * dt;
  const newX = state.x + newVx * dt;
  const newY = state.y + newVy * dt;

  // Check if settled
  const speed = Math.sqrt(newVx * newVx + newVy * newVy);
  const displacement = Math.sqrt(
    (newX - state.targetX) ** 2 + (newY - state.targetY) ** 2,
  );
  const settled =
    speed < config.restThreshold && displacement < config.restThreshold;

  return {
    x: settled ? state.targetX : newX,
    y: settled ? state.targetY : newY,
    vx: settled ? 0 : newVx,
    vy: settled ? 0 : newVy,
    targetX: state.targetX,
    targetY: state.targetY,
    settled,
  };
}

/**
 * Run spring simulation for a single node until settled or maxSteps reached.
 */
export function simulateSpring(
  state: SpringState,
  config: SpringConfig,
  maxSteps = 300,
  dt = 1 / 60,
): SpringState {
  let current = state;
  for (let i = 0; i < maxSteps; i++) {
    current = advanceSpring(current, config, dt);
    if (current.settled) break;
  }
  return current;
}

// ─── New Node Placement ─────────────────────────────────────────────────────

/**
 * Find optimal positions for newly added nodes using a simple force-directed approach.
 * New nodes are placed near their neighbors (connected nodes) to minimize edge lengths.
 */
function placeNewNodes(
  newNodeIds: string[],
  existingPositions: Map<string, LayoutPosition>,
  edges: Edge[],
  options: Required<IncrementalLayoutOptions>,
): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();

  for (const nodeId of newNodeIds) {
    // Find connected nodes that already have positions
    const neighbors: LayoutPosition[] = [];
    for (const edge of edges) {
      if (edge.source === nodeId && existingPositions.has(edge.target)) {
        neighbors.push(existingPositions.get(edge.target)!);
      }
      if (edge.target === nodeId && existingPositions.has(edge.source)) {
        neighbors.push(existingPositions.get(edge.source)!);
      }
    }

    let pos: LayoutPosition;

    if (neighbors.length > 0) {
      // Place near centroid of neighbors
      const cx = neighbors.reduce((sum, n) => sum + n.x, 0) / neighbors.length;
      const cy = neighbors.reduce((sum, n) => sum + n.y, 0) / neighbors.length;
      // Offset slightly to avoid exact overlap
      const angle = Math.random() * Math.PI * 2;
      const offset = options.nodePadding + options.nodeWidth * 0.5;
      pos = {
        x: cx + Math.cos(angle) * offset,
        y: cy + Math.sin(angle) * offset,
      };
    } else {
      // No neighbors: place in next available grid position
      const allPositions = [...existingPositions.values(), ...positions.values()];
      pos = findEmptyGridPosition(
        allPositions,
        options.nodeWidth,
        options.nodeHeight,
        options.nodePadding,
      );
    }

    positions.set(nodeId, pos);
    existingPositions.set(nodeId, pos); // Track for next new node's neighbor lookup
  }

  // Optional: run force simulation to improve placement
  if (options.simulateNewNodes && newNodeIds.length > 1) {
    refinePositionsWithForce(
      newNodeIds,
      positions,
      existingPositions,
      edges,
      options,
    );
  }

  return positions;
}

/**
 * Find an empty grid position that doesn't overlap existing nodes.
 */
function findEmptyGridPosition(
  existing: LayoutPosition[],
  nodeWidth: number,
  nodeHeight: number,
  padding: number,
): LayoutPosition {
  const cellW = nodeWidth + padding;
  const cellH = nodeHeight + padding;
  const cols = Math.ceil(Math.sqrt(existing.length + 1));

  // Try positions in a spiral pattern
  for (let r = 0; r < 50; r++) {
    for (let c = 0; c < cols + r; c++) {
      const candidate = { x: c * cellW, y: r * cellH };
      const overlaps = existing.some(
        (p) =>
          Math.abs(p.x - candidate.x) < cellW &&
          Math.abs(p.y - candidate.y) < cellH,
      );
      if (!overlaps) return candidate;
    }
  }

  // Fallback: place far right
  const maxX = existing.reduce((max, p) => Math.max(max, p.x), 0);
  return { x: maxX + cellW, y: 0 };
}

/**
 * Refine new node positions using a simple force-directed simulation.
 */
function refinePositionsWithForce(
  newNodeIds: string[],
  newPositions: Map<string, LayoutPosition>,
  allPositions: Map<string, LayoutPosition>,
  edges: Edge[],
  options: Required<IncrementalLayoutOptions>,
): void {
  const repulsionStrength = 5000;
  const attractionStrength = 0.01;

  for (let iter = 0; iter < options.maxIterations; iter++) {
    for (const nodeId of newNodeIds) {
      const pos = newPositions.get(nodeId);
      if (!pos) continue;

      let fx = 0;
      let fy = 0;

      // Repulsion from all other nodes
      for (const [otherId, otherPos] of allPositions) {
        if (otherId === nodeId) continue;
        const dx = pos.x - otherPos.x;
        const dy = pos.y - otherPos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 1) continue; // avoid division by zero
        const force = repulsionStrength / distSq;
        const dist = Math.sqrt(distSq);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      // Attraction along edges
      for (const edge of edges) {
        let neighborPos: LayoutPosition | undefined;
        if (edge.source === nodeId) {
          neighborPos = allPositions.get(edge.target);
        } else if (edge.target === nodeId) {
          neighborPos = allPositions.get(edge.source);
        }
        if (!neighborPos) continue;

        const dx = neighborPos.x - pos.x;
        const dy = neighborPos.y - pos.y;
        fx += dx * attractionStrength;
        fy += dy * attractionStrength;
      }

      // Apply force with damping
      const damping = 0.9;
      const newX = pos.x + fx * damping;
      const newY = pos.y + fy * damping;

      newPositions.set(nodeId, { x: newX, y: newY });
      allPositions.set(nodeId, { x: newX, y: newY });
    }
  }
}

// ─── Main Export ────────────────────────────────────────────────────────────

/**
 * Compute incremental layout: only update changed nodes' positions.
 *
 * @param previousNodes - Nodes from the previous render (with positions)
 * @param nextNodes     - Nodes from the new data (may have different IDs)
 * @param edges         - Current edges
 * @param options       - Layout configuration
 * @param prevSpringStates - Spring states from previous animation frame
 *
 * @returns IncrementalLayoutResult with updated nodes and animation state
 */
export function computeIncrementalLayout(
  previousNodes: Node[],
  nextNodes: Node[],
  edges: Edge[],
  options?: IncrementalLayoutOptions,
  prevSpringStates?: Map<string, SpringState>,
): IncrementalLayoutResult {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    spring: { ...DEFAULT_SPRING, ...options?.spring },
  } as Required<IncrementalLayoutOptions> & { spring: SpringConfig };

  const prevMap = new Map(previousNodes.map((n) => [n.id, n]));
  const nextMap = new Map(nextNodes.map((n) => [n.id, n]));

  // Identify changed, added, and removed nodes
  const addedNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  const unchangedNodeIds = new Set<string>();
  const movedNodeIds = new Set<string>();

  for (const node of nextNodes) {
    if (!prevMap.has(node.id)) {
      addedNodeIds.add(node.id);
    } else {
      unchangedNodeIds.add(node.id);
    }
  }

  for (const node of previousNodes) {
    if (!nextMap.has(node.id)) {
      removedNodeIds.add(node.id);
    }
  }

  // Build position map from previous nodes
  const existingPositions = new Map<string, LayoutPosition>();
  for (const node of previousNodes) {
    if (nextMap.has(node.id)) {
      existingPositions.set(node.id, { x: node.position.x, y: node.position.y });
    }
  }

  // Place new nodes
  const newNodePositions = placeNewNodes(
    [...addedNodeIds],
    new Map(existingPositions), // copy to avoid mutation
    edges,
    opts,
  );

  // Build spring states
  const springStates = new Map<string, SpringState>();
  const animatingNodeIds = new Set<string>();

  // New nodes: animate from off-screen or neighbor position to target
  for (const [nodeId, targetPos] of newNodePositions) {
    const startPos = existingPositions.get(nodeId) ?? {
      x: targetPos.x,
      y: targetPos.y - 50, // Start slightly above
    };

    const state: SpringState = {
      x: startPos.x,
      y: startPos.y,
      vx: 0,
      vy: 0,
      targetX: targetPos.x,
      targetY: targetPos.y,
      settled: false,
    };

    springStates.set(nodeId, state);
    animatingNodeIds.add(nodeId);
  }

  // Existing nodes: check if they need to move (e.g., layout shift from ELK)
  for (const nodeId of unchangedNodeIds) {
    const prevNode = prevMap.get(nodeId)!;
    const nextNode = nextMap.get(nodeId)!;

    // Check for explicit position change from layout engine
    const prevPos = prevNode.position;
    const nextPos = nextNode.position;
    const hasMoved =
      Math.abs(prevPos.x - nextPos.x) > 1 ||
      Math.abs(prevPos.y - nextPos.y) > 1;

    if (hasMoved) {
      movedNodeIds.add(nodeId);
      const prevSpring = prevSpringStates?.get(nodeId);

      const state: SpringState = {
        x: prevSpring?.settled === false ? prevSpring.x : prevPos.x,
        y: prevSpring?.settled === false ? prevSpring.y : prevPos.y,
        vx: prevSpring?.vx ?? 0,
        vy: prevSpring?.vy ?? 0,
        targetX: nextPos.x,
        targetY: nextPos.y,
        settled: false,
      };

      springStates.set(nodeId, state);
      animatingNodeIds.add(nodeId);
    } else {
      // Check if there's an ongoing animation from previous frame
      const prevSpring = prevSpringStates?.get(nodeId);
      if (prevSpring && !prevSpring.settled) {
        // Continue animation
        const advanced = advanceSpring(prevSpring, opts.spring, 1 / 60);
        springStates.set(nodeId, advanced);
        if (!advanced.settled) {
          animatingNodeIds.add(nodeId);
        }
      }
    }
  }

  // Build output nodes with interpolated positions
  const outputNodes: Node[] = nextNodes.map((node) => {
    const spring = springStates.get(node.id);

    if (spring && !spring.settled) {
      return {
        ...node,
        position: { x: spring.x, y: spring.y },
      };
    }

    // For new nodes, use computed position
    if (addedNodeIds.has(node.id)) {
      const pos = newNodePositions.get(node.id);
      if (pos) {
        return { ...node, position: { x: pos.x, y: pos.y } };
      }
    }

    // Unchanged node: keep previous position
    const prevNode = prevMap.get(node.id);
    if (prevNode && !movedNodeIds.has(node.id)) {
      return { ...node, position: prevNode.position };
    }

    return node;
  });

  return {
    nodes: outputNodes,
    animatingNodeIds,
    springStates,
    addedNodeIds,
    removedNodeIds,
  };
}

/**
 * Advance all spring animations by one frame.
 * Call this in a requestAnimationFrame loop while animatingNodeIds.size > 0.
 */
export function advanceIncrementalLayout(
  nodes: Node[],
  springStates: Map<string, SpringState>,
  springConfig?: Partial<SpringConfig>,
  dt = 1 / 60,
): { nodes: Node[]; springStates: Map<string, SpringState>; animatingNodeIds: Set<string> } {
  const config = { ...DEFAULT_SPRING, ...springConfig };
  const newStates = new Map<string, SpringState>();
  const animatingNodeIds = new Set<string>();

  for (const [nodeId, state] of springStates) {
    if (state.settled) {
      // No need to continue tracking settled springs
      continue;
    }
    const advanced = advanceSpring(state, config, dt);
    newStates.set(nodeId, advanced);
    if (!advanced.settled) {
      animatingNodeIds.add(nodeId);
    }
  }

  const updatedNodes = nodes.map((node) => {
    const spring = newStates.get(node.id);
    if (spring) {
      return {
        ...node,
        position: { x: spring.x, y: spring.y },
      };
    }
    return node;
  });

  return {
    nodes: updatedNodes,
    springStates: newStates,
    animatingNodeIds,
  };
}
