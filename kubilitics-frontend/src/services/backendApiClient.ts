/**
 * Kubilitics backend API client.
 *
 * THIS FILE IS A THIN RE-EXPORT BARREL.
 * All implementations live in src/services/api/ domain modules.
 * This file exists for backward compatibility — all existing imports
 * from '@/services/backendApiClient' continue to work unchanged.
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
  isBackendCircuitOpen,
  getBackendCircuitCloseTime,
  resetBackendCircuit,
} from './api/client';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
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
} from './api/types';

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
} from './api/clusters';

// ── Topology ──────────────────────────────────────────────────────────────────
export {
  getTopology,
  getResourceTopology,
  getTopologyV2,
  getTopologyExportDrawio,
} from './api/topology';
export { getBlastRadius } from './api/blastRadius';

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
} from './api/resources';

// ── Events ────────────────────────────────────────────────────────────────────
export {
  getEvents,
  getResourceEvents,
} from './api/events';

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
} from './api/metrics';

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
} from './api/shell';

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
} from './api/projects';

// ── Port Forward / File Transfer ──────────────────────────────────────────────
export {
  startPortForward,
  createDebugContainer,
  stopPortForward,
  listContainerFiles,
  getContainerFileDownloadUrl,
  uploadContainerFile,
} from './api/portforward';

// ── Factory ───────────────────────────────────────────────────────────────────
export { createBackendApiClient } from './api/factory';
