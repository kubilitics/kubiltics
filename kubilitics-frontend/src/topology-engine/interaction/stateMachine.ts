/**
 * Topology Interaction State Machine
 * Manages transitions between idle, hovering, selected, and path-tracing states
 */
import type { HighlightState, HighlightContext } from '../types/topology.types';

type StateEvent =
  | { type: 'HOVER'; nodeId: string }
  | { type: 'UNHOVER' }
  | { type: 'SELECT'; nodeId: string }
  | { type: 'DESELECT' }
  | { type: 'TRACE_PATH'; nodeIds: Set<string>; edgeIds: Set<string> }
  | { type: 'CLEAR_TRACE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' };

const initialContext: HighlightContext = {
  state: 'idle',
  hoveredNodeId: null,
  selectedNodeId: null,
  highlightedNodeIds: new Set(),
  highlightedEdgeIds: new Set(),
  fadedNodeIds: new Set(),
  fadedEdgeIds: new Set(),
};

export function createStateMachine() {
  let context: HighlightContext = { ...initialContext };
  let paused = false;

  function transition(event: StateEvent): HighlightContext {
    if (event.type === 'PAUSE') { paused = true; return context; }
    if (event.type === 'RESUME') { paused = false; return context; }
    if (paused && event.type !== 'SELECT' && event.type !== 'DESELECT') return context;

    switch (event.type) {
      case 'HOVER':
        context = { ...context, state: 'hovering', hoveredNodeId: event.nodeId };
        break;
      case 'UNHOVER':
        context = {
          ...context,
          state: context.selectedNodeId ? 'selected' : 'idle',
          hoveredNodeId: null,
          highlightedNodeIds: new Set(),
          highlightedEdgeIds: new Set(),
          fadedNodeIds: new Set(),
          fadedEdgeIds: new Set(),
        };
        break;
      case 'SELECT':
        context = { ...context, state: 'selected', selectedNodeId: event.nodeId };
        break;
      case 'DESELECT':
        context = {
          ...context,
          state: context.hoveredNodeId ? 'hovering' : 'idle',
          selectedNodeId: null,
        };
        break;
      case 'TRACE_PATH':
        context = {
          ...context,
          state: 'path-tracing',
          highlightedNodeIds: event.nodeIds,
          highlightedEdgeIds: event.edgeIds,
        };
        break;
      case 'CLEAR_TRACE':
        context = {
          ...context,
          state: context.selectedNodeId ? 'selected' : 'idle',
          highlightedNodeIds: new Set(),
          highlightedEdgeIds: new Set(),
          fadedNodeIds: new Set(),
          fadedEdgeIds: new Set(),
        };
        break;
    }
    return context;
  }

  function getContext() { return context; }
  function reset() { context = { ...initialContext }; paused = false; }

  return { transition, getContext, reset };
}
