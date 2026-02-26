import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Shield, Clock, Download, Trash2, ArrowDownToLine, ArrowUpFromLine, Activity, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResourceDetailLayout,

  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  SectionCard,
  ResourceTopologyView,
  ResourceComparisonView,


  type ResourceStatus,
  type EventInfo,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface NetworkPolicyResource extends KubernetesResource {
  spec?: {
    podSelector?: { matchLabels?: Record<string, string>; matchExpressions?: unknown[] };
    policyTypes?: string[];
    ingress?: Array<{
      from?: Array<{ podSelector?: { matchLabels?: Record<string, string> }; namespaceSelector?: { matchLabels?: Record<string, string> }; ipBlock?: { cidr: string } }>;
      ports?: Array<{ protocol?: string; port?: number | string }>;
    }>;
    egress?: Array<{
      to?: Array<{ podSelector?: { matchLabels?: Record<string, string> }; namespaceSelector?: { matchLabels?: Record<string, string> }; ipBlock?: { cidr: string } }>;
      ports?: Array<{ protocol?: string; port?: number | string }>;
    }>;
  };
}


const VALID_TAB_IDS = new Set(['overview', 'visualization', 'simulation', 'pods', 'coverage', 'events', 'metrics', 'yaml', 'compare', 'audit', 'actions']);

