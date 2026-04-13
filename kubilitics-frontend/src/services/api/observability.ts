/**
 * Observability setup API client — talks to the read-only tracing endpoints.
 *
 * All functions are GETs. There are no mutations. The principle is captured
 * in docs/architecture/cluster-mutation-policy.md.
 */
import { backendRequest } from './client';

export type ComponentStatus = 'missing' | 'installing' | 'ready' | 'no-data';

export interface TracingComponent {
  key: 'cert-manager' | 'otel-operator' | 'kubilitics-collector' | 'trace-ingestion';
  name: string;
  status: ComponentStatus;
  namespace?: string;
  version_installed: string | null;
  version_required?: string;
  skip_if_present: boolean;
  spans_per_minute?: number;
  last_span_seen_at?: number; // unix ms
  pod_status?: string;
  service_endpoints?: number;
}

export interface TracingInstallCommands {
  helm: string;
  kubectl: string;
  kustomize_url: string;
}

export interface TracingStatusResponse {
  cluster_id: string;
  cluster_name: string;
  backend_url: string;
  all_ready: boolean;
  components: TracingComponent[];
  install: TracingInstallCommands;
}

export interface Diagnosis {
  signature: string;
  title: string;
  remediation: string;
  test_command?: string;
}

export interface DiagnosticCheck {
  name: string;
  passed: boolean;
  detail?: string;
  duration_ms: number;
  likely_causes?: Diagnosis[];
}

export interface DiagnosticsResponse {
  checks: DiagnosticCheck[];
  summary: string;
}

export interface ContainerInstrumentation {
  name: string;
  image: string;
  detected_language: string;
  confidence: 'high' | 'medium' | 'low';
  detection_source: string;
  supports_auto: boolean;
  instrumented: boolean;
}

export interface PreflightCheck {
  name: string;
  severity: 'blocking' | 'warning' | 'info';
  passed: boolean;
  message: string;
  detail?: string;
}

export interface PreflightChecks {
  passed: boolean;
  checks: PreflightCheck[];
}

export interface InstrumentCommandResponse {
  deployment: string;
  namespace: string;
  containers: ContainerInstrumentation[];
  preflight: PreflightChecks;
  command: string; // empty if manual_guide is set
  verify_command: string;
  uninstrument_command: string;
  manual_guide: { language: string; snippets: { filename: string; language: string; content: string }[] } | null;
}

export async function getTracingStatus(
  baseUrl: string,
  clusterId: string,
): Promise<TracingStatusResponse> {
  return backendRequest<TracingStatusResponse>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/status`,
  );
}

export async function getTracingDiagnostics(
  baseUrl: string,
  clusterId: string,
): Promise<DiagnosticsResponse> {
  return backendRequest<DiagnosticsResponse>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/diagnostics`,
  );
}

export function getInstallYamlUrl(baseUrl: string, clusterId: string): string {
  return `${baseUrl}/api/v1/clusters/${encodeURIComponent(clusterId)}/install/kubilitics-otel.yaml`;
}

export async function getInstrumentCommand(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  deployment: string,
): Promise<InstrumentCommandResponse> {
  return backendRequest<InstrumentCommandResponse>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(deployment)}/instrument-command`,
  );
}
