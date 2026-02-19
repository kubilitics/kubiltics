/**
 * Kubilitics AI service layer.
 * HTTP client for the kubilitics-ai backend (default port 8081).
 *
 * Endpoints covered:
 *   GET  /health                              - health check
 *   GET  /ready                               - readiness check
 *   GET  /info                                - server info
 *   POST /api/v1/llm/complete                 - non-streaming LLM completion
 *   POST /api/v1/llm/stream                   - streaming via SSE
 *   POST /api/v1/safety/evaluate              - safety evaluation
 *   GET  /api/v1/safety/rules                 - list safety rules
 *   GET  /api/v1/safety/policies              - list safety policies
 *   GET  /api/v1/analytics/anomalies          - anomaly detection results
 *   GET  /api/v1/analytics/trends             - trend analysis
 *   GET  /api/v1/analytics/recommendations    - AI-driven recommendations
 *   GET  /api/v1/conversations                - list conversations
 *   GET  /api/v1/conversations/{id}           - get conversation by ID
 *   WS   /ws/chat                             - AI chat WebSocket (see useWebSocket hook)
 *
 * Configuration:
 *   VITE_AI_BACKEND_URL  - HTTP base URL  (default http://localhost:8081)
 *   VITE_AI_WS_URL       - WebSocket URL  (default ws://localhost:8081)
 */

// ─── Base URL ────────────────────────────────────────────────────────────────

import { getCurrentAiBackendUrl, getCurrentAiWsUrl } from '@/stores/backendConfigStore';
import { getAIAvailableForRequest } from '@/stores/aiAvailableStore';
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_WS_URL } from '@/lib/backendConstants';

export const AI_BASE_URL = DEFAULT_AI_BASE_URL;
export const AI_WS_URL = DEFAULT_AI_WS_URL;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AITool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface AICompleteRequest {
  messages: AIMessage[];
  tools?: AITool[];
  stream?: boolean;
}

export interface AICompleteResponse {
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
}

export interface AIServerInfo {
  name: string;
  version: string;
  llm_provider: string;
  safety_engine_enabled: boolean;
  analytics_enabled: boolean;
  autonomy_level: number;
  timestamp: string;
}

export interface AIHealthResponse {
  status: 'healthy' | 'not_ready';
  timestamp?: string;
}

export interface SafetyEvaluateRequest {
  action: string;
  context?: Record<string, unknown>;
}

export interface SafetyEvaluateResponse {
  allowed: boolean;
  risk_level: string;
  reason: string;
  autonomy_required: number;
}

export interface AnalyticsAnomaly {
  resource: string;
  namespace: string;
  metric: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detected_at: string;
  value: number;
  threshold: number;
}

export interface AnalyticsTrend {
  resource: string;
  metric: string;
  direction: 'increasing' | 'decreasing' | 'stable';
  change_percent: number;
  period: string;
}

export interface AnalyticsRecommendation {
  id: string;
  type: string;
  resource: string;
  namespace: string;
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  potential_savings?: number;
}

export interface ConversationMessage {
  role: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  messages: ConversationMessage[];
  context?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom' | 'none';
  api_key?: string;
  base_url?: string;
  model?: string;
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class AIServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

// ─── Core request helper ─────────────────────────────────────────────────────

async function aiRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  // P2-8: In Tauri, do not hit AI backend when sidecar is not available.
  if (!getAIAvailableForRequest()) {
    throw new AIServiceError('AI backend is not available.');
  }

  const url = `${getCurrentAiBackendUrl()}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (err) {
    throw new AIServiceError(
      `AI service unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AIServiceError(
      `AI service error ${response.status} on ${path}`,
      response.status,
      body
    );
  }

  return response.json() as Promise<T>;
}

// ─── Health & Info ────────────────────────────────────────────────────────────

export async function getAIHealth(): Promise<AIHealthResponse> {
  return aiRequest<AIHealthResponse>('/health');
}

export async function getAIReadiness(): Promise<AIHealthResponse> {
  return aiRequest<AIHealthResponse>('/ready');
}

export async function getAIInfo(): Promise<AIServerInfo> {
  return aiRequest<AIServerInfo>('/info');
}

// ─── LLM Completion ──────────────────────────────────────────────────────────