export default function NetworkPolicyDetail() {
  const { namespace: nsParam, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') ?? 'overview';
  const initialTab = VALID_TAB_IDS.has(tabFromUrl) ? tabFromUrl : 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const namespace = nsParam ?? '';

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabId === 'overview') next.delete('tab');
      else next.set('tab', tabId);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);

  const { resource: np, isLoading, error, age, yaml, isConnected, refetch } = useResourceDetail<NetworkPolicyResource>(
    'networkpolicies',
    name,
    nsParam,
    {} as NetworkPolicyResource
  );
  const resourceEvents = useResourceEvents('NetworkPolicy', namespace, name ?? undefined);
  const events = resourceEvents.events;

  const deleteNetworkPolicy = useDeleteK8sResource('networkpolicies');
  const updateNetworkPolicy = useUpdateK8sResource('networkpolicies');

  const podsInNs = useK8sResourceList<KubernetesResource>('pods', namespace, { enabled: !!namespace });
  const podSelector = np.spec?.podSelector?.matchLabels ?? {};
  const affectedPods = useMemo(() => {
    if (!podsInNs.data?.items?.length || !Object.keys(podSelector).length) return [];
    return (podsInNs.data.items as KubernetesResource[]).filter((p) => {
      const labels = p.metadata?.labels ?? {};
      return Object.entries(podSelector).every(([k, v]) => labels[k] === v);
    });
  }, [podsInNs.data?.items, podSelector]);

  const npName = np.metadata?.name || '';
  const npNamespace = np.metadata?.namespace || '';
  const policyTypes = np.spec?.policyTypes ?? [];
  const ingressRules = np.spec?.ingress ?? [];
  const egressRules = np.spec?.egress ?? [];
  const status: ResourceStatus = 'Healthy';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${npName || 'networkpolicy'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, npName]);

  const handleDownloadJson = useCallback(() => {
    if (!np) return;
    downloadResourceJson(np, `${npName || 'networkpolicy'}.json`);
    toast.success('JSON downloaded');
  }, [np, npName]);

  const handleSaveYaml = useCallback(async (newYaml: string) => {
    if (!isConnected || !name || !namespace) {
      toast.error('Connect cluster to update NetworkPolicy');
      throw new Error('Not connected');
    }
    try {
      await updateNetworkPolicy.mutateAsync({ name, namespace, yaml: newYaml });
      toast.success('NetworkPolicy updated successfully');
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to update: ${message}`);
      throw err;
    }
  }, [isConnected, name, namespace, updateNetworkPolicy, refetch]);


  const yamlVersions: YamlVersion[] = useMemo(() => [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }], [yaml]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!np?.metadata?.name || error) {
    return (
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{error ? 'Failed to load resource.' : 'NetworkPolicy not found.'}</p>
            {error && <p className="text-sm text-destructive mt-2">{String(error)}</p>}
            <Button variant="outline" className="mt-4" onClick={() => navigate('/networkpolicies')}>
              Back to NetworkPolicies
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCards = [
    { label: 'Policy Types', value: policyTypes.join(', ') || '—', icon: Shield, iconColor: 'primary' as const },
    { label: 'Affected Pods', value: String(affectedPods.length), icon: Shield, iconColor: 'info' as const },
    { label: 'Ingress Rules', value: String(ingressRules.length), icon: ArrowDownToLine, iconColor: 'info' as const },
    { label: 'Egress Rules', value: String(egressRules.length), icon: ArrowUpFromLine, iconColor: 'muted' as const },
    { label: 'Namespace', value: npNamespace, icon: Shield, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Pod Selector</CardTitle></CardHeader>
            <CardContent>
              {Object.keys(podSelector).length === 0 ? <p className="text-muted-foreground text-sm">All pods in namespace</p> : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(podSelector).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Policy Types</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2">
                {policyTypes.map((type) => (
                  <Badge key={type} variant="secondary">{type}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          {ingressRules.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Ingress Rules</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {ingressRules.map((rule, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">From</p>
                      <div className="space-y-2">
                        {(rule.from ?? []).map((source, sIdx) => (
                          <div key={sIdx} className="flex gap-2 flex-wrap">
                            {source.podSelector?.matchLabels && (
                              <Badge variant="outline" className="font-mono text-xs">
                                Pod: {Object.entries(source.podSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}
                              </Badge>
                            )}
                            {source.namespaceSelector?.matchLabels && (
                              <Badge variant="secondary" className="font-mono text-xs">
                                Namespace: {Object.entries(source.namespaceSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}
                              </Badge>
                            )}
                            {source.ipBlock?.cidr && (
                              <Badge variant="outline" className="font-mono text-xs">IP: {source.ipBlock.cidr}</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">Ports</p>
                      <div className="flex gap-2 flex-wrap">
                        {(rule.ports ?? []).map((port, pIdx) => (
                          <Badge key={pIdx} variant="outline" className="font-mono text-xs">
                            {port.port}/{port.protocol ?? 'TCP'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {egressRules.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Egress Rules</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {egressRules.map((rule, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">To</p>
                      <div className="space-y-2">
                        {(rule.to ?? []).map((dest, dIdx) => (
                          <div key={dIdx} className="flex gap-2 flex-wrap">
                            {dest.podSelector?.matchLabels && <Badge variant="outline" className="font-mono text-xs">Pod: {Object.entries(dest.podSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}</Badge>}
                            {dest.namespaceSelector?.matchLabels && <Badge variant="secondary" className="font-mono text-xs">Namespace: {Object.entries(dest.namespaceSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}</Badge>}
                            {dest.ipBlock?.cidr && <Badge variant="outline" className="font-mono text-xs">IP: {dest.ipBlock.cidr}</Badge>}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">Ports</p>
                      <div className="flex gap-2 flex-wrap">
                        {(rule.ports ?? []).map((port, pIdx) => (
                          <Badge key={pIdx} variant="outline" className="font-mono text-xs">{port.port}/{port.protocol ?? 'TCP'}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      ),
    },
    {
      id: 'visualization',
      label: 'Policy Visualization',
      content: (
        <SectionCard title="Policy visualization" icon={Shield}>
          <p className="text-muted-foreground text-sm mb-4">Diagram: selected pods, allowed ingress/egress sources/destinations. Simplified view.</p>
          <p className="text-sm">Selected pods: {affectedPods.length}. Ingress rules: {ingressRules.length}. Egress rules: {egressRules.length}.</p>
        </SectionCard>
      ),
    },
    {
      id: 'simulation',
      label: 'Policy Simulation',
      content: (
        <SectionCard title="Policy simulation" icon={Shield}>
          <p className="text-muted-foreground text-sm">Simulate: source pod/ns/IP, dest pod/ns/IP, port → ALLOW/DENY. Placeholder until evaluation implemented.</p>
        </SectionCard>
      ),
    },
    {
      id: 'pods',
      label: 'Affected Pods',
      content: (
        <SectionCard title="Affected pods" icon={Shield}>
          {affectedPods.length === 0 ? <p className="text-muted-foreground text-sm">No pods match the pod selector.</p> : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">Name</th><th className="text-left p-2">Actions</th></tr></thead>
                <tbody>
                  {affectedPods.map((p) => (
                    <tr key={p.metadata?.name} className="border-b">
                      <td className="p-2 font-mono">{p.metadata?.name}</td>
                      <td className="p-2"><Link to={`/pods/${namespace}/${p.metadata?.name}`} className="text-primary text-sm hover:underline">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ),
    },
    {
      id: 'coverage',
      label: 'Coverage Analysis',
      content: (
        <SectionCard title="Coverage analysis" icon={Shield}>
          <p className="text-muted-foreground text-sm">Namespace coverage %, uncovered pods list, default-deny status. Placeholder for full analysis.</p>
        </SectionCard>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'metrics', label: 'Metrics', content: <SectionCard title="Metrics" icon={Activity}><p className="text-muted-foreground text-sm">Placeholder until metrics pipeline.</p></SectionCard> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={npName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="networkpolicies"
          resourceKind="NetworkPolicy"
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
          kind={normalizeKindForTopology('NetworkPolicy')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="NetworkPolicy"
          sourceResourceName={np?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    { id: 'audit', label: 'Audit Trail', content: <SectionCard title="Audit trail" icon={Shield}><p className="text-muted-foreground text-sm">Placeholder for event history / audit.</p></SectionCard> },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Shield, label: 'Simulate', description: 'Run policy simulation', onClick: () => toast.info('Simulation: requires backend support (design 3.6)') },
          { icon: Download, label: 'Clone policy', description: 'Create a copy', onClick: () => toast.info('Clone: open create with same YAML') },
          { icon: Download, label: 'Download YAML', description: 'Export NetworkPolicy definition', onClick: handleDownloadYaml },
          { icon: Download, label: 'Export as JSON', description: 'Export NetworkPolicy as JSON', onClick: handleDownloadJson },
          { icon: Trash2, label: 'Delete Policy', description: 'Remove this network policy', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="NetworkPolicy"
        resourceIcon={Shield}
        name={npName}
        namespace={npNamespace}
        status={status}
        backLink="/networkpolicies"
        backLabel="Network Policies"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}{isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="NetworkPolicy"
        resourceName={npName}
        namespace={npNamespace}
        onConfirm={async () => {
          if (isConnected && name && npNamespace) {
            await deleteNetworkPolicy.mutateAsync({ name, namespace: npNamespace });
            navigate('/networkpolicies');
          } else {
            toast.success(`NetworkPolicy ${npName} deleted (demo mode)`);
            navigate('/networkpolicies');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
