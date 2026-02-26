import { useState, useEffect, useCallback, useRef } from 'react';
import * as aiService from '@/services/aiService';

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

// ─── usePersistenceHealth ─────────────────────────────────────────────────────

export function usePersistenceHealth(opts: { pollIntervalMs?: number } = {}) {
  const { pollIntervalMs = 30_000 } = opts;
  const [data, setData] = useState<PersistenceHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await aiService.getPersistenceHealth();
      setData(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
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
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (query.resource) params.resource = query.resource;
      if (query.action) params.action = query.action;
      if (query.user_id) params.user_id = query.user_id;
      if (query.from) params.from = query.from;
      if (query.to) params.to = query.to;
      if (query.limit !== undefined) params.limit = String(query.limit);
      if (query.offset !== undefined) params.offset = String(query.offset);

      const json = await aiService.getAuditLogs(params);
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
      await aiService.appendAuditLog(rec);
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
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit) };
      if (clusterID) params.cluster_id = clusterID;

      const json = await aiService.listConversations(params);
      setConversations(json.conversations as unknown as ConversationRecord[] ?? []);
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
    setLoading(true);
    try {
      const json = await aiService.getConversation(id);
      setConversation(json.conversation as unknown as ConversationRecord ?? null);
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
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (query.resource_id) params.resource_id = query.resource_id;
      if (query.namespace) params.namespace = query.namespace;
      if (query.kind) params.kind = query.kind;
      if (query.anomaly_type) params.anomaly_type = query.anomaly_type;
      if (query.severity) params.severity = query.severity;
      if (query.from) params.from = query.from;
      if (query.to) params.to = query.to;
      if (query.limit !== undefined) params.limit = String(query.limit);
      if (query.offset !== undefined) params.offset = String(query.offset);

      const json = await aiService.getAnomalyHistory(params);
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
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;

      const result = await aiService.getAnomalySummary(params);
      setData(result);
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
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit) };
      if (clusterID) params.cluster_id = clusterID;

      const json = await aiService.getCostSnapshots(params);
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
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (clusterID) params.cluster_id = clusterID;
      if (from) params.from = from;
      if (to) params.to = to;

      const json = await aiService.getCostTrend(params);
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
    setLoading(true);
    try {
      const result = await aiService.getLatestCostSnapshot(clusterID);
      if (!result) {
        setSnapshot(null);
        setError(null);
        return;
      }
      setSnapshot(result);
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
