import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shield, Clock, Download, Trash2, Edit, Users, Network, GitCompare } from 'lucide-react';
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

interface RoleRule {
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
  verbs?: string[];
}

interface RoleResource extends KubernetesResource {
  rules?: RoleRule[];
}

const VERBS_ORDER = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'deletecollection'];

function buildPermissionMatrix(rules: RoleRule[]): Map<string, Set<string>> {
  const matrix = new Map<string, Set<string>>();
  for (const rule of rules || []) {
    const apiGroup = (rule.apiGroups || ['']).join(',') || 'core';
    for (const res of rule.resources || []) {
      const key = apiGroup ? `${res} (${apiGroup})` : res;
      if (!matrix.has(key)) matrix.set(key, new Set());
      for (const v of rule.verbs || []) matrix.get(key)!.add(v);
    }
  }
  return matrix;
}

export default function RoleDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<RoleResource>(
    'roles',
    name ?? undefined,
    namespace ?? undefined,
    undefined as unknown as RoleResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('Role', namespace ?? undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('roles');

  const roleName = resource?.metadata?.name ?? name ?? '';
  const roleNamespace = resource?.metadata?.namespace ?? namespace ?? '';
  const rules = resource?.rules ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  const apiGroupsSet = useMemo(() => {
    const set = new Set<string>();
    rules.forEach((r) => (r.apiGroups ?? []).forEach((g) => set.add(g || 'core')));
    return Array.from(set);
  }, [rules]);

  const resourcesCovered = useMemo(() => {
    const set = new Set<string>();
    rules.forEach((r) => (r.resources ?? []).forEach((res) => set.add(res)));
    return Array.from(set).slice(0, 5).join(', ') + (rules.reduce((acc, r) => acc + (r.resources?.length ?? 0), 0) > 5 ? '…' : '');
  }, [rules]);

  const permissionMatrix = useMemo(() => buildPermissionMatrix(rules), [rules]);

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${roleName || 'role'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, roleName]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(resource, `${roleName || 'role'}.json`);
    toast.success('JSON downloaded');
  }, [resource, roleName]);

  const statusCards = [
    { label: 'Rules Count', value: rules.length, icon: Shield, iconColor: 'primary' as const },
    { label: 'API Groups', value: apiGroupsSet.length || '–', icon: Shield, iconColor: 'muted' as const },
    { label: 'Resources Covered', value: resourcesCovered || '–', icon: Shield, iconColor: 'muted' as const },
    { label: 'Bindings Count', value: '–', icon: Shield, iconColor: 'muted' as const },
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
        <Shield className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Role not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No role "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/roles')}>Back to Roles</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rules.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No rules</p>
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
                          <p className="text-muted-foreground mb-2">Resources</p>
                          <div className="flex flex-wrap gap-1">
                            {(rule.resources ?? []).map((r, j) => (
                              <Badge key={j} variant="outline" className="font-mono">{r}</Badge>
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
          <CardHeader><CardTitle className="text-base">RoleBindings</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">RoleBindings that reference this Role can be listed by viewing RoleBindings in this namespace and filtering by role.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate(`/rolebindings?namespace=${roleNamespace}`)}>View RoleBindings in {roleNamespace}</Button>
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
            <p className="text-muted-foreground text-sm">Subjects are derived from RoleBindings that reference this Role. View Bindings tab and open each RoleBinding to see subjects.</p>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={roleName} /> },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType="roles"
          resourceKind="Role"
          namespace={roleNamespace}
          initialSelectedResources={roleNamespace && roleName ? [`${roleNamespace}/${roleName}`] : [roleName]}
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
          kind={normalizeKindForTopology('Role')}
          namespace={roleNamespace ?? ''}
          name={name ?? ''}
          sourceResourceType="Role"
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
            { icon: Edit, label: 'Edit Role', description: 'Modify role permissions', onClick: () => toast.info('Edit not implemented') },
            { icon: Users, label: 'View Bindings', description: 'See all role bindings using this role', onClick: () => navigate(`/rolebindings?namespace=${roleNamespace}`) },
            { icon: Download, label: 'Download YAML', description: 'Export Role definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export Role as JSON', onClick: handleDownloadJson },
            { icon: Trash2, label: 'Delete Role', description: 'Remove this role', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="Role"
        resourceIcon={Shield}
        name={roleName}
        namespace={roleNamespace}
        status={status}
        backLink="/roles"
        backLabel="Roles"
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
        resourceType="Role"
        resourceName={roleName}
        namespace={roleNamespace}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: roleName, namespace: roleNamespace });
          navigate('/roles');
        }}
        requireNameConfirmation
      />
    </>
  );
}
