import { useState, useEffect, useCallback, useRef } from 'react';
import * as aiService from '@/services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Anomaly {
  timestamp: string;
  resource_id: string;
  metric_name: string;
  value: number;
  confidence: number;
  reason: string;
}

export interface AnomalyResponse {
  anomalies: Anomaly[];
  total: number;
  namespace?: string;
  timestamp: string;
  note?: string;
}

export interface TrendResult {
  resource_id: string;
  metric_name: string;
  direction: 'increasing' | 'decreasing' | 'flat' | 'unknown';
  strength?: 'strong' | 'moderate' | 'weak';
  current_value?: number;
  slope_per_5m?: number;
  hourly_growth_rate?: number;
  r_squared?: number;
  forecast_24h?: number;
  data_points?: number;
  error?: string;
}

export interface TrendResponse {
  resource_id: string;
  metric_name: string;
  trend: TrendResult | Record<string, unknown>;
  raw_series: unknown[];
  window: string;
  timestamp: string;
}

export interface ScoreResult {
  resource_id: string;
  health: {
    resource_id: string;
    score: number;
    status: string;
    details: Record<string, unknown>;
  };
  overall_score: number;
  breakdown: unknown;
  timestamp: string;
}

export interface ForecastPoint {
  resource_id: string;
  metric_name: string;
  horizon: string;
  point_estimate: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  confidence_level: number;
  std_error: number;
  method: string;
  data_points: number;
  forecast_at?: string;
}

export interface ForecastResponse {
  resource_id: string;
  metric_name: string;
  horizon: string;
  forecast: ForecastPoint;
  trend?: TrendResult;
  capacity_comparison?: Record<string, unknown>;
  threshold_crossing?: Record<string, unknown>;
  seasonal_pattern?: Record<string, unknown>;
  timestamp: string;
}

export interface IngestRequest {
  resource_id: string;
  metric_name: string;
  value: number;
}

export interface ForecastRequest {
  resource_id: string;
  metric_name: string;
  horizon?: string;
  capacity?: number;
  threshold?: number;
  direction?: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * useAnalyticsAnomalies — polls for recent anomalies.
 */
export function useAnalyticsAnomalies(opts: {
  namespace?: string;
  limit?: number;
  pollIntervalMs?: number;
  enabled?: boolean;
}) {
  const {
    namespace = '',
    limit = 50,
    pollIntervalMs = 15_000,
    enabled = true,
  } = opts;

  const [data, setData] = useState<AnomalyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const fetchRef = useRef<AbortController | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled) return;
    fetchRef.current?.abort();
    fetchRef.current = new AbortController();

    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit) };
      if (namespace) params.namespace = namespace;

      const json = await aiService.getAnalyticsAnomalies(params);
      setData(json as unknown as AnomalyResponse);
      setError(null);
      setLastRefreshedAt(new Date());
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, namespace, limit]);

  useEffect(() => {
    fetch();
    if (!enabled) return;
    const id = setInterval(fetch, pollIntervalMs);
    return () => {
      clearInterval(id);
      fetchRef.current?.abort();
    };
  }, [fetch, enabled, pollIntervalMs]);

  return { data, loading, error, lastRefreshedAt, refresh: fetch };
}

/**
 * useAnalyticsTrend — fetches trend for a resource+metric.
 */
export function useAnalyticsTrend(opts: {
  resourceId: string;
  metric?: string;
  enabled?: boolean;
}) {
  const { resourceId, metric = 'cpu_usage', enabled = true } = opts;

  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrend = useCallback(async () => {
    if (!enabled || !resourceId) return;
    setLoading(true);
    try {
      const json = await aiService.getAnalyticsTrend(resourceId, metric);
      setData(json as unknown as TrendResponse);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled, resourceId, metric]);

  useEffect(() => {
    fetchTrend();
  }, [fetchTrend]);

  return { data, loading, error, refresh: fetchTrend };
}

/**
 * useAnalyticsScore — fetches health score for a resource.
 */
export function useAnalyticsScore(opts: {
  resourceId: string;
  enabled?: boolean;
}) {
  const { resourceId, enabled = true } = opts;

  const [data, setData] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScore = useCallback(async () => {
    if (!enabled || !resourceId) return;
    setLoading(true);
    try {
      const json = await aiService.getAnalyticsScore(resourceId);
      setData(json as unknown as ScoreResult);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled, resourceId]);

  useEffect(() => {
    fetchScore();
  }, [fetchScore]);

  return { data, loading, error, refresh: fetchScore };
}

/**
 * useAnalyticsForecast — imperative hook: call submit() to request a forecast.
 */
export function useAnalyticsForecast() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (req: ForecastRequest) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const json = await aiService.getAnalyticsForecast({
        horizon: '1h',
        direction: 'above',
        ...req,
      });
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, submit };
}

/**
 * useAnalyticsIngest — imperative hook: call ingest() to push a metric value.
 */
export function useAnalyticsIngest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastIngestedAt, setLastIngestedAt] = useState<Date | null>(null);

  const ingest = useCallback(async (req: IngestRequest) => {
    setLoading(true);
    setError(null);
    try {
      await aiService.ingestAnalyticsMetric(req);
      setLastIngestedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, lastIngestedAt, ingest };
}
