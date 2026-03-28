/**
 * GenericResourceDetail — extracts the common pattern shared by 50+ Kubilitics
 * detail pages into a single reusable component.
 *
 * Every detail page follows the same skeleton:
 *   1. useParams → name / namespace
 *   2. useResourceDetail hook → resource, isLoading, error, age, yaml, isConnected, refetch
 *   3. useResourceEvents → events
 *   4. useDeleteK8sResource / useUpdateK8sResource
 *   5. Tab & search-param sync
 *   6. Loading skeleton → Error card → Not-found card → ResourceDetailLayout
 *   7. Standard tabs: YAML, Events, Compare, Topology, Blast Radius, Actions
 *   8. DeleteConfirmDialog
 *
 * This component handles all of the above. Consumers only need to provide
 * the kind-specific bits: resource type interface, status derivation,
 * status cards, custom tabs (overview, etc.), and header actions.
 */

import { useState, useCallback, useEffect, ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { LucideIcon, Clock, Download, Trash2, Edit, FileCode, GitCompare, Network, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResourceDetailLayout,
  YamlViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  ResourceComparisonView,
  type ResourceStatus,
  type ResourceAction,
  type TabConfig,
} from '@/components/resources';
import { ResourceStatusCardProps } from '@/components/resources/ResourceStatusCard';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, useUpdateK8sResource, type KubernetesResource, type ResourceType } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { BlastRadiusTab } from '@/components/resources/BlastRadiusTab';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { downloadResourceJson } from '@/lib/exportUtils';
import { toast } from '@/components/ui/sonner';
import { normalizeError, notifyError, notifySuccess } from '@/lib/notificationFormatter';
import { BackendApiError, getResource } from '@/services/backendApiClient';
import { isConflictError } from '@/lib/conflictDetection';
import yamlParser from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single custom tab definition provided by the consumer. */
export interface CustomTab {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: number | string;
  /**
   * Render function receiving the loaded resource and helpers so the
   * consumer can build kind-specific UI without re-fetching anything.
   */
  render: (ctx: ResourceContext<any>) => ReactNode;
}

/** Action item for the Actions tab — mirrors the existing ActionsSection API. */
export interface ActionItemConfig {
  icon: LucideIcon;
  label: string;
  description: string;
  variant?: string;
  className?: string;
  onClick?: () => void;
}

/** Context object passed to render functions so consumers have everything. */
export interface ResourceContext<T extends KubernetesResource> {
  resource: T;
  name: string;
  namespace: string;
  age: string;
  yaml: string;
  isConnected: boolean;
  refetch: () => void;
  clusterId: string | null;
  backendBaseUrl: string;
  isBackendConfigured: boolean;
}

export interface GenericResourceDetailProps<T extends KubernetesResource> {
  /** Plural API resource type, e.g. 'configmaps', 'deployments' */
  resourceType: ResourceType;
  /** Singular display kind, e.g. 'ConfigMap', 'Deployment' */
  kind: string;
  /** Plural display label for back link, e.g. 'ConfigMaps', 'Deployments' */
  pluralLabel: string;
  /** Route path prefix for the list page, e.g. '/configmaps' */
  listPath: string;
  /** Icon shown in the header */
  resourceIcon: LucideIcon;

  // --- Customization hooks (all optional with sensible defaults) ---

