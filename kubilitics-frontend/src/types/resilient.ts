// Cross-cutting types for the onboarding-v2 epic — mirror the Go shapes.
// Keep in sync with kubilitics-backend/internal/cluster/identity/logical.go
// and internal/api/resilient/envelope.go.

export interface LogicalIdentity {
  name: string;
  serverUrl: string;
}

export function logicalIdentityKey(id: LogicalIdentity): string {
  // Defensive: if the identity is malformed (e.g. backend returned an
  // unexpected shape or field is genuinely missing), return a stable
  // fallback key instead of crashing the whole page. Callers that rely
  // on uniqueness should check for `id?.name` beforehand if it matters.
  const name = id?.name ?? '';
  const server = id?.serverUrl ?? '';
  return `${name}|${normalizeUrl(server)}`;
}

export function logicalIdentityEqual(a: LogicalIdentity, b: LogicalIdentity): boolean {
  return logicalIdentityKey(a) === logicalIdentityKey(b);
}

function normalizeUrl(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string' || raw.length === 0) return '';
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

export interface ResilientResponse<T> {
  data?: T;
  reachable: boolean;
  stale?: boolean;
  stale_as_of?: string; // ISO-8601
  error_message?: string;
  health_status: 'healthy' | 'unreachable' | 'degraded';
}

export interface DiscoveredCluster {
  identity: LogicalIdentity;
  source: 'kubeconfig' | 'secret' | 'manual';
  context_name?: string;
  kubeconfig_path?: string;
  last_seen_at?: string;
  /** Backend-issued UUID for cluster-scoped API calls. Only present on
   *  entries that have been registered (ManualSource); empty until the
   *  user explicitly registers a file-/secret-sourced cluster. */
  session_id?: string;
  /** Cloud/local provider classification (eks | gke | aks | minikube |
   *  kind | docker-desktop | on-prem | openshift | rancher | k3s). */
  provider?: string;
}

export interface RegisteredCluster extends DiscoveredCluster {
  registered_at: string;
  reachable: boolean;
  /** Required on RegisteredCluster: a registered entry always has a UUID. */
  session_id: string;
}

export interface ConnectedCluster extends RegisteredCluster {
  connected_at: string;
}

export interface PresenceSnapshot {
  discovered: DiscoveredCluster[];
  registered: RegisteredCluster[];
  connected: ConnectedCluster[];
  last_used?: LogicalIdentity | null;
}

// Kind of discovery event emitted by the backend SSE stream.
export type DiscoveryEventKind =
  | 'discovered'
  | 'registered'
  | 'connected'
  | 'disconnected'
  | 'removed';
