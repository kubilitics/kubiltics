/**
 * CSV Export for Topology — enriches nodes with Kubernetes resource details.
 *
 * Fetches full resource data for each topology node via the backend API,
 * then exports a CSV with resource-specific fields (NFS server/path for PVs,
 * capacity, bound PVC, provisioner for StorageClass, etc.)
 */
import type { TopologyResponse } from '../types/topology';
import type { ExportContext } from './exportTopology';
import { buildExportFilename } from './exportTopology';
import { downloadFile } from '../graph/utils/exportUtils';
import { getResource } from '@/services/api/resources';
import { toast } from '@/components/ui/sonner';

/** Escape a CSV field (wrap in quotes if it contains comma, quote, or newline) */
function csvEscape(val: string): string {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/** Extract a nested value from an object by dot-delimited path */
function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return '';
  if (typeof current === 'object') return JSON.stringify(current);
  return String(current);
}

/** Resource-specific fields to extract for each kind */
const KIND_FIELDS: Record<string, { header: string; path: string }[]> = {
  PersistentVolume: [
    { header: 'Capacity', path: 'spec.capacity.storage' },
    { header: 'Access Modes', path: 'spec.accessModes' },
    { header: 'Reclaim Policy', path: 'spec.persistentVolumeReclaimPolicy' },
    { header: 'Storage Class', path: 'spec.storageClassName' },
    { header: 'Volume Type', path: 'spec.nfs' },
    { header: 'NFS Server', path: 'spec.nfs.server' },
    { header: 'NFS Path', path: 'spec.nfs.path' },
    { header: 'CSI Driver', path: 'spec.csi.driver' },
    { header: 'CSI Volume Handle', path: 'spec.csi.volumeHandle' },
    { header: 'Host Path', path: 'spec.hostPath.path' },
    { header: 'Claim Ref', path: 'status.phase' },
    { header: 'Bound PVC', path: 'spec.claimRef.name' },
    { header: 'Bound PVC Namespace', path: 'spec.claimRef.namespace' },
  ],
  PersistentVolumeClaim: [
    { header: 'Capacity', path: 'status.capacity.storage' },
    { header: 'Access Modes', path: 'spec.accessModes' },
    { header: 'Storage Class', path: 'spec.storageClassName' },
    { header: 'Volume Name', path: 'spec.volumeName' },
    { header: 'Phase', path: 'status.phase' },
  ],
  StorageClass: [
    { header: 'Provisioner', path: 'provisioner' },
    { header: 'Reclaim Policy', path: 'reclaimPolicy' },
    { header: 'Volume Binding Mode', path: 'volumeBindingMode' },
    { header: 'Allow Expansion', path: 'allowVolumeExpansion' },
    { header: 'Parameters', path: 'parameters' },
  ],
  Service: [
    { header: 'Type', path: 'spec.type' },
    { header: 'Cluster IP', path: 'spec.clusterIP' },
    { header: 'External IPs', path: 'spec.externalIPs' },
    { header: 'Ports', path: 'spec.ports' },
    { header: 'Selector', path: 'spec.selector' },
  ],
  Deployment: [
    { header: 'Replicas', path: 'spec.replicas' },
    { header: 'Available', path: 'status.availableReplicas' },
    { header: 'Strategy', path: 'spec.strategy.type' },
    { header: 'Image', path: 'spec.template.spec.containers.0.image' },
  ],
  StatefulSet: [
    { header: 'Replicas', path: 'spec.replicas' },
    { header: 'Ready', path: 'status.readyReplicas' },
    { header: 'Service Name', path: 'spec.serviceName' },
    { header: 'Image', path: 'spec.template.spec.containers.0.image' },
  ],
  Pod: [
    { header: 'Phase', path: 'status.phase' },
    { header: 'Node', path: 'spec.nodeName' },
    { header: 'IP', path: 'status.podIP' },
    { header: 'Image', path: 'spec.containers.0.image' },
  ],
  Ingress: [
    { header: 'Class', path: 'spec.ingressClassName' },
    { header: 'Hosts', path: 'spec.rules' },
  ],
  Node: [
    { header: 'OS', path: 'status.nodeInfo.osImage' },
    { header: 'Kubelet Version', path: 'status.nodeInfo.kubeletVersion' },
    { header: 'Internal IP', path: 'status.addresses' },
  ],
};

