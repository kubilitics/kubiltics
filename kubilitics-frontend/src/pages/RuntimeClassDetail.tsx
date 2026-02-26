import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { FolderCog, Clock, Cpu, Download, Trash2, Settings, Package, Box, Network, Loader2, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface K8sRuntimeClass extends KubernetesResource {
  handler?: string;
  overhead?: { podFixed?: { cpu?: string; memory?: string } };
  scheduling?: {
    nodeSelector?: Record<string, string>;
    tolerations?: Array<{ key?: string; operator?: string; value?: string; effect?: string }>;
  };
}

interface PodWithRuntime extends KubernetesResource {
  spec?: { runtimeClassName?: string };
}

export default function RuntimeClassDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource: k8sRc, isLoading, age, yaml, isConnected: resourceConnected, refetch } = useResourceDetail<K8sRuntimeClass>(
    'runtimeclasses',
    name ?? '',
    undefined,
    undefined as unknown as K8sRuntimeClass
  );
  const { events } = useResourceEvents('RuntimeClass', undefined, name ?? undefined);
  const deleteRc = useDeleteK8sResource('runtimeclasses');
  const { data: podsData } = useK8sResourceList<PodWithRuntime>('pods', undefined, { enabled: !!name && isConnected, limit: 5000 });

  const podsUsingRuntime = useMemo(() => {
    if (!name || !podsData?.items) return [];
    return podsData.items.filter((p) => p.spec?.runtimeClassName === name);
  }, [name, podsData?.items]);

  const rc = useMemo(() => {
    if (!k8sRc?.metadata?.name) return null;
    return {
      name: k8sRc.metadata.name,
      status: 'Active' as ResourceStatus,
      handler: k8sRc.handler ?? '—',
      age: k8sRc.metadata.creationTimestamp ? calculateAge(k8sRc.metadata.creationTimestamp) : '—',
      overhead: k8sRc.overhead,
      scheduling: k8sRc.scheduling,
    };
  }, [k8sRc]);

  useEffect(() => {
    if (!name?.trim()) navigate('/runtimeclasses', { replace: true });
  }, [name, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rc?.name ?? name ?? 'runtimeclass'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, rc?.name, name]);

  const handleDownloadJson = useCallback(() => {
    if (!k8sRc) return;
    downloadResourceJson(k8sRc, `${rc?.name ?? name ?? 'runtimeclass'}.json`);
    toast.success('JSON downloaded');
  }, [k8sRc, rc?.name, name]);

  const handleSaveYaml = useCallback(async () => {
    toast.info('Update RuntimeClass via YAML is not implemented in this flow. Use Apply in cluster.');
  }, []);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: rc?.age ?? 'now' }] : [];

  const statusCards = rc
    ? [
      { label: 'Handler', value: rc.handler, icon: Cpu, iconColor: 'primary' as const },
      { label: 'CPU Overhead', value: rc.overhead?.podFixed?.cpu ?? '—', icon: Settings, iconColor: 'info' as const },
      { label: 'Memory Overhead', value: rc.overhead?.podFixed?.memory ?? '—', icon: FolderCog, iconColor: 'warning' as const },
      { label: 'Age', value: rc.age, icon: Clock, iconColor: 'muted' as const },
    ]
    : [];

  const handleDelete = useCallback(async () => {
    if (!name || !isConnected) {
      toast.error('Connect cluster to delete RuntimeClass');
      return;
    }
    try {
      await deleteRc.mutateAsync({ name, namespace: undefined });
      toast.success(`RuntimeClass ${name} deleted`);
      navigate('/runtimeclasses');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete RuntimeClass');
    }
  }, [name, isConnected, deleteRc, navigate]);

  if (!name?.trim()) return null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (resourceConnected && name && !rc) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-muted-foreground">RuntimeClass not found: {name}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/runtimeclasses')}>
          Back to Runtime Classes
        </Button>
      </div>
    );
  }

  if (!rc) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-muted-foreground">Connect cluster to view RuntimeClass.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/runtimeclasses')}>
          Back to Runtime Classes
        </Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <ResourceOverviewMetadata metadata={{ name: rc.name }} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Runtime Info</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Handler</p>
                    <Badge variant="default" className="font-mono">{rc.handler}</Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Age</p>
                    <p>{rc.age}</p>
                  </div>
                </div>
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground">
                    The handler specifies the underlying runtime configuration. Pods using this RuntimeClass
                    run with the configured isolation and overhead.
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overhead</CardTitle>
                <CardDescription>Additional resources consumed by the runtime</CardDescription>
              </CardHeader>
              <CardContent>
                {rc.overhead?.podFixed ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-1">CPU</p>
                      <p className="font-mono text-lg font-medium">{rc.overhead.podFixed.cpu}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-1">Memory</p>
                      <p className="font-mono text-lg font-medium">{rc.overhead.podFixed.memory}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No overhead defined</p>
                )}
              </CardContent>
            </Card>
            {rc.scheduling && (
              <>
                <Card>
                  <CardHeader><CardTitle className="text-base">Node Selector</CardTitle></CardHeader>
                  <CardContent>
                    {rc.scheduling.nodeSelector && Object.keys(rc.scheduling.nodeSelector).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(rc.scheduling.nodeSelector).map(([key, value]) => (
                          <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No node selector defined</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Tolerations</CardTitle></CardHeader>
                  <CardContent>
                    {rc.scheduling.tolerations && rc.scheduling.tolerations.length > 0 ? (
                      <div className="space-y-2">
                        {rc.scheduling.tolerations.map((tol, idx) => (
                          <div key={idx} className="p-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2 flex-wrap">
                              {tol.key != null && <Badge variant="outline" className="font-mono text-xs">{tol.key}</Badge>}
                              {tol.operator != null && <span className="text-muted-foreground">{tol.operator}</span>}
                              {tol.value != null && <Badge variant="secondary" className="font-mono text-xs">{tol.value}</Badge>}
                              {tol.effect != null && <Badge variant="destructive" className="text-xs">{tol.effect}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No tolerations defined</p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Pods Using This RuntimeClass
                </CardTitle>
                <CardDescription>{podsUsingRuntime.length} pods are using this runtime class</CardDescription>
              </CardHeader>
              <CardContent>
                {podsUsingRuntime.length === 0 ? (
                  <p className="text-muted-foreground">No pods are using this RuntimeClass.</p>
                ) : (
                  <div className="space-y-2">
                    {podsUsingRuntime.map((pod) => (
                      <div
                        key={`${pod.metadata?.namespace ?? ''}/${pod.metadata?.name ?? ''}`}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                        onClick={() => navigate(`/pods/${pod.metadata?.namespace ?? 'default'}/${pod.metadata?.name ?? ''}`)}
                      >
                        <div className="flex items-center gap-3">
                          <Box className="h-4 w-4 text-primary" />
                          <span className="font-medium">{pod.metadata?.name ?? '—'}</span>
                        </div>
                        <NamespaceBadge namespace={pod.metadata?.namespace ?? ''} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={rc.name} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="runtimeclasses"
          resourceKind="RuntimeClass"
          initialSelectedResources={[rc?.name ?? '']}
          clusterId={clusterId ?? undefined}
          backendBaseUrl={baseUrl ?? ''}
          isConnected={isConnected}
          embedded
        />
      ),
    },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('RuntimeClass')}
          namespace=""
          name={name ?? ''}
          sourceResourceType="RuntimeClass"
          sourceResourceName={rc.name}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export RuntimeClass definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export RuntimeClass as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete RuntimeClass', description: 'Remove this runtime class', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="RuntimeClass"
        resourceIcon={FolderCog}
        name={rc.name}
        status="Healthy"
        backLink="/runtimeclasses"
        backLabel="Runtime Classes"
        createdLabel={rc.age}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="RuntimeClass"
        resourceName={rc.name}
        onConfirm={handleDelete}
        requireNameConfirmation
      />
    </>
  );
}
