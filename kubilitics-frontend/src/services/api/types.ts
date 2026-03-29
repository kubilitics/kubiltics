/**
 * Shared types/interfaces for the Kubilitics backend API.
 * All domain modules import from here.
 */

import type { TopologyGraph } from '@/topology/graph';

// Re-export TopologyGraph so domain modules can reference it without importing topology-engine directly
export type { TopologyGraph };

/** Cluster shape returned by GET /api/v1/clusters (matches backend models.Cluster) */
export interface BackendCluster {
  id: string;
  name: string;
  context: string;
  kubeconfig_path?: string;
  server_url?: string;
  server?: string;
  version?: string;
  status?: string;
  provider?: string; // EKS, GKE, AKS, OpenShift, Rancher, k3s, Kind, Minikube, Docker Desktop, on-prem
  last_connected?: string;
  created_at?: string;
  updated_at?: string;
  node_count?: number;
  namespace_count?: number;
  is_current?: boolean;
}

/** Cluster summary shape from GET /api/v1/clusters/{clusterId}/summary (matches backend ClusterSummary). */
export interface BackendClusterSummary {
  id: string;
  name: string;
  node_count: number;
  namespace_count: number;
  pod_count: number;
  deployment_count: number;
  service_count: number;
  statefulset_count?: number;
  replicaset_count?: number;
  daemonset_count?: number;
  job_count?: number;
  cronjob_count?: number;
  health_status: string;
}

/** Cluster overview shape from GET /api/v1/clusters/{clusterId}/overview (dashboard snapshot). */
export interface ClusterOverview {
  health: {
    score: number;
    grade: string;
    status: string;
  };
  counts: {
    nodes: number;
    pods: number;
    namespaces: number;
    deployments: number;
  };
  pod_status: {
    running: number;
    pending: number;
    failed: number;
    succeeded: number;
  };
  alerts: {
    warnings: number;
    critical: number;
    top_3: Array<{ reason: string; resource: string; namespace: string }>;
  };
  utilization?: {
    cpu_percent: number;
    memory_percent: number;
    cpu_cores: number;
    memory_gib: number;
  };
}

/** Workloads overview from GET /api/v1/clusters/{clusterId}/workloads */
export interface WorkloadsOverview {
  pulse: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    optimal_percent: number;
  };
  workloads: Array<{
    kind: string;
    name: string;
    namespace: string;
    status: string;
    ready: number;
    desired: number;
    pressure: string;
  }>;
  alerts: {
    warnings: number;
    critical: number;
    top_3: Array<{ reason: string; resource: string; namespace: string }>;
  };
}

/** GET /api/v1/capabilities */
export interface BackendCapabilities {
  resource_topology_kinds?: string[];
}

/** List response shape from GET /api/v1/clusters/{clusterId}/resources/{kind} (matches backend). */
export interface BackendResourceListResponse {
  kind?: string;
  apiVersion?: string;
  metadata?: { resourceVersion?: string; continue?: string; remainingItemCount?: number; total?: number };
  items: Record<string, unknown>[];
}

/** Rollout history entry from GET .../deployments/{namespace}/{name}/rollout-history */
export interface RolloutHistoryRevision {
  revision: number;
  creationTimestamp: string;
  changeCause: string;
  podTemplateHash: string;
  ready: number;
  desired: number;
  available: number;
  name: string;
  /** Container images from ReplicaSet pod template (order preserved). */
  images?: string[];
  /** Seconds from this revision's creation until the next revision (rollout duration); 0 for current. */
  durationSeconds?: number;
}

/** Search result item from GET /api/v1/clusters/{clusterId}/search */
export interface SearchResultItem {
  kind: string;
  name: string;
  namespace?: string;
  path: string;
}

export interface SearchResponse {
  results: SearchResultItem[];
}

/** Ref shape for consumers API (namespace/name). */
export interface ConsumersRef {
  namespace: string;
  name: string;
}

/** Response from GET .../configmaps|secrets/{namespace}/{name}/consumers */
export interface ConsumersResponse {
  pods: ConsumersRef[];
  deployments: ConsumersRef[];
  statefulSets: ConsumersRef[];
  daemonSets: ConsumersRef[];
  jobs: ConsumersRef[];
  cronJobs: ConsumersRef[];
}

/** TLS cert info from GET .../secrets/{namespace}/{name}/tls-info */
export interface TLSSecretInfo {
  issuer?: string;
  subject?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining: number;
  hasValidCert: boolean;
  error?: string;
}

/** Result type for node drain. */
export interface NodeDrainResult {
  evicted: string[];
  skipped: string[];
  errors: string[];
}

/** Event shape from GET /api/v1/clusters/{clusterId}/events (matches backend models.Event). */
export interface BackendEvent {
  id: string;
  name: string;
  event_namespace: string;
  type: string;
  reason: string;
  message: string;
  resource_kind: string;
  resource_name: string;
  namespace: string;
  first_timestamp: string;
  last_timestamp: string;
  count: number;
  source_component?: string;
  historical?: boolean;
}

/** Per-container metrics from pod metrics API. */
export interface BackendContainerMetrics {
  name: string;
  cpu: string;
  memory: string;
}

/** Pod metrics shape from GET /api/v1/clusters/{clusterId}/metrics/{namespace}/{pod}. */
export interface BackendPodMetrics {
  name: string;
  namespace: string;
  CPU: string;
  Memory: string;
  containers?: BackendContainerMetrics[];
}

/** Node metrics shape from GET /api/v1/clusters/{clusterId}/metrics/nodes/{nodeName}. */
export interface BackendNodeMetrics {
  name: string;
  CPU: string;
  Memory: string;
}

