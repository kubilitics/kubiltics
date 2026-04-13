/**
 * Tracing API client — enable/disable distributed tracing, query agent status,
 * and instrument deployments via the Kubilitics backend tracing endpoints.
 */
import { backendRequest } from './client';

export interface DeploymentInfo {
  name: string;
  namespace: string;
  image: string;
  detected_language: string;
  replicas: number;
  instrumented: boolean;
}

export interface TracingStatus {
  enabled: boolean;
  agent_healthy: boolean;
  agent_span_count: number;
  instrumented_deployments: string[];
  available_deployments: DeploymentInfo[];
}

export interface InstrumentRequest {
  deployments: Array<{ name: string; namespace: string }>;
}

export async function enableTracing(
  baseUrl: string,
  clusterId: string,
): Promise<{ status: string; message: string }> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/enable`,
    { method: 'POST' },
  );
}

export async function getTracingStatus(
  baseUrl: string,
  clusterId: string,
): Promise<TracingStatus> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/status`,
  );
}

export async function instrumentDeployments(
  baseUrl: string,
  clusterId: string,
  req: InstrumentRequest,
): Promise<{ instrumented: string[]; restarting: boolean }> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/instrument`,
    {
      method: 'POST',
      body: JSON.stringify(req),
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export interface InstrumentationStatus {
  instrumented: boolean;
  language?: string;
  detected_language: string;
  annotation?: string;
  otel_operator_ready: boolean;
  supports_language: boolean;
}

export async function getInstrumentationStatus(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  deployment: string,
): Promise<InstrumentationStatus> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(deployment)}/instrumentation-status`,
  );
}

export async function instrumentDeployment(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  deployment: string,
  language?: string,
): Promise<{ instrumented: boolean; language: string; rollout_started: boolean; already?: boolean }> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(deployment)}/instrument`,
    {
      method: 'POST',
      body: JSON.stringify(language ? { language } : {}),
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function uninstrumentDeployment(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  deployment: string,
): Promise<{ instrumented: boolean }> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(deployment)}/uninstrument`,
    { method: 'POST' },
  );
}

export async function disableTracing(
  baseUrl: string,
  clusterId: string,
): Promise<{ status: string }> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/disable`,
    { method: 'POST' },
  );
}
