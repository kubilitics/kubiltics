import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bell, Clock, Download, AlertTriangle, CheckCircle2, ExternalLink, Network, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ResourceDetailLayout,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  YamlViewer,
  EventsSection,
  ActionsSection,
  ResourceTopologyView,
  type ResourceStatus,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import type { KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { BlastRadiusTab } from '@/components/resources/BlastRadiusTab';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { toast } from '@/components/ui/sonner';
import { downloadResourceJson } from '@/lib/exportUtils';

interface EventResource extends KubernetesResource {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
    uid?: string;
  };
  source?: {
    component?: string;
    host?: string;
  };
}

function getInvolvedObjectLink(kind: string, name: string, namespace: string): string {
  const kindMap: Record<string, string> = {
    Pod: 'pods',
    Deployment: 'deployments',
    ReplicaSet: 'replicasets',
    StatefulSet: 'statefulsets',
    DaemonSet: 'daemonsets',
    Job: 'jobs',
    CronJob: 'cronjobs',
    Service: 'services',
    Ingress: 'ingresses',
    ConfigMap: 'configmaps',
    Secret: 'secrets',
    PersistentVolumeClaim: 'persistentvolumeclaims',
    PersistentVolume: 'persistentvolumes',
    Node: 'nodes',
    Namespace: 'namespaces',
    HorizontalPodAutoscaler: 'horizontalpodautoscalers',
    ServiceAccount: 'serviceaccounts',
  };
  const path = kindMap[kind];
  if (!path) return '#';
  if (kind === 'Node' || kind === 'PersistentVolume' || kind === 'Namespace') {
    return `/${path}/${name}`;
  }
  return `/${path}/${namespace}/${name}`;
}

