import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Gauge, Clock, Download, Trash2, Box, Network, AlertTriangle, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ResourceDetailLayout,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  MetadataCard,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { parseQuantityToNum, formatUsagePercent } from '@/lib/k8s-utils';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface ResourceQuotaResource extends KubernetesResource {
  spec?: { hard?: Record<string, string>; scopeSelector?: unknown };
  status?: { hard?: Record<string, string>; used?: Record<string, string> };
}

// parseQuantityToNum is now imported from @/lib/k8s-utils

function getUsagePercent(used: string, hard: string): number | null {
  return formatUsagePercent(used, hard);
}

function usageBarIndicatorClass(pct: number | null): string {
  if (pct == null) return 'bg-muted-foreground/40';
  if (pct >= 100) return 'bg-destructive';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-[hsl(142,76%,36%)]';
}

export default function ResourceQuotaDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<ResourceQuotaResource>(
    'resourcequotas',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as ResourceQuotaResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ResourceQuota', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('resourcequotas');
  const updateResource = useUpdateK8sResource('resourcequotas');

  const quotaName = resource?.metadata?.name ?? name ?? '';
  const quotaNamespace = resource?.metadata?.namespace ?? namespace ?? '';

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update resource');
      throw new Error('Not connected');
    }
    try {
      await updateResource.mutateAsync({ name, yaml: newYaml, namespace });
      toast.success('Resource updated successfully');
      refetch();
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
      throw error;
    }
  }, [isConnected, name, namespace, updateResource, refetch]);
  const hard = resource?.status?.hard || resource?.spec?.hard || {};
  const used = resource?.status?.used || {};
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};
  const hasScopeSelector = !!(resource?.spec?.scopeSelector && Object.keys((resource.spec.scopeSelector as Record<string, unknown>) || {}).length > 0);

  const resourcesTracked = useMemo(() => Object.keys(hard).length, [hard]);
  const overallPct = useMemo(() => {
    let maxPct: number | null = null;
    for (const key of Object.keys(hard)) {
      const pct = getUsagePercent(used[key] || '0', hard[key] || '');
      if (pct != null && (maxPct == null || pct > maxPct)) maxPct = pct;
    }
    return maxPct;
  }, [hard, used]);

  const usageRows = useMemo(() => {
    return Object.keys(hard)
      .sort()
      .map((resource) => {
        const hardVal = hard[resource] ?? '';
        const usedVal = used[resource] ?? '0';
        const percent = getUsagePercent(usedVal, hardVal);
        return { resource, used: usedVal, hard: hardVal, percent };
      });
  }, [hard, used]);

  const nearingLimitResources = useMemo(() => usageRows.filter((r) => r.percent != null && r.percent > 80), [usageRows]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${quotaName || 'resourcequota'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, quotaName]);

  const handleDownloadJson = useCallback(() => {
    if (!resource) return;
    downloadResourceJson(resource, `${quotaName || 'resourcequota'}.json`);
    toast.success('JSON downloaded');
  }, [resource, quotaName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Overall Usage', value: overallPct != null ? `${overallPct}%` : '–', icon: Gauge, iconColor: 'primary' as const },
    { label: 'Resources Tracked', value: resourcesTracked, icon: Box, iconColor: 'muted' as const },
    { label: 'Namespace', value: quotaNamespace, icon: Clock, iconColor: 'info' as const },
    { label: 'Scopes', value: hasScopeSelector ? 'Yes' : 'No', icon: Gauge, iconColor: 'muted' as const },
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

  if (isConnected && (resourceError || !resource?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Gauge className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Resource Quota not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No resource quota "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/resourcequotas')}>Back to Resource Quotas</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Resource Usage</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(hard).map(([key, hardVal]) => {
                  const usedVal = used[key] ?? '0';
                  const percent = getUsagePercent(usedVal, hardVal);
                  return (
                    <div key={key} className="p-4 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-sm font-mono">{key}</span>
                        {percent != null ? (
                          <Badge variant={percent >= 100 ? 'destructive' : percent >= 80 ? 'secondary' : 'default'}>
                            {percent}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">used / hard</span>
                        )}
                      </div>
                      {percent != null && <Progress value={Math.min(percent, 100)} className="h-2" />}
                      <p className="text-xs text-muted-foreground">{usedVal} / {hardVal}</p>
                    </div>
                  );
                })}
              </div>
              {Object.keys(hard).length === 0 && (
                <p className="text-muted-foreground text-sm">No hard limits defined.</p>
              )}
            </CardContent>
          </Card>
          <MetadataCard title="Labels" items={labels} variant="badges" />
          {Object.keys(annotations).length > 0 && <MetadataCard title="Annotations" items={annotations} variant="badges" />}
        </div>
      ),
    },
    {
      id: 'usage',
      label: 'Usage',
      icon: Gauge,
      content: (
        <div className="space-y-6">
          {nearingLimitResources.length > 0 && (
            <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Nearing limit</AlertTitle>
              <AlertDescription>
                The following resources are above 80% of their hard limit: <span className="font-mono font-medium">{nearingLimitResources.map((r) => r.resource).join(', ')}</span>. Consider increasing quotas or reducing usage.
              </AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-resource usage</CardTitle>
              <p className="text-sm text-muted-foreground">Used vs hard limit for each quota resource. Bars are green (&lt;80%), amber (80–99%), or red (≥100%).</p>
            </CardHeader>
            <CardContent>
              {usageRows.length === 0 ? (
                <p className="text-muted-foreground text-sm">No hard limits defined.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="font-medium">Resource</TableHead>
                      <TableHead className="font-medium">Used</TableHead>
                      <TableHead className="font-medium">Hard limit</TableHead>
                      <TableHead className="font-medium w-24">Usage %</TableHead>
                      <TableHead className="font-medium min-w-[180px]">Bar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usageRows.map((row) => (
                      <TableRow key={row.resource}>
                        <TableCell className="font-mono text-sm">{row.resource}</TableCell>
                        <TableCell className="font-mono text-sm">{row.used}</TableCell>
                        <TableCell className="font-mono text-sm">{row.hard}</TableCell>
                        <TableCell>
                          {row.percent != null ? (
                            <span className={row.percent >= 100 ? 'text-destructive font-medium' : row.percent >= 80 ? 'text-amber-600 font-medium' : 'text-[hsl(142,76%,36%)] font-medium'}>
                              {row.percent}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.percent != null ? (
                            <div className="flex items-center gap-2">
                              <Progress value={Math.min(row.percent, 100)} className="h-2.5 flex-1 max-w-[160px]" indicatorClassName={usageBarIndicatorClass(row.percent)} />
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">–</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={quotaName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="resourcequotas"
          resourceKind="ResourceQuota"
          namespace={namespace}
          initialSelectedResources={namespace && name ? [`${namespace}/${name}`] : [name || '']}
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
          kind={normalizeKindForTopology('ResourceQuota')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="ResourceQuota"
          sourceResourceName={resource?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: Download, label: 'Download YAML', description: 'Export ResourceQuota definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export ResourceQuota as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete Quota', description: 'Remove this resource quota', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = overallPct != null && overallPct >= 100 ? 'Failed' : 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="ResourceQuota"
        resourceIcon={Gauge}
        name={quotaName}
        namespace={quotaNamespace}
        status={status}
        backLink="/resourcequotas"
        backLabel="Resource Quotas"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tabId) => {
          setActiveTab(tabId);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (tabId === 'overview') next.delete('tab');
            else next.set('tab', tabId);
            return next;
          }, { replace: true });
        }}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="ResourceQuota"
        resourceName={quotaName}
        namespace={quotaNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: quotaName, namespace: quotaNamespace });
          navigate('/resourcequotas');
        }}
        requireNameConfirmation
      />
    </>
  );
}
