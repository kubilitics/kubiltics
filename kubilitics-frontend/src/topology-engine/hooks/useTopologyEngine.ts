import { useState, useCallback, useRef, useMemo, type RefObject } from 'react';
import type { RendererEngine, EngineRef, EngineState } from '../types/engine.types';
import type { TopologyGraph } from '../types/topology.types';

export interface UseTopologyEngineOptions {
  /** Initial engine type */
  initialEngine?: RendererEngine;

  /** Topology graph data */
  graph?: TopologyGraph;

  /** On engine change callback */
  onEngineChange?: (engine: RendererEngine) => void;
}

export interface UseTopologyEngineReturn {
  /** Current engine type */
  engine: RendererEngine;

  /** Switch to a different engine */
  switchEngine: (newEngine: RendererEngine) => void;

  /** Engine reference for imperative methods */
  engineRef: RefObject<EngineRef>;

  /** Current engine state */
  state: EngineState;

  /** Update engine state */
  setState: (updates: Partial<EngineState>) => void;
}

/**
 * Hook for managing topology engine selection and state
 *
 * This hook provides:
 * - Engine selection (Cytoscape, Three.js, Hybrid, D3)
 * - State management for zoom, pan, selection
 * - Ref forwarding to active engine
 * - Smooth transitions between engines
 *
 * @example
 * ```tsx
 * const { engine, switchEngine, engineRef } = useTopologyEngine({
 *   initialEngine: 'cytoscape',
 *   graph: topologyData
 * });
 *
 * // Switch engines
 * switchEngine('three');
 *
 * // Use engine methods
 * engineRef.current?.zoomIn();
 * ```
 */
export function useTopologyEngine(
  options: UseTopologyEngineOptions = {}
): UseTopologyEngineReturn {
  const {
    initialEngine = 'cytoscape',
    onEngineChange,
  } = options;

  // Engine selection state
  const [engine, setEngine] = useState<RendererEngine>(initialEngine);

  // Engine state
  const [state, setStateInternal] = useState<EngineState>({
    engine: initialEngine,
    loading: false,
    zoom: 1.0,
    pan: { x: 0, y: 0 },
    selectedNodes: new Set<string>(),
    isLayouting: false,
  });

  // Engine ref for imperative methods
  const engineRef = useRef<EngineRef>(null);

  // Switch engine with state preservation
  const switchEngine = useCallback((newEngine: RendererEngine) => {
    setEngine(newEngine);
    setStateInternal(prev => ({
      ...prev,
      engine: newEngine,
      loading: true,
    }));

    // Notify callback
    onEngineChange?.(newEngine);

    // Reset loading after a brief delay to allow new engine to mount
    setTimeout(() => {
      setStateInternal(prev => ({ ...prev, loading: false }));
    }, 100);
  }, [onEngineChange]);

  // Update state helper
  const setState = useCallback((updates: Partial<EngineState>) => {
    setStateInternal(prev => ({ ...prev, ...updates }));
  }, []);

  return {
    engine,
    switchEngine,
    engineRef,
    state,
    setState,
  };
}
