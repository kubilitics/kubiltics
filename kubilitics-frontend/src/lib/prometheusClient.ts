/**
 * TASK-OBS-002: Prometheus Query Provider
 *
 * PromQL query builder and client with auto-detection of Prometheus endpoint.
 * Falls back to metrics-server when Prometheus is unavailable.
 */

import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DataSource = 'prometheus' | 'metrics-server' | 'none';

export interface PrometheusResult {
  status: 'success' | 'error';
  data: {
    resultType: 'matrix' | 'vector' | 'scalar' | 'string';
    result: PrometheusMetric[];
  };
  errorType?: string;
  error?: string;
}

export interface PrometheusMetric {
  metric: Record<string, string>;
  values?: [number, string][]; // matrix
  value?: [number, string];    // vector / scalar
}

export interface QueryRangeParams {
  query: string;
  start: number;   // unix epoch seconds
  end: number;     // unix epoch seconds
  step: number;    // seconds
}

export interface QueryInstantParams {
  query: string;
  time?: number;   // unix epoch seconds (defaults to now)
}

export interface PrometheusClientConfig {
  /** Override Prometheus base URL. When empty, auto-detect via backend /api/v1/metrics/config. */
  prometheusUrl?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const DETECT_CACHE_TTL_MS = 60_000;

let cachedDataSource: DataSource | null = null;
let cachedPromUrl: string | null = null;
let cacheTimestamp = 0;

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Auto-detect the active metrics data source.
 * First tries the backend's metrics config endpoint, then tries Prometheus directly.
 */
export async function detectDataSource(
  config?: PrometheusClientConfig,
): Promise<{ source: DataSource; url: string | null }> {
  const now = Date.now();
  if (cachedDataSource && now - cacheTimestamp < DETECT_CACHE_TTL_MS) {
    return { source: cachedDataSource, url: cachedPromUrl };
  }

  // If user explicitly set a Prometheus URL, probe it directly
  if (config?.prometheusUrl) {
    const ok = await probePrometheus(config.prometheusUrl, config?.timeoutMs);
    if (ok) {
      cachedDataSource = 'prometheus';
      cachedPromUrl = config.prometheusUrl;
      cacheTimestamp = now;
      return { source: 'prometheus', url: config.prometheusUrl };
    }
  }

  // Ask the backend for its metrics configuration
  const stored = useBackendConfigStore.getState().backendBaseUrl;
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  try {
    const res = await fetch(`${baseUrl}/api/v1/metrics/config`, {
      signal: AbortSignal.timeout(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json();
      if (body.prometheusUrl) {
        const ok = await probePrometheus(body.prometheusUrl, config?.timeoutMs);
        if (ok) {
          cachedDataSource = 'prometheus';
          cachedPromUrl = body.prometheusUrl;
          cacheTimestamp = now;
          return { source: 'prometheus', url: body.prometheusUrl };
        }
      }
      if (body.metricsServer) {
        cachedDataSource = 'metrics-server';
        cachedPromUrl = null;
        cacheTimestamp = now;
        return { source: 'metrics-server', url: null };
      }
    }
  } catch {
    // Backend not reachable — fall through
  }

  // Try common Prometheus endpoints
  for (const candidate of [
    'http://prometheus-server.monitoring.svc:9090',
    'http://localhost:9090',
  ]) {
    const ok = await probePrometheus(candidate, config?.timeoutMs);
    if (ok) {
      cachedDataSource = 'prometheus';
      cachedPromUrl = candidate;
      cacheTimestamp = now;
      return { source: 'prometheus', url: candidate };
    }
  }

  // Fall back to metrics-server via backend proxy
  cachedDataSource = 'metrics-server';
  cachedPromUrl = null;
  cacheTimestamp = now;
  return { source: 'metrics-server', url: null };
}

async function probePrometheus(url: string, timeoutMs?: number): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/v1/status/buildinfo`, {
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Invalidate the cached data source detection result. */
export function invalidateDataSourceCache(): void {
  cachedDataSource = null;
  cachedPromUrl = null;
  cacheTimestamp = 0;
}

// ─── Query Functions ─────────────────────────────────────────────────────────

/**
 * Execute a PromQL range query.
 * Returns time-series matrix data for charting.
 */
export async function queryRange(
  params: QueryRangeParams,
  config?: PrometheusClientConfig,
): Promise<PrometheusResult> {
  const { source, url } = await detectDataSource(config);

  if (source === 'prometheus' && url) {
    const qs = new URLSearchParams({
      query: params.query,
      start: params.start.toString(),
      end: params.end.toString(),
      step: params.step.toString(),
    });
    const res = await fetch(`${url}/api/v1/query_range?${qs}`, {
      signal: AbortSignal.timeout(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Prometheus query_range failed: ${res.status}`);
    return res.json();
  }

