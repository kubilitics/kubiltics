import type { Cluster } from '@/stores/clusterStore';

/** State passed when navigating from Connect page to dashboard so ProtectedRoute can apply cluster. */
export interface ConnectState {
  connectedCluster: Cluster;
  connectedClusters: Cluster[];
  clusterId: string;
}
