import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Activity, Clock, User, Download, Trash2, Timer, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  MetadataCard,
  ResourceOverviewMetadata,
  SectionCard,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

interface LeaseResource extends KubernetesResource {
  spec?: {
    holderIdentity?: string;
    leaseDurationSeconds?: number;
    acquireTime?: string;
    renewTime?: string;
    leaseTransitions?: number;
  };
}

export default function LeaseDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { resource: lease, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<LeaseResource>(
    'leases',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as LeaseResource
  );
  const { events } = useResourceEvents('Lease', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('leases');

  const leaseName = lease?.metadata?.name ?? name ?? '';
  const leaseNamespace = lease?.metadata?.namespace ?? namespace ?? '';
  const holderIdentity = lease?.spec?.holderIdentity ?? '–';
  const leaseDurationSeconds = lease?.spec?.leaseDurationSeconds ?? 0;
  const acquireTime = lease?.spec?.acquireTime;
  const renewTime = lease?.spec?.renewTime;
  const leaseTransitions = lease?.spec?.leaseTransitions ?? 0;

  const renewTimeDate = renewTime ? new Date(renewTime) : null;
  const now = Date.now();
  const secondsSinceRenewal = renewTimeDate ? Math.floor((now - renewTimeDate.getTime()) / 1000) : 0;
  const isExpired = leaseDurationSeconds > 0 && secondsSinceRenewal > leaseDurationSeconds;
  const status: ResourceStatus = isExpired ? 'Failed' : 'Healthy';
  const held = !!lease?.spec?.holderIdentity;

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lease-${leaseNamespace}-${leaseName}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, leaseNamespace, leaseName]);

  const handleDownloadJson = useCallback(() => {
    if (!lease) return;
    downloadResourceJson(lease, `lease-${leaseNamespace}-${leaseName}.json`);
    toast.success('JSON downloaded');
  }, [lease, leaseNamespace, leaseName]);

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

  if (isConnected && (resourceError || !lease?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Activity className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Lease not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No lease "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/leases')}>Back to Leases</Button>
      </div>
    );
  }

  const statusCards = [
    { label: 'Holder', value: holderIdentity !== '–' ? holderIdentity : '–', icon: User, iconColor: 'info' as const },
    { label: 'Duration', value: leaseDurationSeconds ? `${leaseDurationSeconds}s` : '–', icon: Timer, iconColor: 'primary' as const },
    { label: 'Last Renewed', value: renewTime ? new Date(renewTime).toISOString() : '–', icon: Clock, iconColor: 'muted' as const },
    { label: 'Status', value: isExpired ? 'Expired' : held ? 'Held' : 'Available', icon: Activity, iconColor: (isExpired ? 'error' : 'success') as 'error' | 'success' },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <ResourceOverviewMetadata
            metadata={lease?.metadata ?? { name: leaseName, namespace: leaseNamespace }}
            createdLabel={age}
            namespace={leaseNamespace}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard icon={Activity} title="Lease Info" tooltip="Holder, duration, transitions">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Holder Identity</p>
                  <p className="font-mono text-xs break-all">{holderIdentity}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Lease Duration</p>
                  <Badge variant="secondary">{leaseDurationSeconds ? `${leaseDurationSeconds}s` : '–'}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Transitions</p>
                  <p>{leaseTransitions}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Age</p>
                  <p>{age}</p>
                </div>
              </div>
            </SectionCard>
            <SectionCard icon={Clock} title="Timing" tooltip="Acquire and renew timestamps">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground">Acquire Time</span>
                  <span className="font-mono text-xs">{acquireTime ? new Date(acquireTime).toLocaleString() : '–'}</span>
                </div>
                <div className="flex justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground">Renew Time</span>
                  <span className="font-mono text-xs">{renewTime ? new Date(renewTime).toLocaleString() : '–'}</span>
                </div>
                <div className={`flex justify-between p-3 rounded-lg ${isExpired ? 'bg-destructive/10' : 'bg-muted/50'}`}>
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={isExpired ? 'destructive' : 'default'}>{isExpired ? 'Expired' : 'Active'}</Badge>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={leaseName} editable={false} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="leases"
          resourceKind="Lease"
          namespace={leaseNamespace}
          initialSelectedResources={leaseNamespace && leaseName ? [`${leaseNamespace}/${leaseName}`] : [leaseName]}
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
          kind={normalizeKindForTopology('Lease')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="Lease"
          sourceResourceName={lease?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: Download, label: 'Download YAML', description: 'Export Lease definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export Lease as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete Lease', description: 'Remove this lease', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="Lease"
        resourceIcon={Activity}
        name={leaseName}
        namespace={leaseNamespace}
        status={status}
        backLink="/leases"
        backLabel="Leases"
        createdLabel={age}
        createdAt={lease?.metadata?.creationTimestamp}
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
          </span>
        }
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
        resourceType="Lease"
        resourceName={leaseName}
        namespace={leaseNamespace}
        onConfirm={async () => {
          if (isConnected && name && namespace) {
            await deleteResource.mutateAsync({ name, namespace });
            navigate('/leases');
          } else {
            toast.success(`Lease ${leaseName} deleted`);
            navigate('/leases');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
