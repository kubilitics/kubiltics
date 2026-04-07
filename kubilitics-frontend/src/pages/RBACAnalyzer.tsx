/**
 * RBACAnalyzer — "Who can do what?" security analysis page.
 *
 * Three views:
 * 1. Permission Matrix — Subject x Resource x Verbs filterable table
 * 2. "Who Can" Query — natural-language-style query: verb + resource + namespace
 * 3. Over-Privileged Detection — flags wildcard verbs/resources & cluster-admin bindings
 *
 * All computation is client-side using existing useK8sResourceList hooks.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Shield, Search, AlertTriangle, Users, Eye, Pencil, Trash2,
  ChevronRight, Filter, Loader2, ShieldAlert, CheckCircle2,
  Star, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout/PageLayout';
import { useK8sResourceList, type KubernetesResource } from '@/hooks/useKubernetes';

// ─── RBAC Types ──────────────────────────────────────────────

interface PolicyRule {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
  resourceNames?: string[];
  nonResourceURLs?: string[];
}

interface RoleResource extends KubernetesResource {
  rules?: PolicyRule[];
}

interface SubjectRef {
  kind: string;  // User | Group | ServiceAccount
  name: string;
  namespace?: string;
  apiGroup?: string;
}

interface RoleRef {
  kind: string;  // Role | ClusterRole
  name: string;
  apiGroup?: string;
}

interface BindingResource extends KubernetesResource {
  subjects?: SubjectRef[];
  roleRef?: RoleRef;
}

// Resolved permission entry — one row in the matrix
interface PermissionEntry {
  subjectKind: string;
  subjectName: string;
  subjectNamespace: string;
  resource: string;
  apiGroup: string;
  verbs: string[];
  namespace: string;  // binding namespace or "(cluster-wide)"
  bindingName: string;
  bindingKind: string;
  roleName: string;
  roleKind: string;
  isWildcard: boolean;
}

// ─── Constants ───────────────────────────────────────────────

const READ_VERBS = new Set(['get', 'list', 'watch']);
const WRITE_VERBS = new Set(['create', 'update', 'patch']);
const ADMIN_VERBS = new Set(['delete', 'deletecollection', '*']);
const ALL_STANDARD_VERBS = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'];

const COMMON_RESOURCES = [
  'pods', 'deployments', 'services', 'configmaps', 'secrets',
  'namespaces', 'nodes', 'persistentvolumes', 'persistentvolumeclaims',
  'serviceaccounts', 'roles', 'clusterroles', 'rolebindings', 'clusterrolebindings',
  'ingresses', 'networkpolicies', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs',
  'replicasets', 'events', 'endpoints', 'storageclasses',
];

// ─── Helpers ─────────────────────────────────────────────────

function verbColor(verb: string): string {
  if (verb === '*') return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-500/30';
  if (ADMIN_VERBS.has(verb)) return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20';
  if (WRITE_VERBS.has(verb)) return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';
  return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';
}

function subjectIcon(kind: string) {
  switch (kind) {
    case 'ServiceAccount': return <Shield className="h-3.5 w-3.5" />;
    case 'Group': return <Users className="h-3.5 w-3.5" />;
    default: return <Eye className="h-3.5 w-3.5" />;
  }
}

function subjectLabel(entry: { subjectKind: string; subjectName: string; subjectNamespace: string }) {
  if (entry.subjectKind === 'ServiceAccount' && entry.subjectNamespace) {
    return `${entry.subjectNamespace}/${entry.subjectName}`;
  }
  return entry.subjectName;
}

// ─── Permission Builder ──────────────────────────────────────

function buildPermissions(
  roles: RoleResource[],
  clusterRoles: RoleResource[],
  roleBindings: BindingResource[],
  clusterRoleBindings: BindingResource[],
): PermissionEntry[] {
  const roleMap = new Map<string, RoleResource>();

  // Index roles by "namespace/name" and clusterroles by name
  for (const r of roles) {
    const ns = r.metadata.namespace ?? '';
    roleMap.set(`Role:${ns}/${r.metadata.name}`, r);
  }
  for (const cr of clusterRoles) {
    roleMap.set(`ClusterRole:/${cr.metadata.name}`, cr);
  }

  const entries: PermissionEntry[] = [];

  function processBinding(binding: BindingResource, isClusterBinding: boolean) {
    const subjects = binding.subjects ?? [];
    const roleRef = binding.roleRef;
    if (!roleRef) return;

    const bindingNs = binding.metadata.namespace ?? '';
    const lookupKey = roleRef.kind === 'ClusterRole'
      ? `ClusterRole:/${roleRef.name}`
      : `Role:${bindingNs}/${roleRef.name}`;

    const role = roleMap.get(lookupKey);
    if (!role) return;

    const rules = role.rules ?? [];
    const effectiveNs = isClusterBinding ? '(cluster-wide)' : bindingNs;

    for (const subject of subjects) {
      for (const rule of rules) {
        const resources = rule.resources ?? ['(non-resource)'];
        const verbs = rule.verbs ?? [];
        const apiGroups = rule.apiGroups ?? [''];

        for (const resource of resources) {
          const isWildcard = verbs.includes('*') || resource === '*';
          entries.push({
            subjectKind: subject.kind,
            subjectName: subject.name,
            subjectNamespace: subject.namespace ?? '',
            resource,
            apiGroup: apiGroups.join(', '),
            verbs,
            namespace: effectiveNs,
            bindingName: binding.metadata.name,
            bindingKind: isClusterBinding ? 'ClusterRoleBinding' : 'RoleBinding',
            roleName: roleRef.name,
            roleKind: roleRef.kind,
            isWildcard,
          });
        }
      }
    }
  }

  for (const rb of roleBindings) processBinding(rb, false);
  for (const crb of clusterRoleBindings) processBinding(crb, true);

  return entries;
}

// ─── Over-Privileged Detection ───────────────────────────────

interface OverPrivilegedEntry extends PermissionEntry {
  reason: string;
}

function detectOverPrivileged(entries: PermissionEntry[]): OverPrivilegedEntry[] {
  const results: OverPrivilegedEntry[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    const key = `${e.subjectKind}:${e.subjectNamespace}/${e.subjectName}:${e.bindingName}:${e.resource}`;
    if (seen.has(key)) continue;

    const reasons: string[] = [];

    if (e.verbs.includes('*')) reasons.push('Wildcard verbs (*)');
    if (e.resource === '*') reasons.push('Wildcard resources (*)');
    if (e.roleKind === 'ClusterRole' && e.roleName === 'cluster-admin' && e.bindingKind === 'ClusterRoleBinding') {
      reasons.push('Bound to cluster-admin via ClusterRoleBinding');
    }

    if (reasons.length > 0) {
      seen.add(key);
      results.push({ ...e, reason: reasons.join('; ') });
    }
  }
  return results;
}

// ─── "Who Can" Query Parser ──────────────────────────────────

interface WhoCanQuery {
  verb: string;
  resource: string;
  namespace: string;
}

function parseWhoCanQuery(query: string): WhoCanQuery | null {
  // Pattern: "Who can <verb> <resource> in namespace <ns>?"
  const cleaned = query.replace(/[?!.]/g, '').trim().toLowerCase();

  // Try "who can <verb> <resource> in namespace <ns>"
  const fullMatch = cleaned.match(/who\s+can\s+(\w+)\s+(\w+)\s+in\s+(?:namespace\s+)?(\S+)/);
  if (fullMatch) {
    return { verb: fullMatch[1]!, resource: fullMatch[2]!, namespace: fullMatch[3]! };
  }

  // Try "who can <verb> <resource>"
  const simpleMatch = cleaned.match(/who\s+can\s+(\w+)\s+(\w+)/);
  if (simpleMatch) {
    return { verb: simpleMatch[1]!, resource: simpleMatch[2]!, namespace: '' };
  }

  // Try just "<verb> <resource> <ns>"
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    return { verb: parts[0]!, resource: parts[1]!, namespace: parts[2] ?? '' };
  }

  return null;
}

function findWhoCanDo(entries: PermissionEntry[], query: WhoCanQuery): PermissionEntry[] {
  return entries.filter(e => {
    const verbMatch = e.verbs.includes('*') || e.verbs.includes(query.verb);
    const resourceMatch = e.resource === '*' || e.resource === query.resource;
    const nsMatch = !query.namespace ||
      e.namespace === '(cluster-wide)' ||
      e.namespace === query.namespace;
    return verbMatch && resourceMatch && nsMatch;
  });
}

// ─── Main Component ──────────────────────────────────────────

export default function RBACAnalyzer() {
  const [activeTab, setActiveTab] = useState('matrix');
  const [searchFilter, setSearchFilter] = useState('');
  const [nsFilter, setNsFilter] = useState('all');
  const [subjectTypeFilter, setSubjectTypeFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [whoCanInput, setWhoCanInput] = useState('');
  const [whoCanParsed, setWhoCanParsed] = useState<WhoCanQuery | null>(null);

  // Fetch RBAC resources
  const rolesQuery = useK8sResourceList<RoleResource>('roles', undefined, { limit: 2000 });
  const clusterRolesQuery = useK8sResourceList<RoleResource>('clusterroles', undefined, { limit: 2000 });
  const roleBindingsQuery = useK8sResourceList<BindingResource>('rolebindings', undefined, { limit: 2000 });
  const clusterRoleBindingsQuery = useK8sResourceList<BindingResource>('clusterrolebindings', undefined, { limit: 2000 });
  const serviceAccountsQuery = useK8sResourceList<KubernetesResource>('serviceaccounts', undefined, { limit: 2000 });

  const isLoading = rolesQuery.isLoading || clusterRolesQuery.isLoading ||
    roleBindingsQuery.isLoading || clusterRoleBindingsQuery.isLoading || serviceAccountsQuery.isLoading;

  const isError = rolesQuery.isError || clusterRolesQuery.isError ||
    roleBindingsQuery.isError || clusterRoleBindingsQuery.isError;

  // Build permissions matrix
  const permissions = useMemo(() => {
    const roles = rolesQuery.data?.items ?? [];
    const clusterRoles = clusterRolesQuery.data?.items ?? [];
    const roleBindings = roleBindingsQuery.data?.items ?? [];
    const clusterRoleBindings = clusterRoleBindingsQuery.data?.items ?? [];
    return buildPermissions(roles, clusterRoles, roleBindings, clusterRoleBindings);
  }, [rolesQuery.data, clusterRolesQuery.data, roleBindingsQuery.data, clusterRoleBindingsQuery.data]);

  // Derive available namespaces and resources from data
  const availableNamespaces = useMemo(() => {
    const ns = new Set<string>();
    for (const e of permissions) {
      if (e.namespace && e.namespace !== '(cluster-wide)') ns.add(e.namespace);
    }
    return Array.from(ns).sort();
  }, [permissions]);

  const availableResources = useMemo(() => {
    const res = new Set<string>();
    for (const e of permissions) {
      if (e.resource !== '*') res.add(e.resource);
    }
    return Array.from(res).sort();
  }, [permissions]);

  // Filtered permissions for matrix view
  const filteredPermissions = useMemo(() => {
    return permissions.filter(e => {
      if (nsFilter !== 'all' && e.namespace !== nsFilter && e.namespace !== '(cluster-wide)') return false;
      if (subjectTypeFilter !== 'all' && e.subjectKind !== subjectTypeFilter) return false;
      if (resourceFilter !== 'all' && e.resource !== resourceFilter && e.resource !== '*') return false;
      if (searchFilter) {
        const s = searchFilter.toLowerCase();
        const matchesSubject = e.subjectName.toLowerCase().includes(s);
        const matchesResource = e.resource.toLowerCase().includes(s);
        const matchesRole = e.roleName.toLowerCase().includes(s);
        if (!matchesSubject && !matchesResource && !matchesRole) return false;
      }
      return true;
    });
  }, [permissions, nsFilter, subjectTypeFilter, resourceFilter, searchFilter]);

  // Group by subject for matrix display (deduplicated)
  const matrixRows = useMemo(() => {
    const grouped = new Map<string, {
      subjectKind: string;
      subjectName: string;
      subjectNamespace: string;
      resources: Map<string, { verbs: Set<string>; namespace: string; roleName: string; bindingName: string }>;
    }>();

    for (const e of filteredPermissions) {
      const subjectKey = `${e.subjectKind}:${e.subjectNamespace}/${e.subjectName}`;
      if (!grouped.has(subjectKey)) {
        grouped.set(subjectKey, {
          subjectKind: e.subjectKind,
          subjectName: e.subjectName,
          subjectNamespace: e.subjectNamespace,
          resources: new Map(),
        });
      }
      const entry = grouped.get(subjectKey)!;
      const resKey = `${e.resource}@${e.namespace}`;
      if (!entry.resources.has(resKey)) {
        entry.resources.set(resKey, { verbs: new Set(), namespace: e.namespace, roleName: e.roleName, bindingName: e.bindingName });
      }
      const resEntry = entry.resources.get(resKey)!;
      for (const v of e.verbs) resEntry.verbs.add(v);
    }

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.subjectKind !== b.subjectKind) return a.subjectKind.localeCompare(b.subjectKind);
      return a.subjectName.localeCompare(b.subjectName);
    });
  }, [filteredPermissions]);

  // Over-privileged detection
  const overPrivileged = useMemo(() => detectOverPrivileged(permissions), [permissions]);

  // Unique over-privileged subjects count
  const overPrivilegedSubjectCount = useMemo(() => {
    const subjects = new Set<string>();
    for (const e of overPrivileged) {
      subjects.add(`${e.subjectKind}:${e.subjectNamespace}/${e.subjectName}`);
    }
    return subjects.size;
  }, [overPrivileged]);

  // "Who Can" query handler
  const handleWhoCanSearch = useCallback(() => {
    const parsed = parseWhoCanQuery(whoCanInput);
    setWhoCanParsed(parsed);
  }, [whoCanInput]);

  const whoCanResults = useMemo(() => {
    if (!whoCanParsed) return [];
    return findWhoCanDo(permissions, whoCanParsed);
  }, [permissions, whoCanParsed]);

  // Deduplicated who-can results by subject
  const whoCanSubjects = useMemo(() => {
    const subjectMap = new Map<string, { kind: string; name: string; namespace: string; bindings: string[] }>();
    for (const e of whoCanResults) {
      const key = `${e.subjectKind}:${e.subjectNamespace}/${e.subjectName}`;
      if (!subjectMap.has(key)) {
        subjectMap.set(key, { kind: e.subjectKind, name: e.subjectName, namespace: e.subjectNamespace, bindings: [] });
      }
      const bindingChain = `${e.bindingKind}/${e.bindingName} -> ${e.roleKind}/${e.roleName}`;
      const entry = subjectMap.get(key)!;
      if (!entry.bindings.includes(bindingChain)) entry.bindings.push(bindingChain);
    }
    return Array.from(subjectMap.values());
  }, [whoCanResults]);

  const handleRefresh = useCallback(() => {
    rolesQuery.refetch();
    clusterRolesQuery.refetch();
    roleBindingsQuery.refetch();
    clusterRoleBindingsQuery.refetch();
    serviceAccountsQuery.refetch();
  }, [rolesQuery, clusterRolesQuery, roleBindingsQuery, clusterRoleBindingsQuery, serviceAccountsQuery]);

  // Stats
  const totalSubjects = useMemo(() => {
    const subjects = new Set<string>();
    for (const e of permissions) subjects.add(`${e.subjectKind}:${e.subjectNamespace}/${e.subjectName}`);
    return subjects.size;
  }, [permissions]);

  const totalRoles = (rolesQuery.data?.items?.length ?? 0) + (clusterRolesQuery.data?.items?.length ?? 0);
  const totalBindings = (roleBindingsQuery.data?.items?.length ?? 0) + (clusterRoleBindingsQuery.data?.items?.length ?? 0);

  // ─── Render ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <PageLayout label="RBAC Analyzer">
        <div className="flex items-center justify-center h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading RBAC data...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout label="RBAC Analyzer">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-rose-500" />
            RBAC Analyzer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analyze role-based access control &mdash; who can do what across your cluster.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subjects</p>
                <p className="text-2xl font-bold mt-1">{totalSubjects}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Roles</p>
                <p className="text-2xl font-bold mt-1">{totalRoles}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bindings</p>
                <p className="text-2xl font-bold mt-1">{totalBindings}</p>
              </div>
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={overPrivilegedSubjectCount > 0 ? 'border-red-300 dark:border-red-500/40' : ''}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Over-Privileged</p>
                <p className={cn('text-2xl font-bold mt-1', overPrivilegedSubjectCount > 0 ? 'text-red-600 dark:text-red-400' : '')}>
                  {overPrivilegedSubjectCount}
                </p>
              </div>
              <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center',
                overPrivilegedSubjectCount > 0 ? 'bg-red-500/10' : 'bg-muted/50')}>
                <ShieldAlert className={cn('h-5 w-5',
                  overPrivilegedSubjectCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="matrix" className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            Permission Matrix
          </TabsTrigger>
          <TabsTrigger value="whocan" className="gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Who Can?
          </TabsTrigger>
          <TabsTrigger value="overprivileged" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Over-Privileged
            {overPrivilegedSubjectCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-[20px] px-1.5 text-[10px]">
                {overPrivilegedSubjectCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── Matrix Tab ─── */}
        <TabsContent value="matrix">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Permission Matrix</CardTitle>
              <CardDescription>
                Each row is a subject (user, group, or service account). Filter by namespace, subject type, or resource.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search subjects, resources, roles..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <Select value={nsFilter} onValueChange={setNsFilter}>
                  <SelectTrigger className="w-[180px] h-9">
                    <SelectValue placeholder="Namespace" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Namespaces</SelectItem>
                    <SelectItem value="(cluster-wide)">Cluster-wide</SelectItem>
                    {availableNamespaces.map(ns => (
                      <SelectItem key={ns} value={ns}>{ns}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={subjectTypeFilter} onValueChange={setSubjectTypeFilter}>
                  <SelectTrigger className="w-[170px] h-9">
                    <SelectValue placeholder="Subject Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    <SelectItem value="User">Users</SelectItem>
                    <SelectItem value="Group">Groups</SelectItem>
                    <SelectItem value="ServiceAccount">Service Accounts</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={resourceFilter} onValueChange={setResourceFilter}>
                  <SelectTrigger className="w-[170px] h-9">
                    <SelectValue placeholder="Resource" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Resources</SelectItem>
                    {availableResources.map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Matrix Table */}
              {isError ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                  Failed to load RBAC resources. Check cluster connectivity.
                </div>
              ) : matrixRows.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No permissions match the current filters.
                </div>
              ) : (
                <div className="border rounded-lg overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-[50px] font-semibold text-xs">#</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[180px]">Subject</TableHead>
                        <TableHead className="font-semibold text-xs w-[100px]">Type</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[140px]">Resource</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[120px]">Namespace</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[300px]">Verbs</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[160px]">Via Role</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matrixRows.slice(0, 200).map((row, rowIdx) => {
                        const resourceEntries = Array.from(row.resources.entries());
                        return resourceEntries.map(([resKey, resData], resIdx) => (
                          <TableRow
                            key={`${rowIdx}-${resKey}`}
                            className={cn(
                              'hover:bg-muted/40 transition-colors',
                              resData.verbs.has('*') && 'bg-red-500/[0.03]',
                            )}
                          >
                            {resIdx === 0 && (
                              <>
                                <TableCell rowSpan={resourceEntries.length} className="text-xs text-muted-foreground font-mono">
                                  {rowIdx + 1}
                                </TableCell>
                                <TableCell rowSpan={resourceEntries.length} className="font-medium text-sm">
                                  <div className="flex items-center gap-1.5">
                                    {subjectIcon(row.subjectKind)}
                                    <span className="truncate max-w-[200px]" title={subjectLabel(row)}>{subjectLabel(row)}</span>
                                  </div>
                                </TableCell>
                                <TableCell rowSpan={resourceEntries.length}>
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {row.subjectKind}
                                  </Badge>
                                </TableCell>
                              </>
                            )}
                            <TableCell className="text-sm font-mono">
                              {resKey.split('@')[0]}
                            </TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                {resData.namespace}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {ALL_STANDARD_VERBS.map(v => {
                                  const has = resData.verbs.has(v) || resData.verbs.has('*');
                                  return (
                                    <Badge
                                      key={v}
                                      variant="outline"
                                      className={cn(
                                        'text-[10px] px-1.5 py-0',
                                        has ? verbColor(resData.verbs.has('*') ? '*' : v) : 'opacity-20',
                                      )}
                                    >
                                      {v}
                                    </Badge>
                                  );
                                })}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={resData.roleName}>
                              {resData.roleName}
                            </TableCell>
                          </TableRow>
                        ));
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {matrixRows.length > 200 && (
                <p className="text-xs text-muted-foreground text-center">
                  Showing first 200 subjects of {matrixRows.length}. Use filters to narrow results.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Who Can Tab ─── */}
        <TabsContent value="whocan">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Who Can Query</CardTitle>
              <CardDescription>
                Ask natural questions like &quot;Who can delete pods in namespace production?&quot;
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-xl">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Who can delete pods in namespace production?"
                    value={whoCanInput}
                    onChange={(e) => setWhoCanInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleWhoCanSearch()}
                    className="pl-9 h-10"
                  />
                </div>
                <Button onClick={handleWhoCanSearch} className="h-10 gap-1.5">
                  <Search className="h-4 w-4" />
                  Search
                </Button>
              </div>

              {/* Quick examples */}
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground">Try:</span>
                {[
                  'Who can delete pods in namespace default?',
                  'Who can create deployments?',
                  'Who can get secrets?',
                  'Who can list nodes?',
                ].map(example => (
                  <Button
                    key={example}
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground hover:text-foreground px-2"
                    onClick={() => { setWhoCanInput(example); setWhoCanParsed(parseWhoCanQuery(example)); }}
                  >
                    {example}
                  </Button>
                ))}
              </div>

              {whoCanParsed && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Parsed query:</span>
                    <Badge variant="outline" className={verbColor(whoCanParsed.verb)}>
                      {whoCanParsed.verb}
                    </Badge>
                    <Badge variant="outline">{whoCanParsed.resource}</Badge>
                    {whoCanParsed.namespace && (
                      <Badge variant="secondary">{whoCanParsed.namespace}</Badge>
                    )}
                    <span className="text-muted-foreground ml-2">
                      &mdash; {whoCanSubjects.length} subject{whoCanSubjects.length !== 1 ? 's' : ''} found
                    </span>
                  </div>

                  {whoCanSubjects.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                      No subjects have this permission.
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-auto max-h-[500px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="font-semibold text-xs w-[100px]">Type</TableHead>
                            <TableHead className="font-semibold text-xs min-w-[200px]">Subject</TableHead>
                            <TableHead className="font-semibold text-xs min-w-[300px]">Binding Chain</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {whoCanSubjects.map((s, i) => (
                            <TableRow key={i} className="hover:bg-muted/40">
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  {subjectIcon(s.kind)}
                                  <Badge variant="outline" className="text-[10px] font-normal">{s.kind}</Badge>
                                </div>
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {s.kind === 'ServiceAccount' && s.namespace
                                  ? `${s.namespace}/${s.name}`
                                  : s.name}
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  {s.bindings.map((b, bi) => (
                                    <div key={bi} className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <ChevronRight className="h-3 w-3 shrink-0" />
                                      <span className="font-mono">{b}</span>
                                    </div>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Over-Privileged Tab ─── */}
        <TabsContent value="overprivileged">
          <Card className={overPrivileged.length > 0 ? 'border-red-200 dark:border-red-500/30' : ''}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Over-Privileged Subjects
                    {overPrivilegedSubjectCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {overPrivilegedSubjectCount} subject{overPrivilegedSubjectCount !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Subjects with wildcard verbs (*), wildcard resources (*), or cluster-admin bindings.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {overPrivileged.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                  No over-privileged subjects detected. Your RBAC configuration looks clean.
                </div>
              ) : (
                <div className="border rounded-lg overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-red-500/[0.03]">
                        <TableHead className="font-semibold text-xs w-[100px]">Type</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[200px]">Subject</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[140px]">Resource</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[120px]">Namespace</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[200px]">Reason</TableHead>
                        <TableHead className="font-semibold text-xs min-w-[200px]">Binding Chain</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overPrivileged.map((e, i) => (
                        <TableRow key={i} className="hover:bg-red-500/[0.02]">
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {subjectIcon(e.subjectKind)}
                              <Badge variant="outline" className="text-[10px] font-normal">{e.subjectKind}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-sm">
                            {subjectLabel(e)}
                          </TableCell>
                          <TableCell className="text-sm font-mono">
                            {e.resource === '*' ? (
                              <Badge variant="destructive" className="text-[10px]">* (all)</Badge>
                            ) : e.resource}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              {e.namespace}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {e.reason.split('; ').map((r, ri) => (
                                <Badge key={ri} variant="destructive" className="text-[10px] font-normal">
                                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                  {r}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {e.bindingKind}/{e.bindingName}
                            <ChevronRight className="h-3 w-3 inline mx-0.5" />
                            {e.roleKind}/{e.roleName}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
