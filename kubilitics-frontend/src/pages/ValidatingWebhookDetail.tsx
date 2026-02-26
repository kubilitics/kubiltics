import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Webhook, Clock, Shield, Download, Trash2, AlertTriangle, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ResourceDetailLayout,
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
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface ValidatingWebhookResource extends KubernetesResource {
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
    namespaceSelector?: {
      matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
      matchLabels?: Record<string, string>;
    };
  }>;
}

export default function ValidatingWebhookDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource: wh, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<ValidatingWebhookResource>(
    'validatingwebhookconfigurations',
    name ?? undefined,
    undefined,
    undefined as unknown as ValidatingWebhookResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ValidatingWebhookConfiguration', undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('validatingwebhookconfigurations');

  const whName = wh?.metadata?.name ?? name ?? '';
  const webhooks = wh?.webhooks ?? [];

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${whName || 'validatingwebhook'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, whName]);

  const handleDownloadJson = useCallback(() => {
    if (!wh) return;
    downloadResourceJson(wh, `${whName || 'validatingwebhook'}.json`);
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
        <p className="text-sm text-muted-foreground">{name ? `No ValidatingWebhookConfiguration "${name}".` : 'Missing name.'}</p>
        <Button variant="outline" onClick={() => navigate('/validatingwebhooks')}>Back to Webhooks</Button>
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
            <Card><CardContent className="p-4 text-muted-foreground">No webhooks configured</CardContent></Card>
          ) : (
            webhooks.map((webhook, idx) => (
              <Card key={idx}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Webhook className="h-4 w-4" />
                    {webhook.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground mb-1">Failure Policy</p>
                      <Badge variant={webhook.failurePolicy === 'Fail' ? 'destructive' : 'secondary'}>
                        {webhook.failurePolicy}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Match Policy</p>
                      <Badge variant="outline">{webhook.matchPolicy}</Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Side Effects</p>
                      <Badge variant="outline">{webhook.sideEffects}</Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Timeout</p>
                      <p>{webhook.timeoutSeconds}s</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Rules</p>
                    <div className="space-y-2">
                      {webhook.rules?.map((rule, ruleIdx) => (
                        <div key={ruleIdx} className="p-3 rounded-lg bg-muted/50 text-sm font-mono">
                          <p>Groups: {rule.apiGroups.join(', ')}</p>
                          <p>Versions: {rule.apiVersions.join(', ')}</p>
                          <p>Operations: {rule.operations.join(', ')}</p>
                          <p>Resources: {rule.resources.join(', ')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {webhook.namespaceSelector && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Namespace Selector</p>
                      <div className="p-3 rounded-lg bg-muted/50 text-sm font-mono">
                        {webhook.namespaceSelector.matchExpressions?.map((expr, i) => (
                          <p key={i}>{expr.key} {expr.operator} {expr.values?.join(', ')}</p>
                        ))}
                        {webhook.namespaceSelector.matchLabels && (
                          <p>Labels: {JSON.stringify(webhook.namespaceSelector.matchLabels)}</p>
                        )}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Client Config</p>
                    <div className="p-3 rounded-lg bg-muted/50 text-sm">
                      {webhook.clientConfig?.service ? (
                        <p>Service: {webhook.clientConfig.service.namespace}/{webhook.clientConfig.service.name}:{webhook.clientConfig.service.port}</p>
                      ) : webhook.clientConfig?.url ? (
                        <p>URL: {webhook.clientConfig.url}</p>
                      ) : (
                        <p>No client configuration</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
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
          resourceType="validatingwebhookconfigurations"
          resourceKind="ValidatingWebhookConfiguration"
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
          kind={normalizeKindForTopology('ValidatingWebhookConfiguration')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="ValidatingWebhookConfiguration"
          sourceResourceName={whName}
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
        resourceType="ValidatingWebhookConfiguration"
        resourceIcon={Webhook}
        name={whName}
        status={statusLabel}
        backLink="/validatingwebhooks"
        backLabel="Validating Webhooks"
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
        resourceType="ValidatingWebhookConfiguration"
        resourceName={whName}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: whName });
          navigate('/validatingwebhooks');
        }}
        requireNameConfirmation
      />
    </>
  );
}
