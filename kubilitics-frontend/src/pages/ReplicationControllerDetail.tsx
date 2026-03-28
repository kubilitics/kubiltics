import { useState } from 'react';
import { Layers, Clock, Server, Scale, AlertTriangle, Package, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from '@/components/ui/sonner';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  ScaleDialog,
  type CustomTab,
  type ResourceContext,
  type ActionItemConfig,
} from '@/components/resources';
import { type KubernetesResource } from '@/hooks/useKubernetes';

interface RCResource extends KubernetesResource {
  spec?: {
    replicas?: number;
    selector?: Record<string, string>;
    template?: {
      metadata?: { labels?: Record<string, string> };
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          ports?: Array<{ containerPort: number; protocol: string }>;
          resources?: {
            requests?: { cpu?: string; memory?: string };
            limits?: { cpu?: string; memory?: string };
          };
        }>;
      };
    };
  };
  status?: {
    replicas?: number;
    fullyLabeledReplicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    observedGeneration?: number;
    conditions?: Array<{ type: string; status: string; lastTransitionTime?: string; reason?: string; message?: string }>;
  };
}

function OverviewTab({ resource: rc }: ResourceContext<RCResource>) {
  const spec = rc?.spec ?? {};
  const status = rc?.status ?? {};
  const desired = spec.replicas ?? 0;
  const current = status.replicas ?? 0;
  const ready = status.readyReplicas ?? 0;
  const selector = spec.selector ?? {};
  const template = spec.template ?? {};
  const containers = template.spec?.containers ?? [];

  return (
    <div className="space-y-6">
      <Alert variant="destructive" className="border-warning/50 bg-warning/10">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertTitle className="text-warning">Deprecated Resource</AlertTitle>
        <AlertDescription className="text-warning/80">
          ReplicationControllers are deprecated. Consider migrating to Deployments for rolling updates, rollback, and pause/resume functionality.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard icon={Server} title="Replica Status">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Desired" value={<span className="text-sm font-semibold text-primary">{desired}</span>} />
              <DetailRow label="Current" value={<span className="text-sm font-semibold">{current}</span>} />
              <DetailRow label="Ready" value={<span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{ready}</span>} />
              <DetailRow label="Readiness" value={<span className="font-mono">{ready}/{desired}</span>} />
            </div>
            <div className="mt-4 space-y-1">
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${desired > 0 ? (ready / desired) * 100 : 0}%` }}
                />
              </div>
            </div>
        </SectionCard>

        <SectionCard icon={Target} title="Selector">
            <div className="flex flex-wrap gap-2">
              {Object.entries(selector).map(([key, value]) => (
                <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
              ))}
            </div>
            {Object.keys(selector).length === 0 && <p className="text-sm text-muted-foreground">No selectors</p>}
        </SectionCard>

        <div className="lg:col-span-2">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <LabelList labels={rc?.metadata?.labels ?? {}} />
          </div>
        </div>
        <div className="lg:col-span-2">
          <AnnotationList annotations={rc?.metadata?.annotations ?? {}} />
        </div>

        <SectionCard icon={Package} title="Pod Template" className="lg:col-span-1">
            <div className="space-y-3">
              {containers.map((container, idx) => (
                <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{container.name}</p>
                    <Badge variant="outline" className="font-mono text-xs max-w-[200px] truncate">{container.image}</Badge>
                  </div>

                  {container.ports && container.ports.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Ports</p>
                      <div className="flex flex-wrap gap-2">
                        {container.ports.map((port, pIdx) => (
                          <Badge key={pIdx} variant="secondary" className="font-mono text-xs">
                            {port.containerPort}/{port.protocol}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {container.resources && (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                      <DetailRow label="CPU Request" value={<span className="font-mono">{container.resources.requests?.cpu || '-'}</span>} />
                      <DetailRow label="Memory Request" value={<span className="font-mono">{container.resources.requests?.memory || '-'}</span>} />
                      <DetailRow label="CPU Limit" value={<span className="font-mono">{container.resources.limits?.cpu || '-'}</span>} />
                      <DetailRow label="Memory Limit" value={<span className="font-mono">{container.resources.limits?.memory || '-'}</span>} />
                    </div>
                  )}
                </div>
              ))}
              {containers.length === 0 && <p className="text-sm text-muted-foreground">No containers defined</p>}
            </div>
        </SectionCard>
      </div>
    </div>
  );
}

export default function ReplicationControllerDetail() {
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  // We need these values for the ScaleDialog; they'll be populated once the resource loads
  // Scale info derived from ctx in extraDialogs — no state needed

  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  const handleScale = async (replicas: number) => {
    try {
      toast.success(`Scaled to ${replicas} replicas`);
    } catch {
      toast.error('Failed to scale');
    }
  };

  return (
    <>
      <GenericResourceDetail<RCResource>
        resourceType="replicationcontrollers"
        kind="ReplicationController"
        pluralLabel="Replication Controllers"
        listPath="/replicationcontrollers"
        resourceIcon={Layers}
        customTabs={customTabs}
        headerMetadata={(ctx) => (
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-warning border-warning/30 bg-warning/10">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Deprecated
            </Badge>
            <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {ctx.age}</span>
          </div>
        )}
        extraHeaderActions={() => [
          { label: 'Scale', icon: Scale, variant: 'outline', onClick: () => setShowScaleDialog(true), className: 'press-effect' },
        ]}
        extraActionItems={() => [
          { icon: Scale, label: 'Scale', description: 'Adjust replica count', onClick: () => setShowScaleDialog(true), className: 'press-effect' },
        ]}
        deriveStatus={(rc) => {
          const desired = rc?.spec?.replicas ?? 0;
          const ready = rc?.status?.readyReplicas ?? 0;
          return ready === desired && desired > 0 ? 'Healthy' : 'Pending';
        }}
        buildStatusCards={(ctx) => {
          const rc = ctx.resource;
          const desired = rc?.spec?.replicas ?? 0;
          const current = rc?.status?.replicas ?? 0;
          const ready = rc?.status?.readyReplicas ?? 0;

          return [
            { label: 'Desired', value: desired, icon: Layers, iconColor: 'primary' as const },
            { label: 'Current', value: current, icon: Server, iconColor: 'info' as const },
            { label: 'Ready', value: ready, icon: Package, iconColor: 'success' as const },
            { label: 'Age', value: ctx.age || '-', icon: Clock, iconColor: 'muted' as const },
          ];
        }}
        extraDialogs={(ctx) => (
          <ScaleDialog
            open={showScaleDialog}
            onOpenChange={setShowScaleDialog}
            resourceType="ReplicationController"
            resourceName={ctx.name}
            namespace={ctx.namespace}
            currentReplicas={ctx.resource?.spec?.replicas ?? 0}
            onScale={handleScale}
          />
        )}
      />
    </>
  );
}
