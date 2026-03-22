/**
 * Scanner API client for the DevSecOps scanning engine.
 */
import type {
  ScanRun,
  ScanFinding,
  ScanStats,
  ScannerTool,
} from '@/types/scanner';

const API_PREFIX = '/api/v1';

function getBaseUrl(): string {
  // Support VITE_API_URL or VITE_BACKEND_URL, falling back to empty string (same-origin)
  return (
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    ''
  );
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Scanner API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function startScan(
  targetType: string = 'directory',
  targetPath: string = '.',
  scanners?: string[]
): Promise<ScanRun> {
  return apiFetch<ScanRun>('/scanner/runs', {
    method: 'POST',
    body: JSON.stringify({
      target_type: targetType,
      target_path: targetPath,
      scanners: scanners ?? [],
    }),
  });
}

export async function listScanRuns(
  limit = 20,
  offset = 0
): Promise<{ runs: ScanRun[]; total: number }> {
  return apiFetch(`/scanner/runs?limit=${limit}&offset=${offset}`);
}

export async function getScanRun(runId: string): Promise<ScanRun> {
  return apiFetch(`/scanner/runs/${runId}`);
}

export async function listRunFindings(
  runId: string,
  params: { severity?: string; tool?: string; status?: string; limit?: number; offset?: number } = {}
): Promise<{ findings: ScanFinding[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.severity) qs.set('severity', params.severity);
  if (params.tool) qs.set('tool', params.tool);
  if (params.status) qs.set('status', params.status);
  qs.set('limit', String(params.limit ?? 100));
  qs.set('offset', String(params.offset ?? 0));
  return apiFetch(`/scanner/runs/${runId}/findings?${qs}`);
}

export async function listAllFindings(
  params: { severity?: string; tool?: string; status?: string; limit?: number; offset?: number } = {}
): Promise<{ findings: ScanFinding[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.severity) qs.set('severity', params.severity);
  if (params.tool) qs.set('tool', params.tool);
  if (params.status) qs.set('status', params.status);
  qs.set('limit', String(params.limit ?? 100));
  qs.set('offset', String(params.offset ?? 0));
  return apiFetch(`/scanner/findings?${qs}`);
}

export async function getScanStats(): Promise<ScanStats> {
  return apiFetch('/scanner/stats');
}

export async function getAvailableTools(): Promise<{ tools: ScannerTool[] }> {
  return apiFetch('/scanner/tools');
}

export function getReportUrl(runId: string, format: 'json' | 'html' | 'markdown' = 'html'): string {
  return `${getBaseUrl()}${API_PREFIX}/scanner/runs/${runId}/report?format=${format}`;
}