  /** Derive resource status from the loaded resource. Default: 'Healthy'. */
  deriveStatus?: (resource: T) => ResourceStatus;
  /** Build status cards from the loaded resource. */
  buildStatusCards?: (ctx: ResourceContext<T>) => ResourceStatusCardProps[];
  /** Custom tabs to insert before the standard YAML/Events/Topology tabs. */
  customTabs?: CustomTab[];
  /** Extra header actions beyond the default Download YAML / Edit / Delete. */
  extraHeaderActions?: (ctx: ResourceContext<T>) => ResourceAction[];
  /** Replace the default header actions entirely. */
  headerActions?: (ctx: ResourceContext<T>) => ResourceAction[];
  /** Extra action items for the Actions tab. */
  extraActionItems?: (ctx: ResourceContext<T>) => ActionItemConfig[];
  /** Header metadata slot (right of name). Default: age + Live badge. */
  headerMetadata?: (ctx: ResourceContext<T>) => ReactNode;
  /** Extra dialogs to render alongside DeleteConfirmDialog. */
  extraDialogs?: (ctx: ResourceContext<T> & { showDeleteDialog: boolean; setShowDeleteDialog: (v: boolean) => void }) => ReactNode;
  /** useResourceDetail options (e.g. refetchInterval). */
  detailOptions?: { refetchInterval?: number | false; staleTime?: number };
  /** Number of skeleton cards in loading state. Default: 4. */
  loadingCardCount?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GenericResourceDetail<T extends KubernetesResource>({
  resourceType,
  kind,
  pluralLabel,
  listPath,
  resourceIcon,
  deriveStatus,
  buildStatusCards,
  customTabs = [],
  extraHeaderActions,
  headerActions: headerActionsFn,
  extraActionItems,
  headerMetadata: headerMetadataFn,
  extraDialogs,
  detailOptions,
  loadingCardCount = 4,
}: GenericResourceDetailProps<T>) {
  // --- Routing & params ---
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs(kind, name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const clusterId = useActiveClusterId();
  const isBackendConfiguredFn = useBackendConfigStore((s) => s.isBackendConfigured);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // --- Data fetching ---
  const {
    resource,
    isLoading,
    error: resourceError,
    age,
    yaml,
    isConnected,
    refetch,
  } = useResourceDetail<T>(resourceType, name, namespace, undefined as unknown as T, detailOptions);

  const { events } = useResourceEvents(kind, namespace, name ?? undefined);
  const deleteResource = useDeleteK8sResource(resourceType);
  const updateResource = useUpdateK8sResource(resourceType);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // --- Context object for render props ---
  const ctx: ResourceContext<T> = {
    resource,
    name: resource?.metadata?.name || name || '',
    namespace: resource?.metadata?.namespace || namespace || '',
    age,
    yaml,
    isConnected,
    refetch,
    clusterId: clusterId ?? null,
    backendBaseUrl: baseUrl ?? '',
    isBackendConfigured: isBackendConfiguredFn(),
  };

  // --- Handlers ---
  const handleDownloadYaml = useCallback(async () => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const filename = `${ctx.name || resourceType}.yaml`;
    // Use Tauri-aware download (save dialog in desktop, anchor click in browser)
    try {
      const { downloadFile } = await import('@/topology/graph/utils/exportUtils');
      await downloadFile(blob, filename);
    } catch {
      // Fallback to basic download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [yaml, ctx.name, resourceType]);

  const handleDownloadJson = useCallback(() => {
    downloadResourceJson(resource, `${ctx.name || resourceType}.json`);
    toast.success('JSON downloaded');
  }, [resource, ctx.name, resourceType]);

  const handleSaveYaml = async (newYaml: string) => {
    if (!namespace || !name) return;
    try {
      await updateResource.mutateAsync({ name, namespace, yaml: newYaml });
      notifySuccess({ action: 'update', resourceType, resourceName: name, namespace });
      refetch();
    } catch (e) {
      // Re-throw so the editor can detect 409 conflicts and show the conflict UI.
      // Non-conflict errors are still reported here for structured formatting.
      if (!isConflictError(e)) {
        notifyError(e, { action: 'update', resourceType, resourceName: name, namespace });
      }
      throw e;
    }
  };

  /** Fetch the latest YAML from the server — used by the editor for conflict resolution. */
  const handleFetchLatestYaml = useCallback(async (): Promise<string> => {
    if (!name) throw new Error('Resource name is required');
    if (isBackendConfiguredFn() && clusterId) {
      const latest = await getResource(baseUrl, clusterId, resourceType, namespace || '', name);
      return yamlParser.dump(latest, { lineWidth: -1, noRefs: true });
    }
    throw new Error('Cannot fetch latest: backend not configured');
  }, [name, namespace, resourceType, clusterId, baseUrl, isBackendConfiguredFn]);

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabId === 'overview') next.delete('tab');
      else next.set('tab', tabId);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className={`grid grid-cols-${Math.min(loadingCardCount, 4)} gap-4`}>
          {Array.from({ length: loadingCardCount }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  // --- Error state ---
  if (resourceError) {
    const isBackend404 = resourceError instanceof BackendApiError && resourceError.status === 404;
    const normalized = normalizeError(resourceError, {
      action: 'load',
      resourceType,
      resourceName: name,
      namespace,
    });
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-muted-foreground font-medium">Could not load {kind}.</p>
            <p className="text-sm text-muted-foreground">
              {isBackend404
                ? 'The backend returned 404. Ensure the Kubilitics backend is running (e.g. port 8190) and the cluster is registered in Settings.'
                : normalized.description}
            </p>
            {normalized.details && !isBackend404 && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => {
                  try { void navigator.clipboard.writeText(normalized.details!); } catch { /* ignore */ }
                }}
              >
                Copy technical details
              </button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => refetch()} className="press-effect">Retry</Button>
              <Button variant="outline" onClick={() => navigate(listPath)} className="press-effect">Back to {pluralLabel}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Not-found state ---
  if (isConnected && name && !resource?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{kind} not found.</p>
            <Button variant="outline" className="mt-4 press-effect" onClick={() => navigate(listPath)}>
              Back to {pluralLabel}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Derived values ---
  const status: ResourceStatus = deriveStatus ? deriveStatus(resource) : 'Healthy';
  const statusCards = buildStatusCards ? buildStatusCards(ctx) : [];

  // --- Standard tabs ---
  const standardTabs: TabConfig[] = [
    {
      id: 'events',
      label: 'Events',
      icon: Clock,
      content: <EventsSection events={events} />,
    },
    {
      id: 'yaml',
      label: 'YAML',
      icon: FileCode,
      content: <YamlViewer yaml={yaml} resourceName={ctx.name} editable onSave={handleSaveYaml} onFetchLatest={handleFetchLatestYaml} />,
    },
    {
      id: 'compare',
      label: 'Compare',
      icon: GitCompare,
      content: (
        <ResourceComparisonView
          resourceType={resourceType}
          resourceKind={kind}
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
          kind={normalizeKindForTopology(kind)}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType={kind}
          sourceResourceName={resource?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'blast-radius',
      label: 'Blast Radius',
      icon: Zap,
      content: (
        <BlastRadiusTab
          kind={normalizeKindForTopology(kind)}
          namespace={namespace ?? ''}
          name={name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      icon: Edit,
      content: (
        <ActionsSection actions={[
          { icon: Edit, label: `Edit ${kind}`, description: `Modify this ${kind}`, className: 'press-effect' },
          { icon: Download, label: 'Download YAML', description: `Export ${kind} definition`, onClick: handleDownloadYaml, className: 'press-effect' },
          { icon: Download, label: 'Export as JSON', description: `Export ${kind} as JSON`, onClick: handleDownloadJson, className: 'press-effect' },
          ...(extraActionItems ? extraActionItems(ctx) : []),
          { icon: Trash2, label: `Delete ${kind}`, description: `Remove this ${kind}`, variant: 'destructive', onClick: () => setShowDeleteDialog(true), className: 'press-effect' },
        ]} />
      ),
    },
  ];

  // Merge custom tabs (before standard ones) into the final tab list
  const customRendered: TabConfig[] = customTabs.map((ct) => ({
    id: ct.id,
    label: ct.label,
    icon: ct.icon,
    badge: ct.badge,
    content: ct.render(ctx),
  }));

  const tabs: TabConfig[] = [...customRendered, ...standardTabs];

  // --- Header actions ---
  const defaultHeaderActions: ResourceAction[] = [
    { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml, className: 'press-effect' },
    { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true), className: 'press-effect' },
  ];

  const actions = headerActionsFn
    ? headerActionsFn(ctx)
    : extraHeaderActions
      ? [...defaultHeaderActions.slice(0, -1), ...extraHeaderActions(ctx), defaultHeaderActions[defaultHeaderActions.length - 1]]
      : defaultHeaderActions;

  // --- Header metadata ---
  const headerMetadata = headerMetadataFn ? headerMetadataFn(ctx) : (
    <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />Created {age}
      {isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
    </span>
  );

  // --- Render ---
  return (
    <>
      <ResourceDetailLayout
        role="main"
        aria-label={`${kind} Detail`}
        resourceType={kind}
        resourceIcon={resourceIcon}
        name={ctx.name}
        namespace={ctx.namespace}
        status={status}
        backLink={listPath}
        backLabel={pluralLabel}
        headerMetadata={headerMetadata}
        actions={actions}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      >
        {breadcrumbSegments.length > 0 && (
          <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        )}
      </ResourceDetailLayout>
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType={kind}
        resourceName={ctx.name}
        namespace={ctx.namespace}
        onConfirm={async () => {
          if (isConnected && name && ctx.namespace) {
            await deleteResource.mutateAsync({ name, namespace: ctx.namespace });
            navigate(listPath);
          } else {
            notifySuccess(
              { action: 'delete', resourceType, resourceName: ctx.name, namespace: ctx.namespace },
              { description: 'Demo mode -- no changes were made to your cluster.' },
            );
            navigate(listPath);
          }
        }}
        requireNameConfirmation
      />
      {extraDialogs?.({ ...ctx, showDeleteDialog, setShowDeleteDialog })}
    </>
  );
}
