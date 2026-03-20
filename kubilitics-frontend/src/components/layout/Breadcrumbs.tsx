/**
 * Contextual breadcrumbs — Cluster → Namespace → Resource type → Name.
 * Each segment can be a link or dropdown for lateral navigation.
 */
import { Link, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
  className?: string;
}

export function Breadcrumbs({ segments, className }: BreadcrumbsProps) {
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1 list-none p-0 m-0">
        {segments.map((seg, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden
              />
            )}
            {seg.href ? (
              <Link
                to={seg.href}
                className="text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
              >
                {seg.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{seg.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Helper: build breadcrumb segments for a resource detail page */
export function useDetailBreadcrumbs(
  resourceKind: string,
  resourceName: string | undefined,
  namespace: string | undefined,
  clusterName?: string
): BreadcrumbSegment[] {
  const params = useParams();
  const ns = namespace ?? params.namespace ?? 'default';
  const name = resourceName ?? params.name ?? '';

  const segments: BreadcrumbSegment[] = [];
  if (clusterName) {
    segments.push({ label: clusterName, href: '/dashboard' });
  }
  const clusterScopedKinds: string[] = ['IngressClass', 'Node', 'Namespace', 'APIService', 'ClusterRole', 'ClusterRoleBinding', 'PriorityClass', 'StorageClass', 'PersistentVolume', 'VolumeAttachment'];
  const isClusterScoped = clusterScopedKinds.includes(resourceKind) || (!namespace && resourceKind === 'IngressClass');

  const listPaths: Record<string, string> = {
    Pod: '/pods',
    Deployment: '/deployments',
    Node: '/nodes',
    Service: '/services',
    Ingress: '/ingresses',
    IngressClass: '/ingressclasses',
    Endpoints: '/endpoints',
    EndpointSlice: '/endpointslices',
    NetworkPolicy: '/networkpolicies',
    Namespace: '/namespaces',
    Event: '/events',
    APIService: '/apiservices',
    Lease: '/leases',
    ReplicaSet: '/replicasets',
    StatefulSet: '/statefulsets',
    DaemonSet: '/daemonsets',
    Job: '/jobs',
    CronJob: '/cronjobs',
    ConfigMap: '/configmaps',
    Secret: '/secrets',
    PersistentVolume: '/persistentvolumes',
    PersistentVolumeClaim: '/persistentvolumeclaims',
    StorageClass: '/storageclasses',
    VolumeAttachment: '/volumeattachments',
    ServiceAccount: '/serviceaccounts',
    Role: '/roles',
    RoleBinding: '/rolebindings',
    ClusterRole: '/clusterroles',
    ClusterRoleBinding: '/clusterrolebindings',
    PriorityClass: '/priorityclasses',
    ResourceQuota: '/resourcequotas',
    LimitRange: '/limitranges',
    HorizontalPodAutoscaler: '/horizontalpodautoscalers',
    VerticalPodAutoscaler: '/verticalpodautoscalers',
    PodDisruptionBudget: '/poddisruptionbudgets',
  };
  const listPath = listPaths[resourceKind] ?? `/${resourceKind.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}s`;
  if (!isClusterScoped && ns) {
    segments.push({ label: ns, href: `/pods?namespace=${encodeURIComponent(ns)}` });
  }
  segments.push({ label: resourceKind, href: listPath });
  if (name) {
    segments.push({ label: name, href: undefined });
  }
  return segments;
}
