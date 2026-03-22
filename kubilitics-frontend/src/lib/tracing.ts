/**
 * TASK-OBS-007: OpenTelemetry Span Instrumentation
 *
 * Browser SDK initialization for OpenTelemetry traces.
 * Propagates trace context in all API calls and exports to a configurable OTLP endpoint.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TracingConfig {
  /** OTLP HTTP endpoint (e.g. http://localhost:4318/v1/traces). Empty = tracing disabled. */
  otlpEndpoint: string;
  /** Sampling rate 0.0 - 1.0 (default 0.1 = 10%). */
  samplingRate: number;
  /** Service name reported in spans. */
  serviceName: string;
  /** Extra resource attributes. */
  resourceAttributes?: Record<string, string>;
  /** Whether tracing is enabled at all. */
  enabled: boolean;
}

export interface Span {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'ok' | 'error' | 'unset';
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TracingConfig = {
  otlpEndpoint: '',
  samplingRate: 0.1,
  serviceName: 'kubilitics-frontend',
  enabled: false,
};

const STORAGE_KEY = 'kubilitics-tracing-config';

// ─── State ───────────────────────────────────────────────────────────────────

let currentConfig: TracingConfig = DEFAULT_CONFIG;
const activeSpans: Map<string, Span> = new Map();
let spanBuffer: Span[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const MAX_BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateTraceId(): string {
  return generateId(16); // 32 hex chars
}

function generateSpanId(): string {
  return generateId(8); // 16 hex chars
}

function shouldSample(): boolean {
  return Math.random() < currentConfig.samplingRate;
}

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize the tracing system with the given configuration.
 * Call once at app startup or when configuration changes.
 */
export function initTracing(config?: Partial<TracingConfig>): void {
  // Load persisted config
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    // ignore corrupt storage
  }

  // Apply overrides
  if (config) {
    currentConfig = { ...currentConfig, ...config };
  }

  // Start flush timer
  if (currentConfig.enabled && currentConfig.otlpEndpoint) {
    startFlushTimer();
  }
}

/** Persist and apply new tracing configuration. */
export function updateTracingConfig(config: Partial<TracingConfig>): void {
  currentConfig = { ...currentConfig, ...config };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
  } catch {
    // storage full — ignore
  }

  if (currentConfig.enabled && currentConfig.otlpEndpoint) {
    startFlushTimer();
  } else {
    stopFlushTimer();
  }
}

/** Get the current tracing configuration (read-only copy). */
export function getTracingConfig(): Readonly<TracingConfig> {
  return { ...currentConfig };
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushSpans();
  }, FLUSH_INTERVAL_MS);
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// ─── Span Management ─────────────────────────────────────────────────────────

/**
 * Start a new span. Returns a span handle with `end()` and `addEvent()` methods.
 * If tracing is disabled or the request is not sampled, returns a no-op handle.
 */
export function startSpan(
  name: string,
  options?: {
    parentSpanId?: string;
    traceId?: string;
    attributes?: Record<string, string | number | boolean>;
  },
): SpanHandle {
  if (!currentConfig.enabled || !shouldSample()) {
    return NO_OP_SPAN_HANDLE;
  }

  const traceId = options?.traceId ?? generateTraceId();
  const spanId = generateSpanId();

  const span: Span = {
    name,
    traceId,
    spanId,
    parentSpanId: options?.parentSpanId,
    startTime: performance.now(),
    attributes: options?.attributes ?? {},
    status: 'unset',
    events: [],
  };

  activeSpans.set(spanId, span);

  return {
    traceId,
    spanId,
    setAttribute(key: string, value: string | number | boolean) {
      span.attributes[key] = value;
    },
    addEvent(eventName: string, attrs?: Record<string, string | number | boolean>) {
      span.events.push({
        name: eventName,
        timestamp: performance.now(),
        attributes: attrs,
      });
    },
    setStatus(status: 'ok' | 'error') {
      span.status = status;
    },
    end() {
      span.endTime = performance.now();
      activeSpans.delete(spanId);
      spanBuffer.push(span);
      if (spanBuffer.length >= MAX_BUFFER_SIZE) {
        flushSpans();
      }
    },
  };
}

