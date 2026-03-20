/**
 * Kubilitics backend API client and types.
 * Use useBackendClient() when backend base URL is configured (backendConfigStore).
 */
export {
  getClusters,
  getTopology,
  getResourceTopology,
  getTopologyExportDrawio,
  getHealth,
  listResources,
  getResource,
  backendRequest,
  createBackendApiClient,
  BackendApiError,
  type BackendCluster,
  type BackendResourceListResponse,
} from './backendApiClient';
