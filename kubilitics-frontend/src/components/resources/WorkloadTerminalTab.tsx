/**
 * Self-contained Terminal tab for any workload that owns pods (Deployment,
 * StatefulSet, DaemonSet, ReplicaSet, Job, CronJob). Owns its own pod query
 * with labelSelector derived from the workload's spec.selector.matchLabels.
 *
 * Why a dedicated component: parent-level pod queries (useK8sResourceList at
 * the page component level) get scoped by the active project's namespace
 * filter, which silently returns empty when the project doesn't include the
 * workload's namespace. A self-contained component that receives the workload
 * via props and runs its own query eliminates all timing, caching, and project-
 * scoping issues. Same architecture that ReplicaSetDetail uses natively.
 */
import { useState } from 'react';
import { Terminal } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { SectionCard } from '@/components/resources';
import { MultiTerminal } from '@/components/resources/MultiTerminal';
import { useK8sResourceList, type KubernetesResource } from '@/hooks/useKubernetes';

interface WorkloadTerminalTabProps {
  /** The workload's spec.selector.matchLabels (Deployment, StatefulSet, DaemonSet, ReplicaSet) or equivalent label filter (Job: { 'job-name': name }). */
  matchLabels: Record<string, string>;
  namespace?: string;
  /** Tooltip text, e.g. "Exec into deployment pods" */
  tooltip?: string;
}

export function WorkloadTerminalTab({ matchLabels, namespace, tooltip }: WorkloadTerminalTabProps) {
  const [selectedPod, setSelectedPod] = useState('');
  const [, setSelectedContainer] = useState('');

  const labelSelector = Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(',');

  const { data: podsList } = useK8sResourceList<KubernetesResource & {
    metadata?: { name?: string; labels?: Record<string, string> };
    spec?: { containers?: Array<{ name: string }> };
  }>(
    'pods',
    namespace,
    { enabled: !!namespace && !!labelSelector, labelSelector, staleTime: 30000 },
  );

  const pods = podsList?.items ?? [];
  const firstPodName = pods[0]?.metadata?.name ?? '';
  const activePod = selectedPod || firstPodName;
  const activePodContainers = pods.find((p) => p.metadata?.name === activePod)?.spec?.containers?.map((c) => c.name) ?? [];

  if (pods.length === 0) {
    return (
      <SectionCard icon={Terminal} title="Terminal" tooltip={tooltip ? <p className="text-xs text-muted-foreground">{tooltip}</p> : undefined}>
        <p className="text-sm text-muted-foreground">
          {!labelSelector ? 'Loading pod selector...' : 'No pods available.'}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard icon={Terminal} title="Terminal" tooltip={tooltip ? <p className="text-xs text-muted-foreground">{tooltip}</p> : undefined}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-2">
            <Label>Pod</Label>
            <Select value={activePod} onValueChange={setSelectedPod}>
              <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select pod" /></SelectTrigger>
              <SelectContent>
                {pods.map((p) => (<SelectItem key={p.metadata?.name} value={p.metadata?.name ?? ''}>{p.metadata?.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {/*
          MultiTerminal owns its own session list with tab UI (+ button to spawn
          new tabs, container picker per-tab). Keyed on activePod so changing the
          pod from the selector above remounts MultiTerminal cleanly with fresh
          sessions targeting the new pod.
        */}
        <MultiTerminal
          key={activePod}
          podName={activePod}
          namespace={namespace ?? ''}
          containers={activePodContainers}
          onContainerChange={setSelectedContainer}
        />
      </div>
    </SectionCard>
  );
}