/** Deployment metrics: aggregated + per-pod from GET .../metrics/{namespace}/deployment/{name}. */
export interface BackendDeploymentMetrics {
  deploymentName: string;
  namespace: string;
  podCount: number;
  totalCPU: string;
  totalMemory: string;
  pods: BackendPodMetrics[];
}

/** Per-pod entry in unified metrics summary (backend sends lowercase cpu/memory). */
export interface BackendMetricsSummaryPod {
  name: string;
  namespace?: string;
  cpu: string;
  memory: string;
  containers?: BackendContainerMetrics[];
  network_rx_bytes?: number;
  network_tx_bytes?: number;
}

/** Unified metrics summary: one API for pod, node, deployment, replicaset, statefulset, daemonset, job, cronjob. */
export interface BackendMetricsSummary {
  cluster_id: string;
  namespace: string;
  resource_type: string;
  resource_name: string;
  total_cpu: string;
  total_memory: string;
  total_network_rx?: number;
  total_network_tx?: number;
  pod_count: number;
  pods?: BackendMetricsSummaryPod[];
  source?: string;
  warning?: string;
}

/** Response from GET .../metrics/summary. Always 200; use error_code for "no data" reasons (no silent failures). */
export interface BackendMetricsQueryResult {
  summary?: BackendMetricsSummary;
  error?: string;
  error_code?: string;
  query_ms?: number;
  cache_hit?: boolean;
}

export interface MetricsHistoryPoint {
  ts: number;
  cpu_milli: number;
  memory_mib: number;
  network_rx?: number;
  network_tx?: number;
}

export interface MetricsHistoryResponse {
  points: MetricsHistoryPoint[];
  interval_sec: number;
}

/** Response from POST /clusters/{clusterId}/shell */
export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Response from POST /clusters/{clusterId}/kcli/exec */
export interface KCLIExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Response from GET /api/v1/clusters/{clusterId}/shell/complete?line=... */
export interface ShellCompleteResult {
  completions: string[];
}

/** Response from GET /api/v1/clusters/{clusterId}/shell/status */
export interface ShellStatusResult {
  clusterId: string;
  clusterName: string;
  context: string;
  namespace: string;
  kcliAvailable: boolean;
  aiEnabled: boolean;
}

/** Response from GET /api/v1/clusters/{clusterId}/kcli/tui/state */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface KCLITUIStateResult extends ShellStatusResult { }

/** Project shape from GET /api/v1/projects (list includes cluster_count, namespace_count) */
export interface BackendProject {
  id: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
  cluster_count?: number;
  namespace_count?: number;
}

/** Project with clusters and namespaces from GET /api/v1/projects/{projectId} */
export interface BackendProjectWithDetails extends BackendProject {
  clusters: Array<{
    project_id: string;
    cluster_id: string;
    cluster_name: string;
    cluster_status: string;
    cluster_provider: string;
  }>;
  namespaces: Array<{
    project_id: string;
    cluster_id: string;
    namespace_name: string;
    team: string;
    cluster_name: string;
  }>;
}

// ── Port Forward ──────────────────────────────────────────────────────────────

export interface PortForwardStartRequest {
  resourceType: 'pod' | 'service';
  name: string;
  namespace: string;
  localPort: number;
  remotePort: number;
}

export interface PortForwardStartResponse {
  sessionId: string;
  localPort: number;
  status: string;
}

// ── File Transfer ────────────────────────────────────────────────────────

/** A single file/directory entry from the container filesystem. */
export interface ContainerFileEntry {
  name: string;
  type: 'file' | 'dir' | 'link' | 'other';
  size: number;
  modified: string;
}

// ── Blast Radius ─────────────────────────────────────────────────────────

// --- Cluster-Wide Blast Radius (V2) ---

export interface ResourceRef {
  kind: string;
  name: string;
  namespace: string;
}

export interface BlastRadiusResult {
  target_resource: ResourceRef;
  criticality_score: number;
  criticality_level: 'critical' | 'high' | 'medium' | 'low';
  blast_radius_percent: number;
  fan_in: number;
  fan_out: number;
  total_affected: number;
  affected_namespaces: number;
  is_spof: boolean;
  has_hpa: boolean;
  has_pdb: boolean;
  is_ingress_exposed: boolean;
  ingress_hosts?: string[];
  replica_count: number;
  waves: BlastWave[];
  dependency_chain: BlastDependencyEdge[];
  risk_indicators: RiskIndicator[];
  graph_node_count: number;
  graph_edge_count: number;
  graph_staleness_ms: number;
}

export interface BlastWave {
  depth: number;
  resources: AffectedResource[];
}

export interface AffectedResource {
  kind: string;
  name: string;
  namespace: string;
  impact: 'direct' | 'transitive';
  wave_depth: number;
  failure_path: PathHop[];
}

export interface PathHop {
  from: ResourceRef;
  to: ResourceRef;
  edge_type: string;
  detail: string;
}

export interface RiskIndicator {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface BlastDependencyEdge {
  source: ResourceRef;
  target: ResourceRef;
  type: string;
  detail?: string;
}

export interface GraphStatus {
  ready: boolean;
  node_count: number;
  edge_count: number;
  namespace_count: number;
  last_rebuild_ms: number;
  staleness_ms: number;
  rebuild_count: number;
  error?: string;
}

export interface BlastRadiusSummaryEntry {
  resource: ResourceRef;
  criticality_score: number;
  criticality_level: string;
  blast_radius_percent: number;
  fan_in: number;
  is_spof: boolean;
  affected_namespaces: number;
}