export async function llmComplete(
  req: AICompleteRequest
): Promise<AICompleteResponse> {
  return aiRequest<AICompleteResponse>('/api/v1/llm/complete', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ─── Safety ──────────────────────────────────────────────────────────────────

export async function safetyEvaluate(
  req: SafetyEvaluateRequest
): Promise<SafetyEvaluateResponse> {
  return aiRequest<SafetyEvaluateResponse>('/api/v1/safety/evaluate', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function getSafetyRules(): Promise<unknown[]> {
  return aiRequest<unknown[]>('/api/v1/safety/rules');
}

export async function getSafetyPolicies(): Promise<unknown[]> {
  return aiRequest<unknown[]>('/api/v1/safety/policies');
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export async function getAnomalies(
  namespace?: string
): Promise<AnalyticsAnomaly[]> {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return aiRequest<AnalyticsAnomaly[]>(`/api/v1/analytics/anomalies${qs}`);
}

export async function getTrends(
  namespace?: string
): Promise<AnalyticsTrend[]> {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return aiRequest<AnalyticsTrend[]>(`/api/v1/analytics/trends${qs}`);
}

export async function getRecommendations(
  namespace?: string
): Promise<AnalyticsRecommendation[]> {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return aiRequest<AnalyticsRecommendation[]>(
    `/api/v1/analytics/recommendations${qs}`
  );
}

// ─── ML Analytics (A-CORE-ML) ─────────────────────────────────────────────────
// These endpoints are handled by ml_handlers.go in the AI backend.

export interface MLAnomalyPoint {
  timestamp: string;
  value: number;
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  path_length?: number;
}

export interface MLModelInfo {
  algorithm: string;
  num_trees: number;
  sample_size: number;
  threshold: number;
  total_points: number;
}

export interface MLAnomalyRequest {
  time_series: {
    metric_name: string;
    metric_type: string;
    data: Array<{ timestamp: string; value: number }>;
  };
  algorithm?: 'isolation_forest' | 'ensemble';
  sensitivity?: number;
  num_trees?: number;
  sample_size?: number;
}

export interface MLAnomalyResponse {
  anomalies: MLAnomalyPoint[];
  model_info: MLModelInfo;
  total_points: number;
  anomaly_rate: number;
}

export async function detectMLAnomalies(
  req: MLAnomalyRequest
): Promise<MLAnomalyResponse> {
  return aiRequest<MLAnomalyResponse>('/api/v1/analytics/ml/anomalies', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export interface ForecastPoint {
  timestamp: string;
  value: number;
  lower_95: number;
  upper_95: number;
}

export interface ForecastModelInfo {
  order: number[];
  fitted: boolean;
  ar_coeffs: number[];
  ma_coeffs: number[];
  constant: number;
  std_error: number;
  n_residuals: number;
}

export interface ForecastRequest {
  time_series: {
    metric_name: string;
    metric_type: string;
    data: Array<{ timestamp: string; value: number }>;
  };
  forecast_steps?: number;
  model?: 'arima' | 'auto';
  arima_order?: [number, number, number];
}

export interface ForecastResponse {
  forecasts: ForecastPoint[];
  model_info: ForecastModelInfo;
  std_error: number;
  metric_name: string;
  forecast_horizon: number;
}

export async function forecastTimeSeries(
  req: ForecastRequest
): Promise<ForecastResponse> {
  return aiRequest<ForecastResponse>('/api/v1/analytics/forecast', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export interface MLModelDescription {
  name: string;
  algorithm: string;
  parameters: Record<string, unknown>;
  use_cases: string[];
  output_fields: string[];
}

export async function getMLModels(): Promise<{ models: MLModelDescription[] }> {
  return aiRequest<{ models: MLModelDescription[] }>('/api/v1/analytics/ml/models');
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function listConversations(): Promise<{
  conversations: Conversation[];
  count: number;
}> {
  return aiRequest<{ conversations: Conversation[]; count: number }>(
    '/api/v1/conversations'
  );
}

export async function getConversation(id: string): Promise<Conversation> {
  return aiRequest<Conversation>(`/api/v1/conversations/${id}`);
}

// ─── LLM Provider Configuration (stored in local storage for now) ─────────────

const LLM_CONFIG_KEY = 'kubilitics_ai_provider_config';

export async function updateAIConfiguration(config: LLMProviderConfig): Promise<void> {
  // Security fix: Send config to backend, never store API keys in localStorage.
  await aiRequest('/api/v1/config/provider', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getAIConfiguration(): Promise<LLMProviderConfig> {
  return aiRequest<LLMProviderConfig>('/api/v1/config/provider');
}

/**
 * @deprecated Use updateAIConfiguration (server-side persistence) instead.
 * This remains only for non-sensitive preferences if needed.
 */
export function saveLLMProviderConfig(config: LLMProviderConfig): void {
  // Legacy cleanup: ensure no sensitive data lingers
  localStorage.removeItem(LLM_CONFIG_KEY);
}

/**
 * @deprecated Use getAIConfiguration (server-side persistence) instead.
 */
export function loadLLMProviderConfig(): LLMProviderConfig | null {
  return null;
}

export function clearLLMProviderConfig(): void {
  localStorage.removeItem(LLM_CONFIG_KEY);
}

// ─── Investigations ───────────────────────────────────────────────────────────

export interface InvestigationCreateRequest {
  description: string;
  type?: string;
}

export interface InvestigationCreateResponse {
  id: string;
  type: string;
  description: string;
  state: string;
  stream_url: string;
}

export interface InvestigationSummary {
  id: string;
  type: string;
  state: string;
  description: string;
  conclusion: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  concluded_at?: string;
}

export async function createInvestigation(
  req: InvestigationCreateRequest
): Promise<InvestigationCreateResponse> {
  return aiRequest<InvestigationCreateResponse>('/api/v1/investigations', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function listInvestigations(): Promise<{
  investigations: InvestigationSummary[];
  count: number;
}> {
  return aiRequest<{ investigations: InvestigationSummary[]; count: number }>(
    '/api/v1/investigations'
  );
}

export async function getInvestigation(id: string): Promise<InvestigationSummary> {
  return aiRequest<InvestigationSummary>(`/api/v1/investigations/${id}`);
}

export async function cancelInvestigation(id: string): Promise<{ id: string; state: string }> {
  return aiRequest<{ id: string; state: string }>(`/api/v1/investigations/${id}`, {
    method: 'DELETE',
  });
}

/** Build a WebSocket URL for streaming investigation events */
export function buildInvestigationStreamUrl(id: string): string {
  return `${getCurrentAiWsUrl()}/ws/investigations/${id}`;
}

// ─── WebSocket chat URL builder ───────────────────────────────────────────────

export interface WSChatContext {
  namespace?: string;
  resource?: string;
  screen?: string;
}

export function buildChatWSUrl(context?: WSChatContext): string {
  const params = new URLSearchParams();
  if (context?.namespace) params.set('namespace', context.namespace);
  if (context?.resource) params.set('resource', context.resource);
  if (context?.screen) params.set('screen', context.screen);
  const qs = params.toString();
  return `${getCurrentAiWsUrl()}/ws/chat${qs ? `?${qs}` : ''}`;
}
