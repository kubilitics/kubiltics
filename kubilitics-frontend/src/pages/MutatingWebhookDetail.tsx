import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Webhook, Clock, Shield, Download, Trash2, AlertTriangle, Network, GitCompare, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ResourceDetailLayout,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  YamlViewer,
  ResourceComparisonView,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { BlastRadiusTab } from '@/components/resources/BlastRadiusTab';
import { toast } from '@/components/ui/sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface MutatingWebhookResource extends KubernetesResource {
  webhooks?: Array<{
    name: string;
    failurePolicy?: string;
    matchPolicy?: string;
    sideEffects?: string;
    timeoutSeconds?: number;
    admissionReviewVersions?: string[];
    rules?: Array<{
      apiGroups: string[];
      apiVersions: string[];
      operations: string[];
      resources: string[];
    }>;
    clientConfig?: {
      service?: { name: string; namespace: string; port: number };
      url?: string;
    };
  }>;
}

export default function MutatingWebhookDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource: wh, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<MutatingWebhookResource>(
    'mutatingwebhookconfigurations',
    name ?? undefined,
    undefined,
    undefined as unknown as MutatingWebhookResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('MutatingWebhookConfiguration', undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('mutatingwebhookconfigurations');

  const whName = wh?.metadata?.name ?? name ?? '';
  const webhooks = wh?.webhooks ?? [];

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${whName || 'mutatingwebhook'}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [yaml, whName]);

  const handleDownloadJson = useCallback(() => {
    if (!wh) return;
    downloadResourceJson(wh, `${whName || 'mutatingwebhook'}.json`);
    toast.success('JSON downloaded');
  }, [wh, whName]);

  const statusCards = [
    { label: 'Webhooks', value: webhooks.length, icon: Webhook, iconColor: 'primary' as const },
    { label: 'Failure Policy', value: webhooks[0]?.failurePolicy || '-', icon: AlertTriangle, iconColor: 'warning' as const },
    { label: 'Side Effects', value: webhooks[0]?.sideEffects || '-', icon: Shield, iconColor: 'info' as const },
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

  if (isConnected && (resourceError || !wh?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Webhook className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Webhook not found</p>
        <p className="text-sm text-muted-foreground">{name ? `No MutatingWebhookConfiguration "${name}".` : 'Missing name.'}</p>
        <Button variant="outline" onClick={() => navigate('/mutatingwebhooks')}>Back to Webhooks</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          {webhooks.length === 0 ? (
            <SectionCard icon={Webhook} title="Webhooks"><p className="text-sm text-muted-foreground">No webhooks configured</p></SectionCard>
          ) : (
            webhooks.map((webhook, idx) => (
              <SectionCard key={idx} icon={Webhook} title={webhook.name}>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                    <DetailRow label="Failure Policy" value={<Badge variant={webhook.failurePolicy === 'Fail' ? 'destructive' : 'secondary'}>{webhook.failurePolicy}</Badge>} />
                    <DetailRow label="Match Policy" value={<Badge variant="outline">{webhook.matchPolicy}</Badge>} />
                    <DetailRow label="Side Effects" value={<Badge variant="outline">{webhook.sideEffects}</Badge>} />
                    <DetailRow label="Timeout" value={`${webhook.timeoutSeconds}s`} />
                    <DetailRow
                      label="Client Config"
                      value={
                        webhook.clientConfig?.service
                          ? `${webhook.clientConfig.service.namespace}/${webhook.clientConfig.service.name}:${webhook.clientConfig.service.port}`
                          : webhook.clientConfig?.url
                            ? webhook.clientConfig.url
                            : 'No client configuration'
                      }
                    />
                  </div>
                  {webhook.rules && webhook.rules.length > 0 && (
                    <div className="mt-4">
                      <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">Rules</span>
                      <div className="mt-2 space-y-2">
                        {webhook.rules.map((rule, ruleIdx) => (
                          <div key={ruleIdx} className="p-3 rounded-lg bg-muted/50 text-sm font-mono">
                            <p>Groups: {rule.apiGroups.join(', ')}</p>
                            <p>Versions: {rule.apiVersions.join(', ')}</p>
                            <p>Operations: {rule.operations.join(', ')}</p>
                            <p>Resources: {rule.resources.join(', ')}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </SectionCard>
            ))
          )}
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LabelList labels={wh?.metadata?.labels ?? {}} />
            </div>
          </div>
          <div className="lg:col-span-2">
            <AnnotationList annotations={wh?.metadata?.annotations ?? {}} />
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={whName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="mutatingwebhookconfigurations"
          resourceKind="MutatingWebhookConfiguration"
          initialSelectedResources={[whName]}
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
          kind={normalizeKindForTopology('MutatingWebhookConfiguration')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="MutatingWebhookConfiguration"
          sourceResourceName={whName}
        />
      ),
    },
    {
      id: 'blast-radius',
      label: 'Blast Radius',
      icon: Zap,
      content: (
        <BlastRadiusTab
          kind={normalizeKindForTopology('MutatingWebhookConfiguration')}
          namespace={''}
          name={name || whName || ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export Webhook configuration', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export webhook as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Webhook', description: 'Remove this webhook configuration', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  const statusLabel: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="MutatingWebhookConfiguration"
        resourceIcon={Webhook}
        name={whName}
        status={statusLabel}
        backLink="/mutatingwebhooks"
        backLabel="Mutating Webhooks"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
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
        resourceType="MutatingWebhookConfiguration"
        resourceName={whName}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: whName });
          navigate('/mutatingwebhooks');
        }}
        requireNameConfirmation
      />
    </>
  );
}
