import { useState, useMemo } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { useCreateK8sResource } from '@/hooks/useKubernetes';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';

interface CronJobWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

interface ContainerConfig {
  name: string;
  image: string;
  command: string;
  args: string;
  cpu: string;
  memory: string;
}

export function CronJobWizard({ onClose, onSubmit }: CronJobWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('cronjobs');
  
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [schedule, setSchedule] = useState('0 * * * *');
  const [concurrencyPolicy, setConcurrencyPolicy] = useState('Forbid');
  const [suspend, setSuspend] = useState('false');
  const [successfulJobsHistoryLimit, setSuccessfulJobsHistoryLimit] = useState('3');
  const [failedJobsHistoryLimit, setFailedJobsHistoryLimit] = useState('1');
  const [startingDeadlineSeconds, setStartingDeadlineSeconds] = useState('');
  const [restartPolicy, setRestartPolicy] = useState('OnFailure');
  const [containers, setContainers] = useState<ContainerConfig[]>([
    { name: '', image: '', command: '', args: '', cpu: '100m', memory: '128Mi' },
  ]);

  const addContainer = () =>
    setContainers([...containers, { name: '', image: '', command: '', args: '', cpu: '100m', memory: '128Mi' }]);
  const removeContainer = (index: number) => setContainers(containers.filter((_, i) => i !== index));
  const updateContainer = (index: number, field: keyof ContainerConfig, value: string) => {
    const updated = [...containers];
    updated[index][field] = value;
    setContainers(updated);
  };

  const yaml = useMemo(() => {
    const cronJobName = name || 'my-cronjob';
    
    const containersYaml = containers
      .map((c) => {
        let containerYaml = `          - name: ${c.name || 'cron'}
            image: ${c.image || 'busybox:latest'}`;
        
        if (c.command) {
          containerYaml += `
            command: [${c.command.split(',').map(cmd => `"${cmd.trim()}"`).join(', ')}]`;
        }
        
        if (c.args) {
          containerYaml += `
            args: [${c.args.split(',').map(arg => `"${arg.trim()}"`).join(', ')}]`;
        }
        
        containerYaml += `
            resources:
              requests:
                cpu: ${c.cpu || '100m'}
                memory: ${c.memory || '128Mi'}
              limits:
                cpu: ${c.cpu || '100m'}
                memory: ${c.memory || '128Mi'}`;
        
        return containerYaml;
      })
      .join('\n');

    let spec = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${cronJobName}
  namespace: ${namespace}
  labels:
    app: ${cronJobName}
spec:
  schedule: "${schedule}"
  concurrencyPolicy: ${concurrencyPolicy}
  suspend: ${suspend}
  successfulJobsHistoryLimit: ${successfulJobsHistoryLimit}
  failedJobsHistoryLimit: ${failedJobsHistoryLimit}`;

    if (startingDeadlineSeconds) {
      spec += `
  startingDeadlineSeconds: ${startingDeadlineSeconds}`;
    }

    spec += `
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: ${cronJobName}
        spec:
          restartPolicy: ${restartPolicy}
          containers:
${containersYaml}`;

    return spec;
  }, [name, namespace, schedule, concurrencyPolicy, suspend, successfulJobsHistoryLimit, failedJobsHistoryLimit, startingDeadlineSeconds, restartPolicy, containers]);

  const handleCreate = async () => {
    if (config.isConnected) {
      await createResource.mutateAsync({ yaml, namespace });
    }
    onSubmit?.(yaml);
    onClose();
  };

  const schedulePresets = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every day at midnight', value: '0 0 * * *' },
    { label: 'Every day at 2 AM', value: '0 2 * * *' },
    { label: 'Every Sunday at midnight', value: '0 0 * * 0' },
    { label: 'Every 1st of month', value: '0 0 1 * *' },
  ];

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Configure CronJob name and schedule',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">CronJob Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="daily-backup"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace</Label>
              <Select value={namespace} onValueChange={setNamespace}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="kube-system">kube-system</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule">Schedule (Cron Expression)</Label>
            <Input
              id="schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 * * * *"
              className="font-mono"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {schedulePresets.map((preset) => (
                <Button
                  key={preset.value}
                  variant="outline"
                  size="sm"
                  onClick={() => setSchedule(preset.value)}
                  className="text-xs"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'execution',
      title: 'Execution',
      description: 'Configure execution policies and history limits',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Concurrency Policy</Label>
              <Select value={concurrencyPolicy} onValueChange={setConcurrencyPolicy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Allow">Allow</SelectItem>
                  <SelectItem value="Forbid">Forbid</SelectItem>
                  <SelectItem value="Replace">Replace</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {concurrencyPolicy === 'Allow' && 'Allows concurrent runs'}
                {concurrencyPolicy === 'Forbid' && 'Skips new runs if previous is running'}
                {concurrencyPolicy === 'Replace' && 'Cancels previous run and starts new'}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Suspend</Label>
              <Select value={suspend} onValueChange={setSuspend}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Active</SelectItem>
                  <SelectItem value="true">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Successful History</Label>
              <Input
                type="number"
                min="0"
                value={successfulJobsHistoryLimit}
                onChange={(e) => setSuccessfulJobsHistoryLimit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Failed History</Label>
              <Input
                type="number"
                min="0"
                value={failedJobsHistoryLimit}
                onChange={(e) => setFailedJobsHistoryLimit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Starting Deadline (s)</Label>
              <Input
                type="number"
                min="0"
                value={startingDeadlineSeconds}
                onChange={(e) => setStartingDeadlineSeconds(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Restart Policy</Label>
            <Select value={restartPolicy} onValueChange={setRestartPolicy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Never">Never</SelectItem>
                <SelectItem value="OnFailure">OnFailure</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ),
    },
    {
      id: 'containers',
      title: 'Containers',
      description: 'Configure container images and commands',
      content: (
        <div className="space-y-4">
          {containers.map((container, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex justify-between items-center">
                  <Badge>Container {index + 1}</Badge>
                  {containers.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeContainer(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Container Name</Label>
                    <Input
                      value={container.name}
                      onChange={(e) => updateContainer(index, 'name', e.target.value)}
                      placeholder="cron"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Image</Label>
                    <Input
                      value={container.image}
                      onChange={(e) => updateContainer(index, 'image', e.target.value)}
                      placeholder="myapp/backup:v1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Command (comma-separated)</Label>
                    <Input
                      value={container.command}
                      onChange={(e) => updateContainer(index, 'command', e.target.value)}
                      placeholder="/bin/sh, -c"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Args (comma-separated)</Label>
                    <Input
                      value={container.args}
                      onChange={(e) => updateContainer(index, 'args', e.target.value)}
                      placeholder="./backup.sh"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>CPU</Label>
                    <Input
                      value={container.cpu}
                      onChange={(e) => updateContainer(index, 'cpu', e.target.value)}
                      placeholder="100m"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Memory</Label>
                    <Input
                      value={container.memory}
                      onChange={(e) => updateContainer(index, 'memory', e.target.value)}
                      placeholder="128Mi"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" className="w-full gap-2" onClick={addContainer}>
            <Plus className="h-4 w-4" />
            Add Container
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ResourceWizard
      title="Create CronJob"
      resourceType="CronJob"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleCreate}
      isSubmitting={createResource.isPending}
    />
  );
}
