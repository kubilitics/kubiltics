// Cross-cutting types for the onboarding-v2 epic — mirror the Go shapes.
// Keep in sync with kubilitics-backend/internal/cluster/identity/logical.go
// and internal/api/resilient/envelope.go.

export interface LogicalIdentity {
  name: string;
  serverUrl: string;
}

export function logicalIdentityKey(id: LogicalIdentity): string {
  return `${id.name}|${normalizeUrl(id.serverUrl)}`;
}

export function logicalIdentityEqual(a: LogicalIdentity, b: LogicalIdentity): boolean {
  return logicalIdentityKey(a) === logicalIdentityKey(b);
}

function normalizeUrl(raw: string): string {
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
}

export interface RegisteredCluster extends DiscoveredCluster {
  registered_at: string;
  reachable: boolean;
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