export interface SpanHandle {
  traceId: string;
  spanId: string;
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attrs?: Record<string, string | number | boolean>): void;
  setStatus(status: 'ok' | 'error'): void;
  end(): void;
}

const NO_OP_SPAN_HANDLE: SpanHandle = {
  traceId: '',
  spanId: '',
  setAttribute: () => {},
  addEvent: () => {},
  setStatus: () => {},
  end: () => {},
};

// ─── Trace Context Propagation ───────────────────────────────────────────────

/**
 * Generate W3C Trace Context headers for outgoing API calls.
 * Inject these into fetch/XMLHttpRequest headers.
 */
export function getTraceHeaders(spanHandle?: SpanHandle): Record<string, string> {
  if (!currentConfig.enabled || !spanHandle || !spanHandle.traceId) {
    return {};
  }
  // W3C traceparent format: version-traceId-parentId-flags
  const flags = '01'; // sampled
  return {
    traceparent: `00-${spanHandle.traceId}-${spanHandle.spanId}-${flags}`,
  };
}

/**
 * Wrap a fetch call with automatic span creation and trace context propagation.
 */
export async function tracedFetch(
  url: string,
  init?: RequestInit,
  spanName?: string,
): Promise<Response> {
  const span = startSpan(spanName ?? `HTTP ${init?.method ?? 'GET'} ${new URL(url, window.location.origin).pathname}`, {
    attributes: {
      'http.method': init?.method ?? 'GET',
      'http.url': url,
    },
  });

  const headers = new Headers(init?.headers);
  const traceHeaders = getTraceHeaders(span);
  for (const [key, value] of Object.entries(traceHeaders)) {
    headers.set(key, value);
  }

  try {
    const response = await fetch(url, { ...init, headers });
    span.setAttribute('http.status_code', response.status);
    span.setStatus(response.ok ? 'ok' : 'error');
    return response;
  } catch (error) {
    span.setStatus('error');
    span.setAttribute('error.message', String(error));
    throw error;
  } finally {
    span.end();
  }
}

// ─── Span Export ─────────────────────────────────────────────────────────────

/**
 * Flush buffered spans to the OTLP endpoint.
 * Uses the OTLP/HTTP JSON protocol.
 */
async function flushSpans(): Promise<void> {
  if (spanBuffer.length === 0 || !currentConfig.otlpEndpoint) return;

  const spans = [...spanBuffer];
  spanBuffer = [];

  const otlpPayload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: currentConfig.serviceName } },
            ...(currentConfig.resourceAttributes
              ? Object.entries(currentConfig.resourceAttributes).map(([key, val]) => ({
                  key,
                  value: { stringValue: val },
                }))
              : []),
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'kubilitics-frontend', version: '1.0.0' },
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId ?? '',
              name: s.name,
              kind: 3, // SPAN_KIND_CLIENT
              startTimeUnixNano: String(Math.round(s.startTime * 1_000_000)),
              endTimeUnixNano: String(Math.round((s.endTime ?? s.startTime) * 1_000_000)),
              attributes: Object.entries(s.attributes).map(([key, val]) => ({
                key,
                value: typeof val === 'number'
                  ? { intValue: String(val) }
                  : typeof val === 'boolean'
                    ? { boolValue: val }
                    : { stringValue: String(val) },
              })),
              status: {
                code: s.status === 'ok' ? 1 : s.status === 'error' ? 2 : 0,
              },
              events: s.events.map((e) => ({
                name: e.name,
                timeUnixNano: String(Math.round(e.timestamp * 1_000_000)),
                attributes: e.attributes
                  ? Object.entries(e.attributes).map(([key, val]) => ({
                      key,
                      value: { stringValue: String(val) },
                    }))
                  : [],
              })),
            })),
          },
        ],
      },
    ],
  };

  try {
    await fetch(currentConfig.otlpEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(otlpPayload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Re-buffer on failure (drop if over limit to prevent memory leak)
    if (spanBuffer.length < MAX_BUFFER_SIZE * 2) {
      spanBuffer.unshift(...spans);
    }
  }
}

/** Shutdown tracing — flush remaining spans and stop timers. */
export async function shutdownTracing(): Promise<void> {
  stopFlushTimer();
  await flushSpans();
  activeSpans.clear();
}