export default function EventDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const [activeTab, setActiveTab] = useState('overview');

  const { resource: ev, isLoading, error: resourceError, age, yaml, isConnected: resourceConnected, refetch } = useResourceDetail<EventResource>(
    'events',
    name ?? undefined,
    namespace ?? undefined
  );

  const involvedKind = ev?.involvedObject?.kind;
  const involvedName = ev?.involvedObject?.name;
  const involvedNs = ev?.involvedObject?.namespace ?? '';
  const { events: relatedEvents } = useResourceEvents(
    involvedKind ?? '',
    involvedKind === 'Node' || involvedKind === 'Namespace' ? undefined : involvedNs || undefined,
    involvedName ?? undefined
  );

  const eventName = ev?.metadata?.name ?? name ?? '';
  const eventNamespace = ev?.metadata?.namespace ?? namespace ?? '';
  const eventType = (ev?.type === 'Warning' || ev?.type === 'Error' ? ev.type : 'Normal') as 'Normal' | 'Warning' | 'Error';
  const status: ResourceStatus = eventType === 'Normal' ? 'Healthy' : eventType === 'Warning' ? 'Warning' : 'Failed';

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-${eventNamespace}-${eventName}.yaml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [yaml, eventNamespace, eventName]);

  const handleDownloadJson = useCallback(() => {
    if (!ev) return;
    downloadResourceJson(ev, `event-${eventNamespace}-${eventName}.json`);
    toast.success('JSON downloaded');
  }, [ev, eventNamespace, eventName]);

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

  if (isConnected && (resourceError || !ev?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Bell className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Event not found</p>
        <p className="text-sm text-muted-foreground">
          {namespace && name ? `No event "${name}" in namespace "${namespace}".` : 'Missing namespace or name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/events')}>Back to Events</Button>
      </div>
    );
  }

  const involvedLink = involvedKind && involvedName
    ? getInvolvedObjectLink(involvedKind, involvedName, involvedNs)
    : '#';

  const statusCards = [
    { label: 'Type', value: eventType, icon: eventType === 'Normal' ? CheckCircle2 : AlertTriangle, iconColor: (eventType === 'Normal' ? 'success' : 'warning') as const },
    { label: 'Reason', value: ev?.reason ?? '–', icon: Bell, iconColor: 'primary' as const },
    { label: 'Involved Object', value: involvedKind && involvedName ? `${involvedKind}/${involvedName}` : '–', icon: Bell, iconColor: 'muted' as const },
    { label: 'Source', value: ev?.source?.component ?? '–', icon: Bell, iconColor: 'muted' as const },
    { label: 'Count', value: ev?.count ?? 1, icon: Bell, iconColor: 'muted' as const },
    { label: 'First Seen', value: ev?.firstTimestamp ? new Date(ev.firstTimestamp).toISOString() : '–', icon: Clock, iconColor: 'muted' as const },
    { label: 'Last Seen', value: ev?.lastTimestamp ? new Date(ev.lastTimestamp).toISOString() : '–', icon: Clock, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard icon={Bell} title="Event" tooltip="Full event details">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Reason" value={ev?.reason ?? '–'} />
              <DetailRow label="Type" value={<Badge variant={eventType === 'Normal' ? 'secondary' : 'destructive'}>{eventType}</Badge>} />
              <DetailRow label="Count" value={<span className="font-mono">{ev?.count ?? 1}</span>} />
              <DetailRow label="Source" value={ev?.source?.component ?? '–'} />
              <DetailRow label="First Timestamp" value={<span className="font-mono">{ev?.firstTimestamp ?? '–'}</span>} />
              <DetailRow label="Last Timestamp" value={<span className="font-mono">{ev?.lastTimestamp ?? '–'}</span>} />
            </div>
          </SectionCard>
          <SectionCard icon={Bell} title="Message">
            <p className="text-sm font-semibold">{ev?.message ?? '–'}</p>
          </SectionCard>
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LabelList labels={ev?.metadata?.labels ?? {}} />
            </div>
          </div>
          <div className="lg:col-span-2">
            <AnnotationList annotations={ev?.metadata?.annotations ?? {}} />
          </div>
        </div>
      ),
    },
    {
      id: 'involved',
      label: 'Involved Resource',
      content: (
        <SectionCard icon={Bell} title="Involved Resource">
          {involvedKind && involvedName ? (
            <div>
              <p className="text-sm text-muted-foreground mb-2">This event is about the following resource:</p>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{involvedKind}</Badge>
                <span className="font-mono text-sm font-semibold">{involvedName}</span>
                {involvedNs && <Badge variant="outline">{involvedNs}</Badge>}
                {involvedLink !== '#' && (
                  <Button variant="link" size="sm" className="gap-1" onClick={() => navigate(involvedLink)}>
                    View resource <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No involved object.</p>
          )}
        </SectionCard>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={relatedEvents} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={eventName} editable={false} /> },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('Event')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="Event"
          sourceResourceName={ev?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'blast-radius',
      label: 'Blast Radius',
      icon: Zap,
      content: (
        <BlastRadiusTab
          kind={normalizeKindForTopology('Event')}
          namespace={namespace || ev?.metadata?.namespace || ''}
          name={name || ev?.metadata?.name || ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: Download, label: 'Download YAML', description: 'Export event definition', onClick: handleDownloadYaml },
            { icon: Download, label: 'Export as JSON', description: 'Export event as JSON', onClick: handleDownloadJson },
          ]}
        />
      ),
    },
  ];

  return (
    <ResourceDetailLayout
      resourceType="Event"
      resourceIcon={Bell}
      name={eventName}
      status={status}
      backLink="/events"
      backLabel="Events"
      headerMetadata={
        <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
          <Badge variant={eventType === 'Normal' ? 'secondary' : 'destructive'}>{eventType}</Badge>
          <span>{ev?.reason}</span>
          {eventNamespace && <Badge variant="outline">{eventNamespace}</Badge>}
        </span>
      }
      actions={[
        { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
        { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: handleDownloadJson },
      ]}
      statusCards={statusCards}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    />
  );
}
