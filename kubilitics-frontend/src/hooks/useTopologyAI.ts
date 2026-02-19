/**
 * useTopologyAI — E-PLAT-001: AI-Powered Topology Analysis hooks
 *
 * Provides three AI-backed capabilities for the Topology page:
 *  1. analyzeBlastRadius  — POST /api/v1/topology/analyze
 *     Natural-language impact analysis when user asks "what happens if I delete X?"
 *
 *  2. fetchCriticalPath   — POST /api/v1/topology/critical-path
 *     Identifies the user-traffic critical path + SPOFs across the topology
 *
 *  3. explainNode         — POST /api/v1/topology/node-explain
 *     AI tooltip with role, dependencies, anomalies for hovered/selected nodes
 *
 * All endpoints fall back to heuristic results server-side when LLM is unavailable,
 * so the hooks always return something useful.
 */

import { useState, useCallback, useRef } from 'react';
import { AI_BASE_URL } from '@/services/aiService';
import { guardAIAvailable } from '@/stores/aiAvailableStore';

// ─── Shared graph types ──────────────────────────────────────────────────────

export interface TopologyNodeSummary {
  id: string;
  kind: string;
  name: string;
  namespace?: string;
  health?: string;     // "healthy" | "warning" | "critical" | "unknown"
  replicas?: number;
  labels?: Record<string, string>;
}

export interface TopologyEdgeSummary {
  source: string;
  target: string;
  relationship_type: string;
}

// ─── Blast radius analysis ───────────────────────────────────────────────────

export interface BlastRadiusAnalysisRequest {
  target_node_id: string;
  operation: 'delete' | 'scale-down' | 'update' | 'restart';
  nodes: TopologyNodeSummary[];
  edges: TopologyEdgeSummary[];
  blast_radius_node_ids?: string[];
  total_impact?: number;
}

export interface BlastRadiusAnalysisResult {
  natural_language_summary: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  affected_services: string[];
  recommended_actions: string[];
  can_proceed_safely: boolean;
  safety_check_message: string;
  source: 'llm' | 'heuristic';
}

export function useBlastRadiusAnalysis() {
  const [result, setResult] = useState<BlastRadiusAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (req: BlastRadiusAnalysisRequest) => {
    try {
      guardAIAvailable();
    } catch {
      setError('AI backend is not available.');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${AI_BASE_URL}/api/v1/topology/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI backend error ${res.status}: ${text}`);
      }
      const data: BlastRadiusAnalysisResult = await res.json();
      setResult(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, analyze, clear };
}

// ─── Critical path ────────────────────────────────────────────────────────────

export interface CriticalPathResult {
  path_node_ids: string[];
  path_description: string;
  spofs: string[];
  bottleneck_node_ids: string[];
  llm_explanation: string;
  source: 'llm' | 'heuristic';
}

export function useCriticalPath() {
  const [result, setResult] = useState<CriticalPathResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (
    nodes: TopologyNodeSummary[],
    edges: TopologyEdgeSummary[],
    namespaceFilter?: string,
  ) => {
    try {
      guardAIAvailable();
    } catch {
      setError('AI backend is not available.');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${AI_BASE_URL}/api/v1/topology/critical-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, namespace_filter: namespaceFilter ?? '' }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI backend error ${res.status}: ${text}`);
      }
      const data: CriticalPathResult = await res.json();
      setResult(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, fetchCriticalPath: fetch_, clear };
}

// ─── Node explain (AI tooltip) ────────────────────────────────────────────────

export interface NodeExplainResult {
  role: string;
  dependencies: string[];
  anomalies: string[];
  health_summary: string;
  source: 'llm' | 'heuristic';
}

export function useNodeExplain() {
  const [results, setResults] = useState<Map<string, NodeExplainResult>>(new Map());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // Debounce: track last requested id to avoid duplicate calls
  const lastRequestedId = useRef<string | null>(null);

  const explain = useCallback(async (
    node: TopologyNodeSummary,
    nodes?: TopologyNodeSummary[],
    edges?: TopologyEdgeSummary[],
  ) => {
    const id = node.id;

    // Return cached result
    if (results.has(id)) {
      return results.get(id)!;
    }

    // Debounce: skip if already requesting this id
    if (lastRequestedId.current === id) return null;
    lastRequestedId.current = id;
    setLoadingId(id);

    try {
      guardAIAvailable();
      const res = await fetch(`${AI_BASE_URL}/api/v1/topology/node-explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node,
          nodes: nodes ?? [],
          edges: edges ?? [],
        }),
      });
      if (!res.ok) return null;
      const data: NodeExplainResult = await res.json();
      setResults(prev => new Map(prev).set(id, data));
      return data;
    } catch {
      return null;
    } finally {
      setLoadingId(null);
      if (lastRequestedId.current === id) lastRequestedId.current = null;
    }
  }, [results]);

  const clearCache = useCallback(() => {
    setResults(new Map());
  }, []);

  return { results, loadingId, explain, clearCache };
}
