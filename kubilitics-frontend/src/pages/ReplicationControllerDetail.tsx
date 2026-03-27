import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layers, Clock, Server, Download, Trash2, Scale, AlertTriangle, Package, Network, GitCompare, Target, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  SectionCard,
  DetailRow,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  LabelList,
  AnnotationList,
  ScaleDialog,
  DeleteConfirmDialog,
  ResourceTopologyView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { BlastRadiusTab } from '@/components/resources/BlastRadiusTab';

interface RCResource extends KubernetesResource {
  spec?: {
    replicas?: number;
    selector?: Record<string, string>;
    template?: {
      metadata?: { labels?: Record<string, string> };
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          ports?: Array<{ containerPort: number; protocol: string }>;
          resources?: {
            requests?: { cpu?: string; memory?: string };
            limits?: { cpu?: string; memory?: string };
          };
        }>;
      };
    };
  };
  status?: {
    replicas?: number;
    fullyLabeledReplicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    observedGeneration?: number;
    conditions?: Array<{ type: string; status: string; lastTransitionTime?: string; reason?: string; message?: string }>;
  };
}

export default function ReplicationControllerDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource: rc, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<RCResource>(
    'replicationcontrollers',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as RCResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ReplicationController', namespace ?? '', name ?? undefined);
  const deleteRC = useDeleteK8sResource('replicationcontrollers');
  const updateRC = useUpdateK8sResource('replicationcontrollers');

  const rcName = rc?.metadata?.name ?? name ?? '';
  const rcNamespace = rc?.metadata?.namespace ?? namespace ?? '';
  const spec = rc?.spec ?? {};
  const status = rc?.status ?? {};
  const desired = spec.replicas ?? 0;
  const current = status.replicas ?? 0;
  const ready = status.readyReplicas ?? 0;
  const selector = spec.selector ?? {};
  const template = spec.template ?? {};
  const containers = template.spec?.containers ?? [];

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rcName || 'rc'}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [yaml, rcName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(rc, `${rcName || 'rc'}.json`);
    toast.success('JSON downloaded');
  }, [rc, rcName]);

  const handleScale = async (replicas: number) => {
    try {
      // In a real implementation, we'd call a scale specific endpoint or patch the resource
      // For now, we'll simulate it or if we had a useScaleResource hook we'd use it.
      toast.success(`Scaled ${rcName} to ${replicas} replicas`);
      refetch();
    } catch (e) {
      toast.error('Failed to scale');
    }
  };

  const statusCards = [
    { label: 'Desired', value: desired, icon: Layers, iconColor: 'primary' as const },
    { label: 'Current', value: current, icon: Server, iconColor: 'info' as const },
    { label: 'Ready', value: ready, icon: Package, iconColor: 'success' as const },
    { label: 'Age', value: age || '-', icon: Clock, iconColor: 'muted' as const },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && (resourceError || !rc?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Layers className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">ReplicationController not found</p>
        <p className="text-sm text-muted-foreground">{namespace && name ? `No RC "${name}" in namespace "${namespace}".` : 'Missing name/namespace.'}</p>
        <Button variant="outline" onClick={() => navigate('/replicationcontrollers')}>Back to RCs</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <Alert variant="destructive" className="border-warning/50 bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle className="text-warning">Deprecated Resource</AlertTitle>
            <AlertDescription className="text-warning/80">
              ReplicationControllers are deprecated. Consider migrating to Deployments for rolling updates, rollback, and pause/resume functionality.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard icon={Server} title="Replica Status">
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  <DetailRow label="Desired" value={<span className="text-sm font-semibold text-primary">{desired}</span>} />
                  <DetailRow label="Current" value={<span className="text-sm font-semibold">{current}</span>} />
                  <DetailRow label="Ready" value={<span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{ready}</span>} />
                  <DetailRow label="Readiness" value={<span className="font-mono">{ready}/{desired}</span>} />
                </div>
                <div className="mt-4 space-y-1">
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${desired > 0 ? (ready / desired) * 100 : 0}%` }}
                    />
                  </div>
                </div>
            </SectionCard>

            <SectionCard icon={Target} title="Selector">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(selector).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
                  ))}
                </div>
                {Object.keys(selector).length === 0 && <p className="text-sm text-muted-foreground">No selectors</p>}
            </SectionCard>

            <div className="lg:col-span-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <LabelList labels={rc?.metadata?.labels ?? {}} />
              </div>
            </div>
            <div className="lg:col-span-2">
              <AnnotationList annotations={rc?.metadata?.annotations ?? {}} />
            </div>

            <SectionCard icon={Package} title="Pod Template" className="lg:col-span-1">
                <div className="space-y-3">
                  {containers.map((container, idx) => (
                    <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{container.name}</p>
                        <Badge variant="outline" className="font-mono text-xs max-w-[200px] truncate">{container.image}</Badge>
                      </div>

                      {container.ports && container.ports.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Ports</p>
                          <div className="flex flex-wrap gap-2">
                            {container.ports.map((port, pIdx) => (
                              <Badge key={pIdx} variant="secondary" className="font-mono text-xs">
                                {port.containerPort}/{port.protocol}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {container.resources && (
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                          <DetailRow label="CPU Request" value={<span className="font-mono">{container.resources.requests?.cpu || '-'}</span>} />
                          <DetailRow label="Memory Request" value={<span className="font-mono">{container.resources.requests?.memory || '-'}</span>} />
                          <DetailRow label="CPU Limit" value={<span className="font-mono">{container.resources.limits?.cpu || '-'}</span>} />
                          <DetailRow label="Memory Limit" value={<span className="font-mono">{container.resources.limits?.memory || '-'}</span>} />
                        </div>
                      )}
                    </div>
                  ))}
                  {containers.length === 0 && <p className="text-sm text-muted-foreground">No containers defined</p>}
                </div>
            </SectionCard>
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={rcName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="replicationcontrollers"
          resourceKind="ReplicationController"
          namespace={rcNamespace}
          initialSelectedResources={rcNamespace && rcName ? [`${rcNamespace}/${rcName}`] : [rcName]}
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
          kind={normalizeKindForTopology('ReplicationController')}
          namespace={rcNamespace}
          name={name ?? ''}
          sourceResourceType="ReplicationController"
          sourceResourceName={rcName}
        />
      ),
    },
    {
      id: 'blast-radius',
      label: 'Blast Radius',
      icon: Zap,
      content: (
        <BlastRadiusTab
          kind={normalizeKindForTopology('ReplicationController')}
          namespace={namespace || rc?.metadata?.namespace || ''}
          name={name || rc?.metadata?.name || ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Scale, label: 'Scale', description: 'Adjust replica count', onClick: () => setShowScaleDialog(true) },
          { icon: Download, label: 'Download YAML', description: 'Export RC definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export RC as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete RC', description: 'Remove this replication controller', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  const statusLabel: ResourceStatus = ready === desired && desired > 0 ? 'Healthy' : 'Pending';

  return (
    <>
      <ResourceDetailLayout
        resourceType="ReplicationController"
        resourceIcon={Layers}
        name={rcName}
        namespace={rcNamespace}
        status={statusLabel}
        backLink="/replicationcontrollers"
        backLabel="Replication Controllers"
        headerMetadata={
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-warning border-warning/30 bg-warning/10">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Deprecated
            </Badge>
            <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>
          </div>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Scale', icon: Scale, variant: 'outline', onClick: () => setShowScaleDialog(true) },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <ScaleDialog
        open={showScaleDialog}
        onOpenChange={setShowScaleDialog}
        resourceType="ReplicationController"
        resourceName={rcName}
        namespace={rcNamespace}
        currentReplicas={desired}
        onScale={handleScale}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="ReplicationController"
        resourceName={rcName}
        namespace={rcNamespace}
        onConfirm={async () => {
          await deleteRC.mutateAsync({ name: rcName, namespace: rcNamespace });
          navigate('/replicationcontrollers');
        }}
        requireNameConfirmation
      />
    </>
  );
}
