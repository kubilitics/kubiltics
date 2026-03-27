/**
 * Factory: create a client interface bound to a base URL (for hooks/pages).
 */
import { getClusters, getClusterSummary, getClusterOverview, addCluster } from './clusters';
import { getTopology, getResourceTopology } from './topology';
import { getHealth } from './client';
import { listResources, getResource, deleteResource, applyManifest } from './resources';
import { getEvents, getResourceEvents } from './events';
import { getPodMetrics } from './metrics';
import {
  getPodLogsUrl,
  getPodExecWebSocketUrl,
  postShellCommand,
  getShellStatus,
  getKCLITUIState,
  getShellComplete,
  getKCLIComplete,
  postKCLIExec,
} from './shell';

export function createBackendApiClient(baseUrl: string) {
  return {
    getClusters: () => getClusters(baseUrl),
    getClusterSummary: (clusterId: string) => getClusterSummary(baseUrl, clusterId),
    getClusterOverview: (clusterId: string) => getClusterOverview(baseUrl, clusterId),
    addCluster: (kubeconfigPath: string, context: string) =>
      addCluster(baseUrl, kubeconfigPath, context),
    getTopology: (clusterId: string, params?: Parameters<typeof getTopology>[2]) =>
      getTopology(baseUrl, clusterId, params),
    getResourceTopology: (clusterId: string, kind: string, namespace: string, name: string) =>
      getResourceTopology(baseUrl, clusterId, kind, namespace, name),
    getHealth: () => getHealth(baseUrl),
    listResources: (clusterId: string, kind: string, params?: Parameters<typeof listResources>[3]) =>
      listResources(baseUrl, clusterId, kind, params),
    getResource: (clusterId: string, kind: string, namespace: string, name: string) =>
      getResource(baseUrl, clusterId, kind, namespace, name),
    deleteResource: (cid: string, kind: string, ns: string, n: string) =>
      deleteResource(baseUrl, cid, kind, ns, n),
    applyManifest: (cid: string, yaml: string) => applyManifest(baseUrl, cid, yaml),
    getEvents: (clusterId: string, params?: Parameters<typeof getEvents>[2]) =>
      getEvents(baseUrl, clusterId, params),
    getResourceEvents: (clusterId: string, namespace: string, kind: string, name: string, limit?: number) =>
      getResourceEvents(baseUrl, clusterId, namespace, kind, name, limit),
    getPodMetrics: (clusterId: string, namespace: string, podName: string) =>
      getPodMetrics(baseUrl, clusterId, namespace, podName),
    getPodLogsUrl: (clusterId: string, namespace: string, pod: string, params?: Parameters<typeof getPodLogsUrl>[4]) =>
      getPodLogsUrl(baseUrl, clusterId, namespace, pod, params),
    getPodExecWebSocketUrl: (clusterId: string, namespace: string, podName: string, params?: Parameters<typeof getPodExecWebSocketUrl>[4]) =>
      getPodExecWebSocketUrl(baseUrl, clusterId, namespace, podName, params),
    postShellCommand: (clusterId: string, command: string) =>
      postShellCommand(baseUrl, clusterId, command),
    getShellStatus: (clusterId: string) =>
      getShellStatus(baseUrl, clusterId),
    getKCLITUIState: (clusterId: string) =>
      getKCLITUIState(baseUrl, clusterId),
    getShellComplete: (clusterId: string, line: string) =>
      getShellComplete(baseUrl, clusterId, line),
    getKCLIComplete: (clusterId: string, line: string) =>
      getKCLIComplete(baseUrl, clusterId, line),
    postKCLIExec: (clusterId: string, args: string[], force?: boolean) =>
      postKCLIExec(baseUrl, clusterId, args, force),
  };
}
