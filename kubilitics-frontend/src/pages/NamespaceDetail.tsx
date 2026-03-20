import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Folder, Clock, Download, Trash2, Box, Globe, Settings, Layers, Package, Database, Shield, Activity, Loader2, Network, GitCompare, ChevronRight, BarChart2, Boxes, HardDrive, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';
import {
  ResourceDetailLayout,
  SectionCard,
  LabelList,
  AnnotationList,
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
import { useDeleteK8sResource, useUpdateK8sResource, useK8sResourceList, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

interface NamespaceResource extends KubernetesResource {
  spec?: {
    finalizers?: string[];
  };
  status?: {
    phase?: string;
  };
}

export default function NamespaceDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const [activeTab, setActiveTab] = useState('overview');

  const { resource: ns, isLoading, error: resourceError, age, yaml, isConnected: resourceConnected, refetch } = useResourceDetail<NamespaceResource>(
    'namespaces',
    name ?? undefined,
    undefined,
    {} as NamespaceResource
  );
  const { events } = useResourceEvents('Namespace', name ?? undefined, name ?? undefined);
  const deleteNamespace = useDeleteK8sResource('namespaces');
  const updateNamespace = useUpdateK8sResource('namespaces');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const nsName = ns?.metadata?.name ?? name ?? '';
  const labels = ns?.metadata?.labels || {};
  const annotations = ns?.metadata?.annotations || {};
  const phase = ns?.status?.phase || 'Active';
  const finalizers = ns?.spec?.finalizers || [];
  const status: ResourceStatus = phase === 'Active' ? 'Healthy' : phase === 'Terminating' ? 'Warning' : 'Unknown';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nsName || 'namespace'}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [yaml, nsName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(ns, `${nsName || 'namespace'}.json`);
    toast.success('JSON downloaded');
  }, [ns, nsName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const handleSaveYaml = async (newYaml: string) => {
    if (!nsName) return;
    try {
      await updateNamespace.mutateAsync({ name: nsName, yaml: newYaml });
      toast.success('Namespace updated successfully');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update Namespace');
      throw e;
    }
  };

  const queryOpts = { enabled: !!nsName && isConnected, limit: 500 };
  const podsList = useK8sResourceList<KubernetesResource>('pods', nsName, { ...queryOpts, limit: 5000 });
  const deploymentsList = useK8sResourceList<KubernetesResource>('deployments', nsName, queryOpts);
  const servicesList = useK8sResourceList<KubernetesResource>('services', nsName, queryOpts);
  const configMapsList = useK8sResourceList<KubernetesResource>('configmaps', nsName, queryOpts);
  const secretsList = useK8sResourceList<KubernetesResource>('secrets', nsName, queryOpts);
  const replicaSetsList = useK8sResourceList<KubernetesResource>('replicasets', nsName, queryOpts);
  const statefulSetsList = useK8sResourceList<KubernetesResource>('statefulsets', nsName, queryOpts);
  const daemonSetsList = useK8sResourceList<KubernetesResource>('daemonsets', nsName, queryOpts);
  const jobsList = useK8sResourceList<KubernetesResource>('jobs', nsName, queryOpts);
  const ingressesList = useK8sResourceList<KubernetesResource>('ingresses', nsName, queryOpts);
  const pvcList = useK8sResourceList<KubernetesResource>('persistentvolumeclaims', nsName, queryOpts);
  const resourceQuotasList = useK8sResourceList<KubernetesResource>('resourcequotas', nsName, { ...queryOpts, limit: 100 });
  const limitRangesList = useK8sResourceList<KubernetesResource>('limitranges', nsName, { ...queryOpts, limit: 100 });

  const getCount = (q: { data?: { items?: unknown[] } }) => q.data?.items?.length;
  const resourceCounts = useMemo(() => {
    if (!isConnected || !nsName) return {
      pods: '–', deployments: '–', services: '–', configmaps: '–', secrets: '–',
      replicasets: '–', statefulsets: '–', daemonsets: '–', jobs: '–', ingresses: '–', pvcs: '–',
    };
    return {
      pods: getCount(podsList) ?? '–',
      deployments: getCount(deploymentsList) ?? '–',
      services: getCount(servicesList) ?? '–',
      configmaps: getCount(configMapsList) ?? '–',
      secrets: getCount(secretsList) ?? '–',
      replicasets: getCount(replicaSetsList) ?? '–',
      statefulsets: getCount(statefulSetsList) ?? '–',
      daemonsets: getCount(daemonSetsList) ?? '–',
      jobs: getCount(jobsList) ?? '–',
      ingresses: getCount(ingressesList) ?? '–',
      pvcs: getCount(pvcList) ?? '–',
    };
  }, [isConnected, nsName, podsList.data, deploymentsList.data, servicesList.data, configMapsList.data, secretsList.data, replicaSetsList.data, statefulSetsList.data, daemonSetsList.data, jobsList.data, ingressesList.data, pvcList.data]);

  const resourceQuotas = useMemo(() => resourceQuotasList.data?.items ?? [], [resourceQuotasList.data?.items]);
  const hasQuota = resourceQuotas.length > 0;


  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && (resourceError || !ns?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Folder className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Namespace not found</p>
        <p className="text-sm text-muted-foreground">{name ? `No namespace named "${name}".` : 'Missing namespace name.'}</p>
        <Button variant="outline" className="press-effect" onClick={() => navigate('/namespaces')}>Back to Namespaces</Button>
      </div>
    );
  }

  const totalResources = Object.values(resourceCounts).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);

  const statusCards = [
    { label: 'Status', value: phase, icon: Box, iconColor: (phase === 'Active' ? 'success' : 'warning') as any },
    { label: 'Pods', value: String(resourceCounts.pods), icon: Package, iconColor: 'primary' as any },
    { label: 'Deployments', value: String(resourceCounts.deployments), icon: Layers, iconColor: 'info' as any },
    { label: 'Services', value: String(resourceCounts.services), icon: Globe, iconColor: 'success' as any },
    { label: 'Total Resources', value: totalResources > 0 ? String(totalResources) : '–', icon: Boxes, iconColor: 'primary' as any },
    { label: 'Age', value: age, icon: Clock, iconColor: 'muted' as any },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Namespace Info */}
            <SectionCard icon={Folder} title="Namespace Info" tooltip="Phase, finalizers, labels, annotations">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Phase</p>
                  <Badge variant={phase === 'Active' ? 'default' : 'secondary'} className={phase === 'Active' ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>{phase}</Badge>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Age</p>
                  <p className="font-medium">{age}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Finalizers</p>
                  <p className="text-muted-foreground">{finalizers.length ? finalizers.join(', ') : 'None'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Labels</p>
                  <p className="font-medium">{Object.keys(labels).length} labels</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Annotations</p>
                  <p className="font-medium">{Object.keys(annotations).length} annotations</p>
                </div>
                {hasQuota && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Resource Quotas</p>
                    <p className="font-medium">{resourceQuotas.length} quota{resourceQuotas.length !== 1 ? 's' : ''}</p>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Labels */}
            <LabelList labels={labels} />
            <AnnotationList annotations={annotations} />

            {/* Resource Summary — full grid */}
            <SectionCard icon={Boxes} title="Resource Summary" tooltip="Counts of all resource types in this namespace" className="lg:col-span-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {([
                  { label: 'Pods', value: resourceCounts.pods, icon: Package, path: '/pods', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' },
                  { label: 'Deployments', value: resourceCounts.deployments, icon: Layers, path: '/deployments', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
                  { label: 'ReplicaSets', value: resourceCounts.replicasets, icon: Boxes, path: '/replicasets', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
                  { label: 'StatefulSets', value: resourceCounts.statefulsets, icon: Database, path: '/statefulsets', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10' },
                  { label: 'DaemonSets', value: resourceCounts.daemonsets, icon: Activity, path: '/daemonsets', color: 'text-fuchsia-600 dark:text-fuchsia-400', bg: 'bg-fuchsia-500/10' },
                  { label: 'Jobs', value: resourceCounts.jobs, icon: BarChart2, path: '/jobs', color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10' },
                  { label: 'Services', value: resourceCounts.services, icon: Globe, path: '/services', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
                  { label: 'Ingresses', value: resourceCounts.ingresses, icon: Network, path: '/ingresses', color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500/10' },
                  { label: 'ConfigMaps', value: resourceCounts.configmaps, icon: Settings, path: '/configmaps', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
                  { label: 'Secrets', value: resourceCounts.secrets, icon: Shield, path: '/secrets', color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' },
                  { label: 'PVCs', value: resourceCounts.pvcs, icon: HardDrive, path: '/persistentvolumeclaims', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10' },
                ] as const).map(({ label, value, icon: Icon, path, color, bg }) => (
                  <button
                    key={label}
                    className="group relative p-4 rounded-xl border border-border/50 bg-card hover:border-primary/30 hover:shadow-md transition-all duration-200 text-left cursor-pointer"
                    onClick={() => navigate(`${path}?namespace=${encodeURIComponent(nsName)}`)}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center`}>
                        <Icon className={`h-4 w-4 ${color}`} />
                      </div>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-primary group-hover:text-muted-foreground transition-all" />
                    </div>
                    <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
                    <p className="text-[11px] font-medium text-muted-foreground mt-0.5">{label}</p>
                  </button>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      ),
    },
    {
      id: 'quotas',
      label: 'Quota Status',
      content: (
        <div className="space-y-6">
          {!hasQuota ? (
            <p className="text-muted-foreground">No resource quotas in this namespace.</p>
          ) : (
            resourceQuotas.map((rq: KubernetesResource) => (
              <Card key={rq.metadata?.uid}>
                <CardHeader>
                  <CardTitle className="text-base">Resource Quota: {rq.metadata?.name}</CardTitle>
                  <CardDescription>Resource usage limits for this namespace</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs font-mono bg-muted/50 p-4 rounded-lg overflow-auto">
                    {JSON.stringify((rq as any).status ?? (rq as any).spec ?? {}, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={nsName} editable onSave={handleSaveYaml} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="namespaces"
          resourceKind="Namespace"
          initialSelectedResources={[nsName]}
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
          kind={normalizeKindForTopology('Namespace')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="Namespace"
          sourceResourceName={ns?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: Download, label: 'Download YAML', description: 'Export Namespace definition', onClick: handleDownloadYaml, className: 'press-effect' },
            { icon: Download, label: 'Export as JSON', description: 'Export Namespace as JSON', onClick: handleDownloadJson, className: 'press-effect' },
            { icon: Trash2, label: 'Delete Namespace', description: 'Remove namespace and all resources', variant: 'destructive', onClick: () => setShowDeleteDialog(true), className: 'press-effect' },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        role="main"
        aria-label="Namespace Detail"
        resourceType="Namespace"
        resourceIcon={Folder}
        name={nsName}
        status={status}
        backLink="/namespaces"
        backLabel="Namespaces"
        headerMetadata={
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />Created {age}
            <span className="mx-2">•</span>
            <Badge variant={phase === 'Active' ? 'default' : 'secondary'}>{phase}</Badge>
            {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
          </span>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml, className: 'press-effect' },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson, className: 'press-effect' },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true), className: 'press-effect' },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="Namespace"
        resourceName={nsName}
        onConfirm={async () => {
          if (isConnected && name) {
            await deleteNamespace.mutateAsync({ name, namespace: undefined });
            navigate('/namespaces');
          } else {
            toast.success(`Namespace ${nsName} deleted`);
            navigate('/namespaces');
          }
        }}
        requireNameConfirmation
      />
    </>
  );
}
