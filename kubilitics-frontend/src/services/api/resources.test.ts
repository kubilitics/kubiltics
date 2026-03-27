/**
 * Tests for src/services/api/resources.ts
 *
 * Covers: listResources, getResource, deleteResource, applyManifest,
 * patchResource, searchResources, listCRDInstances, and specialized endpoints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBackendRequest = vi.fn();

vi.mock('./client', () => ({
  backendRequest: (...args: unknown[]) => mockBackendRequest(...args),
  BackendApiError: class BackendApiError extends Error {
    status: number;
    responseBody?: string;
    constructor(msg: string, status: number, body?: string) {
      super(msg);
      this.status = status;
      this.responseBody = body;
      this.name = 'BackendApiError';
    }
  },
  CONFIRM_DESTRUCTIVE_HEADER: 'X-Confirm-Destructive',
}));

import {
  listResources,
  getResource,
  deleteResource,
  applyManifest,
  patchResource,
  searchResources,
  listCRDInstances,
  getDeploymentRolloutHistory,
  getServiceEndpoints,
  getConfigMapConsumers,
  getSecretConsumers,
  getStorageClassPVCounts,
  getNamespaceCounts,
  postDeploymentRollback,
  postNodeCordon,
  postCronJobTrigger,
  getCronJobJobs,
} from './resources';

// Access the mocked BackendApiError for 404 test
const { BackendApiError } = await import('./client');

const BASE = 'http://localhost:8190';
const CLUSTER = 'cluster-1';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================

describe('listResources', () => {
  const listResponse = {
    items: [
      { metadata: { name: 'pod-1', namespace: 'default' } },
      { metadata: { name: 'pod-2', namespace: 'default' } },
    ],
    metadata: { total: 2, resourceVersion: '123' },
  };

  it('returns items from backend', async () => {
    mockBackendRequest.mockResolvedValue(listResponse);

    const result = await listResources(BASE, CLUSTER, 'pods');

    expect(result.items).toHaveLength(2);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/pods'
    );
  });

  it('appends namespace query param when provided', async () => {
    mockBackendRequest.mockResolvedValue(listResponse);

    await listResources(BASE, CLUSTER, 'pods', { namespace: 'kube-system' });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/pods?namespace=kube-system'
    );
  });

  it('appends namespaces query param for project scope', async () => {
    mockBackendRequest.mockResolvedValue(listResponse);

    await listResources(BASE, CLUSTER, 'pods', { namespaces: ['ns1', 'ns2'] });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/pods?namespaces=ns1%2Cns2'
    );
  });

  it('appends limit and continue params', async () => {
    mockBackendRequest.mockResolvedValue(listResponse);

    await listResources(BASE, CLUSTER, 'pods', { limit: 10, continue: 'token123' });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/pods?limit=10&continue=token123'
    );
  });

  it('appends labelSelector and fieldSelector', async () => {
    mockBackendRequest.mockResolvedValue(listResponse);

    await listResources(BASE, CLUSTER, 'pods', {
      labelSelector: 'app=web',
      fieldSelector: 'status.phase=Running',
    });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('labelSelector=app%3Dweb')
    );
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('fieldSelector=status.phase%3DRunning')
    );
  });

  it('returns empty list on 404 error', async () => {
    mockBackendRequest.mockRejectedValue(new BackendApiError('Not found', 404));

    const result = await listResources(BASE, CLUSTER, 'certificates');

    expect(result).toEqual({ items: [], metadata: { total: 0, resourceVersion: '' } });
  });

  it('propagates non-404 errors', async () => {
    mockBackendRequest.mockRejectedValue(new BackendApiError('Server error', 500));

    await expect(listResources(BASE, CLUSTER, 'pods')).rejects.toThrow('Server error');
  });

  it('propagates non-BackendApiError errors', async () => {
    mockBackendRequest.mockRejectedValue(new Error('Network failure'));

    await expect(listResources(BASE, CLUSTER, 'pods')).rejects.toThrow('Network failure');
  });
});

describe('getResource', () => {
  it('returns a single resource', async () => {
    const resource = { metadata: { name: 'my-pod', namespace: 'default' }, kind: 'Pod' };
    mockBackendRequest.mockResolvedValue(resource);

    const result = await getResource(BASE, CLUSTER, 'pods', 'default', 'my-pod');

    expect(result).toEqual(resource);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/pods/default/my-pod'
    );
  });

  it('uses "-" sentinel for cluster-scoped resources', async () => {
    const resource = { metadata: { name: 'node-1' }, kind: 'Node' };
    mockBackendRequest.mockResolvedValue(resource);

    await getResource(BASE, CLUSTER, 'nodes', '', 'node-1');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/nodes/-/node-1'
    );
  });

  it('encodes special characters in kind, namespace, name', async () => {
    mockBackendRequest.mockResolvedValue({});

    await getResource(BASE, CLUSTER, 'custom/kind', 'my ns', 'my name');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/custom%2Fkind/my%20ns/my%20name'
    );
  });
});

describe('deleteResource', () => {
  it('calls DELETE with X-Confirm-Destructive header', async () => {
    const deleteResponse = {
      message: 'deleted',
      cluster_id: CLUSTER,
      kind: 'Pod',
      namespace: 'default',
      name: 'my-pod',
    };
    mockBackendRequest.mockResolvedValue(deleteResponse);

    const result = await deleteResource(BASE, CLUSTER, 'pods', 'default', 'my-pod');

    expect(result).toEqual(deleteResponse);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/pods/default/my-pod',
      {
        method: 'DELETE',
        headers: { 'X-Confirm-Destructive': 'true' },
      }
    );
  });

  it('uses "-" sentinel for cluster-scoped resources', async () => {
    mockBackendRequest.mockResolvedValue({ message: 'deleted' });

    await deleteResource(BASE, CLUSTER, 'nodes', '', 'node-1');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/nodes/-/node-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('applyManifest', () => {
  it('sends POST with YAML body and destructive header', async () => {
    const applyResponse = {
      message: 'applied',
      cluster_id: CLUSTER,
      resources: [{ kind: 'ConfigMap', namespace: 'default', name: 'cm1', action: 'created' }],
    };
    mockBackendRequest.mockResolvedValue(applyResponse);

    const yaml = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm1';
    const result = await applyManifest(BASE, CLUSTER, yaml);

    expect(result).toEqual(applyResponse);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/apply',
      {
        method: 'POST',
        headers: { 'X-Confirm-Destructive': 'true' },
        body: JSON.stringify({ yaml }),
      }
    );
  });
});

describe('patchResource', () => {
  it('sends PATCH with JSON merge-patch body', async () => {
    const patched = { metadata: { name: 'my-deploy' }, spec: { replicas: 5 } };
    mockBackendRequest.mockResolvedValue(patched);

    const patch = { spec: { replicas: 5 } };
    const result = await patchResource(BASE, CLUSTER, 'deployments', 'default', 'my-deploy', patch);

    expect(result).toEqual(patched);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/deployments/default/my-deploy',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );
  });
});

describe('searchResources', () => {
  it('sends query string and returns results', async () => {
    const searchResponse = { results: [{ kind: 'Pod', name: 'web', namespace: 'default' }] };
    mockBackendRequest.mockResolvedValue(searchResponse);

    const result = await searchResources(BASE, CLUSTER, 'web');

    expect(result).toEqual(searchResponse);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('clusters/cluster-1/search?q=web')
    );
  });

  it('trims query whitespace', async () => {
    mockBackendRequest.mockResolvedValue({ results: [] });

    await searchResources(BASE, CLUSTER, '  hello  ');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('q=hello')
    );
  });

  it('includes limit when provided', async () => {
    mockBackendRequest.mockResolvedValue({ results: [] });

    await searchResources(BASE, CLUSTER, 'web', 10);

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('limit=10')
    );
  });
});

describe('listCRDInstances', () => {
  it('calls correct path for CRD instances', async () => {
    const response = { items: [], metadata: { total: 0, resourceVersion: '' } };
    mockBackendRequest.mockResolvedValue(response);

    await listCRDInstances(BASE, CLUSTER, 'certificates.cert-manager.io');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/crd-instances/certificates.cert-manager.io'
    );
  });

  it('appends namespace and limit params', async () => {
    mockBackendRequest.mockResolvedValue({ items: [] });

    await listCRDInstances(BASE, CLUSTER, 'crd.example.com', {
      namespace: 'prod',
      limit: 50,
    });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('namespace=prod')
    );
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('limit=50')
    );
  });
});

describe('getDeploymentRolloutHistory', () => {
  it('returns rollout history revisions', async () => {
    const history = { revisions: [{ revision: 1 }, { revision: 2 }] };
    mockBackendRequest.mockResolvedValue(history);

    const result = await getDeploymentRolloutHistory(BASE, CLUSTER, 'default', 'my-deploy');

    expect(result.revisions).toHaveLength(2);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/deployments/default/my-deploy/rollout-history'
    );
  });
});

describe('getServiceEndpoints', () => {
  it('calls correct endpoint', async () => {
    mockBackendRequest.mockResolvedValue({ subsets: [] });

    await getServiceEndpoints(BASE, CLUSTER, 'default', 'my-svc');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/services/default/my-svc/endpoints'
    );
  });
});

describe('getConfigMapConsumers', () => {
  it('calls correct endpoint', async () => {
    mockBackendRequest.mockResolvedValue({ consumers: [] });

    await getConfigMapConsumers(BASE, CLUSTER, 'default', 'my-cm');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/configmaps/default/my-cm/consumers'
    );
  });
});

describe('getSecretConsumers', () => {
  it('calls correct endpoint', async () => {
    mockBackendRequest.mockResolvedValue({ consumers: [] });

    await getSecretConsumers(BASE, CLUSTER, 'default', 'my-secret');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/secrets/default/my-secret/consumers'
    );
  });
});

describe('getStorageClassPVCounts', () => {
  it('returns PV counts per storage class', async () => {
    const counts = { standard: 5, fast: 3 };
    mockBackendRequest.mockResolvedValue(counts);

    const result = await getStorageClassPVCounts(BASE, CLUSTER);

    expect(result).toEqual(counts);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/storageclasses/pv-counts'
    );
  });
});

describe('getNamespaceCounts', () => {
  it('returns pod and service counts per namespace', async () => {
    const counts = { default: { pods: 10, services: 3 } };
    mockBackendRequest.mockResolvedValue(counts);

    const result = await getNamespaceCounts(BASE, CLUSTER);

    expect(result).toEqual(counts);
  });
});

describe('postDeploymentRollback', () => {
  it('sends POST with revision body', async () => {
    mockBackendRequest.mockResolvedValue({ message: 'rolled back' });

    await postDeploymentRollback(BASE, CLUSTER, 'default', 'my-deploy', { revision: 2 });

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/deployments/default/my-deploy/rollback',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 2 }),
      }
    );
  });

  it('sends empty object when no body provided', async () => {
    mockBackendRequest.mockResolvedValue({ message: 'rolled back' });

    await postDeploymentRollback(BASE, CLUSTER, 'default', 'my-deploy');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({}),
      })
    );
  });
});

describe('postNodeCordon', () => {
  it('sends POST with unschedulable flag', async () => {
    mockBackendRequest.mockResolvedValue({});

    await postNodeCordon(BASE, CLUSTER, 'node-1', true);

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/nodes/node-1/cordon',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unschedulable: true }),
      }
    );
  });
});

describe('postCronJobTrigger', () => {
  it('sends POST to trigger a CronJob', async () => {
    mockBackendRequest.mockResolvedValue({});

    await postCronJobTrigger(BASE, CLUSTER, 'default', 'my-cronjob');

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/cronjobs/default/my-cronjob/trigger',
      { method: 'POST' }
    );
  });
});

describe('getCronJobJobs', () => {
  it('returns child jobs with default limit', async () => {
    const jobs = { items: [{ metadata: { name: 'job-1' } }] };
    mockBackendRequest.mockResolvedValue(jobs);

    const result = await getCronJobJobs(BASE, CLUSTER, 'default', 'my-cronjob');

    expect(result.items).toHaveLength(1);
    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      'clusters/cluster-1/resources/cronjobs/default/my-cronjob/jobs?limit=5'
    );
  });

  it('uses custom limit', async () => {
    mockBackendRequest.mockResolvedValue({ items: [] });

    await getCronJobJobs(BASE, CLUSTER, 'default', 'my-cronjob', 10);

    expect(mockBackendRequest).toHaveBeenCalledWith(
      BASE,
      expect.stringContaining('limit=10')
    );
  });

  it('returns empty items when response is null', async () => {
    mockBackendRequest.mockResolvedValue(null);

    const result = await getCronJobJobs(BASE, CLUSTER, 'default', 'my-cronjob');

    expect(result).toEqual({ items: [] });
  });
});
