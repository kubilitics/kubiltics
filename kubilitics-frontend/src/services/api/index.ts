/**
 * Barrel file: re-exports all API modules for convenience.
 * Import from '@/services/api' or from individual domain files.
 */

// ── Client infrastructure ─────────────────────────────────────────────────────
export {
  API_PREFIX,
  CONFIRM_DESTRUCTIVE_HEADER,
  BackendApiError,
  backendRequest,
  backendRequestText,
  getHealth,
  markBackendReady,
  isBackendEverReady,
  isBackendCircuitOpen,
  getBackendCircuitCloseTime,
  resetBackendCircuit,
  markBackendUnavailable,
  isNetworkError,
  isCORSError,
  extractClusterIdFromPath,
} from './client';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  TopologyGraph,
  BackendCluster,
  BackendClusterSummary,
  ClusterOverview,
  WorkloadsOverview,
  BackendCapabilities,
  BackendResourceListResponse,
  RolloutHistoryRevision,
  SearchResultItem,
  SearchResponse,
  ConsumersRef,
  ConsumersResponse,
  TLSSecretInfo,
  NodeDrainResult,
  BackendEvent,
  BackendContainerMetrics,
  BackendPodMetrics,
  BackendNodeMetrics,
  BackendDeploymentMetrics,
  BackendMetricsSummaryPod,
  BackendMetricsSummary,
  BackendMetricsQueryResult,
  MetricsHistoryPoint,
  MetricsHistoryResponse,
  ShellCommandResult,
  KCLIExecResult,
  ShellCompleteResult,
  ShellStatusResult,
  KCLITUIStateResult,
  BackendProject,
  BackendProjectWithDetails,
  PortForwardStartRequest,
  PortForwardStartResponse,
  ContainerFileEntry,
} from './types';

// ── Clusters ──────────────────────────────────────────────────────────────────
export {
  getCapabilities,
  getClusters,
  discoverClusters,
  getClusterFeatureMetallb,
  getClusterSummary,
  getClusterOverview,
  getWorkloadsOverview,
  addCluster,
  addClusterWithUpload,
  reconnectCluster,
  deleteCluster,
  getClusterKubeconfig,
} from './clusters';

// ── Topology ──────────────────────────────────────────────────────────────────
export {
  getTopology,
  getResourceTopology,
  getTopologyV2,
  getTopologyExportDrawio,
} from './topology';

// ── Resources ─────────────────────────────────────────────────────────────────
export {
  listCRDInstances,
  listResources,
  getResource,
  patchResource,
  deleteResource,
  applyManifest,
  searchResources,
  getDeploymentRolloutHistory,
  getServiceEndpoints,
  getConfigMapConsumers,
  getSecretConsumers,
  getSecretTLSInfo,
  getPVCConsumers,
  getStorageClassPVCounts,
  getNamespaceCounts,
  getServiceAccountTokenCounts,
  postDeploymentRollback,
  postNodeCordon,
  postNodeDrain,
  postCronJobTrigger,
  getCronJobJobs,
  postJobRetry,
} from './resources';

// ── Events ────────────────────────────────────────────────────────────────────
export {
  getEvents,
  getResourceEvents,
} from './events';

// ── Metrics ───────────────────────────────────────────────────────────────────
export {
  getPodMetrics,
  getNodeMetrics,
  getDeploymentMetrics,
  getReplicaSetMetrics,
  getStatefulSetMetrics,
  getDaemonSetMetrics,
  getJobMetrics,
  getCronJobMetrics,
  getMetricsSummary,
  getMetricsHistory,
} from './metrics';

// ── Shell ─────────────────────────────────────────────────────────────────────
export {
  getPodLogsUrl,
  getPodExecWebSocketUrl,
  getKubectlShellStreamUrl,
  getKCLIShellStreamUrl,
  postShellCommand,
  postKCLIExec,
  getShellComplete,
  getShellStatus,
  getKCLITUIState,
  getKCLIComplete,
} from './shell';

// ── Projects ──────────────────────────────────────────────────────────────────
export {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addClusterToProject,
  removeClusterFromProject,
  addNamespaceToProject,
  removeNamespaceFromProject,
} from './projects';

// ── Port Forward / File Transfer ──────────────────────────────────────────────
export {
  startPortForward,
  createDebugContainer,
  stopPortForward,
  listContainerFiles,
  getContainerFileDownloadUrl,
  uploadContainerFile,
} from './portforward';

// ── Factory ───────────────────────────────────────────────────────────────────
export { createBackendApiClient } from './factory';
