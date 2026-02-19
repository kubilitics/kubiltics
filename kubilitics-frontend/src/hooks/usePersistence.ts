// A-CORE-013: Persistence layer hooks — backed by real /api/v1/persistence/* endpoints.
// Persistence endpoints live on the AI backend (port 8081), not the main backend (port 819).

import { useState, useEffect, useCallback, useRef } from 'react';
import { AI_BASE_URL } from '@/services/aiService';
import { guardAIAvailable } from '@/stores/aiAvailableStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditRecord {
  id: number;
  correlation_id: string;
  event_type: string;
  description: string;
  resource: string;
  action: string;
  result: string;
  user_id: string;
  metadata: string;
  timestamp: string;
}

export interface AuditQuery {
  resource?: string;
  action?: string;
  user_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationRecord {
  id: string;
  cluster_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  token_count: number;
  metadata: string;
  timestamp: string;
}

export interface AnomalyRecord {
  id: number;
  resource_id: string;
  namespace: string;
  kind: string;
  anomaly_type: string;
  severity: string;
  score: number;
  description: string;
  metadata: string;
  detected_at: string;
}

export interface AnomalyQuery {
  resource_id?: string;
  namespace?: string;
  kind?: string;
  anomaly_type?: string;
  severity?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AnomalySummary {
  summary: Record<string, number>;
  total: number;
  from: string;
  to: string;
}

export interface CostSnapshotRecord {
  id: number;
  cluster_id: string;
  total_cost: number;
  waste_cost: number;
  efficiency: number;
  grade: string;
  breakdown: string;
  namespaces: string;
  recorded_at: string;
}

export interface CostTrendPoint {
  recorded_at: string;
  total_cost: number;
  waste_cost: number;
  efficiency: number;
  grade: string;
}

export interface PersistenceHealth {
  status: 'ok' | 'error' | 'unavailable';
  backend?: string;
  note?: string;
  error?: string;
}

// ─── API base ─────────────────────────────────────────────────────────────────
// Persistence layer (audit, conversations, anomalies, cost snapshots) lives on
// the AI backend (port 8081 by default). Use the canonical AI_BASE_URL so the
// port is consistent across all AI-backend callers.
const API_BASE = `${AI_BASE_URL}/api/v1/persistence`;

// ─── usePersistenceHealth ─────────────────────────────────────────────────────

export function usePersistenceHealth(opts: { pollIntervalMs?: number } = {}) {
  const { pollIntervalMs = 30_000 } = opts;
  const [data, setData] = useState<PersistenceHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/health`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchData, pollIntervalMs]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useAuditLog ──────────────────────────────────────────────────────────────

export function useAuditLog(query: AuditQuery = {}) {
  const [events, setEvents] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.resource) params.set('resource', query.resource);
      if (query.action) params.set('action', query.action);
      if (query.user_id) params.set('user_id', query.user_id);
      if (query.from) params.set('from', query.from);
      if (query.to) params.set('to', query.to);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));

      const res = await window.fetch(`${API_BASE}/audit?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setEvents(json.events ?? []);
      setTotal(json.total ?? 0);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query.resource, query.action, query.user_id, query.from, query.to, query.limit, query.offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const appendEvent = useCallback(async (rec: Partial<AuditRecord>) => {
    try {
      guardAIAvailable();
      await window.fetch(`${API_BASE}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      fetchData();
    } catch { /* ignore */ }
  }, [fetchData]);

  return { events, total, loading, error, refresh: fetchData, appendEvent };
}

// ─── useConversations ─────────────────────────────────────────────────────────

export function useConversations(opts: { clusterID?: string; limit?: number } = {}) {
  const { clusterID = '', limit = 50 } = opts;
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clusterID) params.set('cluster_id', clusterID);
      params.set('limit', String(limit));

      const res = await window.fetch(`${API_BASE}/conversations?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setConversations(json.conversations ?? []);
      setTotal(json.total ?? 0);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clusterID, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { conversations, total, loading, error, refresh: fetchData };
}

// ─── useConversation (with messages) ─────────────────────────────────────────

export function useConversation(id: string | null) {
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/conversations/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setConversation(json.conversation ?? null);
      setMessages(json.messages ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { conversation, messages, loading, error, refresh: fetchData };
}

// ─── useAnomalyHistory ────────────────────────────────────────────────────────

export function useAnomalyHistory(query: AnomalyQuery = {}, opts: { pollIntervalMs?: number } = {}) {
  const { pollIntervalMs = 60_000 } = opts;
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.resource_id) params.set('resource_id', query.resource_id);
      if (query.namespace) params.set('namespace', query.namespace);
      if (query.kind) params.set('kind', query.kind);
      if (query.anomaly_type) params.set('anomaly_type', query.anomaly_type);
      if (query.severity) params.set('severity', query.severity);
      if (query.from) params.set('from', query.from);
      if (query.to) params.set('to', query.to);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));

      const res = await window.fetch(`${API_BASE}/anomalies?${params.toString()}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAnomalies(json.anomalies ?? []);
      setTotal(json.total ?? 0);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query.resource_id, query.namespace, query.kind, query.anomaly_type,
  query.severity, query.from, query.to, query.limit, query.offset]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollIntervalMs);
    return () => { clearInterval(id); abortRef.current?.abort(); };
  }, [fetchData, pollIntervalMs]);

  return { anomalies, total, loading, error, refresh: fetchData };
}

// ─── useAnomalySummary ────────────────────────────────────────────────────────

export function useAnomalySummary(opts: {
  from?: string;
  to?: string;
  pollIntervalMs?: number;
} = {}) {
  const { from, to, pollIntervalMs = 60_000 } = opts;
  const [data, setData] = useState<AnomalySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const res = await window.fetch(`${API_BASE}/anomalies/summary?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchData, pollIntervalMs]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useCostSnapshots ────────────────────────────────────────────────────────

export function useCostSnapshots(opts: { clusterID?: string; limit?: number } = {}) {
  const { clusterID = '', limit = 90 } = opts;
  const [snapshots, setSnapshots] = useState<CostSnapshotRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clusterID) params.set('cluster_id', clusterID);
      params.set('limit', String(limit));

      const res = await window.fetch(`${API_BASE}/cost/snapshots?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSnapshots(json.snapshots ?? []);
      setTotal(json.total ?? 0);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clusterID, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { snapshots, total, loading, error, refresh: fetchData };
}

// ─── useCostTrend ────────────────────────────────────────────────────────────

export function useCostTrend(opts: {
  clusterID?: string;
  from?: string;
  to?: string;
  pollIntervalMs?: number;
} = {}) {
  const { clusterID = '', from, to, pollIntervalMs = 120_000 } = opts;
  const [trend, setTrend] = useState<CostTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clusterID) params.set('cluster_id', clusterID);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const res = await window.fetch(`${API_BASE}/cost/trend?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTrend(json.trend ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clusterID, from, to]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchData, pollIntervalMs]);

  return { trend, loading, error, refresh: fetchData };
}

// ─── useLatestCostSnapshot ────────────────────────────────────────────────────

export function useLatestCostSnapshot(clusterID = '') {
  const [snapshot, setSnapshot] = useState<CostSnapshotRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      guardAIAvailable();
    } catch {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (clusterID) params.set('cluster_id', clusterID);

      const res = await window.fetch(`${API_BASE}/cost/latest?${params.toString()}`);
      if (res.status === 204) {
        setSnapshot(null);
        setError(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnapshot(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clusterID]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { snapshot, loading, error, refresh: fetchData };
}