/**
 * Export topology as enriched CSV with K8s resource-specific fields.
 */
export async function exportTopologyCSV(
  topology: TopologyResponse | null,
  baseUrl: string,
  clusterId: string,
  ctx?: ExportContext,
): Promise<void> {
  if (!topology || topology.nodes.length === 0) {
    toast.error('No topology data to export');
    return;
  }

  const toastId = toast.loading(`Exporting ${topology.nodes.length} resources...`);

  try {
    // Collect all unique extra headers from all node kinds
    const allExtraHeaders = new Set<string>();
    for (const node of topology.nodes) {
      const fields = KIND_FIELDS[node.kind];
      if (fields) {
        for (const f of fields) allExtraHeaders.add(f.header);
      }
    }
    const extraHeaders = Array.from(allExtraHeaders);

    // Base headers always present
    const baseHeaders = ['Kind', 'Name', 'Namespace', 'Status', 'Created'];

    // Fetch full resource data for each node (parallel, batched)
    const resourceData = new Map<string, Record<string, unknown>>();
    const fetchPromises = topology.nodes.map(async (node) => {
      if (!node.kind || !node.name) return;
      try {
        const ns = node.namespace || '-';
        const kindPlural = node.kind.toLowerCase() + (node.kind.endsWith('s') ? '' : 's');
        const data = await getResource(baseUrl, clusterId, kindPlural, ns, node.name);
        resourceData.set(node.id, data as Record<string, unknown>);
      } catch {
        // Skip resources that fail to fetch (deleted, RBAC, etc.)
      }
    });

    await Promise.all(fetchPromises);

    // Build CSV rows
    const rows: string[][] = [];

    // Section 1: Resources
    const resourceCount = topology.nodes.length;
    rows.push([`RESOURCES (${resourceCount})`]);
    rows.push(['#', ...baseHeaders, ...extraHeaders]);

    let resourceNum = 1;
    for (const node of topology.nodes) {
      const baseRow = [
        node.kind,
        node.name,
        node.namespace || '',
        node.status || '',
        node.createdAt || '',
      ];

      const fullResource = resourceData.get(node.id);
      const kindFields = KIND_FIELDS[node.kind] || [];

      const extraValues = extraHeaders.map((header) => {
        const field = kindFields.find((f) => f.header === header);
        if (!field || !fullResource) return '';
        return getNestedValue(fullResource, field.path);
      });

      rows.push([String(resourceNum++), ...baseRow, ...extraValues]);
    }

    // Section 2: Relationships
    rows.push([]);
    const relationshipCount = topology.edges.filter((e) => {
      return topology.nodes.some((n) => n.id === e.source) && topology.nodes.some((n) => n.id === e.target);
    }).length;
    rows.push([`RELATIONSHIPS (${relationshipCount})`]);
    rows.push(['#', 'Source Kind', 'Source Name', 'Source Namespace', 'Relationship', 'Target Kind', 'Target Name', 'Target Namespace']);

    let relNum = 1;
    for (const edge of topology.edges) {
      const srcNode = topology.nodes.find((n) => n.id === edge.source);
      const tgtNode = topology.nodes.find((n) => n.id === edge.target);
      if (!srcNode || !tgtNode) continue;
      rows.push([
        String(relNum++),
        srcNode.kind, srcNode.name, srcNode.namespace || '',
        edge.relationshipType || edge.label || '',
        tgtNode.kind, tgtNode.name, tgtNode.namespace || '',
      ]);
    }

    // Generate CSV string
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const filename = buildExportFilename('csv', ctx);
    await downloadFile(blob, filename);

    toast.dismiss(toastId);
    toast.success(`Exported ${topology.nodes.length} resources + ${topology.edges.length} relationships`);
  } catch (err) {
    toast.dismiss(toastId);
    toast.error(`CSV export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