  // Fallback: proxy through backend
  const stored = useBackendConfigStore.getState().backendBaseUrl;
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const res = await fetch(`${baseUrl}/api/v1/metrics/query_range`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Backend metrics query_range failed: ${res.status}`);
  return res.json();
}

/**
 * Execute a PromQL instant query.
 * Returns a single vector result at the specified time.
 */
export async function queryInstant(
  params: QueryInstantParams,
  config?: PrometheusClientConfig,
): Promise<PrometheusResult> {
  const { source, url } = await detectDataSource(config);

  if (source === 'prometheus' && url) {
    const qs = new URLSearchParams({ query: params.query });
    if (params.time) qs.set('time', params.time.toString());
    const res = await fetch(`${url}/api/v1/query?${qs}`, {
      signal: AbortSignal.timeout(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Prometheus query failed: ${res.status}`);
    return res.json();
  }

  const stored = useBackendConfigStore.getState().backendBaseUrl;
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const res = await fetch(`${baseUrl}/api/v1/metrics/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Backend metrics query failed: ${res.status}`);
  return res.json();
}

// ─── PromQL Builder ──────────────────────────────────────────────────────────

/** Convenience builder for common PromQL patterns used in Kubilitics dashboards. */
export const PromQL = {
  /** CPU usage rate for a pod. */
  podCpuRate: (pod: string, namespace?: string): string => {
    const ns = namespace ? `,namespace="${namespace}"` : '';
    return `rate(container_cpu_usage_seconds_total{pod="${pod}"${ns},container!="POD",container!=""}[5m])`;
  },

  /** Memory working set for a pod. */
  podMemory: (pod: string, namespace?: string): string => {
    const ns = namespace ? `,namespace="${namespace}"` : '';
    return `container_memory_working_set_bytes{pod="${pod}"${ns},container!="POD",container!=""}`;
  },

  /** Node CPU utilization percentage. */
  nodeCpuPercent: (node?: string): string => {
    const n = node ? `{instance=~"${node}.*"}` : '';
    return `100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"${n ? ',' + n.slice(1, -1) : ''}}[5m])) * 100)`;
  },

  /** Node memory utilization percentage. */
  nodeMemoryPercent: (node?: string): string => {
    const n = node ? `,instance=~"${node}.*"` : '';
    return `100 * (1 - node_memory_MemAvailable_bytes${n ? `{${n.slice(1)}}` : ''} / node_memory_MemTotal_bytes${n ? `{${n.slice(1)}}` : ''})`;
  },

  /** HTTP request rate for Kubilitics backend. */
  httpRequestRate: (): string =>
    'sum(rate(http_requests_total{job="kubilitics-backend"}[5m]))',

  /** HTTP request duration P99. */
  httpDurationP99: (): string =>
    'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{job="kubilitics-backend"}[5m])) by (le))',

  /** WebSocket active connections. */
  wsConnections: (): string =>
    'kubilitics_websocket_connections_active',

  /** Cache hit ratio. */
  cacheHitRatio: (): string =>
    'sum(rate(kubilitics_cache_hits_total[5m])) / (sum(rate(kubilitics_cache_hits_total[5m])) + sum(rate(kubilitics_cache_misses_total[5m])))',

  /** Circuit breaker state (1=closed, 0=open). */
  circuitBreakerState: (): string =>
    'kubilitics_circuit_breaker_state',

  /** Network received bytes per pod. */
  podNetworkReceive: (pod: string, namespace?: string): string => {
    const ns = namespace ? `,namespace="${namespace}"` : '';
    return `rate(container_network_receive_bytes_total{pod="${pod}"${ns}}[5m])`;
  },

  /** Network transmitted bytes per pod. */
  podNetworkTransmit: (pod: string, namespace?: string): string => {
    const ns = namespace ? `,namespace="${namespace}"` : '';
    return `rate(container_network_transmit_bytes_total{pod="${pod}"${ns}}[5m])`;
  },

  /** Namespace CPU cost (for cost attribution). */
  namespaceCpuCost: (namespace?: string): string => {
    const ns = namespace ? `{namespace="${namespace}"}` : '';
    return `sum by (namespace) (rate(container_cpu_usage_seconds_total${ns}[1h]))`;
  },

  /** Namespace memory cost. */
  namespaceMemoryCost: (namespace?: string): string => {
    const ns = namespace ? `{namespace="${namespace}"}` : '';
    return `sum by (namespace) (container_memory_working_set_bytes${ns})`;
  },
} as const;
