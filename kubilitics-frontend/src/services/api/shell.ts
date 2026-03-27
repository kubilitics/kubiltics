/**
 * Shell/exec endpoints: kubectl shell, kcli, pod exec, pod logs, completions.
 */
import { API_PREFIX, backendRequest } from './client';
import type {
  ShellCommandResult,
  KCLIExecResult,
  ShellCompleteResult,
  ShellStatusResult,
  KCLITUIStateResult,
} from './types';

/**
 * Returns the URL for GET /api/v1/clusters/{clusterId}/logs/{namespace}/{pod}.
 * Use with fetch() for streaming or non-streaming log read.
 */
export function getPodLogsUrl(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  pod: string,
  params?: { container?: string; tail?: number; follow?: boolean }
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const search = new URLSearchParams();
  if (params?.container) search.set('container', params.container);
  if (params?.tail != null) search.set('tail', String(params.tail));
  if (params?.follow) search.set('follow', 'true');
  const query = search.toString();
  return `${normalizedBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/logs/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}${query ? `?${query}` : ''}`;
}

/**
 * Returns the WebSocket URL for GET /api/v1/clusters/{clusterId}/pods/{namespace}/{name}/exec.
 * Converts http(s) baseUrl to ws(s). When baseUrl is empty (dev proxy), uses window.location.origin.
 */
export function getPodExecWebSocketUrl(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  podName: string,
  params?: { container?: string; shell?: string }
): string {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
  let wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!wsBase && typeof window !== 'undefined') {
    wsBase = window.location.origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  const search = new URLSearchParams();
  if (params?.container) search.set('container', params.container);
  if (params?.shell) search.set('shell', params.shell);
  const query = search.toString();
  return `${wsBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/exec${query ? `?${query}` : ''}`;
}

/**
 * WebSocket URL for GET /api/v1/clusters/{clusterId}/shell/stream — full PTY cloud shell
 * (kubectl and any CLI with cluster KUBECONFIG set). Same protocol as pod exec: stdin, resize, stdout/stderr.
 * When baseUrl is empty (dev proxy), uses window.location.origin so the URL is absolute and the proxy is used.
 */
export function getKubectlShellStreamUrl(baseUrl: string, clusterId: string): string {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
  let wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!wsBase && typeof window !== 'undefined') {
    wsBase = window.location.origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  return `${wsBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/shell/stream`;
}

/**
 * WebSocket URL for GET /api/v1/clusters/{clusterId}/kcli/stream.
 * Always uses shell mode (interactive kcli shell with kcli on PATH).
 * namespace (optional) starts the shell in that namespace.
 */
export function getKCLIShellStreamUrl(
  baseUrl: string,
  clusterId: string,
  mode: 'shell' = 'shell',
  namespace?: string
): string {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
  let wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!wsBase && typeof window !== 'undefined') {
    wsBase = window.location.origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  const search = new URLSearchParams({ mode: 'shell' });
  if (namespace && namespace !== 'all') {
    search.set('namespace', namespace);
  }
  return `${wsBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/kcli/stream?${search.toString()}`;
}

/**
 * POST /api/v1/clusters/{clusterId}/shell — run a kubectl command (get, describe, logs, top, etc.) and return output.
 */
export async function postShellCommand(
  baseUrl: string,
  clusterId: string,
  command: string
): Promise<ShellCommandResult> {
  return backendRequest<ShellCommandResult>(baseUrl, `clusters/${encodeURIComponent(clusterId)}/shell`, {
    method: 'POST',
    body: JSON.stringify({ command: command.trim() }),
  });
}

/**
 * POST /api/v1/clusters/{clusterId}/kcli/exec — run kcli args server-side for embedded mode.
 */
export async function postKCLIExec(
  baseUrl: string,
  clusterId: string,
  args: string[],
  force = false
): Promise<KCLIExecResult> {
  const headers: Record<string, string> = {};
  if (force) {
    headers['X-Confirm-Destructive'] = 'true';
  }
  return backendRequest<KCLIExecResult>(baseUrl, `clusters/${encodeURIComponent(clusterId)}/kcli/exec`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ args, force }),
  });
}

/**
 * GET /api/v1/clusters/{clusterId}/shell/complete?line=... — IDE-style kubectl completions (optional for dropdown).
 */
export async function getShellComplete(
  baseUrl: string,
  clusterId: string,
  line: string
): Promise<ShellCompleteResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/shell/complete`;
  const query = line ? `?line=${encodeURIComponent(line)}` : '';
  return backendRequest<ShellCompleteResult>(baseUrl, `${path}${query}`);
}

/**
 * GET /api/v1/clusters/{clusterId}/shell/status — shell context/namespace and capability metadata.
 */
export async function getShellStatus(
  baseUrl: string,
  clusterId: string
): Promise<ShellStatusResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/shell/status`;
  return backendRequest<ShellStatusResult>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/kcli/tui/state — context + namespace + capability metadata for kcli shell panel.
 */
export async function getKCLITUIState(
  baseUrl: string,
  clusterId: string
): Promise<KCLITUIStateResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/kcli/tui/state`;
  return backendRequest<KCLITUIStateResult>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/kcli/complete?line=... — IDE-style kcli completions.
 */
export async function getKCLIComplete(
  baseUrl: string,
  clusterId: string,
  line: string
): Promise<ShellCompleteResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/kcli/complete`;
  const query = line ? `?line=${encodeURIComponent(line)}` : '';
  return backendRequest<ShellCompleteResult>(baseUrl, `${path}${query}`);
}
