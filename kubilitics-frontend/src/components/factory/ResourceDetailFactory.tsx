/**
 * Generic ResourceDetailPage component driven by ResourceKindConfig.
 *
 * Renders a complete detail page for any Kubernetes resource kind with:
 *  - Breadcrumb navigation
 *  - Metadata header (name, namespace, age, labels)
 *  - Tabbed content (YAML, Events, Conditions, Pods, etc.)
 *  - Action buttons (delete, scale, edit)
 *  - Dark mode, Framer Motion animations
 *
 * TASK-SCALE-002
 */

import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ChevronRight, Copy, ExternalLink, Loader2, MoreHorizontal,
  RefreshCw, WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { StatusPill, type StatusPillVariant } from '@/components/list';
import { cn } from '@/lib/utils';
import {
  useK8sResourceList, calculateAge,
  type KubernetesResource,
} from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { toast } from '@/components/ui/sonner';
import type { ResourceKindConfig, ResourceTabDef } from '@/lib/resourceKindConfig';
import { resolveAccessorPath } from '@/lib/resourceKindConfig';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ResourceDetailPageProps {
  /** Resource kind configuration */
  config: ResourceKindConfig;
  /** Custom tab renderers: tab id -> React element */
  tabRenderers?: Record<string, (resource: KubernetesResource) => React.ReactNode>;
  /** Extra header actions */
  headerActions?: React.ReactNode;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStatusVariant(resource: KubernetesResource): StatusPillVariant {
  const phase = (resource.status as Record<string, unknown>)?.phase;
  if (typeof phase === 'string') {
    const p = phase.toLowerCase();
    if (['running', 'active', 'bound', 'available', 'ready', 'succeeded'].includes(p)) return 'healthy';
    if (['pending', 'terminating'].includes(p)) return 'warning';
    if (['failed', 'error'].includes(p)) return 'error';
  }
  const conditions = (resource.status as Record<string, unknown>)?.conditions;
  if (Array.isArray(conditions)) {
    const ready = conditions.find((c: Record<string, unknown>) => c.type === 'Ready' || c.type === 'Available');
    if (ready) return (ready as Record<string, unknown>).status === 'True' ? 'healthy' : 'warning';
  }
  return 'neutral';
}

// ── Default Tab Renderers ──────────────────────────────────────────────────────

function YamlTab({ resource }: { resource: KubernetesResource }) {
  return (
    <Card>
      <CardContent className="p-4">
        <pre className="overflow-auto rounded-md bg-muted/50 dark:bg-muted/20 p-4 text-xs font-mono text-foreground dark:text-foreground max-h-[600px]">
          {JSON.stringify(resource, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

function ConditionsTab({ resource }: { resource: KubernetesResource }) {
  const conditions = (resource.status as Record<string, unknown>)?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return <p className="text-muted-foreground text-sm p-4">No conditions reported.</p>;
  }
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Reason</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Message</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Last Transition</th>
            </tr>
          </thead>
          <tbody>
            {conditions.map((cond: Record<string, unknown>, i: number) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2 font-medium">{String(cond.type ?? '')}</td>
                <td className="px-4 py-2">
                  <Badge variant={cond.status === 'True' ? 'default' : 'destructive'}>
                    {String(cond.status ?? '')}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{String(cond.reason ?? '-')}</td>
                <td className="px-4 py-2 text-muted-foreground max-w-xs truncate">{String(cond.message ?? '-')}</td>
                <td className="px-4 py-2 text-muted-foreground text-xs">
                  {cond.lastTransitionTime ? calculateAge(String(cond.lastTransitionTime)) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function LabelsTab({ resource }: { resource: KubernetesResource }) {
  const labels = resource.metadata.labels ?? {};
  const annotations = resource.metadata.annotations ?? {};
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">Labels</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(labels).length === 0 ? (
            <p className="text-sm text-muted-foreground">No labels</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(labels).map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-xs font-mono">
                  {k}={v}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Annotations</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(annotations).length === 0 ? (
            <p className="text-sm text-muted-foreground">No annotations</p>
          ) : (
            <div className="space-y-1">
              {Object.entries(annotations).map(([k, v]) => (
                <div key={k} className="text-xs font-mono">
                  <span className="text-muted-foreground">{k}:</span>{' '}
                  <span className="text-foreground break-all">{v}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusTab({ resource }: { resource: KubernetesResource }) {
  return (
    <Card>
      <CardContent className="p-4">
        <pre className="overflow-auto rounded-md bg-muted/50 dark:bg-muted/20 p-4 text-xs font-mono text-foreground dark:text-foreground max-h-[400px]">
          {JSON.stringify(resource.status, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

function PlaceholderTab({ tab }: { tab: ResourceTabDef }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center p-12">
        <div className="text-center">
          <tab.icon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">{tab.label} tab</p>
          <p className="text-xs text-muted-foreground">Content available when viewing a specific resource.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Built-in tab component map ─────────────────────────────────────────────────

const BUILT_IN_TAB_RENDERERS: Record<string, (resource: KubernetesResource, tab: ResourceTabDef) => React.ReactNode> = {
  yaml: (r) => <YamlTab resource={r} />,
  conditions: (r) => <ConditionsTab resource={r} />,
  labels: (r) => <LabelsTab resource={r} />,
  status: (r) => <StatusTab resource={r} />,
};

// ── Component ──────────────────────────────────────────────────────────────────

export function ResourceDetailPage({
  config,
  tabRenderers,
  headerActions,
}: ResourceDetailPageProps) {
  const params = useParams<{ namespace?: string; name: string }>();
  const navigate = useNavigate();
  const { isOnline } = useConnectionStatus();

  const resourceName = params.name ?? '';
  const resourceNamespace = config.namespaced ? params.namespace : undefined;

  // Fetch all resources and find the one we need
  // (In a real app, you'd use a getResource endpoint; this matches existing patterns)
  const { data, isLoading, isError, error, refetch, isFetching } = useK8sResourceList(
    config.plural as Parameters<typeof useK8sResourceList>[0],
    resourceNamespace,
    { refetchInterval: 15_000 },
  );

  const resource = useMemo(() => {
    if (!data?.items) return null;
    return data.items.find(
      (r) => r.metadata.name === resourceName &&
        (!config.namespaced || r.metadata.namespace === resourceNamespace),
    ) ?? null;
  }, [data, resourceName, resourceNamespace, config.namespaced]);

  const [activeTab, setActiveTab] = useState(config.tabs[0]?.id ?? 'yaml');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !resource) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <p className="text-muted-foreground">
          {isError ? `Error: ${(error as Error)?.message}` : `${config.kind} "${resourceName}" not found.`}
        </p>
        <Button variant="outline" onClick={() => navigate(config.listRoute)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to {config.displayNamePlural}
        </Button>
      </div>
    );
  }

  const Icon = config.icon;
  const age = calculateAge(resource.metadata.creationTimestamp);
  const status = getStatusVariant(resource);

  const renderTabContent = (tab: ResourceTabDef) => {
    // Custom renderer from props
    if (tabRenderers?.[tab.id]) {
      return tabRenderers[tab.id](resource);
    }
    // Built-in renderer
    if (BUILT_IN_TAB_RENDERERS[tab.component]) {
      return BUILT_IN_TAB_RENDERERS[tab.component](resource, tab);
    }
    // Fallback placeholder
    return <PlaceholderTab tab={tab} />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4 p-4 md:p-6"
    >
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to={config.listRoute} className="hover:text-foreground transition-colors">
          {config.displayNamePlural}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        {resourceNamespace && (
          <>
            <span>{resourceNamespace}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </>
        )}
        <span className="text-foreground font-medium">{resourceName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 dark:bg-muted/30">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground dark:text-foreground">
                {resourceName}
              </h1>
              <StatusPill variant={status} label={String((resource.status as Record<string, unknown>)?.phase ?? 'Active')} />
              {!isOnline && <WifiOff className="h-4 w-4 text-amber-500" />}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground">
              {resourceNamespace && <span>Namespace: {resourceNamespace}</span>}
              <span>Age: {age}</span>
              <span>UID: {resource.metadata.uid.slice(0, 8)}...</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                navigator.clipboard.writeText(resourceName);
                toast.success('Copied name to clipboard');
              }}>
                <Copy className="mr-2 h-4 w-4" /> Copy Name
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {config.actions.map((action) => (
                <DropdownMenuItem
                  key={action.kind}
                  className={action.destructive ? 'text-red-600 dark:text-red-400' : undefined}
                  onClick={() => toast.info(`${action.label} action`)}
                >
                  <action.icon className="mr-2 h-4 w-4" />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Labels */}
      {resource.metadata.labels && Object.keys(resource.metadata.labels).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(resource.metadata.labels).slice(0, 8).map(([k, v]) => (
            <Badge key={k} variant="secondary" className="text-xs font-mono">
              {k}={v}
            </Badge>
          ))}
          {Object.keys(resource.metadata.labels).length > 8 && (
            <Badge variant="outline" className="text-xs">
              +{Object.keys(resource.metadata.labels).length - 8} more
            </Badge>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          {config.tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-1.5">
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {config.tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-4">
            {renderTabContent(tab)}
          </TabsContent>
        ))}
      </Tabs>
    </motion.div>
  );
}

ResourceDetailPage.displayName = 'ResourceDetailPage';
