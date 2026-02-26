import { useState, useEffect, useCallback, useRef } from 'react';
import * as aiService from '@/services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResourceSummary {
  kind: string;
  namespace: string;
  name: string;
  uid?: string;
  resource_version?: string;
  labels?: Record<string, string>;
  phase?: string;
  status?: Record<string, unknown>;
  owner_refs?: Array<{ kind: string; name: string; uid: string }>;
}

export interface ChangeRecord {
  timestamp: string;
  update_type: string; // ADDED | MODIFIED | DELETED
  kind: string;
  namespace: string;
  name: string;
  uid?: string;
}

export interface ClusterOverview {
  cluster_stats: {
    bootstrapped: boolean;
    last_sync: string;
    total_resources: number;
    kind_counts: Record<string, number>;
    namespace_counts: Record<string, number>;
    total_kinds: number;
    total_namespaces: number;
  };
  recent_changes: ChangeRecord[];
  change_count_5m: number;
}

export interface TemporalChange {
  timestamp: string;
  update_type: string;
  kind: string;
  namespace: string;
  name: string;
  before?: ResourceSummary | null;
  after?: ResourceSummary | null;
}

export interface RetentionWindow {
  available: boolean;
  oldest?: string;
  newest?: string;
  capacity?: number;
  interval?: string;
  retention?: string;
  error?: string;
}

export interface VectorResult {
  id: string;
  text: string;
  payload: unknown;
  score: number;
  created_at: string;
}

export interface VectorStats {
  available: boolean;
  stats?: {
    backend: string;
    total_items: number;
    type_counts: Record<string, number>;
    semantic_search: boolean;
  };
}

// ─── useMemoryOverview ────────────────────────────────────────────────────────

export function useMemoryOverview(pollMs = 15_000) {
  const [data, setData] = useState<ClusterOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await aiService.getMemoryOverview();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollMs);
    return () => clearInterval(id);
  }, [fetchData, pollMs]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useMemoryResources ───────────────────────────────────────────────────────

export interface UseMemoryResourcesOptions {
  kind?: string;
  namespace?: string;
  search?: string;
  limit?: number;
  enabled?: boolean;
}

export function useMemoryResources(opts: UseMemoryResourcesOptions = {}) {
  const { kind = '', namespace = '', search = '', limit = 100, enabled = true } = opts;
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const params: any = {};
      if (kind) params.kind = kind;
      if (namespace) params.namespace = namespace;
      if (search) params.search = search;
      if (limit) params.limit = String(limit);

      const d = await aiService.searchMemoryResourcesListing(params);
      setResources(d.resources ?? []);
      setCount(d.count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, namespace, search, limit, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { resources, count, loading, error, refresh: fetchData };
}

// ─── useMemoryChanges ─────────────────────────────────────────────────────────

export function useMemoryChanges(since = '10m', pollMs = 8_000) {
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await aiService.getMemoryChanges(since);
      setChanges(d.changes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [since]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollMs);
    return () => clearInterval(id);
  }, [fetchData, pollMs]);

  return { changes, loading, error, refresh: fetchData };
}

// ─── useTemporalWindow ────────────────────────────────────────────────────────

export function useTemporalWindow() {
  const [temporalWindow, setTemporalWindow] = useState<RetentionWindow | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await aiService.getTemporalWindow();
      setTemporalWindow(d);
    } catch {
      setTemporalWindow({ available: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { window: temporalWindow, loading, refresh: fetchData };
}

// ─── useTemporalChanges ───────────────────────────────────────────────────────

export function useTemporalChanges(kind: string, namespace: string, name: string, enabled = true) {
  const [changes, setChanges] = useState<TemporalChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled || !kind || !name) return;
    setLoading(true);
    setError(null);
    try {
      const d = await aiService.getTemporalChanges(kind, namespace, name);
      setChanges(d.changes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, namespace, name, enabled]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { changes, loading, error, refresh: fetchData };
}

// ─── useVectorSearch ──────────────────────────────────────────────────────────

export type VectorSearchType = 'investigations' | 'error_patterns' | 'documentation';

export function useVectorSearch() {
  const [results, setResults] = useState<VectorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (query: string, type: VectorSearchType = 'investigations', limit = 10) => {
    if (!query.trim()) { setResults([]); return; }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const d = await aiService.searchMemoryVector({
        query,
        type,
        limit,
        signal: abortRef.current.signal
      });
      setResults(d.results ?? []);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, error, search };
}

// ─── useVectorStats ───────────────────────────────────────────────────────────

export function useVectorStats() {
  const [stats, setStats] = useState<VectorStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await aiService.getVectorStats();
      setStats(d);
    } catch {
      setStats({ available: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { stats, loading, refresh: fetchData };
}
