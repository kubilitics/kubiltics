import { useState, useEffect, useCallback, useRef } from 'react';
import * as aiService from '@/services/aiService';

// ─── Types matching the Go BackendStatusResponse ──────────────────────────────

export interface ConnectionStatusInfo {
  state: string; // CONNECTED | DISCONNECTED | RECONNECTING | CONNECTING | N/A
  backend_address: string;
  connected: boolean;
  message?: string;
}

export interface WorldModelStatusInfo {
  bootstrapped: boolean;
  total_resources: number;
  kind_counts?: Record<string, number>;
  namespace_counts?: Record<string, number>;
  last_sync_at?: string;
}

export interface AnomalyPattern {
  type: string;
  description: string;
  namespace: string;
  resource: string;
  event_count: number;
  first_seen: string;
  last_seen: string;
  severity: string;
}

export interface EventStatusInfo {
  total_events: number;
  warning_events: number;
  anomaly_count: number;
  anomaly_patterns?: AnomalyPattern[];
  top_reasons?: Record<string, number>;
  events_by_kind?: Record<string, number>;
}

export interface BackendStatus {
  timestamp: string;
  connection: ConnectionStatusInfo;
  world_model: WorldModelStatusInfo;
  events: EventStatusInfo;
}

export interface RecentEvent {
  id?: string;
  type: string; // 'normal' | 'warning' | 'critical'
  reason: string;
  message: string;
  namespace: string;
  involved_kind: string;
  involved_name: string;
  count: number;
  first_seen: string;
  last_seen: string;
  is_anomaly: boolean;
  anomaly_type?: string;
  investigation_id?: string;
}

export interface UseBackendConnectionOptions {
  pollIntervalMs?: number;
  enabled?: boolean;
}

export interface UseBackendConnectionResult {
  status: BackendStatus | null;
  recentEvents: RecentEvent[];
  loading: boolean;
  error: string | null;
  lastRefreshedAt: Date | null;
  refresh: () => void;
}

export function useBackendConnection({
  pollIntervalMs = 10_000,
  enabled = true,
}: UseBackendConnectionOptions = {}): UseBackendConnectionResult {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    try {
      const [s, eventsData] = await Promise.all([
        aiService.getBackendStatus(),
        aiService.getBackendEvents(30),
      ]);

      setStatus(s);

      // Events come back as ProcessedEvent structs from Go — map fields
      const evts = (eventsData.events ?? []).map((e: any) => ({
        id: String(e.ID ?? e.id ?? ''),
        type: String(e.Type ?? e.type ?? 'normal'),
        reason: String(e.Reason ?? e.reason ?? ''),
        message: String(e.Message ?? e.message ?? ''),
        namespace: String(e.Namespace ?? e.namespace ?? ''),
        involved_kind: String(e.InvolvedKind ?? e.involved_kind ?? ''),
        involved_name: String(e.InvolvedName ?? e.involved_name ?? ''),
        count: Number(e.Count ?? e.count ?? 0),
        first_seen: String(e.FirstSeen ?? e.first_seen ?? ''),
        last_seen: String(e.LastSeen ?? e.last_seen ?? ''),
        is_anomaly: Boolean(e.IsAnomaly ?? e.is_anomaly ?? false),
        anomaly_type:
          e.AnomalyType != null
            ? String(e.AnomalyType)
            : e.anomaly_type != null
              ? String(e.anomaly_type)
              : undefined,
        investigation_id:
          e.InvestigationID != null
            ? String(e.InvestigationID)
            : e.investigation_id != null
              ? String(e.investigation_id)
              : undefined,
      }));

      setRecentEvents(evts);
      setLastRefreshedAt(new Date());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = setInterval(() => void refresh(), pollIntervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [enabled, pollIntervalMs, refresh]);

  return { status, recentEvents, loading, error, lastRefreshedAt, refresh };
}
