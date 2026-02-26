import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShieldCheck, Clock, Download, Trash2, Edit, Users, Globe, Network, GitCompare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ResourceDetailLayout,

  MetadataCard,
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
import { toast } from 'sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface ClusterRoleRule {
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
  verbs?: string[];
  nonResourceURLs?: string[];
}

interface AggregationRule {
  clusterRoleSelectors?: Array<{ matchLabels?: Record<string, string>; matchExpressions?: unknown[] }>;
}

interface ClusterRoleResource extends KubernetesResource {
  rules?: ClusterRoleRule[];
  aggregationRule?: AggregationRule;
}

const VERBS_ORDER = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'deletecollection'];

function buildPermissionMatrix(rules: ClusterRoleRule[]): Map<string, Set<string>> {
  const matrix = new Map<string, Set<string>>();
  for (const rule of rules || []) {
    if (rule.nonResourceURLs?.length) {
      for (const url of rule.nonResourceURLs) {
        const key = `(non-resource) ${url}`;
        if (!matrix.has(key)) matrix.set(key, new Set());
        for (const v of rule.verbs ?? []) matrix.get(key)!.add(v);
      }
    }
    const apiGroup = (rule.apiGroups ?? ['']).join(',') || 'core';
    for (const res of rule.resources ?? []) {
      const key = apiGroup ? `${res} (${apiGroup})` : res;
      if (!matrix.has(key)) matrix.set(key, new Set());
      for (const v of rule.verbs ?? []) matrix.get(key)!.add(v);
    }
  }
  return matrix;
}

export default function ClusterRoleDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<ClusterRoleResource>(
    'clusterroles',
    name ?? undefined,
    undefined,
    undefined as unknown as ClusterRoleResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('ClusterRole', undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('clusterroles');

  const crName = resource?.metadata?.name ?? name ?? '';
  const rules = resource?.rules ?? [];
  const aggregationRule = resource?.aggregationRule;
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  const permissionMatrix = useMemo(() => buildPermissionMatrix(rules), [rules]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${crName || 'clusterrole'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, crName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(resource, `${crName || 'clusterrole'}.json`);
    toast.success('JSON downloaded');
  }, [resource, crName]);

  const statusCards = [
    { label: 'Rules Count', value: rules.length, icon: ShieldCheck, iconColor: 'primary' as const },
    { label: 'Bindings', value: '–', icon: ShieldCheck, iconColor: 'muted' as const },
    { label: 'Aggregation', value: aggregationRule ? 'Yes' : 'No', icon: ShieldCheck, iconColor: 'muted' as const },
    { label: 'Scope', value: 'Cluster-wide', icon: Globe, iconColor: 'info' as const },
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
        <ShieldCheck className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Cluster Role not found</p>
        <p className="text-sm text-muted-foreground">
          {name ? `No cluster role "${name}".` : 'Missing name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/clusterroles')}>Back to Cluster Roles</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 gap-6">
          {aggregationRule?.clusterRoleSelectors?.length ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Aggregation Rule</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {aggregationRule.clusterRoleSelectors.map((sel, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/50 text-sm">
                      {sel.matchLabels && Object.keys(sel.matchLabels).length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(sel.matchLabels).map(([k, v]) => (
                            <Badge key={k} variant="outline">{k}={v}</Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Label selector</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rules.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No rules (aggregated role may inherit from others).</p>
                ) : (
                  rules.map((rule, i) => (
                    <div key={i} className="p-4 rounded-lg bg-muted/50">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground mb-2">API Groups</p>
                          <div className="flex flex-wrap gap-1">
                            {(rule.apiGroups ?? ['']).map((g, j) => (
                              <Badge key={j} variant="secondary" className="font-mono">{g || 'core'}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-muted-foreground mb-2">Resources / Non-Resource URLs</p>
                          <div className="flex flex-wrap gap-1">
                            {(rule.resources ?? []).map((r, j) => (
                              <Badge key={j} variant="outline" className="font-mono text-xs">{r}</Badge>
                            ))}
                            {(rule.nonResourceURLs ?? []).map((url, j) => (
                              <Badge key={`n-${j}`} variant="secondary" className="font-mono text-xs">{url}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-muted-foreground mb-2">Verbs</p>
                          <div className="flex flex-wrap gap-1">
                            {(rule.verbs ?? []).map((v, j) => (
                              <Badge key={j} variant="default" className="font-mono text-xs">{v}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          <MetadataCard title="Labels" items={labels} variant="badges" />
          {Object.keys(annotations).length > 0 && <MetadataCard title="Annotations" items={annotations} variant="badges" />}
        </div>
      ),
    },
    {
      id: 'permission-matrix',
      label: 'Permission Matrix',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Resources × Verbs</CardTitle></CardHeader>
          <CardContent>
            {permissionMatrix.size === 0 ? (
              <p className="text-muted-foreground text-sm">No rules to display.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-48">Resource</TableHead>
                      {VERBS_ORDER.map((v) => (
                        <TableHead key={v} className="text-center w-20">{v}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(permissionMatrix.entries()).map(([res, verbs]) => (
                      <TableRow key={res}>
                        <TableCell className="font-mono text-sm">{res}</TableCell>
                        {VERBS_ORDER.map((v) => (
                          <TableCell key={v} className="text-center">
                            {verbs.has(v) ? <span className="inline-block w-4 h-4 rounded bg-green-500/80" title={v} /> : <span className="inline-block w-4 h-4 rounded bg-muted" />}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'bindings',
      label: 'Bindings',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">ClusterRoleBindings / RoleBindings</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Bindings that reference this ClusterRole. View Cluster Role Bindings to see cluster-wide bindings.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate('/clusterrolebindings')}>View Cluster Role Bindings</Button>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'aggregation',
      label: 'Aggregation',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Aggregation</CardTitle></CardHeader>
          <CardContent>
            {aggregationRule?.clusterRoleSelectors?.length ? (
              <div className="space-y-2">
                {aggregationRule.clusterRoleSelectors.map((sel, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/50 text-sm">
                    {sel.matchLabels && Object.keys(sel.matchLabels).length > 0
                      ? Object.entries(sel.matchLabels).map(([k, v]) => <Badge key={k} variant="outline" className="mr-1">{k}={v}</Badge>)
                      : <span className="text-muted-foreground">Label selector</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">This ClusterRole is not aggregated.</p>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'effective-subjects',
      label: 'Effective Subjects',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Subjects</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Subjects are derived from ClusterRoleBindings (and namespaced RoleBindings) that reference this ClusterRole.</p>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={crName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="clusterroles"
          resourceKind="ClusterRole"
          initialSelectedResources={[crName]}
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
          kind={normalizeKindForTopology('ClusterRole')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="ClusterRole"
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
            { icon: Edit, label: 'Edit ClusterRole', description: 'Modify cluster role permissions', onClick: () => toast.info('Edit not implemented') },
            { icon: Users, label: 'View Bindings', description: 'See all bindings using this cluster role', onClick: () => navigate('/clusterrolebindings') },
            { icon: Download, label: 'Download YAML', description: 'Export ClusterRole definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export ClusterRole as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete ClusterRole', description: 'Remove this cluster role', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="ClusterRole"
        resourceIcon={ShieldCheck}
        name={crName}
        status={status}
        backLink="/clusterroles"
        backLabel="Cluster Roles"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {age}</span>}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
          { label: 'Edit', icon: Edit, variant: 'outline', onClick: () => toast.info('Edit not implemented') },
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
        resourceType="ClusterRole"
        resourceName={crName}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: crName });
          navigate('/clusterroles');
        }}
        requireNameConfirmation
      />
    </>
  );
}
